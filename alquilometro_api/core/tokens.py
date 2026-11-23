from datetime import UTC, datetime, timedelta

import jwt

from alquilometro_api.core.config import get_config
from alquilometro_api.domain.errores import NoAutenticado


def crear_token(
    usuario_id: int,
    *,
    vigencia: timedelta | None = None,
    version_sesion: int = 0,
) -> str:
    config = get_config()
    if vigencia is None:
        vigencia = timedelta(minutes=config.jwt_minutos_expiracion)
    ahora = datetime.now(UTC)
    payload = {
        'sub': str(usuario_id),
        'iat': ahora,  # iat: cuando fue emitido
        'exp': ahora + vigencia,
        'version_sesion': version_sesion,
    }
    return jwt.encode(
        payload, config.jwt_secret_key, algorithm=config.jwt_algoritmo
    )


def validar_token(token: str) -> int:
    """Devuelve el id del usuario o lanza NoAutenticado"""
    usuario_id, _ = leer_token(token)
    return usuario_id


def leer_token(token: str) -> tuple[int, int]:
    """Lee el usuario y la versión de sesión de un token verificado."""
    config = get_config()
    try:
        payload = jwt.decode(
            token,
            config.jwt_secret_key,
            algorithms=[config.jwt_algoritmo],
            options={'require': ['exp', 'sub']},
        )
        version = payload.get('version_sesion', 0)
        if type(version) is not int or version < 0:
            raise ValueError('Versión de sesión inválida.')
        return int(payload['sub']), version
    except (jwt.PyJWTError, ValueError):
        msg = 'Token inválido o vencido.'
        raise NoAutenticado(msg) from None
