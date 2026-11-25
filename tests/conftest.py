from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from alquilometro_api.app import app
from alquilometro_api.core.config import get_config
from alquilometro_api.core.database import (
    Base,
    crear_engine,
    get_engine,
)
from alquilometro_api.services import geocodificacion


def cerrar_engine_cacheado() -> None:
    """Libera la conexión que get_engine guarda en caché."""
    if get_engine.cache_info().currsize:
        get_engine().dispose()

    get_engine.cache_clear()


@pytest.fixture(autouse=True)
def limpiar_caches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Iterator[None]:
    monkeypatch.setenv('CARPETA_FOTOS', str(tmp_path / 'fotos-prueba'))
    monkeypatch.setenv('FOTOS_ELIMINAR_HUERFANAS', 'false')
    cerrar_engine_cacheado()
    get_config.cache_clear()

    yield

    cerrar_engine_cacheado()
    get_config.cache_clear()


@pytest.fixture
def engine() -> Iterator[Engine]:
    """Base SQLite en memoria, limpia para cada test."""
    engine = crear_engine('sqlite://')
    Base.metadata.create_all(engine)

    yield engine

    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def sesion(engine: Engine) -> Iterator[Session]:
    """Sesión SQLAlchemy asociada a la base del test."""
    with Session(engine) as sesion:
        yield sesion


@pytest.fixture
def cliente(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """Cliente HTTP que usa una SQLite temporal en memoria."""
    monkeypatch.setenv('DATABASE_URL', 'sqlite://')
    monkeypatch.setattr(
        geocodificacion, 'geocodificar_direccion', lambda _: None
    )

    with TestClient(app) as cliente:
        yield cliente
