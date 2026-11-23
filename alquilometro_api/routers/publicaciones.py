from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from alquilometro_api.core.database import get_session
from alquilometro_api.core.dependencias import usuario_actual
from alquilometro_api.domain.analisis_economico import AnalisisEconomico
from alquilometro_api.domain.desglose_costo import CostoEntrada, DesgloseCosto
from alquilometro_api.models.foto_publicacion import FotoPublicacion
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.publicacion import (
    AnalisisEconomicoRespuesta,
    ContactoPublicacionActualizar,
    CupoPublicacionesRespuesta,
    DescripcionPublicacionActualizar,
    DesgloseCostoRespuesta,
    EstadoPublicacionActualizar,
    EventoPublicacionCrear,
    FiltrosPublicacionesConsulta,
    FotoPublicacionRespuesta,
    GastosPublicacionActualizar,
    PrecioPublicacionActualizar,
    PublicacionCrear,
    PublicacionEdicionRespuesta,
    PublicacionGestionRespuesta,
    PublicacionRespuesta,
)
from alquilometro_api.services import geocodificacion
from alquilometro_api.services.fotos import ServicioFotos
from alquilometro_api.services.publicaciones import (
    FiltrosPublicaciones,
    ServicioPublicaciones,
)

router = APIRouter(
    prefix='/publicaciones',
    tags=['publicaciones'],
)


@router.post(
    '',
    response_model=PublicacionRespuesta,
    status_code=status.HTTP_201_CREATED,
)
def crear_publicacion(
    datos: PublicacionCrear,
    sesion: Session = Depends(get_session),
    publicador: Usuario = Depends(usuario_actual),
) -> Publicacion:
    servicio = ServicioPublicaciones(
        sesion, geocodificacion.geocodificar_direccion
    )
    return servicio.crear(datos, publicador)


@router.get('', response_model=list[PublicacionRespuesta])
def listar_publicaciones(
    consulta: Annotated[FiltrosPublicacionesConsulta, Query()],
    sesion: Session = Depends(get_session),
) -> list[Publicacion]:
    filtros = FiltrosPublicaciones(**consulta.model_dump())
    servicio = ServicioPublicaciones(sesion)
    return servicio.listar(filtros)


@router.get('/mis', response_model=list[PublicacionGestionRespuesta])
def listar_mis_publicaciones(
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> list[Publicacion]:
    return ServicioPublicaciones(sesion).listar_propias(usuario)


@router.get('/mis/cupo', response_model=CupoPublicacionesRespuesta)
def consultar_mi_cupo(
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> CupoPublicacionesRespuesta:
    return ServicioPublicaciones(sesion).consultar_cupo(usuario)


@router.get(
    '/mis/{publicacion_id}', response_model=PublicacionEdicionRespuesta
)
def obtener_mi_publicacion(
    publicacion_id: int,
    respuesta: Response,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> Publicacion:
    respuesta.headers['Cache-Control'] = 'no-store'
    return ServicioPublicaciones(sesion).obtener_gestionable(
        publicacion_id, usuario
    )


@router.patch('/mis/{publicacion_id}/estado', status_code=204)
def cambiar_estado(
    publicacion_id: int,
    datos: EstadoPublicacionActualizar,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> None:
    ServicioPublicaciones(sesion).actualizar_estado(
        publicacion_id, datos.estado, usuario
    )


@router.patch('/mis/{publicacion_id}/precio', status_code=204)
def cambiar_precio(
    publicacion_id: int,
    datos: PrecioPublicacionActualizar,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> None:
    ServicioPublicaciones(sesion).actualizar_precio(
        publicacion_id, datos.monto, usuario
    )


@router.patch(
    '/mis/{publicacion_id}/gastos', response_model=PublicacionGestionRespuesta
)
def cambiar_gastos(
    publicacion_id: int,
    datos: GastosPublicacionActualizar,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> Publicacion:
    return ServicioPublicaciones(sesion).actualizar_gastos(
        publicacion_id, datos, usuario
    )


@router.get('/mis/{publicacion_id}/fotos/{foto_id}')
def ver_foto_propia(
    publicacion_id: int,
    foto_id: int,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> FileResponse:
    ruta, tipo = ServicioFotos(sesion).servir(
        publicacion_id, foto_id, usuario
    )
    return FileResponse(
        ruta,
        media_type=tipo,
        headers={
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
        },
    )


@router.get('/{publicacion_id}', response_model=PublicacionRespuesta)
def obtener_publicacion(
    publicacion_id: int,
    sesion: Session = Depends(get_session),
) -> Publicacion:
    return ServicioPublicaciones(sesion).obtener(publicacion_id)


@router.post('/{publicacion_id}/metricas', status_code=204)
def registrar_metrica(
    publicacion_id: int,
    datos: EventoPublicacionCrear,
    sesion: Session = Depends(get_session),
) -> None:
    ServicioPublicaciones(sesion).registrar_evento(
        publicacion_id, datos.evento
    )


@router.put('/{publicacion_id}', response_model=PublicacionRespuesta)
def actualizar_publicacion(
    publicacion_id: int,
    datos: PublicacionCrear,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> Publicacion:
    servicio = ServicioPublicaciones(
        sesion, geocodificacion.geocodificar_direccion
    )
    return servicio.actualizar(publicacion_id, datos, usuario)


@router.delete('/{publicacion_id}', status_code=status.HTTP_204_NO_CONTENT)
def eliminar_publicacion(
    publicacion_id: int,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> None:
    ServicioPublicaciones(sesion).eliminar(publicacion_id, usuario)


@router.patch(
    '/{publicacion_id}/whatsapp', status_code=status.HTTP_204_NO_CONTENT
)
def actualizar_whatsapp(
    publicacion_id: int,
    datos: ContactoPublicacionActualizar,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> None:
    ServicioPublicaciones(sesion).actualizar_whatsapp(
        publicacion_id,
        datos.whatsapp,
        usuario,
    )


@router.patch(
    '/{publicacion_id}/descripcion', status_code=status.HTTP_204_NO_CONTENT
)
def actualizar_descripcion(
    publicacion_id: int,
    datos: DescripcionPublicacionActualizar,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> None:
    ServicioPublicaciones(sesion).actualizar_descripcion(
        publicacion_id, datos.descripcion, usuario
    )


@router.post(
    '/{publicacion_id}/fotos',
    response_model=list[FotoPublicacionRespuesta],
    status_code=status.HTTP_201_CREATED,
)
def agregar_fotos(
    publicacion_id: int,
    fotos: Annotated[list[UploadFile], File()],
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> list[FotoPublicacion]:
    return ServicioFotos(sesion).agregar(
        publicacion_id,
        usuario,
        [foto.file for foto in fotos],
    )


@router.get('/{publicacion_id}/fotos/{foto_id}')
def ver_foto(
    publicacion_id: int,
    foto_id: int,
    sesion: Session = Depends(get_session),
) -> FileResponse:
    ruta, tipo = ServicioFotos(sesion).servir(publicacion_id, foto_id)
    return FileResponse(
        ruta,
        media_type=tipo,
        headers={
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-cache',
        },
    )


@router.delete(
    '/{publicacion_id}/fotos/{foto_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def eliminar_foto(
    publicacion_id: int,
    foto_id: int,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> None:
    ServicioFotos(sesion).eliminar(publicacion_id, foto_id, usuario)


@router.get(
    '/{publicacion_id}/costo-entrada',
    response_model=DesgloseCostoRespuesta,
)
def obtener_costo_entrada(
    publicacion_id: int,
    sesion: Session = Depends(get_session),
) -> CostoEntrada:
    publicacion = ServicioPublicaciones(sesion).obtener(publicacion_id)
    return publicacion.calcular_costo_entrada()


@router.get(
    '/{publicacion_id}/costo-real',
    response_model=DesgloseCostoRespuesta,
)
def obtener_costo_real(
    publicacion_id: int,
    sesion: Session = Depends(get_session),
) -> DesgloseCosto:
    servicio = ServicioPublicaciones(sesion)
    publicacion = servicio.obtener(publicacion_id)
    return publicacion.calcular_costo_real()


@router.get(
    '/{publicacion_id}/analisis',
    response_model=AnalisisEconomicoRespuesta,
)
def analizar_publicacion(
    publicacion_id: int,
    sesion: Session = Depends(get_session),
    usuario: Usuario = Depends(usuario_actual),
) -> AnalisisEconomico:
    servicio = ServicioPublicaciones(sesion)
    return servicio.analizar_para_usuario(publicacion_id, usuario)
