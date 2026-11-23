import logging

from alquilometro_api.core.config import get_config

logger = logging.getLogger(__name__)


def borrar_archivo_foto(nombre: str) -> None:
    ruta = get_config().carpeta_fotos / nombre
    try:
        ruta.unlink(missing_ok=True)
    except OSError:
        logger.exception('No se pudo borrar el archivo de foto %s', ruta)
