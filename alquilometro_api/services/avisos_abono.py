import logging
from datetime import date, timedelta
from smtplib import SMTPException

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alquilometro_api.core.config import Configuracion, get_config
from alquilometro_api.core.database import get_engine
from alquilometro_api.domain.patrocinio import hoy_en_argentina
from alquilometro_api.domain.rol import Rol
from alquilometro_api.models.pago import AvisoAbonoEnviado
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.services.correo import correo_configurado, enviar_correo

logger = logging.getLogger(__name__)
ANTICIPACION = timedelta(days=3)


def aviso_correspondiente(
    usuario: Usuario, hoy: date
) -> tuple[str, date] | None:
    hasta = usuario.abono_vigente_hasta
    corte = usuario.abono_ocultar_desde
    eliminar = usuario.abono_eliminar_desde
    if hasta and hasta - ANTICIPACION <= hoy <= hasta:
        return 'por_vencer', hasta
    if corte is None or hoy < corte or (eliminar and hoy >= eliminar):
        return None
    if eliminar and hoy >= eliminar - ANTICIPACION:
        if usuario.abono_referencia_pendiente is None:
            return 'por_eliminar', eliminar
        return None
    return 'ocultos', corte


def enviar_aviso(
    config: Configuracion, destinatario: str, tipo: str, fecha: date
) -> None:
    asunto = {
        'por_vencer': 'Tu abono está por vencer',
        'ocultos': 'Tus avisos quedaron ocultos',
        'por_eliminar': 'Tus avisos se eliminarán pronto',
    }[tipo]
    dia = fecha.strftime('%d/%m/%Y')
    texto = {
        'por_vencer': f'Tu abono está vigente hasta el {dia}.',
        'ocultos': f'Tus avisos están ocultos desde el {dia}.',
        'por_eliminar': f'Sin renovación, se eliminarán desde el {dia}.',
    }[tipo]
    url = str(config.avisos_url_publica).rstrip('/') + '/#planes'
    enviar_correo(
        config,
        destinatario,
        'Alquilómetro · ' + asunto,
        f'{texto}\n\nPara revisar tu abono entrá a {url}\n',
    )


def enviar_avisos_de_abono() -> None:
    config = get_config()
    if config.planes_modo_prueba or not correo_configurado(config):
        return
    hoy = hoy_en_argentina()
    with Session(get_engine()) as sesion:
        agencias = list(
            sesion.scalars(
                select(Usuario.id).where(
                    Usuario.rol == Rol.INMOBILIARIA,
                    Usuario.habilitada.is_(True),
                    Usuario.publicaciones.any(),
                )
            )
        )
        for agencia in agencias:
            usuario = sesion.get(Usuario, agencia)
            if usuario is None:
                continue
            aviso = aviso_correspondiente(usuario, hoy)
            if aviso is None or sesion.get(
                AvisoAbonoEnviado, (agencia, *aviso)
            ):
                continue
            tipo, limite = aviso
            sesion.add(
                AvisoAbonoEnviado(
                    inmobiliaria_id=agencia, tipo=tipo, fecha_limite=limite
                )
            )
            try:
                sesion.flush()
                enviar_aviso(config, usuario.email, tipo, limite)
                sesion.commit()
            except IntegrityError:
                sesion.rollback()
            except (OSError, SMTPException, ValueError):
                sesion.rollback()
                logger.warning(
                    'Falló el aviso %s de la inmobiliaria %s.', tipo, agencia
                )
