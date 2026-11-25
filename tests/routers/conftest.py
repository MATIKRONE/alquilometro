from collections.abc import Callable
from datetime import date
from http import HTTPStatus

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from alquilometro_api.core.database import get_engine
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.semilla import crear_admin

CLAVE = 'clave-segura-123'  # noqa: S105


@pytest.fixture
def autenticar(cliente: TestClient) -> Callable[..., dict[str, str]]:
    """Regustra un usuario, inicia sesion y devuelve su cabecera Bearer."""

    def _autenticar(email: str = 'ana@example.com') -> dict[str, str]:
        cliente.post(
            '/auth/registro',
            json={'nombre': 'Ana', 'email': email, 'password': CLAVE},
        )
        respuesta = cliente.post(
            '/auth/login', json={'email': email, 'password': CLAVE}
        )
        return {'Authorization': f'Bearer {respuesta.json()["access_token"]}'}

    return _autenticar


@pytest.fixture
def headers_inmobiliaria(
    cliente: TestClient,
) -> dict[str, str]:
    """Devuelve el token de una inmobiliaria con abono vigente."""

    registro = cliente.post(
        '/auth/registro',
        json={
            'nombre': 'Inmobiliaria de prueba',
            'email': 'inmobiliaria@example.com',
            'password': 'clave-segura-123',
            'rol': 'INMOBILIARIA',
        },
    )
    assert registro.status_code == HTTPStatus.CREATED
    with Session(get_engine()) as sesion:
        agencia = sesion.get(Usuario, registro.json()['id'])
        assert agencia is not None
        agencia.abono_vigente_hasta = date.max
        sesion.commit()

    login = cliente.post(
        '/auth/login',
        json={
            'email': 'inmobiliaria@example.com',
            'password': 'clave-segura-123',
        },
    )
    assert login.status_code == HTTPStatus.OK

    token = login.json()['access_token']
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture
def autenticar_como(cliente: TestClient) -> Callable[..., dict[str, str]]:
    """Crea un usuario con el rol pedido y devuelve su cabecera Bearer."""

    def _como(
        email: str, rol: str, *, con_abono: bool = False
    ) -> dict[str, str]:
        if rol == 'ADMIN':  # el registro público no permite este rol
            with Session(get_engine()) as sesion:
                crear_admin(sesion, email, CLAVE)
        else:
            registro = cliente.post(
                '/auth/registro',
                json={
                    'nombre': 'Usuario',
                    'email': email,
                    'password': CLAVE,
                    'rol': rol,
                },
            )
            if con_abono:
                with Session(get_engine()) as sesion:
                    agencia = sesion.get(Usuario, registro.json()['id'])
                    assert agencia is not None
                    agencia.abono_vigente_hasta = date.max
                    sesion.commit()
        login = cliente.post(
            '/auth/login', json={'email': email, 'password': CLAVE}
        )
        return {'Authorization': f'Bearer {login.json()["access_token"]}'}

    return _como
