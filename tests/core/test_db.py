from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, inspect, text
from sqlalchemy.orm import Mapped, Session, mapped_column
from sqlalchemy.schema import CreateTable

from alquilometro_api.app import app
from alquilometro_api.core import database
from alquilometro_api.core.database import (
    Base,
    crear_engine,
    crear_tablas,
    get_session,
)
from alquilometro_api.models.foto_publicacion import FotoPublicacion
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.semilla import cargar_publicaciones_de_ejemplo


class TablaDePrueba(Base):
    __tablename__ = 'tabla_de_prueba'

    id: Mapped[int] = mapped_column(primary_key=True)


@pytest.fixture(autouse=True, scope='module')
def _aislar_tabla_de_prueba() -> Iterator[None]:
    # Solo en este módulo: la tabla no debe existir para otros tests.
    yield
    Base.metadata.remove(TablaDePrueba.__table__)


def test_in_memory_engine_shares_one_database_across_connections() -> None:
    engine = crear_engine('sqlite://')
    with engine.begin() as conexion:
        conexion.execute(text('CREATE TABLE t (id INTEGER)'))
        conexion.execute(text('INSERT INTO t VALUES (7)'))

    with engine.connect() as otra:
        assert otra.execute(text('SELECT id FROM t')).scalar_one() == 7  # noqa: PLR2004
    engine.dispose()


def test_foreign_keys_are_enforced(engine: Engine) -> None:
    with engine.connect() as conexion:
        assert conexion.execute(text('PRAGMA foreign_keys')).scalar_one() == 1


def test_file_database_persists_between_engines(tmp_path: Path) -> None:
    url = f'sqlite:///{tmp_path / "datos.db"}'
    primero = crear_engine(url)
    with primero.begin() as conexion:
        conexion.execute(text('CREATE TABLE t (id INTEGER)'))
    primero.dispose()

    segundo = crear_engine(url)

    assert 't' in inspect(segundo).get_table_names()
    segundo.dispose()


def test_crear_tablas_creates_missing_tables_and_is_idempotent() -> None:
    engine = crear_engine('sqlite://')

    crear_tablas(engine)
    crear_tablas(engine)

    assert 'tabla_de_prueba' in inspect(engine).get_table_names()
    engine.dispose()


@pytest.mark.parametrize(
    ('tabla', 'campo'),
    [
        ('publicaciones', 'whatsapp'),
        ('publicaciones', 'descripcion'),
        ('publicaciones', 'titulo'),
        ('propiedades', 'latitud_aproximada'),
        ('propiedades', 'longitud_aproximada'),
        ('usuarios', 'apellido'),
        ('usuarios', 'nombre_contacto'),
        ('usuarios', 'telefono'),
    ],
)
def test_crear_tablas_agrega_columnas_a_una_base_anterior(
    tabla: str,
    campo: str,
) -> None:
    engine = crear_engine('sqlite://')
    Base.metadata.create_all(engine)
    with engine.begin() as conexion:
        conexion.exec_driver_sql(f'ALTER TABLE {tabla} DROP COLUMN {campo}')

    crear_tablas(engine)
    crear_tablas(engine)

    columnas = inspect(engine).get_columns(tabla)
    assert next(columna for columna in columnas if columna['name'] == campo)[
        'nullable'
    ]
    engine.dispose()


def test_ampliar_limite_de_fotos_conserva_las_anteriores() -> None:
    engine = crear_engine('sqlite://')
    crear_tablas(engine)
    with Session(engine) as sesion:
        cargar_publicaciones_de_ejemplo(sesion)
        publicacion_id = sesion.query(Publicacion.id).first()[0]

    tabla = FotoPublicacion.__table__
    esquema_anterior = (
        str(CreateTable(tabla).compile(engine))
        .replace('CONSTRAINT ck_fotos_publicaciones_espacio_20 ', '')
        .replace('espacio BETWEEN 1 AND 20', 'espacio BETWEEN 1 AND 5')
    )
    foto = {
        'id': 9,
        'publicacion_id': publicacion_id,
        'espacio': 1,
        'nombre_archivo': 'portada',
        'tipo_contenido': 'image/jpeg',
    }
    with engine.begin() as conexion:
        tabla.drop(conexion)
        conexion.exec_driver_sql(esquema_anterior)
        conexion.execute(tabla.insert(), foto)

    crear_tablas(engine)
    crear_tablas(engine)

    with engine.begin() as conexion:
        assert conexion.execute(tabla.select()).mappings().one() == foto
        conexion.execute(
            tabla.insert(),
            foto | {'id': 10, 'espacio': 20, 'nombre_archivo': 'ultima'},
        )
    engine.dispose()


def test_sesion_fixture_can_persist_and_read(sesion: Session) -> None:
    sesion.add(TablaDePrueba(id=1))
    sesion.commit()

    assert sesion.get(TablaDePrueba, 1) is not None


def test_obtener_sesion_yields_a_session_and_closes_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv('DATABASE_URL', 'sqlite://')
    generador = get_session()

    sesion = next(generador)
    assert sesion.execute(text('SELECT 1')).scalar_one() == 1
    assert sesion.in_transaction()

    generador.close()
    assert not sesion.in_transaction()


def test_app_startup_creates_tables(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    ruta = tmp_path / 'arranque.db'
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{ruta}')

    with TestClient(app):
        pass

    engine = crear_engine(f'sqlite:///{ruta}')

    assert 'tabla_de_prueba' in inspect(engine).get_table_names()

    engine.dispose()


def test_non_sqlite_urls_get_no_sqlite_specific_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    llamadas: list[tuple[tuple, dict]] = []

    monkeypatch.setattr(
        database,
        'create_engine',
        lambda *args, **kwargs: llamadas.append((args, kwargs)),
    )

    crear_engine('postgresql://usuario:clave@localhost/alquilometro')

    assert llamadas == [
        (
            ('postgresql://usuario:clave@localhost/alquilometro',),
            {'echo': False},
        ),
    ]
