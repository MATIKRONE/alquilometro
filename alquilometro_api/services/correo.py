from email.message import EmailMessage
from smtplib import SMTP_SSL
from ssl import create_default_context

from alquilometro_api.core.config import Configuracion


def correo_configurado(config: Configuracion) -> bool:
    return bool(
        config.avisos_smtp_host
        and config.avisos_smtp_usuario
        and config.avisos_smtp_clave.get_secret_value()
        and config.avisos_email_desde
        and config.avisos_url_publica
    )


def enviar_correo(
    config: Configuracion, destinatario: str, asunto: str, texto: str
) -> None:
    correo = EmailMessage()
    correo['From'] = config.avisos_email_desde
    correo['To'] = destinatario
    correo['Subject'] = asunto
    correo.set_content(texto)
    with SMTP_SSL(
        config.avisos_smtp_host,
        465,
        timeout=8,
        context=create_default_context(),
    ) as servidor:
        servidor.login(
            config.avisos_smtp_usuario,
            config.avisos_smtp_clave.get_secret_value(),
        )
        servidor.send_message(correo)
