from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alquilometro_api.domain.errores import ConflictoDominio
from alquilometro_api.domain.patrocinio import hoy_en_argentina
from alquilometro_api.models.pago import Pago
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.schemas.pagos import ConciliacionPago


def anotar_pago(  # noqa: PLR0913
    sesion: Session,
    inmobiliaria_id: int,
    concepto: str,
    referencia: str,
    importe_ars: int,
    *,
    aviso: Publicacion | None = None,
) -> None:
    sesion.add(
        Pago(
            inmobiliaria_id=inmobiliaria_id,
            concepto=concepto,
            referencia=referencia,
            referencia_en_uso=referencia.casefold(),
            importe_ars=importe_ars,
            aviso_id=aviso.id if aviso else None,
            titulo_aviso=aviso.titulo_visible if aviso else None,
            informado_el=hoy_en_argentina(),
        )
    )
    try:
        sesion.flush()
    except IntegrityError:
        sesion.rollback()
        raise ConflictoDominio(
            'Ese número de operación ya fue informado.'
        ) from None


def resolver_pago(  # noqa: PLR0913
    sesion: Session,
    inmobiliaria_id: int,
    concepto: str,
    referencia: str | None,
    *,
    pagado_el: date | None = None,
    motivo: str | None = None,
    aviso: Publicacion | None = None,
    conciliacion: ConciliacionPago | None = None,
    revisado_por_id: int | None = None,
) -> None:
    aviso_id = aviso.id if aviso else None
    pago = sesion.scalar(
        select(Pago).where(
            Pago.inmobiliaria_id == inmobiliaria_id,
            Pago.concepto == concepto,
            Pago.aviso_id == aviso_id,
            Pago.referencia == referencia,
            Pago.estado == 'pendiente',
        )
    )
    if pago is None:
        pago = Pago(
            inmobiliaria_id=inmobiliaria_id,
            concepto=concepto,
            referencia=referencia,
            aviso_id=aviso_id,
            titulo_aviso=aviso.titulo_visible if aviso else None,
            informado_el=hoy_en_argentina(),
        )
        sesion.add(pago)
    pago.estado = 'rechazado' if motivo else 'confirmado'
    pago.motivo = motivo
    pago.pagado_el = pagado_el
    pago.revisado_por_id = revisado_por_id
    if motivo:
        pago.referencia_en_uso = None
    if conciliacion is None:
        return
    if pagado_el is None or pagado_el > hoy_en_argentina():
        raise ConflictoDominio('Ingresá una fecha de acreditación válida.')
    if (
        pago.importe_ars is not None
        and pago.importe_ars != conciliacion.importe_recibido_ars
    ):
        raise ConflictoDominio(
            'El importe acreditado no coincide con el esperado.'
        )
    pago.importe_recibido_ars = conciliacion.importe_recibido_ars
    pago.medio = conciliacion.medio
    pago.referencia_acreditada = conciliacion.referencia_acreditada
    pago.referencia_acreditada_en_uso = (
        f'{conciliacion.medio}:{conciliacion.referencia_acreditada.casefold()}'
    )
    try:
        sesion.flush()
    except IntegrityError:
        sesion.rollback()
        raise ConflictoDominio('Esa acreditación ya fue registrada.') from None
