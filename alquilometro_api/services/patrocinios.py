from datetime import date, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from alquilometro_api.domain.errores import ConflictoDominio
from alquilometro_api.domain.patrocinio import (
    DIAS_PATROCINIO,
    hoy_en_argentina,
)
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.admin import ConfirmarPatrocinioEntrada
from alquilometro_api.services.pagos import anotar_pago, resolver_pago
from alquilometro_api.services.publicaciones import (
    ServicioPublicaciones,
    anunciante_visible,
)


def informar_pago(
    sesion: Session,
    aviso_id: int,
    referencia: str,
    inmobiliaria: Usuario,
    importe_ars: int,
) -> None:
    publicacion = ServicioPublicaciones(sesion).obtener_gestionable(
        aviso_id, inmobiliaria
    )
    aviso = sesion.scalar(
        update(Publicacion)
        .where(
            Publicacion.id == aviso_id,
            Publicacion.estado == 'activa',
            Publicacion.patrocinio_pendiente.is_(False),
            Publicacion.publicador.has(anunciante_visible()),
        )
        .values(patrocinio_pendiente=True, patrocinio_referencia=referencia)
        .returning(Publicacion.id)
    )
    if aviso is None:
        raise ConflictoDominio(
            'El aviso debe estar visible y no tener otro pago pendiente.'
        )
    anotar_pago(
        sesion,
        inmobiliaria.id,
        'patrocinio',
        referencia,
        importe_ars,
        aviso=publicacion,
    )
    sesion.commit()


def confirmar_pago(
    sesion: Session,
    aviso_id: int,
    datos: ConfirmarPatrocinioEntrada,
    admin_id: int,
) -> None:
    desde = datos.desde
    aviso = sesion.scalar(
        select(Publicacion).where(Publicacion.id == aviso_id)
    )
    if aviso is None or (
        datos.referencia is not None
        and datos.referencia != aviso.patrocinio_referencia
    ):
        raise ConflictoDominio('El pago pendiente cambió. Actualizá el panel.')
    dias = timedelta(days=DIAS_PATROCINIO - 1)
    inicio = desde
    hasta = aviso.patrocinio_hasta
    if aviso.patrocinada and hasta and hasta >= hoy_en_argentina():
        inicio = aviso.patrocinio_desde or desde
        dias += timedelta(days=1)
        desde = hasta
    if desde > date.max - dias:
        raise ConflictoDominio('La fecha supera el límite del calendario.')
    publicacion = sesion.scalar(
        update(Publicacion)
        .where(
            Publicacion.id == aviso_id,
            Publicacion.estado == 'activa',
            Publicacion.patrocinio_pendiente.is_(True),
            Publicacion.patrocinio_referencia == aviso.patrocinio_referencia,
            Publicacion.patrocinio_hasta == hasta,
            Publicacion.patrocinada == aviso.patrocinada,
            Publicacion.publicador.has(anunciante_visible()),
        )
        .values(
            patrocinada=True,
            patrocinio_pendiente=False,
            patrocinio_desde=inicio,
            patrocinio_hasta=desde + dias,
            patrocinio_vencimiento_visto=False,
        )
        .returning(Publicacion)
    )
    if publicacion is None:
        raise ConflictoDominio(
            'El aviso debe estar visible y el pago debe seguir pendiente.'
        )
    resolver_pago(
        sesion,
        publicacion.publicador_id,
        'patrocinio',
        publicacion.patrocinio_referencia,
        aviso=publicacion,
        pagado_el=datos.pagado_el,
        conciliacion=datos.conciliacion,
        revisado_por_id=admin_id,
    )
    sesion.commit()


def rechazar_pago(
    sesion: Session, aviso_id: int, referencia: str, motivo: str, admin_id: int
) -> None:
    anuncio = sesion.scalar(
        update(Publicacion)
        .where(
            Publicacion.id == aviso_id,
            Publicacion.patrocinio_pendiente.is_(True),
            Publicacion.patrocinio_referencia == referencia,
        )
        .values(patrocinio_pendiente=False)
        .returning(Publicacion)
    )
    if anuncio is None:
        raise ConflictoDominio('El aviso ya no tiene un pago pendiente.')
    resolver_pago(
        sesion,
        anuncio.publicador_id,
        'patrocinio',
        anuncio.patrocinio_referencia,
        motivo=motivo,
        aviso=anuncio,
        revisado_por_id=admin_id,
    )
    sesion.commit()


def marcar_vencimiento_visto(sesion: Session, aviso_id: int) -> None:
    aviso = sesion.scalar(
        update(Publicacion)
        .where(
            Publicacion.id == aviso_id,
            Publicacion.patrocinio_hasta <= hoy_en_argentina(),
        )
        .values(patrocinio_vencimiento_visto=True)
        .returning(Publicacion.id)
    )
    if aviso is None:
        raise ConflictoDominio('El aviso todavía no tiene un vencimiento.')
    sesion.commit()
