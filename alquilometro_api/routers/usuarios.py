from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alquilometro_api.core.database import get_session
from alquilometro_api.core.dependencias import usuario_actual
from alquilometro_api.domain.dinero import Dinero
from alquilometro_api.models.guardado import AvisoGuardado, BusquedaGuardada
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.auth import (
    IngresoEntrada,
    PerfilActualizar,
    UsuarioRespuesta,
)
from alquilometro_api.services.publicaciones import ServicioPublicaciones
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
    ServicioPublicaciones(sesion).obtener(publicacion_id)
    sesion.add(
        AvisoGuardado(usuario_id=usuario.id, publicacion_id=publicacion_id)
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
    sesion.merge(BusquedaGuardada(usuario_id=usuario.id, **datos.model_dump()))
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
