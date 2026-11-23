from collections.abc import Callable
from http import HTTPStatus
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture
def ruta_perfil(
    cliente: TestClient, headers_inmobiliaria: dict[str, str]
) -> str:
    usuario = cliente.get('/usuarios/me', headers=headers_inmobiliaria).json()
    return f'/publicadores/{usuario["id"]}'


def test_perfil_solo_publica_datos_del_anunciante_y_sus_avisos(
    cliente: TestClient,
    ruta_perfil: str,
    headers_inmobiliaria: dict[str, str],
    autenticar_como: Callable[..., dict[str, str]],
) -> None:
    perfil = cliente.get(ruta_perfil).json()
    assert perfil == {
        'id': int(ruta_perfil.rsplit('/', 1)[-1]),
        'nombre': 'Inmobiliaria de prueba',
        'es_inmobiliaria': True,
        'foto_url': None,
        'calificaciones': {},
    }
    otro = autenticar_como('otra@example.com', 'INMOBILIARIA')
    datos = {
        'propiedad': {
            'direccion': 'Cuenca 3500',
            'zona': 'Villa Devoto',
            'tipo': 'departamento',
            'ambientes': 2,
        },
        'precio_alquiler': {'monto': '530000', 'moneda': 'ARS'},
    }
    propio = cliente.post(
        '/publicaciones', json=datos, headers=headers_inmobiliaria
    )
    ajeno = cliente.post('/publicaciones', json=datos, headers=otro)
    assert propio.status_code == ajeno.status_code == HTTPStatus.CREATED
    avisos = cliente.get(ruta_perfil + '/publicaciones').json()
    assert [aviso['id'] for aviso in avisos] == [propio.json()['id']]


def test_calificacion_se_actualiza_sin_contar_dos_veces(
    cliente: TestClient,
    ruta_perfil: str,
    headers_inmobiliaria: dict[str, str],
    autenticar: Callable[..., dict[str, str]],
) -> None:
    ruta = ruta_perfil + '/calificacion'
    assert (
        cliente.put(ruta, json={'estrellas': 4}).status_code
        == HTTPStatus.UNAUTHORIZED
    )
    assert (
        cliente.put(
            ruta, json={'estrellas': 4}, headers=headers_inmobiliaria
        ).status_code
        == HTTPStatus.FORBIDDEN
    )
    ana = autenticar()
    otro = autenticar('otro@example.com')
    assert (
        cliente.put(ruta, json={'estrellas': 6}, headers=ana).status_code
        == HTTPStatus.UNPROCESSABLE_ENTITY
    )
    for headers, estrellas in [(ana, 4), (ana, 5), (otro, 5)]:
        assert (
            cliente.put(
                ruta, json={'estrellas': estrellas}, headers=headers
            ).status_code
            == HTTPStatus.NO_CONTENT
        )
    assert cliente.get(ruta_perfil).json()['calificaciones'] == {'5': 2}


def test_solo_el_anunciante_puede_subir_su_foto(
    cliente: TestClient,
    ruta_perfil: str,
    headers_inmobiliaria: dict[str, str],
    autenticar: Callable[..., dict[str, str]],
) -> None:
    ruta = ruta_perfil + '/foto'
    assert cliente.get(ruta).status_code == HTTPStatus.NOT_FOUND
    contenido = BytesIO()
    Image.new('RGB', (100, 50), 'green').save(contenido, format='PNG')
    archivos = {'foto': ('perfil.png', contenido.getvalue(), 'image/png')}
    assert (
        cliente.put(ruta, files=archivos, headers=autenticar()).status_code
        == HTTPStatus.FORBIDDEN
    )
    assert (
        cliente.put(
            ruta, files=archivos, headers=headers_inmobiliaria
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert cliente.get(ruta_perfil).json()['foto_url'] == ruta
    respuesta = cliente.get(ruta)
    assert respuesta.headers['content-type'] == 'image/jpeg'
    with Image.open(BytesIO(respuesta.content)) as foto:
        assert foto.size == (256, 256)
