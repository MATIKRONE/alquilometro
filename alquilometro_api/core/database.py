from collections.abc import Iterator
from functools import lru_cache
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Connection,
    Engine,
    create_engine,
    event,
    inspect,
)
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import AddConstraint, CreateTable

from alquilometro_api.core.config import get_config


class Base(DeclarativeBase):
    """
    Base declarativa de todos los modelos SQLalchemy
    """


def _activar_fk(conexion: Any, _registro: Any) -> None:
    # SQLite ignora las claves foráneas salvo que se active el pragma;
    # PostgreSQL siempre las aplica: así ambos se comportan igual
    cursor = conexion.cursor()
    cursor.execute('PRAGMA foreign_keys=ON')
    cursor.close()


def crear_engine(url: str, *, echo: bool = False) -> Engine:
    parsed = make_url(url)
    if parsed.get_backend_name() != 'sqlite':
        return create_engine(url, echo=echo)

    opciones: dict[str, Any] = {'connect_args': {'check_same_thread': False}}
    if parsed.database in {None, '', ':memory:'}:
        # En memoria, cada conexión sería una base distinta y vacía.
        opciones['poolclass'] = StaticPool
    engine = create_engine(url, echo=echo, **opciones)
    event.listen(engine, 'connect', _activar_fk)
    return engine


@lru_cache
def get_engine() -> Engine:
    config = get_config()
    return crear_engine(config.DATABASE_URL, echo=config.sql_echo)


def get_session() -> Iterator[Session]:
    """Dependencia de FastAPI: una sesión por request, siempre cerrada."""
    with Session(get_engine()) as sesion:
        yield sesion


def crear_tablas(engine: Engine | None = None) -> None:
    """Crea las tablas y aplica las actualizaciones de esquema pendientes.

    Los modelos deben estar importados (`alquilometro_api.models`) para
    estar registrados en `Base.metadata`.
    """
    base = engine or get_engine()
    with base.begin() as conexion:
        if base.dialect.name == 'sqlite':
            # Inicia la transacción también para el DDL en SQLite.
            conexion.exec_driver_sql('BEGIN IMMEDIATE')
        Base.metadata.create_all(conexion)
        _actualizar_tabla_fotos(conexion)
        _agregar_columnas(
            conexion,
            'pagos',
            {
                'importe_recibido_ars': 'INTEGER',
                'medio': 'VARCHAR(20)',
                'referencia_acreditada': 'VARCHAR(100)',
                'referencia_acreditada_en_uso': 'VARCHAR(300)',
                'revisado_por_id': 'INTEGER',
            },
        )
        if 'pagos' in Base.metadata.tables:
            conexion.exec_driver_sql(
                'CREATE UNIQUE INDEX IF NOT EXISTS ix_pago_acreditacion '
                'ON pagos (referencia_acreditada_en_uso)'
            )
        _agregar_columnas(
            conexion,
            'publicaciones',
            {
                'whatsapp': 'VARCHAR(16)',
                'descripcion': 'VARCHAR(1200)',
                'titulo': 'VARCHAR(100)',
                'operacion': "VARCHAR(8) NOT NULL DEFAULT 'alquiler'",
                'estado': "VARCHAR(8) NOT NULL DEFAULT 'activa'",
                'visitas': 'INTEGER NOT NULL DEFAULT 0',
                'clics_whatsapp': 'INTEGER NOT NULL DEFAULT 0',
                'patrocinio_desde': 'DATE',
                'patrocinio_hasta': 'DATE',
                'patrocinio_referencia': 'VARCHAR(100)',
                'patrocinio_pendiente': 'BOOLEAN NOT NULL DEFAULT FALSE',
                'patrocinio_vencimiento_visto': (
                    'BOOLEAN NOT NULL DEFAULT FALSE'
                ),
            },
        )
        _agregar_columnas(
            conexion,
            'propiedades',
            {
                'latitud_aproximada': 'FLOAT',
                'longitud_aproximada': 'FLOAT',
            },
        )
        _agregar_columnas(
            conexion,
            'usuarios',
            {
                'apellido': 'VARCHAR(100)',
                'nombre_contacto': 'VARCHAR(100)',
                'telefono': 'VARCHAR(16)',
                'habilitada': 'BOOLEAN NOT NULL DEFAULT TRUE',
                'version_sesion': 'INTEGER NOT NULL DEFAULT 0',
                'abono_vigente_hasta': 'DATE',
                'abono_pagado_el': 'DATE',
                'abono_referencia_pendiente': 'VARCHAR(100)',
                'abono_eliminar_desde': 'DATE',
                'abono_corte_sin_pago': 'DATE',
            },
        )


def _agregar_columnas(
    conexion: Connection, tabla: str, columnas_nuevas: dict[str, str]
) -> None:
    if tabla not in Base.metadata.tables:
        return
    columnas = {
        columna['name'] for columna in inspect(conexion).get_columns(tabla)
    }
    for nombre, tipo in columnas_nuevas.items():
        if nombre not in columnas:
            conexion.exec_driver_sql(
                f'ALTER TABLE {tabla} ADD COLUMN {nombre} {tipo}'
            )


def _actualizar_tabla_fotos(conexion: Connection) -> None:
    tabla = Base.metadata.tables.get('fotos_publicaciones')
    if tabla is None:
        return
    limite = next(
        restriccion
        for restriccion in tabla.constraints
        if isinstance(restriccion, CheckConstraint)
    )
    inspector = inspect(conexion)
    anteriores = inspector.get_check_constraints(tabla.name)
    falta_limite = all(r['name'] != limite.name for r in anteriores)
    unico = next(
        (
            r
            for r in inspector.get_unique_constraints(tabla.name)
            if r['column_names'] == ['nombre_archivo']
        ),
        None,
    )

    if conexion.dialect.name == 'postgresql':
        if falta_limite:
            conexion.exec_driver_sql(
                'ALTER TABLE fotos_publicaciones DROP CONSTRAINT IF EXISTS '
                'fotos_publicaciones_espacio_check'
            )
            conexion.execute(AddConstraint(limite, isolate_from_table=False))
        if unico:
            nombre = conexion.dialect.identifier_preparer.quote(unico['name'])
            conexion.exec_driver_sql(
                'ALTER TABLE fotos_publicaciones DROP CONSTRAINT IF EXISTS '
                f'{nombre}'
            )
    elif falta_limite or unico:
        # SQLite requiere recrear la tabla para cambiar estas restricciones.
        temporal = 'fotos_publicaciones_anterior'
        conexion.exec_driver_sql(
            f'ALTER TABLE fotos_publicaciones RENAME TO {temporal}'
        )
        conexion.execute(CreateTable(tabla))
        columnas = ', '.join(tabla.columns.keys())
        conexion.exec_driver_sql(
            f'INSERT INTO fotos_publicaciones ({columnas}) '
            f'SELECT {columnas} FROM {temporal}'
        )
        conexion.exec_driver_sql(f'DROP TABLE {temporal}')
    for indice in tabla.indexes:
        indice.create(conexion, checkfirst=True)
