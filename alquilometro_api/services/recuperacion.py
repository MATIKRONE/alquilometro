import logging
from hashlib import sha256
from secrets import token_urlsafe
from smtplib import SMTPException
from time import time

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from alquilometro_api.core.config import Configuracion
from alquilometro_api.core.seguridad import hashear_password
from alquilometro_api.domain.errores import ValidacionError
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.services.correo import enviar_correo

logger = logging.getLogger(__name__)
VIGENCIA = 30 * 60
ESPERA_REENVIO = 2 * 60


def iniciar_recuperacion(sesion: Session, email: str) -> str | None:
    ahora = int(time())
    token = token_urlsafe(32)
    usuario_id = sesion.scalar(
        update(Usuario)
        .where(
            Usuario.email == email,
            Usuario.habilitada.is_(True),
            or_(
                Usuario.recuperacion_expira.is_(None),
                Usuario.recuperacion_expira
                <= ahora + VIGENCIA - ESPERA_REENVIO,
            ),
        )
        .values(
            recuperacion_hash=sha256(token.encode()).hexdigest(),
            recuperacion_expira=ahora + VIGENCIA,
        )
        .returning(Usuario.id)
    )
    sesion.commit()
    return token if usuario_id is not None else None


def enviar_recuperacion(config: Configuracion, email: str, token: str) -> None:
    enlace = (
        str(config.avisos_url_publica).rstrip('/') + '/#recuperar/' + token
    )
    texto = (
        f'Para elegir una contraseña nueva, abrí este enlace:\n{enlace}\n\n'
        'El enlace vence en 30 minutos y se puede usar una sola vez. '
        'Si no solicitaste el cambio, podés ignorar este correo.'
    )
    try:
        enviar_correo(
            config, email, 'Restablecé tu contraseña de Alquilómetro', texto
        )
    except (OSError, SMTPException):
        logger.warning('No se pudo enviar un correo de recuperación.')


def restablecer_password(sesion: Session, token: str, password: str) -> None:
    condicion = (
        Usuario.recuperacion_hash == sha256(token.encode()).hexdigest(),
        Usuario.habilitada.is_(True),
    )
    usuario_id = sesion.scalar(
        select(Usuario.id).where(
            *condicion, Usuario.recuperacion_expira > int(time())
        )
    )
    mensaje = 'El enlace venció o ya se usó. Pedí uno nuevo.'
    if usuario_id is None:
        raise ValidacionError(mensaje)
    nuevo_hash = hashear_password(password)
    actualizado = sesion.scalar(
        update(Usuario)
        .where(
            Usuario.id == usuario_id,
            *condicion,
            Usuario.recuperacion_expira > int(time()),
        )
        .values(
            password_hash=nuevo_hash,
            recuperacion_hash=None,
            recuperacion_expira=None,
            version_sesion=Usuario.version_sesion + 1,
        )
        .returning(Usuario.id)
    )
    if actualizado is None:
        raise ValidacionError(mensaje)
    sesion.commit()
