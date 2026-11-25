from collections.abc import Iterator
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from PIL import Image, ImageOps
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alquilometro_api.core.archivos_fotos import (
    borrar_archivo_foto,
    borrar_fotos_sin_referencias,
)
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
MAX_BYTES_PUBLICACION = 15 * 1024 * 1024
MAX_PIXELES_PUBLICACION = 50_000_000
LADO_MAXIMO = 1600
LADO_COMPACTO = 1280
PESO_OBJETIVO = 250 * 1024
FORMATOS = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}


def _leer_contenido(archivo: BinaryIO, limite: int) -> bytes:
    contenido = archivo.read(limite + 1)
    if len(contenido) > limite:
        megas = limite // (1024 * 1024)
        raise ValidacionError(f'Cada foto puede pesar hasta {megas} MB.')
    return contenido


@contextmanager
def _abrir_foto(contenido: bytes, max_pixeles: int) -> Iterator[Image.Image]:
    try:
        with Image.open(BytesIO(contenido), formats=list(FORMATOS)) as imagen:
            if imagen.width * imagen.height > max_pixeles:
                megapixeles = max_pixeles // 1_000_000
                raise ValidacionError(
                    f'La foto supera los {megapixeles} megapíxeles.'
                )
            yield imagen
    except (
        OSError,
        SyntaxError,
        ValueError,
        Image.DecompressionBombError,
    ) as error:
        msg = 'Subí una imagen JPG, PNG o WebP válida.'
        raise ValidacionError(msg) from error


def leer_foto(archivo: BinaryIO) -> tuple[bytes, str]:
    contenido = _leer_contenido(archivo, MAX_BYTES)
    with _abrir_foto(contenido, MAX_PIXELES) as imagen:
        imagen.load()
        return contenido, FORMATOS[imagen.format]


def optimizar_foto(archivo: BinaryIO) -> bytes:
    contenido = _leer_contenido(archivo, MAX_BYTES_PUBLICACION)
    with _abrir_foto(contenido, MAX_PIXELES_PUBLICACION) as original:
        # JPEG permite reducir la resolución durante la decodificación.
        original.draft('RGB', (LADO_MAXIMO, LADO_MAXIMO))
        ImageOps.exif_transpose(original, in_place=True)
        original.thumbnail(
            (LADO_MAXIMO, LADO_MAXIMO), Image.Resampling.LANCZOS
        )
        modo = 'RGBA' if original.has_transparency_data else 'RGB'
        with original.convert(modo) as imagen:
            return _codificar_webp(imagen)


def _codificar_webp(imagen: Image.Image) -> bytes:
    for lado, calidad in (
        (LADO_MAXIMO, 82),
        (LADO_MAXIMO, 74),
        (LADO_COMPACTO, 74),
    ):
        imagen.thumbnail((lado, lado), Image.Resampling.LANCZOS)
        salida = BytesIO()
        imagen.save(salida, format='WEBP', quality=calidad)
        if salida.tell() <= PESO_OBJETIVO:
            break
    return salida.getvalue()


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
        *,
        origen_id: int | None = None,
        orden: list[int] | None = None,
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
        posiciones = orden if orden is not None else [0] * len(archivos)
        if not 1 <= len(posiciones) <= len(libres):
            msg = f'Podés guardar hasta {MAX_FOTOS} fotos por publicación.'
            raise ValidacionError(msg)
        if posiciones.count(0) != len(archivos) or any(
            p < 0 for p in posiciones
        ):
            raise ValidacionError('El orden de las fotos no es válido.')

        reutilizadas = [foto_id for foto_id in posiciones if foto_id]
        anteriores = self._cargar_fotos_origen(
            origen_id, publicacion.publicador_id, usuario, reutilizadas
        )

        fotos = []
        optimizadas: dict[str, bytes] = {}
        nuevas = iter(archivos)
        for foto_id, espacio in zip(posiciones, libres, strict=False):
            previa = anteriores.get(foto_id)
            foto = FotoPublicacion(
                publicacion_id=publicacion.id,
                espacio=espacio,
                nombre_archivo=previa.nombre_archivo
                if previa
                else uuid4().hex,
                tipo_contenido=previa.tipo_contenido
                if previa
                else 'image/webp',
            )
            if previa is None:
                optimizadas[foto.nombre_archivo] = optimizar_foto(next(nuevas))
            fotos.append(foto)

        escritos = []
        try:
            self.sesion.add_all(fotos)
            self.sesion.flush()
            self.carpeta.mkdir(parents=True, exist_ok=True)
            self._guardar_archivos(optimizadas, escritos)
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

    def _cargar_fotos_origen(
        self,
        origen_id: int | None,
        publicador_id: int,
        usuario: Usuario,
        ids_fotos: list[int],
    ) -> dict[int, FotoPublicacion]:
        if not ids_fotos:
            return {}
        if origen_id is None or len(set(ids_fotos)) != len(ids_fotos):
            raise ValidacionError(
                'Indicá las fotos originales sin repetirlas.'
            )
        origen = self.publicaciones.obtener_gestionable(origen_id, usuario)
        if origen.publicador_id != publicador_id:
            raise ValidacionError(
                'Solo podés compartir fotos de la misma cuenta.'
            )
        condiciones = (
            FotoPublicacion.publicacion_id == origen_id,
            FotoPublicacion.id.in_(ids_fotos),
        )
        if self.sesion.get_bind().dialect.name == 'sqlite':
            self.sesion.execute(
                update(FotoPublicacion)
                .where(*condiciones)
                .values(espacio=FotoPublicacion.espacio)
            )
        fotos = {
            foto.id: foto
            for foto in self.sesion.scalars(
                select(FotoPublicacion).where(*condiciones).with_for_update()
            )
        }
        if len(fotos) != len(ids_fotos) or any(
            not (self.carpeta / foto.nombre_archivo).is_file()
            for foto in fotos.values()
        ):
            raise RecursoNoEncontrado(
                'Alguna foto original ya no está disponible.'
            )
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
        borrar_fotos_sin_referencias(self.sesion, [nombre])

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
        archivos: dict[str, bytes],
        escritos: list[str],
    ) -> None:
        for nombre, contenido in archivos.items():
            ruta = self.carpeta / nombre
            with ruta.open('xb') as archivo:
                escritos.append(ruta.name)
                archivo.write(contenido)
