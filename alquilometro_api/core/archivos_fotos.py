import logging
import re
from itertools import batched
from time import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from alquilometro_api.core.config import get_config
from alquilometro_api.core.database import get_engine
from alquilometro_api.models.foto_publicacion import FotoPublicacion

logger = logging.getLogger(__name__)
NOMBRE_FOTO = re.compile(r'[0-9a-f]{32}')
SEGUNDOS_ANTES_DE_REVISAR = 24 * 60 * 60


def borrar_archivo_foto(nombre: str) -> None:
    ruta = get_config().carpeta_fotos / nombre
    try:
        ruta.unlink(missing_ok=True)
    except OSError:
        logger.exception('No se pudo borrar el archivo de foto %s', ruta)


def borrar_fotos_sin_referencias(sesion: Session, nombres: list[str]) -> None:
    for lote in batched(set(nombres), 500):
        usadas = set(
            sesion.scalars(
                select(FotoPublicacion.nombre_archivo).where(
                    FotoPublicacion.nombre_archivo.in_(lote)
                )
            )
        )
        for nombre in set(lote) - usadas:
            borrar_archivo_foto(nombre)


def revisar_fotos_huerfanas() -> int:
    config = get_config()
    carpeta = config.carpeta_fotos
    if not carpeta.is_dir():
        return 0
    corte = time() - SEGUNDOS_ANTES_DE_REVISAR
    candidatas = set()
    for ruta in carpeta.iterdir():
        if not NOMBRE_FOTO.fullmatch(ruta.name) or ruta.is_symlink():
            continue
        try:
            if ruta.is_file() and ruta.stat().st_mtime <= corte:
                candidatas.add(ruta.name)
        except FileNotFoundError:
            continue
    if not candidatas:
        return 0
    with Session(get_engine()) as sesion:
        usadas = set(
            sesion.scalars(select(FotoPublicacion.nombre_archivo).distinct())
        )
        huerfanas = candidatas - usadas
        if config.fotos_eliminar_huerfanas:
            borrar_fotos_sin_referencias(sesion, list(huerfanas))
    if huerfanas:
        logger.warning(
            'Se detectaron %d archivos de foto huérfanos.', len(huerfanas)
        )
    return len(huerfanas)
