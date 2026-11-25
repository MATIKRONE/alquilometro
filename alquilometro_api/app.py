import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

import alquilometro_api.models  # noqa: F401
from alquilometro_api.core.archivos_fotos import revisar_fotos_huerfanas
from alquilometro_api.core.database import crear_tablas
from alquilometro_api.domain.errores import ErrorDominio
from alquilometro_api.routers.admin import router as admin_router
from alquilometro_api.routers.auth import router as auth_router
from alquilometro_api.routers.contratos import router as contratos_router
from alquilometro_api.routers.indices import router as indices_router
from alquilometro_api.routers.planes import router as planes_router
from alquilometro_api.routers.proyecciones import (
    router as proyecciones_router,
)
from alquilometro_api.routers.publicaciones import (
    router as publicaciones_router,
)
from alquilometro_api.routers.publicadores import router as publicadores_router
from alquilometro_api.routers.usuarios import router as usuarios_router
from alquilometro_api.services.avisos_abono import enviar_avisos_de_abono
from alquilometro_api.services.retencion_avisos import aplicar_retencion_avisos

logger = logging.getLogger(__name__)


async def revisar_retencion() -> None:
    try:
        await asyncio.to_thread(aplicar_retencion_avisos)
    except Exception:  # noqa: BLE001
        logger.exception('No se pudo aplicar la retención de avisos.')


async def controlar_retencion() -> None:
    while True:
        try:
            await asyncio.to_thread(enviar_avisos_de_abono)
        except Exception:  # noqa: BLE001
            logger.exception('No se pudieron procesar los avisos de abono.')
        try:
            await asyncio.to_thread(revisar_fotos_huerfanas)
        except Exception:  # noqa: BLE001
            logger.exception('No se pudieron revisar las fotos huérfanas.')
        await asyncio.sleep(3600)
        await revisar_retencion()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    crear_tablas()
    await revisar_retencion()
    tarea = asyncio.create_task(controlar_retencion())
    try:
        yield
    finally:
        tarea.cancel()
        with suppress(asyncio.CancelledError):
            await tarea


app = FastAPI(
    lifespan=lifespan,
    title='Alquilómetro API',
    description=(
        'API para analizar el costo real de alquileres y sus ajustes.'
    ),
)


@app.exception_handler(ErrorDominio)
def manejar_error_dominio(
    _request: Request,
    error: ErrorDominio,
) -> JSONResponse:
    return JSONResponse(
        status_code=error.codigo_http,
        content={'detail': str(error)},
    )


app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(publicaciones_router)
app.include_router(publicadores_router)
app.include_router(usuarios_router)
app.include_router(contratos_router)
app.include_router(indices_router)
app.include_router(planes_router)
app.include_router(proyecciones_router)


@app.get('/')
def read_root() -> dict[str, str]:
    return {'message': 'Bienvenido a Alquilómetro'}
