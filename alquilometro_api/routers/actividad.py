from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alquilometro_api.core.database import get_session
from alquilometro_api.core.dependencias import usuario_actual
from alquilometro_api.domain.errores import (
    ConflictoDominio,
    PermisoInsuficiente,
    RecursoNoEncontrado,
)
from alquilometro_api.domain.patrocinio import hoy_en_argentina
from alquilometro_api.domain.rol import Rol
from alquilometro_api.models.actividad import MetricaDiariaAviso, ReporteAviso
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.routers.admin import exigir_admin
from alquilometro_api.services.publicaciones import ServicioPublicaciones

router = APIRouter(tags=['actividad de avisos'])
Sesion = Annotated[Session, Depends(get_session)]
UsuarioActual = Annotated[Usuario, Depends(usuario_actual)]
MotivoReporte = Literal['no_disponible', 'precio', 'duplicado', 'otro']


class ConfirmarDisponibilidad(BaseModel):
    avisos: set[Annotated[int, Field(gt=0)]] = Field(
        min_length=1, max_length=30
    )


class ReporteEntrada(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    motivo: MotivoReporte
    comentario: str | None = Field(default=None, max_length=500)


class ReporteRespuesta(ReporteEntrada):
    model_config = ConfigDict(from_attributes=True)
    id: int
    publicacion_id: int | None
    titulo: str
    fecha: date


class Metricas(BaseModel):
    visitas: int = 0
    clics_whatsapp: int = 0


class MetricasPeriodo(BaseModel):
    desde: date
    hasta: date
    normales: Metricas
    destacados: Metricas


@router.patch('/actividad/disponibilidad', status_code=204)
def confirmar_disponibilidad(
    datos: ConfirmarDisponibilidad,
    usuario: UsuarioActual,
    sesion: Sesion,
) -> None:
    if usuario.rol not in {Rol.INMOBILIARIA, Rol.ADMIN}:
        raise PermisoInsuficiente(
            'Solo el anunciante puede confirmar el aviso.'
        )
    consulta = update(Publicacion).where(
        Publicacion.id.in_(datos.avisos),
        Publicacion.estado == 'activa',
    )
    if usuario.rol is not Rol.ADMIN:
        consulta = consulta.where(Publicacion.publicador_id == usuario.id)
    confirmados = set(
        sesion.scalars(
            consulta.values(
                disponibilidad_confirmada=hoy_en_argentina(),
            ).returning(Publicacion.id)
        )
    )
    if confirmados != datos.avisos:
        sesion.rollback()
        raise ConflictoDominio('Elegí únicamente avisos activos de tu cuenta.')
    sesion.commit()


@router.post('/actividad/avisos/{publicacion_id}/reportes', status_code=204)
def reportar(
    publicacion_id: int,
    datos: ReporteEntrada,
    usuario: UsuarioActual,
    sesion: Sesion,
) -> None:
    aviso = ServicioPublicaciones(sesion).obtener(publicacion_id)
    if aviso.publicador_id == usuario.id:
        raise PermisoInsuficiente('Podés editar este aviso desde tu cuenta.')
    sesion.add(
        ReporteAviso(
            publicacion_id=aviso.id,
            autor_id=usuario.id,
            titulo=aviso.titulo_visible,
            motivo=datos.motivo,
            comentario=datos.comentario or None,
            fecha=hoy_en_argentina(),
        )
    )
    try:
        sesion.commit()
    except IntegrityError:
        sesion.rollback()
        repetido = sesion.scalar(
            select(ReporteAviso.id).where(
                ReporteAviso.publicacion_id == publicacion_id,
                ReporteAviso.autor_id == usuario.id,
                ReporteAviso.motivo == datos.motivo,
            )
        )
        if repetido is None:
            raise
        raise ConflictoDominio(
            'Ya enviaste un reporte por este motivo.'
        ) from None


@router.get('/admin/reportes', dependencies=[Depends(exigir_admin)])
def reportes_pendientes(sesion: Sesion) -> list[ReporteRespuesta]:
    return [
        ReporteRespuesta.model_validate(reporte)
        for reporte in sesion.scalars(
            select(ReporteAviso)
            .where(ReporteAviso.revisado.is_(False))
            .order_by(ReporteAviso.id.desc())
            .limit(100)
        )
    ]


@router.patch(
    '/admin/reportes/{reporte_id}',
    status_code=204,
    dependencies=[Depends(exigir_admin)],
)
def revisar_reporte(reporte_id: int, sesion: Sesion) -> None:
    reporte = sesion.get(ReporteAviso, reporte_id)
    if reporte is None:
        raise RecursoNoEncontrado('No encontramos ese reporte.')
    reporte.revisado = True
    sesion.commit()


@router.get('/actividad/metricas')
def metricas_recientes(
    usuario: UsuarioActual, sesion: Sesion
) -> MetricasPeriodo:
    if usuario.rol not in {Rol.INMOBILIARIA, Rol.ADMIN}:
        raise PermisoInsuficiente(
            'Las estadísticas requieren una inmobiliaria.'
        )
    hasta = hoy_en_argentina()
    desde = hasta - timedelta(days=29)
    metrica = MetricaDiariaAviso
    filas = sesion.execute(
        select(
            metrica.destacado,
            func.sum(metrica.visitas),
            func.sum(metrica.clics_whatsapp),
        )
        .join(Publicacion, Publicacion.id == metrica.publicacion_id)
        .where(
            Publicacion.publicador_id == usuario.id,
            metrica.dia.between(desde, hasta),
        )
        .group_by(metrica.destacado)
    )
    grupos = {
        destacado: Metricas(visitas=visitas, clics_whatsapp=clics)
        for destacado, visitas, clics in filas
    }
    return MetricasPeriodo(
        desde=desde,
        hasta=hasta,
        normales=grupos.get(False, Metricas()),
        destacados=grupos.get(True, Metricas()),
    )
