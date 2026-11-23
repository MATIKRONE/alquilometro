from collections import Counter
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session, joinedload, raiseload

from alquilometro_api.core.database import get_session
from alquilometro_api.core.dependencias import usuario_actual
from alquilometro_api.domain.errores import (
    PermisoInsuficiente,
    RecursoNoEncontrado,
    ValidacionError,
)
from alquilometro_api.domain.rol import Rol
from alquilometro_api.models.propiedad import Propiedad
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.admin import (
    EstadoInmobiliariaActualizar,
    FiltrosAdmin,
    InmobiliariaAdmin,
    InmobiliariaCrear,
    PatrocinioActualizar,
    PublicacionAdmin,
    PublicacionesAdmin,
    ResumenAdmin,
)
from alquilometro_api.schemas.publicacion import DineroEntrada
from alquilometro_api.services.auth import ServicioAuth
from alquilometro_api.services.publicaciones import CUPO_PILOTO

AVISOS_POR_PAGINA = 20
Sesion = Annotated[Session, Depends(get_session)]


def exigir_admin(
    respuesta: Response,
    usuario: Annotated[Usuario, Depends(usuario_actual)],
) -> None:
    if usuario.rol is not Rol.ADMIN:
        raise PermisoInsuficiente(
            'El panel requiere una cuenta administradora.'
        )
    respuesta.headers['Cache-Control'] = 'no-store'


router = APIRouter(
    prefix='/admin',
    tags=['administración'],
    dependencies=[Depends(exigir_admin)],
)


@router.get('/resumen')
def resumen(sesion: Sesion) -> ResumenAdmin:
    cantidad = sesion.execute(select(func.count(Usuario.id))).scalar_one()
    estados = sesion.execute(
        select(Publicacion.estado, Usuario.habilitada, func.count())
        .join(Publicacion.publicador)
        .group_by(Publicacion.estado, Usuario.habilitada)
    )
    por_estado: Counter[str] = Counter()
    ocultos = 0
    for estado, habilitada, total in estados:
        por_estado[estado] += total
        if estado == 'activa' and not habilitada:
            ocultos += total
    inmobiliarias = sesion.execute(
        select(
            Usuario.id,
            Usuario.nombre,
            Usuario.email,
            Usuario.habilitada,
            func.count(Publicacion.id),
        )
        .outerjoin(
            Publicacion,
            and_(
                Publicacion.publicador_id == Usuario.id,
                Publicacion.estado == 'activa',
            ),
        )
        .where(Usuario.rol == Rol.INMOBILIARIA)
        .group_by(
            Usuario.id, Usuario.nombre, Usuario.email, Usuario.habilitada
        )
        .order_by(Usuario.nombre, Usuario.id)
    )
    agencias = [
        InmobiliariaAdmin(
            id=uid,
            nombre=nombre,
            email=email,
            habilitada=habilitada,
            activas=activas,
            limite=CUPO_PILOTO,
        )
        for uid, nombre, email, habilitada, activas in inmobiliarias
    ]
    return ResumenAdmin(
        cuentas=cantidad,
        publicaciones_por_estado=dict(por_estado),
        avisos_ocultos=ocultos,
        inmobiliarias=agencias,
    )


@router.post('/inmobiliarias', status_code=201)
def alta_inmobiliaria(
    datos: InmobiliariaCrear, sesion: Sesion
) -> InmobiliariaAdmin:
    if datos.password != datos.password_confirmacion:
        raise ValidacionError('Las contraseñas no coinciden.')
    usuario = ServicioAuth(sesion).registrar(
        datos.nombre,
        datos.email,
        datos.password.get_secret_value(),
        Rol.INMOBILIARIA,
        perfil=datos,
    )
    return InmobiliariaAdmin(
        id=usuario.id,
        nombre=usuario.nombre,
        email=usuario.email,
        habilitada=usuario.habilitada,
        activas=0,
        limite=CUPO_PILOTO,
    )


@router.patch('/inmobiliarias/{inmobiliaria_id}/estado', status_code=204)
def cambiar_estado_inmobiliaria(
    inmobiliaria_id: int,
    datos: EstadoInmobiliariaActualizar,
    sesion: Sesion,
) -> None:
    usuario = sesion.get(Usuario, inmobiliaria_id)
    if usuario is None or usuario.rol is not Rol.INMOBILIARIA:
        raise RecursoNoEncontrado('No encontramos esa inmobiliaria.')
    consulta = (
        update(Usuario)
        .where(
            Usuario.id == inmobiliaria_id,
            Usuario.habilitada != datos.habilitada,
        )
        .values(habilitada=datos.habilitada)
    )
    if not datos.habilitada:
        consulta = consulta.values(version_sesion=Usuario.version_sesion + 1)
    sesion.execute(consulta)
    sesion.commit()


@router.get('/publicaciones')
def publicaciones(
    filtros: Annotated[FiltrosAdmin, Query()], sesion: Sesion
) -> PublicacionesAdmin:
    consulta = (
        select(Publicacion)
        .join(Publicacion.propiedad)
        .join(Publicacion.publicador)
    )
    buscar = filtros.buscar.strip()
    if buscar:
        consulta = consulta.where(
            or_(
                Publicacion.titulo.icontains(buscar, autoescape=True),
                Propiedad.tipo.icontains(buscar, autoescape=True),
                Propiedad.zona.icontains(buscar, autoescape=True),
                Usuario.nombre.icontains(buscar, autoescape=True),
            )
        )
    if filtros.estado is not None:
        consulta = consulta.where(Publicacion.estado == filtros.estado)
    if filtros.operacion is not None:
        consulta = consulta.where(Publicacion.operacion == filtros.operacion)

    total = sesion.execute(
        select(func.count()).select_from(consulta.subquery())
    ).scalar_one()
    avisos = sesion.scalars(
        consulta
        .options(
            joinedload(Publicacion.propiedad),
            joinedload(Publicacion.publicador),
            raiseload(Publicacion.fotos),
        )
        .order_by(Publicacion.id.desc())
        .offset((filtros.pagina - 1) * AVISOS_POR_PAGINA)
        .limit(AVISOS_POR_PAGINA)
    )
    return PublicacionesAdmin(
        avisos=[
            PublicacionAdmin(
                id=p.id,
                titulo=p.titulo_visible,
                estado=p.estado,
                patrocinada=p.patrocinada,
                operacion=p.operacion,
                zona=p.propiedad.zona,
                anunciante=p.publicador.nombre,
                anunciante_habilitado=p.publicador.habilitada,
                precio=DineroEntrada.model_validate(p.precio_publicado),
                visitas=p.visitas,
                clics_whatsapp=p.clics_whatsapp,
            )
            for p in avisos
        ],
        total=total,
        por_pagina=AVISOS_POR_PAGINA,
    )


@router.patch('/publicaciones/{publicacion_id}/patrocinio', status_code=204)
def cambiar_patrocinio(
    publicacion_id: int, datos: PatrocinioActualizar, sesion: Sesion
) -> None:
    publicacion = sesion.execute(
        update(Publicacion)
        .where(Publicacion.id == publicacion_id)
        .values(patrocinada=datos.patrocinada)
        .returning(Publicacion.id)
    ).scalar_one_or_none()
    if publicacion is None:
        raise RecursoNoEncontrado('No encontramos ese aviso.')
    sesion.commit()
