from io import BytesIO
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alquilometro_api.core.database import get_session
from alquilometro_api.core.dependencias import usuario_actual
from alquilometro_api.domain.errores import (
    ConflictoDominio,
    PermisoInsuficiente,
    RecursoNoEncontrado,
)
from alquilometro_api.domain.rol import Rol
from alquilometro_api.models.perfil_publicador import (
    CalificacionPublicador,
    FotoPerfilPublicador,
)
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.publicacion import PublicacionCatalogoRespuesta
from alquilometro_api.services.fotos import leer_foto
from alquilometro_api.services.publicaciones import (
    FiltrosPublicaciones,
    ServicioPublicaciones,
)

router = APIRouter(prefix='/publicadores', tags=['publicadores'])
Sesion = Annotated[Session, Depends(get_session)]
UsuarioActual = Annotated[Usuario, Depends(usuario_actual)]


class PerfilPublicadorRespuesta(BaseModel):
    id: int
    nombre: str
    es_inmobiliaria: bool
    foto_url: str | None
    calificaciones: dict[int, int]


class CalificacionEntrada(BaseModel):
    estrellas: int = Field(ge=1, le=5, strict=True)


def obtener_publicador(publicador_id: int, sesion: Sesion) -> Usuario:
    publicador = sesion.get(Usuario, publicador_id)
    if publicador is None or publicador.rol not in {
        Rol.INMOBILIARIA,
        Rol.ADMIN,
    } or not publicador.habilitada:
        raise RecursoNoEncontrado('No encontramos ese anunciante.')
    return publicador


Publicador = Annotated[Usuario, Depends(obtener_publicador)]


@router.get('/{publicador_id}', response_model=PerfilPublicadorRespuesta)
def ver_perfil(
    publicador: Publicador, sesion: Sesion
) -> PerfilPublicadorRespuesta:
    estrellas = CalificacionPublicador.estrellas
    calificaciones = sesion.execute(
        select(estrellas, func.count())
        .where(CalificacionPublicador.publicador_id == publicador.id)
        .group_by(estrellas),
    )
    foto_id = sesion.scalar(
        select(FotoPerfilPublicador.publicador_id).where(
            FotoPerfilPublicador.publicador_id == publicador.id
        ),
    )
    return PerfilPublicadorRespuesta(
        id=publicador.id,
        nombre=publicador.nombre,
        es_inmobiliaria=publicador.rol == Rol.INMOBILIARIA,
        foto_url=f'/publicadores/{publicador.id}/foto' if foto_id else None,
        calificaciones={valor: cantidad for valor, cantidad in calificaciones},
    )


@router.get(
    '/{publicador_id}/publicaciones',
    response_model=list[PublicacionCatalogoRespuesta],
)
def ver_publicaciones(
    publicador: Publicador,
    sesion: Sesion,
) -> list[PublicacionCatalogoRespuesta]:
    avisos = ServicioPublicaciones(sesion).listar(
        FiltrosPublicaciones(publicador_id=publicador.id),
    )
    return [
        PublicacionCatalogoRespuesta.desde_publicacion(aviso)
        for aviso in avisos
    ]


@router.get('/{publicador_id}/foto')
def ver_foto(publicador: Publicador, sesion: Sesion) -> Response:
    foto = sesion.get(FotoPerfilPublicador, publicador.id)
    if foto is None:
        raise RecursoNoEncontrado('El anunciante todavía no tiene foto.')
    return Response(foto.contenido, media_type='image/jpeg')


@router.put('/{publicador_id}/foto', status_code=204)
def guardar_foto(
    publicador: Publicador,
    sesion: Sesion,
    usuario: UsuarioActual,
    foto: Annotated[UploadFile, File()],
) -> None:
    if usuario.id != publicador.id:
        raise PermisoInsuficiente('Solo podés actualizar tu foto de perfil.')
    contenido, _ = leer_foto(foto.file)
    salida = BytesIO()
    with Image.open(BytesIO(contenido)) as imagen:
        perfil = ImageOps.fit(
            ImageOps.exif_transpose(imagen).convert('RGB'), (256, 256)
        )
        perfil.save(salida, format='JPEG', quality=88)
    sesion.merge(
        FotoPerfilPublicador(
            publicador_id=publicador.id, contenido=salida.getvalue()
        )
    )
    confirmar_perfil(sesion)


@router.put('/{publicador_id}/calificacion', status_code=204)
def guardar_calificacion(
    datos: CalificacionEntrada,
    publicador: Publicador,
    sesion: Sesion,
    usuario: UsuarioActual,
) -> None:
    if usuario.id == publicador.id:
        raise PermisoInsuficiente('No podés calificar tu propio perfil.')
    sesion.merge(
        CalificacionPublicador(
            publicador_id=publicador.id,
            autor_id=usuario.id,
            estrellas=datos.estrellas,
        )
    )
    confirmar_perfil(sesion)


def confirmar_perfil(sesion: Session) -> None:
    try:
        sesion.commit()
    except IntegrityError as error:
        sesion.rollback()
        raise ConflictoDominio(
            'El perfil cambió. Volvé a intentar.'
        ) from error
