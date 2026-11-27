from time import time_ns
from typing import Annotated
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alquilometro_api.core.database import get_session
from alquilometro_api.core.dependencias import usuario_actual
from alquilometro_api.domain.dinero import Dinero
from alquilometro_api.domain.errores import ErrorDominio
from alquilometro_api.models.guardado import AvisoGuardado, BusquedaGuardada
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.auth import (
    IngresoEntrada,
    PerfilActualizar,
    UsuarioRespuesta,
)
from alquilometro_api.schemas.publicacion import (
    DineroEntrada,
    FiltrosPublicacionesConsulta,
)
from alquilometro_api.services.publicaciones import (
    FiltrosPublicaciones,
    ServicioPublicaciones,
    anunciante_visible,
)
from alquilometro_api.services.usuarios import ServicioUsuarios

router = APIRouter(prefix='/usuarios/me', tags=['usuarios'])
Sesion = Annotated[Session, Depends(get_session)]
UsuarioActual = Annotated[Usuario, Depends(usuario_actual)]
EnlaceBusqueda = Annotated[
    str, Field(max_length=700, pattern=r'^#(buscar|comprar)\?[^\s#]+$')
]


class BusquedaPersonal(BaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)

    nombre: str = Field(min_length=1, max_length=100)
    enlace: EnlaceBusqueda


class NovedadBusqueda(BusquedaPersonal):
    nuevos: int


class NovedadPrecio(BaseModel):
    aviso_id: int
    titulo: str
    precio_anterior: DineroEntrada
    precio_actual: DineroEntrada


class Novedades(BaseModel):
    hasta_us: int = Field(ge=0)
    busquedas: list[NovedadBusqueda]
    precios: list[NovedadPrecio]


@router.get('/guardados')
def obtener_guardados(usuario: UsuarioActual, sesion: Sesion) -> list[int]:
    return list(
        sesion.scalars(
            select(AvisoGuardado.publicacion_id)
            .where(AvisoGuardado.usuario_id == usuario.id)
            .order_by(AvisoGuardado.publicacion_id.desc())
        )
    )


@router.put('/guardados/{publicacion_id}', status_code=204)
def guardar_aviso(
    publicacion_id: int, usuario: UsuarioActual, sesion: Sesion
) -> None:
    clave = (usuario.id, publicacion_id)
    if sesion.get(AvisoGuardado, clave) is not None:
        return
    aviso = ServicioPublicaciones(sesion).obtener(publicacion_id)
    sesion.add(
        AvisoGuardado(
            usuario_id=usuario.id,
            publicacion_id=publicacion_id,
            precio_visto=aviso.precio_alquiler_monto,
            moneda_vista=aviso.precio_alquiler_moneda,
        )
    )
    try:
        sesion.commit()
    except IntegrityError:
        sesion.rollback()
        if sesion.get(AvisoGuardado, clave) is None:
            raise


@router.delete('/guardados/{publicacion_id}', status_code=204)
def quitar_guardado(
    publicacion_id: int, usuario: UsuarioActual, sesion: Sesion
) -> None:
    guardado = sesion.get(AvisoGuardado, (usuario.id, publicacion_id))
    if guardado is not None:
        sesion.delete(guardado)
        sesion.commit()


@router.get('/busquedas', response_model=list[BusquedaPersonal])
def obtener_busquedas(
    usuario: UsuarioActual, sesion: Sesion
) -> list[BusquedaGuardada]:
    return list(
        sesion.scalars(
            select(BusquedaGuardada)
            .where(BusquedaGuardada.usuario_id == usuario.id)
            .order_by(BusquedaGuardada.nombre, BusquedaGuardada.enlace)
        )
    )


@router.put('/busquedas', status_code=204)
def guardar_busqueda(
    datos: BusquedaPersonal, usuario: UsuarioActual, sesion: Sesion
) -> None:
    guardada = sesion.get(BusquedaGuardada, (usuario.id, datos.enlace))
    if guardada is None:
        guardada = BusquedaGuardada(
            usuario_id=usuario.id,
            enlace=datos.enlace,
            ultima_revision_us=time_ns() // 1000,
        )
        sesion.add(guardada)
    guardada.nombre = datos.nombre
    sesion.commit()


@router.delete('/busquedas', status_code=204)
def quitar_busqueda(
    enlace: Annotated[EnlaceBusqueda, Query()],
    usuario: UsuarioActual,
    sesion: Sesion,
) -> None:
    guardada = sesion.get(BusquedaGuardada, (usuario.id, enlace))
    if guardada is not None:
        sesion.delete(guardada)
        sesion.commit()


def avisos_guardados_visibles(usuario_id: int, sesion: Session):
    return sesion.execute(
        select(AvisoGuardado, Publicacion)
        .join(Publicacion, Publicacion.id == AvisoGuardado.publicacion_id)
        .where(
            AvisoGuardado.usuario_id == usuario_id,
            Publicacion.estado == 'activa',
            Publicacion.publicador.has(anunciante_visible()),
        )
    )


@router.get('/alertas')
def novedades(usuario: UsuarioActual, sesion: Sesion) -> Novedades:
    hasta = time_ns() // 1000
    busquedas = []
    servicio = ServicioPublicaciones(sesion)
    for guardada in obtener_busquedas(usuario, sesion):
        if guardada.ultima_revision_us is None:
            guardada.ultima_revision_us = hasta
        if guardada.ultima_revision_us >= hasta:
            continue
        pagina, _, query = guardada.enlace.partition('?')
        filtros = dict(parse_qsl(query))
        filtros['operacion'] = 'venta' if pagina == '#comprar' else 'alquiler'
        try:
            consulta = FiltrosPublicacionesConsulta.model_validate(filtros)
            coincidencias = servicio.listar(
                FiltrosPublicaciones(
                    **consulta.model_dump(),
                    periodo_creacion_us=(guardada.ultima_revision_us, hasta),
                )
            )
        except (ValidationError, ErrorDominio):
            continue
        nuevos = len(coincidencias)
        if nuevos:
            busquedas.append(
                NovedadBusqueda(
                    nombre=guardada.nombre,
                    enlace=guardada.enlace,
                    nuevos=nuevos,
                )
            )

    precios = []
    for guardado, aviso in avisos_guardados_visibles(usuario.id, sesion):
        monto = aviso.precio_alquiler_monto
        moneda = aviso.precio_alquiler_moneda
        if guardado.precio_visto is None or guardado.moneda_vista != moneda:
            guardado.precio_visto = monto
            guardado.moneda_vista = moneda
        elif monto < guardado.precio_visto:
            precios.append(
                NovedadPrecio(
                    aviso_id=aviso.id,
                    titulo=aviso.titulo_visible,
                    precio_anterior=DineroEntrada(
                        monto=guardado.precio_visto, moneda=moneda
                    ),
                    precio_actual=DineroEntrada(monto=monto, moneda=moneda),
                )
            )
        elif monto > guardado.precio_visto:
            guardado.precio_visto = monto
    sesion.commit()
    return Novedades(hasta_us=hasta, busquedas=busquedas, precios=precios)


@router.post('/alertas/vistas', status_code=204)
def marcar_novedades_vistas(
    datos: Novedades,
    usuario: UsuarioActual,
    sesion: Sesion,
) -> None:
    hasta = min(datos.hasta_us, time_ns() // 1000)
    for guardada in obtener_busquedas(usuario, sesion):
        guardada.ultima_revision_us = max(
            guardada.ultima_revision_us or 0, hasta
        )
    precios = {
        precio.aviso_id: precio.precio_actual for precio in datos.precios
    }
    for guardado, aviso in avisos_guardados_visibles(usuario.id, sesion):
        precio = precios.get(aviso.id)
        if precio and precio.moneda == aviso.precio_alquiler_moneda:
            guardado.precio_visto = precio.monto
            guardado.moneda_vista = precio.moneda
    sesion.commit()


@router.put('', response_model=UsuarioRespuesta)
def actualizar_perfil(
    datos: PerfilActualizar,
    usuario: Usuario = Depends(usuario_actual),
    sesion: Session = Depends(get_session),
) -> Usuario:
    return ServicioUsuarios(sesion).actualizar_perfil(usuario, datos)


@router.put('/ingreso-referencia', response_model=UsuarioRespuesta)
def actualizar_ingreso_referencia(
    datos: IngresoEntrada,
    usuario: Usuario = Depends(usuario_actual),
    sesion: Session = Depends(get_session),
) -> Usuario:
    ingreso = Dinero(datos.monto, datos.moneda)
    return ServicioUsuarios(sesion).actualizar_ingreso_referencia(
        usuario, ingreso
    )


@router.delete('/ingreso-referencia', response_model=UsuarioRespuesta)
def borrar_ingreso_referencia(
    usuario: Usuario = Depends(usuario_actual),
    sesion: Session = Depends(get_session),
) -> Usuario:
    return ServicioUsuarios(sesion).actualizar_ingreso_referencia(
        usuario, None
    )
