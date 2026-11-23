from io import BytesIO
from pathlib import Path
from shutil import copyfileobj
from typing import BinaryIO
from uuid import uuid4

from PIL import Image
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alquilometro_api.core.archivos_fotos import borrar_archivo_foto
from alquilometro_api.core.config import get_config
from alquilometro_api.domain.errores import (
    ConflictoDominio,
    RecursoNoEncontrado,
    ValidacionError,
)
from alquilometro_api.models.foto_publicacion import MAX_FOTOS, FotoPublicacion
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.services.publicaciones import ServicioPublicaciones

MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELES = 24_000_000
FORMATOS = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}


def leer_foto(archivo: BinaryIO) -> tuple[bytes, str]:
    contenido = archivo.read(MAX_BYTES + 1)
    if len(contenido) > MAX_BYTES:
        raise ValidacionError('Cada foto puede pesar hasta 5 MB.')

    try:
        with Image.open(BytesIO(contenido), formats=list(FORMATOS)) as imagen:
            if imagen.width * imagen.height > MAX_PIXELES:
                raise ValidacionError('La foto supera los 24 megapíxeles.')
            imagen.load()
            return contenido, FORMATOS[imagen.format]
    except (
        OSError,
        SyntaxError,
        ValueError,
        Image.DecompressionBombError,
    ) as error:
        msg = 'Subí una imagen JPG, PNG o WebP válida.'
        raise ValidacionError(msg) from error


class ServicioFotos:
    def __init__(self, sesion: Session) -> None:
        self.sesion = sesion
        self.publicaciones = ServicioPublicaciones(sesion)
        self.carpeta = get_config().carpeta_fotos

    def agregar(
        self,
        publicacion_id: int,
        usuario: Usuario,
        archivos: list[BinaryIO],
    ) -> list[FotoPublicacion]:
        publicacion = self.publicaciones.obtener_gestionable(
            publicacion_id,
            usuario,
        )
        ocupados = {foto.espacio for foto in publicacion.fotos}
        libres = [
            espacio
            for espacio in range(1, MAX_FOTOS + 1)
            if espacio not in ocupados
        ]
        if not 1 <= len(archivos) <= len(libres):
            msg = f'Podés guardar hasta {MAX_FOTOS} fotos por publicación.'
            raise ValidacionError(msg)

        fotos = []
        for archivo, espacio in zip(archivos, libres, strict=False):
            _, tipo = leer_foto(archivo)
            archivo.seek(0)
            fotos.append(
                FotoPublicacion(
                    publicacion_id=publicacion.id,
                    espacio=espacio,
                    nombre_archivo=uuid4().hex,
                    tipo_contenido=tipo,
                )
            )

        escritos = []
        try:
            self.sesion.add_all(fotos)
            self.sesion.flush()
            self.carpeta.mkdir(parents=True, exist_ok=True)
            self._guardar_archivos(fotos, archivos, escritos)
            self.sesion.commit()
        except IntegrityError as error:
            self._revertir_carga(escritos)
            raise ConflictoDominio(
                'El aviso o sus fotos cambiaron. Volvé a intentar.',
            ) from error
        except Exception:
            self._revertir_carga(escritos)
            raise
        return fotos

    def servir(
        self,
        publicacion_id: int,
        foto_id: int,
        usuario: Usuario | None = None,
    ) -> tuple[Path, str]:
        if usuario is None:
            self.publicaciones.obtener(publicacion_id)
        else:
            self.publicaciones.obtener_gestionable(publicacion_id, usuario)
        foto = self._obtener(publicacion_id, foto_id)
        ruta = self.carpeta / foto.nombre_archivo
        if not ruta.is_file():
            raise RecursoNoEncontrado('La foto no está disponible.')
        return ruta, foto.tipo_contenido

    def eliminar(
        self, publicacion_id: int, foto_id: int, usuario: Usuario
    ) -> None:
        self.publicaciones.obtener_gestionable(publicacion_id, usuario)
        foto = self._obtener(publicacion_id, foto_id)
        nombre = foto.nombre_archivo
        self.sesion.delete(foto)
        self.sesion.commit()
        borrar_archivo_foto(nombre)

    def _obtener(self, publicacion_id: int, foto_id: int) -> FotoPublicacion:
        foto = self.sesion.get(FotoPublicacion, foto_id)
        if foto is None or foto.publicacion_id != publicacion_id:
            raise RecursoNoEncontrado('La foto no existe en esta publicación.')
        return foto

    def _revertir_carga(self, escritos: list[str]) -> None:
        self.sesion.rollback()
        for nombre in escritos:
            borrar_archivo_foto(nombre)

    def _guardar_archivos(
        self,
        fotos: list[FotoPublicacion],
        archivos: list[BinaryIO],
        escritos: list[str],
    ) -> None:
        for foto, origen in zip(fotos, archivos, strict=True):
            ruta = self.carpeta / foto.nombre_archivo
            with ruta.open('xb') as archivo:
                escritos.append(ruta.name)
                copyfileobj(origen, archivo)
