from collections import Counter
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session, joinedload, raiseload

from alquilometro_api.core.config import get_config
from alquilometro_api.core.database import get_session
from alquilometro_api.core.dependencias import usuario_actual
from alquilometro_api.domain.abonos import DIAS_RETENCION, eliminar_desde
from alquilometro_api.domain.ajuste import sumar_meses
from alquilometro_api.domain.errores import (
    ConflictoDominio,
    PermisoInsuficiente,
    RecursoNoEncontrado,
    ValidacionError,
)
from alquilometro_api.domain.patrocinio import hoy_en_argentina
from alquilometro_api.domain.rol import Rol
from alquilometro_api.models.pago import Pago
from alquilometro_api.models.propiedad import Propiedad
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.admin import (
    AbonoInmobiliariaActualizar,
    ConfirmarPatrocinioEntrada,
    CuentaAdmin,
    CuentasAdmin,
    EstadoInmobiliariaActualizar,
    FiltrosAdmin,
    FiltrosCuentasAdmin,
    InmobiliariaAdmin,
    InmobiliariaCrear,
    PatrocinioActualizar,
    PatrocinioAdmin,
    PublicacionAdmin,
    PublicacionesAdmin,
    RechazarPagoEntrada,
    ResumenAdmin,
)
from alquilometro_api.schemas.pagos import PagoRespuesta
from alquilometro_api.schemas.publicacion import DineroEntrada
from alquilometro_api.services.auth import ServicioAuth
from alquilometro_api.services.pagos import resolver_pago
from alquilometro_api.services.patrocinios import (
    confirmar_pago,
    marcar_vencimiento_visto,
    rechazar_pago,
)
from alquilometro_api.services.publicaciones import (
    CUPO_PILOTO,
    anunciante_visible,
)

AVISOS_POR_PAGINA = 20
CUENTAS_POR_PAGINA = 5
DIAS_REVISION_PAGO = 2
Sesion = Annotated[Session, Depends(get_session)]
UsuarioActual = Annotated[Usuario, Depends(usuario_actual)]


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
    visible = anunciante_visible()
    estados = sesion.execute(
        select(Publicacion.estado, visible, func.count())
        .join(Publicacion.publicador)
        .group_by(Publicacion.estado, visible)
    )
    por_estado: Counter[str] = Counter()
    ocultos = 0
    for estado, se_ve, total in estados:
        por_estado[estado] += total
        if estado == 'activa' and not se_ve:
            ocultos += total
    inmobiliarias = sesion.execute(
        select(
            Usuario.id,
            Usuario.nombre,
            Usuario.email,
            Usuario.habilitada,
            Usuario.abono_vigente_hasta,
            Usuario.abono_pagado_el,
            Usuario.abono_referencia_pendiente,
            func.count(Publicacion.id).label('activas'),
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
            Usuario.id,
            Usuario.nombre,
            Usuario.email,
            Usuario.habilitada,
            Usuario.abono_vigente_hasta,
            Usuario.abono_pagado_el,
            Usuario.abono_referencia_pendiente,
        )
        .order_by(Usuario.nombre, Usuario.id)
    )
    pagos_demorados = set(
        sesion.scalars(
            select(Pago.inmobiliaria_id)
            .join(Usuario, Usuario.id == Pago.inmobiliaria_id)
            .where(
                Pago.concepto == 'abono',
                Pago.estado == 'pendiente',
                Pago.referencia == Usuario.abono_referencia_pendiente,
                Pago.informado_el
                <= hoy_en_argentina() - timedelta(days=DIAS_REVISION_PAGO),
            )
        )
    )
    agencias = [
        InmobiliariaAdmin(
            id=fila.id,
            nombre=fila.nombre,
            email=fila.email,
            habilitada=fila.habilitada,
            activas=fila.activas,
            limite=CUPO_PILOTO,
            abono_vigente_hasta=fila.abono_vigente_hasta,
            abono_pagado_el=fila.abono_pagado_el,
            abono_referencia_pendiente=fila.abono_referencia_pendiente,
            abono_revision_demorada=fila.id in pagos_demorados,
        )
        for fila in inmobiliarias
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


@router.patch('/inmobiliarias/{inmobiliaria_id}/abono', status_code=204)
def cambiar_abono_inmobiliaria(
    inmobiliaria_id: int,
    datos: AbonoInmobiliariaActualizar,
    sesion: Sesion,
    administrador: UsuarioActual,
) -> None:
    usuario = sesion.get(Usuario, inmobiliaria_id)
    if usuario is None or usuario.rol is not Rol.INMOBILIARIA:
        raise RecursoNoEncontrado('No encontramos esa inmobiliaria.')
    inicio = datos.pagado_el
    if (
        inicio
        and usuario.abono_referencia_pendiente
        and not get_config().planes_modo_prueba
        and (datos.referencia is None or datos.conciliacion is None)
    ):
        raise ValidacionError('Completá los datos de la acreditación.')
    if datos.referencia is not None and inicio and usuario.abono_vigente_hasta:
        inicio = max(inicio, usuario.abono_vigente_hasta)
    hasta = sumar_meses(inicio, 1) if inicio else None
    corte = None
    eliminar = eliminar_desde(hasta) if hasta else None
    if hasta is None:
        hoy = hoy_en_argentina()
        anterior = usuario.abono_ocultar_desde
        corte = min(anterior or hoy, hoy)
        eliminar = hoy + timedelta(days=DIAS_RETENCION)
        if anterior and anterior <= hoy and usuario.abono_eliminar_desde:
            eliminar = usuario.abono_eliminar_desde
    consulta = (
        update(Usuario)
        .where(
            Usuario.id == inmobiliaria_id,
            Usuario.abono_vigente_hasta == usuario.abono_vigente_hasta,
            Usuario.abono_corte_sin_pago == usuario.abono_corte_sin_pago,
        )
        .values(
            abono_pagado_el=datos.pagado_el,
            abono_vigente_hasta=hasta,
            abono_eliminar_desde=eliminar,
            abono_corte_sin_pago=corte,
        )
        .returning(Usuario.id)
    )
    if datos.referencia is not None:
        if datos.pagado_el is None:
            raise ValidacionError(
                'Ingresá la fecha del pago para confirmarlo.'
            )
        consulta = consulta.where(
            Usuario.abono_referencia_pendiente == datos.referencia,
        ).values(abono_referencia_pendiente=None)
    if sesion.scalar(consulta) is None:
        raise ConflictoDominio('El pago pendiente cambió. Actualizá el panel.')
    if datos.pagado_el is not None:
        resolver_pago(
            sesion,
            inmobiliaria_id,
            'abono',
            datos.referencia,
            pagado_el=datos.pagado_el,
            conciliacion=datos.conciliacion,
            revisado_por_id=administrador.id,
        )
    sesion.commit()


@router.get('/inmobiliarias/{inmobiliaria_id}/pagos')
def historial_inmobiliaria(
    inmobiliaria_id: int, sesion: Sesion
) -> list[PagoRespuesta]:
    pagos = sesion.scalars(
        select(Pago)
        .where(Pago.inmobiliaria_id == inmobiliaria_id)
        .order_by(Pago.id.desc())
    )
    return [PagoRespuesta.model_validate(pago) for pago in pagos]


@router.patch(
    '/inmobiliarias/{inmobiliaria_id}/abono/rechazar', status_code=204
)
def rechazar_abono(
    inmobiliaria_id: int,
    datos: RechazarPagoEntrada,
    sesion: Sesion,
    administrador: UsuarioActual,
) -> None:
    registro = sesion.scalar(
        update(Usuario)
        .where(
            Usuario.id == inmobiliaria_id,
            Usuario.rol == Rol.INMOBILIARIA,
            Usuario.abono_referencia_pendiente == datos.referencia,
        )
        .values(abono_referencia_pendiente=None)
        .returning(Usuario.id)
    )
    if registro is None:
        raise ConflictoDominio('El pago pendiente cambió. Actualizá el panel.')
    resolver_pago(
        sesion,
        inmobiliaria_id,
        'abono',
        datos.referencia,
        motivo=datos.motivo,
        revisado_por_id=administrador.id,
    )
    sesion.commit()


@router.get('/cuentas')
def cuentas(
    filtros: Annotated[FiltrosCuentasAdmin, Query()], sesion: Sesion
) -> CuentasAdmin:
    consulta = select(Usuario)
    if filtros.rol is not None:
        consulta = consulta.where(Usuario.rol == filtros.rol)
    if filtros.habilitada is not None:
        consulta = consulta.where(Usuario.habilitada.is_(filtros.habilitada))
    total = sesion.scalar(
        select(func.count()).select_from(consulta.subquery())
    )
    usuarios = sesion.scalars(
        consulta
        .order_by(Usuario.nombre, Usuario.id)
        .offset((filtros.pagina - 1) * CUENTAS_POR_PAGINA)
        .limit(CUENTAS_POR_PAGINA)
    )
    return CuentasAdmin(
        cuentas=[CuentaAdmin.model_validate(usuario) for usuario in usuarios],
        total=total or 0,
        por_pagina=CUENTAS_POR_PAGINA,
    )


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
    if filtros.estado == 'visible':
        consulta = consulta.where(
            Publicacion.estado == 'activa', anunciante_visible()
        )
    elif filtros.estado is not None:
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
                patrocinada=p.patrocinio_activo,
                operacion=p.operacion,
                zona=p.propiedad.zona,
                anunciante=p.publicador.nombre,
                anunciante_habilitado=p.publicador.habilitada,
                anunciante_visible=p.publicador.avisos_visibles,
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
        .values(
            patrocinada=datos.patrocinada,
            patrocinio_desde=None,
            patrocinio_hasta=None,
        )
        .returning(Publicacion.id)
    ).scalar_one_or_none()
    if publicacion is None:
        raise RecursoNoEncontrado('No encontramos ese aviso.')
    sesion.commit()


@router.get('/patrocinios')
def patrocinios(sesion: Sesion) -> list[PatrocinioAdmin]:
    hoy = hoy_en_argentina()
    avisos = sesion.scalars(
        select(Publicacion)
        .where(
            or_(
                Publicacion.patrocinio_pendiente.is_(True),
                and_(
                    Publicacion.patrocinio_hasta.is_not(None),
                    or_(
                        Publicacion.patrocinio_hasta >= hoy,
                        Publicacion.patrocinio_vencimiento_visto.is_(False),
                    ),
                ),
            )
        )
        .options(
            joinedload(Publicacion.propiedad),
            joinedload(Publicacion.publicador),
            raiseload(Publicacion.fotos),
        )
        .order_by(Publicacion.id.desc())
    )
    return [
        PatrocinioAdmin(
            id=aviso.id,
            titulo=aviso.titulo_visible,
            inmobiliaria=aviso.publicador.nombre,
            referencia=aviso.patrocinio_referencia,
            pendiente=aviso.patrocinio_pendiente,
            desde=aviso.patrocinio_desde,
            hasta=aviso.patrocinio_hasta,
            aviso_vencimiento=(
                aviso.patrocinio_hasta is not None
                and aviso.patrocinio_hasta <= hoy
                and not aviso.patrocinio_vencimiento_visto
            ),
            vencido=(
                aviso.patrocinio_hasta is not None
                and aviso.patrocinio_hasta < hoy
            ),
        )
        for aviso in avisos
    ]


@router.patch('/patrocinios/{aviso_id}/confirmar', status_code=204)
def confirmar_patrocinio(
    aviso_id: int,
    datos: ConfirmarPatrocinioEntrada,
    sesion: Sesion,
    administrador: UsuarioActual,
) -> None:
    if not get_config().planes_modo_prueba and (
        datos.referencia is None or datos.conciliacion is None
    ):
        raise ValidacionError('Completá los datos de la acreditación.')
    confirmar_pago(sesion, aviso_id, datos, administrador.id)


@router.patch('/patrocinios/{aviso_id}/vencimiento-visto', status_code=204)
def ver_vencimiento(aviso_id: int, sesion: Sesion) -> None:
    marcar_vencimiento_visto(sesion, aviso_id)


@router.patch('/patrocinios/{aviso_id}/rechazar', status_code=204)
def rechazar_patrocinio(
    aviso_id: int,
    datos: RechazarPagoEntrada,
    sesion: Sesion,
    administrador: UsuarioActual,
) -> None:
    rechazar_pago(
        sesion, aviso_id, datos.referencia, datos.motivo, administrador.id
    )
