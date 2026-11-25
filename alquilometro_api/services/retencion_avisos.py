from datetime import timedelta

from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session

from alquilometro_api.core.archivos_fotos import borrar_fotos_sin_referencias
from alquilometro_api.core.database import get_engine
from alquilometro_api.domain.abonos import DIAS_GRACIA, DIAS_RETENCION
from alquilometro_api.domain.patrocinio import hoy_en_argentina
from alquilometro_api.domain.rol import Rol
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.services.pagos import resolver_pago
from alquilometro_api.services.publicaciones import ServicioPublicaciones


def aplicar_retencion_avisos() -> None:
    hoy = hoy_en_argentina()
    vencido = hoy - timedelta(days=DIAS_GRACIA)
    corte_sin_pago = hoy + timedelta(days=DIAS_GRACIA + 1)
    with Session(get_engine()) as sesion:
        sesion.execute(
            update(Usuario)
            .where(
                Usuario.rol == Rol.INMOBILIARIA,
                Usuario.abono_vigente_hasta.is_(None),
                Usuario.abono_corte_sin_pago.is_(None),
                Usuario.publicaciones.any(),
            )
            .values(
                abono_corte_sin_pago=corte_sin_pago,
                abono_eliminar_desde=corte_sin_pago
                + timedelta(days=DIAS_RETENCION),
            )
        )
        # Las cuentas con vencimientos anteriores al despliegue reciben
        # un plazo completo de conservación antes de la primera eliminación.
        sesion.execute(
            update(Usuario)
            .where(
                Usuario.rol == Rol.INMOBILIARIA,
                Usuario.abono_vigente_hasta < vencido,
                Usuario.abono_eliminar_desde.is_(None),
                Usuario.publicaciones.any(),
            )
            .values(abono_eliminar_desde=hoy + timedelta(days=DIAS_RETENCION))
        )
        vencimientos = (
            Usuario.rol == Rol.INMOBILIARIA,
            or_(
                Usuario.abono_vigente_hasta < vencido,
                and_(
                    Usuario.abono_vigente_hasta.is_(None),
                    Usuario.abono_corte_sin_pago <= hoy,
                ),
            ),
            Usuario.abono_eliminar_desde <= hoy,
            Usuario.abono_referencia_pendiente.is_(None),
            Usuario.publicaciones.any(),
        )
        agencias = list(
            sesion.scalars(select(Usuario.id).where(*vencimientos))
        )
        sesion.commit()
        for agencia in agencias:
            tomada = sesion.scalar(
                update(Usuario)
                .where(Usuario.id == agencia, *vencimientos)
                .values(abono_eliminar_desde=Usuario.abono_eliminar_desde)
                .returning(Usuario.id)
            )
            if tomada is None:
                sesion.rollback()
                continue
            avisos = list(
                sesion.scalars(
                    select(Publicacion).where(
                        Publicacion.publicador_id == agencia
                    )
                )
            )
            servicio = ServicioPublicaciones(sesion)
            archivos = []
            for aviso in avisos:
                if aviso.patrocinio_pendiente:
                    resolver_pago(
                        sesion,
                        agencia,
                        'patrocinio',
                        aviso.patrocinio_referencia,
                        motivo='El aviso se eliminó al vencer el abono.',
                        aviso=aviso,
                    )
                archivos.extend(servicio.preparar_eliminacion(aviso))
                sesion.flush()
            sesion.commit()
            borrar_fotos_sin_referencias(sesion, archivos)
