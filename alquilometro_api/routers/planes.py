from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, HttpUrl, StringConstraints
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from alquilometro_api.core.config import Configuracion, get_config
from alquilometro_api.core.database import get_session
from alquilometro_api.core.dependencias import usuario_actual
from alquilometro_api.domain.abonos import eliminar_desde
from alquilometro_api.domain.errores import (
    ConflictoDominio,
    PermisoInsuficiente,
)
from alquilometro_api.domain.patrocinio import DIAS_PATROCINIO
from alquilometro_api.domain.rol import Rol
from alquilometro_api.models.pago import Pago
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.pagos import PagoRespuesta
from alquilometro_api.services.pagos import anotar_pago
from alquilometro_api.services.patrocinios import informar_pago
from alquilometro_api.services.publicaciones import CUPO_PILOTO

CodigoPlan = Literal['abono', 'patrocinio']
Config = Annotated[Configuracion, Depends(get_config)]


def exigir_acceso_a_planes(
    usuario: Annotated[Usuario, Depends(usuario_actual)],
) -> None:
    if usuario.rol not in {Rol.INMOBILIARIA, Rol.ADMIN}:
        raise PermisoInsuficiente(
            'Los planes requieren una cuenta de inmobiliaria o administradora.'
        )


router = APIRouter(
    prefix='/planes',
    tags=['planes'],
    dependencies=[Depends(exigir_acceso_a_planes)],
)


class PreciosPlanes(BaseModel):
    modo_prueba: bool
    abono_mensual_ars: int
    cupo_avisos_activos: int
    patrocinio_ars: int
    patrocinio_dias: int
    abono_mercado_pago_url: HttpUrl | None
    patrocinio_mercado_pago_url: HttpUrl | None
    abono_pago_pendiente: bool
    abono_vigente_hasta: date | None
    abono_ocultar_desde: date | None
    abono_eliminar_desde: date | None


class DatosTransferencia(BaseModel):
    modo_prueba: bool
    importe_ars: int
    titular: str
    alias: str
    cvu: str


class PagoInformadoEntrada(BaseModel):
    model_config = ConfigDict(extra='forbid')

    referencia: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    ]


@router.get('')
def listar_planes(
    config: Config,
    usuario: Annotated[Usuario, Depends(usuario_actual)],
) -> PreciosPlanes:
    hasta = usuario.abono_vigente_hasta
    return PreciosPlanes(
        modo_prueba=config.planes_modo_prueba,
        abono_mensual_ars=config.planes_abono_mensual_ars,
        cupo_avisos_activos=CUPO_PILOTO,
        patrocinio_ars=config.planes_patrocinio_ars,
        patrocinio_dias=DIAS_PATROCINIO,
        abono_pago_pendiente=usuario.abono_referencia_pendiente is not None,
        abono_vigente_hasta=hasta,
        abono_ocultar_desde=usuario.abono_ocultar_desde,
        abono_eliminar_desde=usuario.abono_eliminar_desde
        or (eliminar_desde(hasta) if hasta else None),
        abono_mercado_pago_url=(
            None
            if config.planes_modo_prueba
            else config.planes_abono_mercado_pago_url
        ),
        patrocinio_mercado_pago_url=(
            None
            if config.planes_modo_prueba
            else config.planes_patrocinio_mercado_pago_url
        ),
    )


@router.get('/{codigo}/transferencia')
def datos_transferencia(
    codigo: CodigoPlan, config: Config, respuesta: Response
) -> DatosTransferencia:
    titular = config.planes_transferencia_titular.strip()
    alias = config.planes_transferencia_alias.strip()
    cvu = config.planes_transferencia_cvu
    if not (titular and alias and cvu):
        raise HTTPException(503, 'Los datos de transferencia no están listos.')
    importe = (
        config.planes_abono_mensual_ars
        if codigo == 'abono'
        else config.planes_patrocinio_ars
    )
    respuesta.headers['Cache-Control'] = 'no-store'
    return DatosTransferencia(
        modo_prueba=config.planes_modo_prueba,
        importe_ars=importe,
        titular=titular,
        alias=alias,
        cvu=cvu,
    )


@router.post('/patrocinios/{aviso_id}/pago', status_code=204)
def informar_pago_patrocinio(
    aviso_id: int,
    datos: PagoInformadoEntrada,
    usuario: Annotated[Usuario, Depends(usuario_actual)],
    sesion: Annotated[Session, Depends(get_session)],
    config: Config,
) -> None:
    if usuario.rol is not Rol.INMOBILIARIA:
        raise PermisoInsuficiente(
            'Solo la inmobiliaria puede informar el pago.'
        )
    informar_pago(
        sesion,
        aviso_id,
        datos.referencia,
        usuario,
        config.planes_patrocinio_ars,
    )


@router.post('/abono/pago', status_code=204)
def informar_pago_abono(
    datos: PagoInformadoEntrada,
    usuario: Annotated[Usuario, Depends(usuario_actual)],
    sesion: Annotated[Session, Depends(get_session)],
    config: Config,
) -> None:
    if usuario.rol is not Rol.INMOBILIARIA:
        raise PermisoInsuficiente('El abono es para cuentas de inmobiliaria.')
    registro = sesion.scalar(
        update(Usuario)
        .where(
            Usuario.id == usuario.id,
            Usuario.abono_referencia_pendiente.is_(None),
        )
        .values(abono_referencia_pendiente=datos.referencia)
        .returning(Usuario.id)
    )
    if registro is None:
        sesion.refresh(usuario, ['abono_referencia_pendiente'])
        if usuario.abono_referencia_pendiente != datos.referencia:
            raise ConflictoDominio('Ya hay un pago de abono pendiente.')
    else:
        anotar_pago(
            sesion,
            usuario.id,
            'abono',
            datos.referencia,
            config.planes_abono_mensual_ars,
        )
    sesion.commit()


@router.get('/pagos')
def historial_pagos(
    usuario: Annotated[Usuario, Depends(usuario_actual)],
    sesion: Annotated[Session, Depends(get_session)],
) -> list[PagoRespuesta]:
    pagos = sesion.scalars(
        select(Pago)
        .where(Pago.inmobiliaria_id == usuario.id)
        .order_by(Pago.id.desc())
    )
    return [PagoRespuesta.model_validate(pago) for pago in pagos]
