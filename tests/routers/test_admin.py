from collections.abc import Callable
from http import HTTPStatus

import pytest
from fastapi.testclient import TestClient

from alquilometro_api.routers import admin

Autenticar = Callable[..., dict[str, str]]
CLAVE_AGENCIA = 'clave-de-agencia-prueba'  # noqa: S105


def test_alta_baja_y_reactivacion_de_inmobiliaria(
    cliente: TestClient,
    autenticar_como: Autenticar,
    headers_inmobiliaria: dict[str, str],
) -> None:
    administrador = autenticar_como('admin@example.com', 'ADMIN')
    alta = {
        'nombre': 'Agencia nueva',
        'email': 'nueva@example.com',
        'password': CLAVE_AGENCIA,
        'password_confirmacion': CLAVE_AGENCIA,
    }
    url = '/admin/inmobiliarias'
    assert (
        cliente.post(url, json=alta, headers=headers_inmobiliaria).status_code
        == HTTPStatus.FORBIDDEN
    )
    creada = cliente.post(url, json=alta, headers=administrador)
    assert creada.status_code == HTTPStatus.CREATED
    agencia = creada.json()
    assert agencia['habilitada'] is True
    assert 'password' not in agencia
    login = {'email': alta['email'], 'password': CLAVE_AGENCIA}
    token = cliente.post('/auth/login', json=login).json()['access_token']
    cuenta = {'Authorization': f'Bearer {token}'}
    datos = {
        'propiedad': {
            'direccion': 'Avenida Rivadavia 5500',
            'zona': 'Caballito',
            'tipo': 'departamento',
            'ambientes': 2,
        },
        'precio_alquiler': {'monto': '650000', 'moneda': 'ARS'},
    }
    activos = [
        cliente.post('/publicaciones', json=datos, headers=cuenta).json()['id']
        for _ in range(2)
    ]
    cliente.patch(
        f'/publicaciones/mis/{activos[1]}/estado',
        json={'estado': 'pausada'},
        headers=cuenta,
    )

    estado = f'{url}/{agencia["id"]}/estado'
    assert (
        cliente.patch(
            estado, json={'habilitada': False}, headers=administrador
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert cliente.post('/auth/login', json=login).status_code == (
        HTTPStatus.UNAUTHORIZED
    )
    assert cliente.get('/usuarios/me', headers=cuenta).status_code == (
        HTTPStatus.UNAUTHORIZED
    )
    assert cliente.get('/publicaciones').json() == []
    assert cliente.get(f'/publicaciones/{activos[0]}').status_code == (
        HTTPStatus.NOT_FOUND
    )
    assert cliente.get(f'/publicadores/{agencia["id"]}').status_code == (
        HTTPStatus.NOT_FOUND
    )
    resumen = cliente.get('/admin/resumen', headers=administrador).json()
    assert resumen['avisos_ocultos'] == 1
    moderacion = cliente.get(
        '/admin/publicaciones', headers=administrador
    ).json()['avisos']
    assert all(not p['anunciante_habilitado'] for p in moderacion)
    assert (
        cliente.patch(
            estado, json={'habilitada': True}, headers=administrador
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert cliente.post('/auth/login', json=login).status_code == HTTPStatus.OK
    assert cliente.get('/usuarios/me', headers=cuenta).status_code == (
        HTTPStatus.UNAUTHORIZED
    )
    assert [p['id'] for p in cliente.get('/publicaciones').json()] == activos[
        :1
    ]


def test_baja_de_inmobiliaria_no_cambia_otro_tipo_de_cuenta(
    cliente: TestClient,
    autenticar_como: Autenticar,
) -> None:
    administrador = autenticar_como('admin@example.com', 'ADMIN')
    admin_id = cliente.get('/usuarios/me', headers=administrador).json()['id']
    respuesta = cliente.patch(
        f'/admin/inmobiliarias/{admin_id}/estado',
        json={'habilitada': False},
        headers=administrador,
    )
    assert respuesta.status_code == HTTPStatus.NOT_FOUND
    assert cliente.get('/usuarios/me', headers=administrador).status_code == (
        HTTPStatus.OK
    )


@pytest.mark.parametrize('ruta', ['/admin/resumen', '/admin/publicaciones'])
def test_panel_solo_para_administradores(
    ruta: str,
    cliente: TestClient,
    autenticar_como: Autenticar,
    headers_inmobiliaria: dict[str, str],
) -> None:
    assert cliente.get(ruta).status_code == HTTPStatus.UNAUTHORIZED
    busca = autenticar_como('busca@example.com', 'BUSCADOR')
    for headers in (busca, headers_inmobiliaria):
        assert (
            cliente.get(ruta, headers=headers).status_code
            == HTTPStatus.FORBIDDEN
        )
    administrador = autenticar_como('admin@example.com', 'ADMIN')
    respuesta = cliente.get(ruta, headers=administrador)
    assert respuesta.status_code == HTTPStatus.OK
    assert respuesta.headers['cache-control'] == 'no-store'


def test_panel_muestra_cupos_y_filtra_avisos_por_estado_y_anunciante(
    cliente: TestClient,
    autenticar_como: Autenticar,
    headers_inmobiliaria: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    administrador = autenticar_como('admin@example.com', 'ADMIN')
    monkeypatch.setattr(admin, 'AVISOS_POR_PAGINA', 1)
    datos = {
        'propiedad': {
            'direccion': 'Avenida Rivadavia 5500',
            'zona': 'Caballito',
            'tipo': 'departamento',
            'ambientes': 2,
        },
        'precio_alquiler': {'monto': '650000', 'moneda': 'ARS'},
    }
    primero, segundo = [
        cliente.post(
            '/publicaciones',
            json=datos | {'titulo': titulo},
            headers=headers_inmobiliaria,
        ).json()['id']
        for titulo in ('Departamento cerca del parque', 'PH con terraza')
    ]
    pausa = cliente.patch(
        f'/publicaciones/mis/{segundo}/estado',
        json={'estado': 'pausada'},
        headers=administrador,
    )
    assert pausa.status_code == HTTPStatus.NO_CONTENT
    resumen = cliente.get('/admin/resumen', headers=administrador).json()
    assert resumen['publicaciones_por_estado'] == {'activa': 1, 'pausada': 1}
    assert resumen['inmobiliarias'][0]['activas'] == 1
    assert resumen['inmobiliarias'][0]['limite'] == admin.CUPO_PILOTO

    listado = cliente.get('/admin/publicaciones', headers=administrador).json()
    assert listado['total'] == len([primero, segundo])
    assert listado['avisos'][0]['id'] == segundo
    filtrado = cliente.get(
        '/admin/publicaciones',
        params={'buscar': 'inmobiliaria de prueba', 'estado': 'activa'},
        headers=administrador,
    ).json()
    assert filtrado['total'] == 1
    aviso = filtrado['avisos'][0]
    assert aviso['id'] == primero
    assert aviso['anunciante'] == 'Inmobiliaria de prueba'
    assert aviso['zona'] == 'Caballito'
    assert not {'direccion', 'email', 'telefono', 'whatsapp'} & aviso.keys()
    segunda = cliente.get(
        '/admin/publicaciones', params={'pagina': 2}, headers=administrador
    ).json()
    assert segunda['avisos'][0]['id'] == primero


def test_admin_cambia_patrocinio_sin_modificar_estado(
    cliente: TestClient,
    autenticar_como: Autenticar,
    headers_inmobiliaria: dict[str, str],
) -> None:
    administrador = autenticar_como('admin@example.com', 'ADMIN')
    creado = cliente.post(
        '/publicaciones',
        json={
            'propiedad': {
                'direccion': 'Avenida Rivadavia 5500',
                'zona': 'Caballito',
                'tipo': 'departamento',
                'ambientes': 2,
            },
            'precio_alquiler': {'monto': '650000', 'moneda': 'ARS'},
        },
        headers=headers_inmobiliaria,
    )
    assert creado.status_code == HTTPStatus.CREATED
    aviso_id = creado.json()['id']
    ruta = f'/admin/publicaciones/{aviso_id}/patrocinio'
    patrocinio = {'patrocinada': True}

    assert cliente.patch(ruta, json=patrocinio).status_code == (
        HTTPStatus.UNAUTHORIZED
    )
    assert (
        cliente.patch(
            ruta, json=patrocinio, headers=headers_inmobiliaria
        ).status_code
        == HTTPStatus.FORBIDDEN
    )
    assert (
        cliente.patch(
            ruta, json={'patrocinada': 'true'}, headers=administrador
        ).status_code
        == HTTPStatus.UNPROCESSABLE_ENTITY
    )
    assert (
        cliente.patch(
            '/admin/publicaciones/99999/patrocinio',
            json=patrocinio,
            headers=administrador,
        ).status_code
        == HTTPStatus.NOT_FOUND
    )

    for patrocinada in (True, True, False):
        respuesta = cliente.patch(
            ruta, json={'patrocinada': patrocinada}, headers=administrador
        )
        assert respuesta.status_code == HTTPStatus.NO_CONTENT
        panel = cliente.get('/admin/publicaciones', headers=administrador)
        aviso = panel.json()['avisos'][0]
        assert aviso['patrocinada'] is patrocinada
        assert aviso['estado'] == 'activa'
        publico = cliente.get(f'/publicaciones/{aviso_id}').json()
        assert publico['patrocinada'] is patrocinada
