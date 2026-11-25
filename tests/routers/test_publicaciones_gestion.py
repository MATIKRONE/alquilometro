from collections.abc import Callable
from datetime import date
from http import HTTPStatus
from io import BytesIO
from os import utime
from pathlib import Path
from time import time
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from PIL import ExifTags, Image
from sqlalchemy.orm import Session

from alquilometro_api.core import archivos_fotos
from alquilometro_api.core.config import get_config
from alquilometro_api.core.database import get_engine
from alquilometro_api.domain import abonos
from alquilometro_api.models import usuario
from alquilometro_api.semilla import cargar_publicaciones_de_ejemplo
from alquilometro_api.services import geocodificacion, retencion_avisos
from alquilometro_api.services import publicaciones as servicio_publicaciones
from alquilometro_api.services.fotos import LADO_MAXIMO

Autenticar = Callable[..., dict[str, str]]


def datos(**cambios: object) -> dict[str, object]:
    base: dict[str, object] = {
        'propiedad': {
            'direccion': 'Avenida Rivadavia 5500',
            'zona': 'Caballito',
            'tipo': 'departamento',
            'ambientes': 2,
        },
        'precio_alquiler': {'monto': '650000', 'moneda': 'ARS'},
    }
    return base | cambios


@pytest.fixture
def aviso_id(cliente: TestClient, headers_inmobiliaria: dict[str, str]) -> int:
    respuesta = cliente.post(
        '/publicaciones', json=datos(), headers=headers_inmobiliaria
    )
    return respuesta.json()['id']


def test_los_guardados_son_por_cuenta_y_no_se_duplican(
    cliente: TestClient, aviso_id: int, autenticar_como: Autenticar
) -> None:
    ruta = '/usuarios/me/guardados'
    uno = autenticar_como('uno@example.com', 'BUSCADOR')
    otro = autenticar_como('otro@example.com', 'BUSCADOR')
    aviso = f'{ruta}/{aviso_id}'
    assert cliente.get(ruta).status_code == HTTPStatus.UNAUTHORIZED
    for _ in range(2):
        assert (
            cliente.put(aviso, headers=uno).status_code
            == HTTPStatus.NO_CONTENT
        )
    assert cliente.get(ruta, headers=uno).json() == [aviso_id]
    assert cliente.get(ruta, headers=otro).json() == []
    assert (
        cliente.delete(aviso, headers=otro).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert cliente.get(ruta, headers=uno).json() == [aviso_id]
    assert (
        cliente.delete(aviso, headers=uno).status_code == HTTPStatus.NO_CONTENT
    )
    assert cliente.get(ruta, headers=uno).json() == []


def test_busquedas_personales_se_pueden_reabrir_y_quitar(
    cliente: TestClient, autenticar_como: Autenticar
) -> None:
    ruta = '/usuarios/me/busquedas'
    uno = autenticar_como('uno@example.com', 'BUSCADOR')
    otro = autenticar_como('otro@example.com', 'BUSCADOR')
    datos = {
        'nombre': 'Mi presupuesto',
        'enlace': '#buscar?zona=Belgrano+R&costo_real_max=700000&moneda=ARS',
    }
    assert (
        cliente.put(ruta, json=datos, headers=uno).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert cliente.get(ruta, headers=uno).json() == [datos]
    assert cliente.get(ruta, headers=otro).json() == []
    assert (
        cliente.put(
            ruta, json=datos | {'enlace': '#admin?filtro=privado'}, headers=uno
        ).status_code
        == HTTPStatus.UNPROCESSABLE_ENTITY
    )
    assert (
        cliente.delete(
            ruta, params={'enlace': datos['enlace']}, headers=uno
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert cliente.get(ruta, headers=uno).json() == []


@pytest.fixture
def carpeta_fotos(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    carpeta = tmp_path / 'fotos'
    monkeypatch.setenv('CARPETA_FOTOS', str(carpeta))
    get_config.cache_clear()
    return carpeta


@pytest.fixture
def foto_png() -> tuple[str, bytes, str]:
    contenido = BytesIO()
    Image.new('RGB', (8, 8), 'green').save(contenido, format='PNG')
    return 'foto.png', contenido.getvalue(), 'image/png'


def test_publicar_whatsapp_normaliza_numero_y_arma_enlace(
    cliente: TestClient, headers_inmobiliaria: dict[str, str]
) -> None:
    respuesta = cliente.post(
        '/publicaciones',
        json=datos(whatsapp='+54 9 (11) 5555-0199'),
        headers=headers_inmobiliaria,
    )
    assert respuesta.status_code == HTTPStatus.CREATED
    publicacion = respuesta.json()
    id_aviso = publicacion['id']

    publico = cliente.get(f'/publicaciones/{id_aviso}').json()
    assert publico['whatsapp'] == '+5491155550199'
    enlace = urlsplit(publico['whatsapp_url'])
    assert (enlace.scheme, enlace.netloc, enlace.path) == (
        'https',
        'wa.me',
        '/5491155550199',
    )
    assert parse_qs(enlace.query)['text'] == [
        f'Hola, vi el aviso #{id_aviso} en Alquilómetro. ¿Sigue disponible?'
    ]


def datos_venta(monto: str = '115000') -> dict[str, object]:
    venta = datos(
        operacion='venta', precio_venta={'monto': monto, 'moneda': 'USD'}
    )
    del venta['precio_alquiler']
    return venta


@pytest.mark.parametrize(
    ('tipo', 'ambientes', 'estado'),
    [
        ('dúplex', 3, HTTPStatus.CREATED),
        ('local comercial', 1, HTTPStatus.CREATED),
        ('terreno', 0, HTTPStatus.CREATED),
        ('cochera', 0, HTTPStatus.CREATED),
        ('baulera', 0, HTTPStatus.CREATED),
        ('casa', 0, HTTPStatus.UNPROCESSABLE_ENTITY),
    ],
)
def test_publicar_tipos_de_propiedad(
    cliente: TestClient,
    headers_inmobiliaria: dict[str, str],
    tipo: str,
    ambientes: int,
    estado: HTTPStatus,
) -> None:
    aviso = datos_venta()
    aviso['propiedad'] = {
        'direccion': 'Avenida Rivadavia 5500',
        'zona': 'Caballito',
        'tipo': tipo,
        'ambientes': ambientes,
    }
    respuesta = cliente.post(
        '/publicaciones', json=aviso, headers=headers_inmobiliaria
    )
    assert respuesta.status_code == estado
    if estado == HTTPStatus.CREATED:
        publicacion = respuesta.json()
        detalle = cliente.get(f'/publicaciones/{publicacion["id"]}').json()
        assert detalle['propiedad']['tipo'] == tipo
        assert detalle['propiedad']['ambientes'] == ambientes
        if ambientes == 0:
            assert detalle['titulo'] == f'{tipo.capitalize()} en Caballito'


def test_catalogo_separa_ventas_de_alquileres_y_filtra_precio(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
) -> None:
    primera = cliente.post(
        '/publicaciones', json=datos_venta(), headers=headers_inmobiliaria
    )
    segunda = cliente.post(
        '/publicaciones',
        json=datos_venta('125000'),
        headers=headers_inmobiliaria,
    )
    assert primera.status_code == segunda.status_code == HTTPStatus.CREATED
    venta = primera.json()
    assert venta['precio_alquiler'] is None
    assert venta['precio_venta']['moneda'] == 'USD'
    assert venta['operacion'] == 'venta'

    alquileres = cliente.get(
        '/publicaciones', params={'operacion': 'alquiler'}
    ).json()
    assert [aviso['id'] for aviso in alquileres] == [aviso_id]
    respuesta = cliente.get(
        '/publicaciones',
        params={
            'operacion': 'venta',
            'moneda': 'USD',
            'precio_max': '120000',
            'orden': 'precio',
        },
    )
    assert respuesta.status_code == HTTPStatus.OK
    assert [aviso['id'] for aviso in respuesta.json()] == [venta['id']]

    ruta = f'/publicaciones/{venta["id"]}'
    assert (
        cliente.get(ruta + '/costo-real').status_code
        == HTTPStatus.UNPROCESSABLE_ENTITY
    )
    assert (
        cliente.get(ruta + '/costo-entrada').status_code
        == HTTPStatus.UNPROCESSABLE_ENTITY
    )
    assert (
        cliente.get(
            ruta + '/proyeccion', headers=headers_inmobiliaria
        ).status_code
        == HTTPStatus.UNPROCESSABLE_ENTITY
    )


def test_venta_requiere_precio_propio_y_no_admite_datos_de_contrato(
    cliente: TestClient,
    headers_inmobiliaria: dict[str, str],
) -> None:
    for invalida in [
        datos(operacion='venta'),
        datos_venta('0'),
        {**datos_venta(), 'duracion_contrato_meses': 24},
    ]:
        respuesta = cliente.post(
            '/publicaciones', json=invalida, headers=headers_inmobiliaria
        )
        assert respuesta.status_code == HTTPStatus.UNPROCESSABLE_ENTITY


def test_publicacion_actualiza_el_mapa_solo_al_cambiar_direccion(
    cliente: TestClient,
    headers_inmobiliaria: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    consultas = []
    puntos = {
        'Av. San Juan 350': (-34.622, -58.371),
        'Av. San Juan 1200': (-34.623, -58.383),
    }

    def ubicar(direccion: str) -> tuple[float, float] | None:
        consultas.append(direccion)
        return puntos.get(direccion)

    monkeypatch.setattr(geocodificacion, 'geocodificar_direccion', ubicar)
    payload = datos()
    propiedad = {
        'direccion': 'Av. San Juan 350',
        'zona': 'San Telmo',
        'tipo': 'departamento',
        'ambientes': 2,
    }
    payload['propiedad'] = propiedad
    headers = headers_inmobiliaria
    creado = cliente.post('/publicaciones', json=payload, headers=headers)
    assert creado.status_code == HTTPStatus.CREATED
    ruta = f'/publicaciones/{creado.json()["id"]}'
    latitud, longitud = puntos[propiedad['direccion']]
    assert creado.json()['propiedad']['latitud_aproximada'] == latitud
    assert (
        cliente.put(ruta, json=payload, headers=headers).json()['propiedad'][
            'longitud_aproximada'
        ]
        == longitud
    )
    assert consultas == ['Av. San Juan 350']

    propiedad['direccion'] = 'Av. San Juan 1200'
    actualizada = cliente.put(ruta, json=payload, headers=headers).json()[
        'propiedad'
    ]
    assert (
        actualizada['longitud_aproximada'] == puntos[propiedad['direccion']][1]
    )
    propiedad['direccion'] = 'Dirección no encontrada 1200'
    sin_punto = cliente.put(ruta, json=payload, headers=headers).json()[
        'propiedad'
    ]
    assert sin_punto['latitud_aproximada'] is None
    assert sin_punto['longitud_aproximada'] is None


def test_titulo_publico_reemplaza_la_direccion_en_las_respuestas(
    cliente: TestClient,
    headers_inmobiliaria: dict[str, str],
) -> None:
    titulo = 'Departamento luminoso de dos ambientes'
    creado = cliente.post(
        '/publicaciones',
        json=datos(titulo=f'  {titulo}  '),
        headers=headers_inmobiliaria,
    )
    assert creado.status_code == HTTPStatus.CREATED
    aviso = creado.json()
    ruta = f'/publicaciones/{aviso["id"]}'
    publicador_id = aviso['publicador_id']
    for publico in [
        aviso,
        cliente.get(ruta).json(),
        cliente.get('/publicaciones').json()[0],
        cliente.get(f'/publicadores/{publicador_id}/publicaciones').json()[0],
    ]:
        assert publico['titulo'] == titulo
        assert 'direccion' not in publico['propiedad']

    sin_titulo = cliente.post(
        '/publicaciones',
        json=datos(),
        headers=headers_inmobiliaria,
    ).json()
    assert sin_titulo['titulo'] == 'Departamento de 2 ambientes en Caballito'


def test_descripcion_se_crea_se_conserva_y_se_puede_quitar(
    cliente: TestClient,
    headers_inmobiliaria: dict[str, str],
) -> None:
    descripcion = 'Living luminoso.\n\nDormitorio con placard.'
    creado = cliente.post(
        '/publicaciones',
        json=datos(descripcion=f'  {descripcion}  '),
        headers=headers_inmobiliaria,
    )
    assert creado.status_code == HTTPStatus.CREATED
    ruta = f'/publicaciones/{creado.json()["id"]}'
    assert creado.json()['descripcion'] == descripcion

    editado = cliente.put(ruta, json=datos(), headers=headers_inmobiliaria)
    assert editado.json()['descripcion'] == descripcion

    for nuevo, esperado in [
        ('Ambientes al frente.', 'Ambientes al frente.'),
        ('   ', None),
    ]:
        respuesta = cliente.patch(
            ruta + '/descripcion',
            json={'descripcion': nuevo},
            headers=headers_inmobiliaria,
        )
        assert respuesta.status_code == HTTPStatus.NO_CONTENT
        assert cliente.get(ruta).json()['descripcion'] == esperado


def test_descripcion_rechaza_texto_excesivo_y_cambios_ajenos(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    autenticar_como: Autenticar,
) -> None:
    ruta = f'/publicaciones/{aviso_id}/descripcion'
    ajeno = cliente.patch(
        ruta,
        json={'descripcion': 'Texto de otra inmobiliaria'},
        headers=autenticar_como('otro@example.com', 'INMOBILIARIA'),
    )
    assert ajeno.status_code == HTTPStatus.FORBIDDEN
    largo = cliente.patch(
        ruta,
        json={'descripcion': 'A' * 1201},
        headers=headers_inmobiliaria,
    )
    assert largo.status_code == HTTPStatus.UNPROCESSABLE_ENTITY


@pytest.mark.parametrize(
    'numero',
    ['11 5555-0199', '+00 5555-0199', 'https://wa.me/123456789'],
)
def test_publicar_rechaza_whatsapp_fuera_del_formato_internacional(
    cliente: TestClient, headers_inmobiliaria: dict[str, str], numero: str
) -> None:
    respuesta = cliente.post(
        '/publicaciones',
        json=datos(whatsapp=numero),
        headers=headers_inmobiliaria,
    )
    assert respuesta.status_code == HTTPStatus.UNPROCESSABLE_ENTITY


def test_editar_aviso_sin_whatsapp_conserva_el_contacto_y_null_lo_borra(
    cliente: TestClient, aviso_id: int, headers_inmobiliaria: dict[str, str]
) -> None:
    ruta = f'/publicaciones/{aviso_id}'
    assert cliente.get(ruta).json()['whatsapp_url'] is None
    numero = '+5491155550199'
    guardado = cliente.put(
        ruta,
        json=datos(whatsapp=numero),
        headers=headers_inmobiliaria,
    )
    assert guardado.status_code == HTTPStatus.OK
    cambios = cliente.put(ruta, json=datos(), headers=headers_inmobiliaria)
    assert cambios.json()['whatsapp'] == numero
    borrado = cliente.put(
        ruta,
        json=datos(whatsapp=None),
        headers=headers_inmobiliaria,
    )
    assert borrado.status_code == HTTPStatus.OK
    assert cliente.get(ruta).json()['whatsapp_url'] is None


def test_actualizar_solo_el_whatsapp_de_un_aviso(
    cliente: TestClient, aviso_id: int, headers_inmobiliaria: dict[str, str]
) -> None:
    ruta = f'/publicaciones/{aviso_id}'
    original = cliente.get(ruta).json()
    resultado = cliente.patch(
        f'{ruta}/whatsapp',
        json={'whatsapp': '+54 9 (11) 5555-0199'},
        headers=headers_inmobiliaria,
    )
    assert resultado.status_code == HTTPStatus.NO_CONTENT
    actual = cliente.get(ruta).json()
    assert actual.pop('whatsapp') == '+5491155550199'
    assert actual.pop('whatsapp_url').startswith(
        'https://wa.me/5491155550199?'
    )
    assert actual == {
        campo: valor
        for campo, valor in original.items()
        if campo not in {'whatsapp', 'whatsapp_url'}
    }

    resultado = cliente.patch(
        f'{ruta}/whatsapp',
        json={},
        headers=headers_inmobiliaria,
    )
    assert resultado.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    resultado = cliente.patch(
        f'{ruta}/whatsapp',
        json={'whatsapp': None},
        headers=headers_inmobiliaria,
    )
    assert resultado.status_code == HTTPStatus.NO_CONTENT
    assert cliente.get(ruta).json() == original


def test_otra_inmobiliaria_no_puede_editar_el_whatsapp(
    cliente: TestClient, aviso_id: int, autenticar_como: Autenticar
) -> None:
    ajeno = autenticar_como('otra@example.com', 'INMOBILIARIA')
    resultado = cliente.patch(
        f'/publicaciones/{aviso_id}/whatsapp',
        json={'whatsapp': '+5491155550199'},
        headers=ajeno,
    )
    assert resultado.status_code == HTTPStatus.FORBIDDEN


def test_agregar_y_eliminar_fotos_de_un_aviso(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    carpeta_fotos: Path,
    foto_png: tuple[str, bytes, str],
) -> None:
    ruta = f'/publicaciones/{aviso_id}'
    assert cliente.get(ruta).json()['fotos'] == []

    respuesta = cliente.post(
        f'{ruta}/fotos',
        files=[('fotos', foto_png), ('fotos', foto_png)],
        headers=headers_inmobiliaria,
    )
    assert respuesta.status_code == HTTPStatus.CREATED
    primera, segunda = respuesta.json()
    resultados = cliente.get('/publicaciones').json()
    assert resultados[0]['fotos'] == [primera, segunda]

    imagen = cliente.get(primera['url'])
    assert imagen.status_code == HTTPStatus.OK
    assert imagen.headers['content-type'] == 'image/webp'
    with Image.open(BytesIO(imagen.content)) as optimizada:
        with Image.open(BytesIO(foto_png[1])) as original:
            assert optimizada.size == original.size

    borrado = cliente.delete(primera['url'], headers=headers_inmobiliaria)
    assert borrado.status_code == HTTPStatus.NO_CONTENT
    assert cliente.get(primera['url']).status_code == HTTPStatus.NOT_FOUND
    assert cliente.get(ruta).json()['fotos'] == [segunda]

    borrado = cliente.delete(ruta, headers=headers_inmobiliaria)
    assert borrado.status_code == HTTPStatus.NO_CONTENT
    assert cliente.get(segunda['url']).status_code == HTTPStatus.NOT_FOUND
    assert list(carpeta_fotos.iterdir()) == []


def test_admite_y_reescala_foto_grande_de_celular(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    carpeta_fotos: Path,
) -> None:
    original = BytesIO()
    with Image.effect_noise((3600, 2400), 70) as imagen:
        exif = Image.Exif()
        exif[ExifTags.Base.Orientation] = 6  # Captura vertical.
        imagen.save(original, format='JPEG', quality=100, exif=exif)
    assert original.tell() > 5 * 1024 * 1024
    respuesta = cliente.post(
        f'/publicaciones/{aviso_id}/fotos',
        files=[('fotos', ('celular.jpg', original.getvalue(), 'image/jpeg'))],
        headers=headers_inmobiliaria,
    )
    assert respuesta.status_code == HTTPStatus.CREATED
    descarga = cliente.get(respuesta.json()[0]['url'])
    assert descarga.headers['content-type'] == 'image/webp'
    with Image.open(BytesIO(descarga.content)) as optimizada:
        assert optimizada.format == 'WEBP'
        assert optimizada.width < optimizada.height <= LADO_MAXIMO
        assert ExifTags.Base.Orientation not in optimizada.getexif()
    assert len(descarga.content) < original.tell() // 10
    assert [archivo.stat().st_size for archivo in carpeta_fotos.iterdir()] == [
        len(descarga.content)
    ]


def test_fotos_compartidas_conservan_el_archivo_hasta_la_ultima_referencia(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    carpeta_fotos: Path,
    foto_png: tuple[str, bytes, str],
) -> None:
    cabeceras = headers_inmobiliaria
    origen = f'/publicaciones/{aviso_id}'
    subida = cliente.post(
        f'{origen}/fotos', files=[('fotos', foto_png)], headers=cabeceras
    )
    assert subida.status_code == HTTPStatus.CREATED
    anterior = subida.json()[0]
    archivo = next(carpeta_fotos.iterdir())
    copia_simple = cliente.post(
        '/publicaciones', json=datos(), headers=cabeceras
    )
    destino_simple = f'/publicaciones/{copia_simple.json()["id"]}'
    solo_referencia = cliente.post(
        f'{destino_simple}/fotos',
        files=[
            ('origen_id', (None, str(aviso_id))),
            ('orden', (None, str(anterior['id']))),
        ],
        headers=cabeceras,
    )
    assert solo_referencia.status_code == HTTPStatus.CREATED
    assert list(carpeta_fotos.iterdir()) == [archivo]
    copia = cliente.post('/publicaciones', json=datos(), headers=cabeceras)
    destino = f'/publicaciones/{copia.json()["id"]}'
    fotos = cliente.post(
        f'{destino}/fotos',
        data={'origen_id': str(aviso_id), 'orden': ['0', str(anterior['id'])]},
        files=[('fotos', foto_png)],
        headers=cabeceras,
    )
    assert fotos.status_code == HTTPStatus.CREATED
    nueva, compartida = fotos.json()
    assert nueva['id'] < compartida['id']
    assert cliente.get(destino).json()['fotos'] == [nueva, compartida]
    assert len(list(carpeta_fotos.iterdir())) == len(fotos.json())
    assert cliente.delete(origen, headers=cabeceras).status_code == (
        HTTPStatus.NO_CONTENT
    )
    assert archivo.exists()
    assert cliente.get(compartida['url']).content == archivo.read_bytes()
    assert cliente.delete(
        compartida['url'], headers=cabeceras
    ).status_code == (HTTPStatus.NO_CONTENT)
    assert archivo.exists()
    assert cliente.get(nueva['url']).status_code == HTTPStatus.OK
    assert cliente.delete(destino_simple, headers=cabeceras).status_code == (
        HTTPStatus.NO_CONTENT
    )
    assert not archivo.exists()
    assert cliente.delete(destino, headers=cabeceras).status_code == (
        HTTPStatus.NO_CONTENT
    )
    assert cliente.get(destino).status_code == HTTPStatus.NOT_FOUND
    assert list(carpeta_fotos.iterdir()) == []


def test_cupo_total_cuenta_pausadas_y_cerradas(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    limite = 2
    monkeypatch.setattr(
        servicio_publicaciones, 'CUPO_TOTAL_INMOBILIARIA', limite
    )
    cabeceras = headers_inmobiliaria
    venta = cliente.post(
        '/publicaciones', json=datos_venta(), headers=cabeceras
    )
    assert venta.status_code == HTTPStatus.CREATED
    for identificador, estado in (
        (aviso_id, 'pausada'),
        (venta.json()['id'], 'cerrada'),
    ):
        assert (
            cliente.patch(
                f'/publicaciones/mis/{identificador}/estado',
                json={'estado': estado},
                headers=cabeceras,
            ).status_code
            == HTTPStatus.NO_CONTENT
        )
    cupo = cliente.get('/publicaciones/mis/cupo', headers=cabeceras).json()
    assert cupo['activas'] == 0
    assert cupo['guardadas'] == cupo['limite_guardadas'] == limite
    assert (
        cliente.post(
            '/publicaciones', json=datos(), headers=cabeceras
        ).status_code
        == HTTPStatus.CONFLICT
    )
    assert (
        cliente.delete(
            f'/publicaciones/{aviso_id}', headers=cabeceras
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert (
        cliente.post(
            '/publicaciones', json=datos(), headers=cabeceras
        ).status_code
        == HTTPStatus.CREATED
    )


def test_revision_de_huerfanas_respeta_fotos_en_uso_y_archivos_recientes(  # noqa: PLR0913
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    carpeta_fotos: Path,
    *,
    foto_png: tuple[str, bytes, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    subida = cliente.post(
        f'/publicaciones/{aviso_id}/fotos',
        files=[('fotos', foto_png)],
        headers=headers_inmobiliaria,
    )
    assert subida.status_code == HTTPStatus.CREATED
    en_uso = next(carpeta_fotos.iterdir())
    antigua = carpeta_fotos / ('a' * 32)
    reciente = carpeta_fotos / ('b' * 32)
    otro_archivo = carpeta_fotos / 'guia.txt'
    for ruta in (antigua, reciente, otro_archivo):
        ruta.write_bytes(b'prueba')
    pasado = time() - archivos_fotos.SEGUNDOS_ANTES_DE_REVISAR - 60
    for ruta in (en_uso, antigua, otro_archivo):
        utime(ruta, (pasado, pasado))
    assert archivos_fotos.revisar_fotos_huerfanas() == 1
    assert antigua.exists()
    monkeypatch.setattr(get_config(), 'fotos_eliminar_huerfanas', True)
    assert archivos_fotos.revisar_fotos_huerfanas() == 1
    assert not antigua.exists()
    assert all(ruta.exists() for ruta in (en_uso, reciente, otro_archivo))


def test_mis_publicaciones_exige_cuenta_y_muestra_solo_avisos_propios(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    autenticar_como: Autenticar,
) -> None:
    otra = autenticar_como('otra@example.com', 'INMOBILIARIA')
    assert cliente.get('/publicaciones/mis').status_code in {
        HTTPStatus.UNAUTHORIZED,
        HTTPStatus.FORBIDDEN,
    }
    assert cliente.get('/publicaciones/mis', headers=otra).json() == []
    propios = cliente.get('/publicaciones/mis', headers=headers_inmobiliaria)
    assert [(p['id'], p['estado']) for p in propios.json()] == [
        (aviso_id, 'activa'),
    ]
    ruta = f'/publicaciones/mis/{aviso_id}'
    assert cliente.get(ruta, headers=otra).status_code == HTTPStatus.FORBIDDEN
    for campo, cuerpo in [
        ('precio', {'monto': '700000'}),
        ('estado', {'estado': 'pausada'}),
    ]:
        assert (
            cliente.patch(
                f'{ruta}/{campo}', json=cuerpo, headers=otra
            ).status_code
            == HTTPStatus.FORBIDDEN
        )


def test_solo_admin_puede_cambiar_el_patrocinio_de_un_aviso(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    autenticar_como: Autenticar,
) -> None:
    ruta = f'/publicaciones/{aviso_id}'
    assert (
        cliente.post(
            '/publicaciones',
            json=datos(patrocinada=True),
            headers=headers_inmobiliaria,
        ).status_code
        == HTTPStatus.FORBIDDEN
    )
    assert (
        cliente.put(
            ruta, json=datos(patrocinada=True), headers=headers_inmobiliaria
        ).status_code
        == HTTPStatus.FORBIDDEN
    )
    administrador = autenticar_como('admin@example.com', 'ADMIN')
    patrocinada = cliente.put(
        ruta, json=datos(patrocinada=True), headers=administrador
    )
    assert patrocinada.status_code == HTTPStatus.OK
    assert patrocinada.json()['patrocinada'] is True
    editada = cliente.put(
        ruta,
        json=datos(titulo='Aviso actualizado'),
        headers=headers_inmobiliaria,
    )
    assert editada.status_code == HTTPStatus.OK
    assert editada.json()['patrocinada'] is True
    assert (
        cliente.put(
            ruta, json=datos(patrocinada=False), headers=headers_inmobiliaria
        ).status_code
        == HTTPStatus.FORBIDDEN
    )
    retirada = cliente.put(
        ruta, json=datos(patrocinada=False), headers=administrador
    )
    assert retirada.status_code == HTTPStatus.OK
    assert retirada.json()['patrocinada'] is False


def test_publicar_y_reactivar_requieren_abono_vigente(
    cliente: TestClient,
    autenticar_como: Autenticar,
) -> None:
    agencia = autenticar_como('nueva@example.com', 'INMOBILIARIA')
    admin = autenticar_como('admin@example.com', 'ADMIN')
    cupo = '/publicaciones/mis/cupo'
    agencia_id = cliente.get('/usuarios/me', headers=agencia).json()['id']
    abono = f'/admin/inmobiliarias/{agencia_id}/abono'
    assert cliente.get(cupo, headers=agencia).json()['requiere_abono'] is True
    assert (
        cliente.post(
            '/publicaciones', json=datos(), headers=agencia
        ).status_code
        == HTTPStatus.FORBIDDEN
    )
    assert cliente.get('/planes', headers=agencia).status_code == HTTPStatus.OK
    assert cliente.get('/publicaciones/mis', headers=agencia).json() == []

    assert (
        cliente.patch(
            abono, json={'pagado_el': '2099-01-01'}, headers=admin
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert cliente.get(cupo, headers=agencia).json()['requiere_abono'] is False
    aviso = cliente.post('/publicaciones', json=datos(), headers=agencia)
    assert aviso.status_code == HTTPStatus.CREATED
    aviso_id = aviso.json()['id']
    estado = f'/publicaciones/mis/{aviso_id}/estado'

    assert (
        cliente.patch(
            abono, json={'pagado_el': '2000-01-01'}, headers=admin
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert (
        cliente.get(f'/publicaciones/{aviso_id}').status_code
        == HTTPStatus.NOT_FOUND
    )
    assert (
        cliente.patch(
            estado, json={'estado': 'pausada'}, headers=agencia
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert (
        cliente.patch(
            estado, json={'estado': 'activa'}, headers=agencia
        ).status_code
        == HTTPStatus.FORBIDDEN
    )


def test_retencion_y_renovacion_de_avisos(
    cliente: TestClient,
    autenticar_como: Autenticar,
    monkeypatch: pytest.MonkeyPatch,
    carpeta_fotos: Path,
    foto_png: tuple[str, bytes, str],
) -> None:
    fecha = date(2026, 1, 1)
    for modulo in (abonos, usuario, retencion_avisos, servicio_publicaciones):
        monkeypatch.setattr(modulo, 'hoy_en_argentina', lambda: fecha)

    agencia = autenticar_como('retencion@example.com', 'INMOBILIARIA')
    admin = autenticar_como('admin@example.com', 'ADMIN')
    agencia_id = cliente.get('/usuarios/me', headers=agencia).json()['id']
    abono = f'/admin/inmobiliarias/{agencia_id}/abono'

    def registrar_pago() -> None:
        respuesta = cliente.patch(
            abono, json={'pagado_el': fecha.isoformat()}, headers=admin
        )
        assert respuesta.status_code == HTTPStatus.NO_CONTENT

    registrar_pago()
    aviso = cliente.post(
        '/publicaciones', json=datos(), headers=agencia
    ).json()
    pausado = cliente.post(
        '/publicaciones', json=datos(), headers=agencia
    ).json()
    aviso_url = f'/publicaciones/{aviso["id"]}'
    assert (
        cliente.patch(
            f'/publicaciones/mis/{pausado["id"]}/estado',
            json={'estado': 'pausada'},
            headers=agencia,
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    subida = cliente.post(
        aviso_url + '/fotos', files=[('fotos', foto_png)], headers=agencia
    )
    assert subida.status_code == HTTPStatus.CREATED
    foto_url = subida.json()[0]['url']
    avisos_creados = {aviso['id'], pausado['id']}

    fecha = date(2026, 2, 4)
    assert cliente.get(foto_url).status_code == HTTPStatus.OK
    perfil = cliente.get('/usuarios/me', headers=agencia).json()
    assert perfil['abono_vigente'] is False
    assert perfil['abono_ocultar_desde'] == '2026-02-05'
    fecha = date(2026, 2, 5)
    assert cliente.get('/publicaciones').json() == []
    assert cliente.get(aviso_url).status_code == HTTPStatus.NOT_FOUND
    assert cliente.get(foto_url).status_code == HTTPStatus.NOT_FOUND
    guardados = cliente.get('/publicaciones/mis', headers=agencia).json()
    assert {p['id'] for p in guardados} == avisos_creados

    assert (
        cliente.patch(
            abono, json={'pagado_el': None}, headers=admin
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert cliente.get(aviso_url).status_code == HTTPStatus.NOT_FOUND

    fecha = date(2026, 2, 20)
    registrar_pago()
    assert cliente.get(foto_url).status_code == HTTPStatus.OK
    assert cliente.get(f'/publicaciones/{pausado["id"]}').status_code == (
        HTTPStatus.NOT_FOUND
    )

    fecha = date(2026, 4, 22)
    retencion_avisos.aplicar_retencion_avisos()
    guardados = cliente.get('/publicaciones/mis', headers=agencia).json()
    assert {p['id'] for p in guardados} == avisos_creados
    fecha = date(2026, 4, 23)
    assert (
        cliente.post(
            '/planes/abono/pago',
            json={'referencia': 'TR-RETENCION'},
            headers=agencia,
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    retencion_avisos.aplicar_retencion_avisos()
    guardados = cliente.get('/publicaciones/mis', headers=agencia).json()
    assert {p['id'] for p in guardados} == avisos_creados
    assert (
        cliente.patch(
            abono + '/rechazar',
            json={
                'referencia': 'TR-RETENCION',
                'motivo': 'Falta el comprobante.',
            },
            headers=admin,
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    retencion_avisos.aplicar_retencion_avisos()
    assert cliente.get('/publicaciones/mis', headers=agencia).json() == []
    assert not list(carpeta_fotos.iterdir())
    historial = cliente.get('/planes/pagos', headers=agencia).json()
    assert [p['pagado_el'] for p in historial] == [
        None,
        '2026-02-20',
        '2026-01-01',
    ]


def test_cupo_compartido_por_operacion_y_liberado_al_pausar(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    publicar = headers_inmobiliaria
    monkeypatch.setattr(servicio_publicaciones, 'CUPO_PILOTO', 1)
    ruta = f'/publicaciones/mis/{aviso_id}/estado'
    cupo = cliente.get('/publicaciones/mis/cupo', headers=publicar)
    assert cupo.json() == {
        'activas': 1,
        'limite': 1,
        'guardadas': 1,
        'limite_guardadas': servicio_publicaciones.CUPO_TOTAL_INMOBILIARIA,
        'requiere_abono': False,
        'avisos_visibles': True,
    }
    assert (
        cliente.post(
            '/publicaciones', json=datos_venta(), headers=publicar
        ).status_code
        == HTTPStatus.CONFLICT
    )
    assert (
        cliente.patch(
            ruta, json={'estado': 'activa'}, headers=publicar
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert (
        cliente.patch(
            ruta, json={'estado': 'pausada'}, headers=publicar
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    venta = cliente.post(
        '/publicaciones', json=datos_venta(), headers=publicar
    )
    assert venta.status_code == HTTPStatus.CREATED
    assert (
        cliente.patch(
            ruta, json={'estado': 'activa'}, headers=publicar
        ).status_code
        == HTTPStatus.CONFLICT
    )
    cierre = cliente.patch(
        f'/publicaciones/mis/{venta.json()["id"]}/estado',
        json={'estado': 'cerrada'},
        headers=publicar,
    )
    assert cierre.status_code == HTTPStatus.NO_CONTENT
    assert (
        cliente.patch(
            ruta, json={'estado': 'activa'}, headers=publicar
        ).status_code
        == HTTPStatus.NO_CONTENT
    )


def test_metricas_del_aviso_se_acumulan_y_son_privadas(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
) -> None:
    editar = headers_inmobiliaria
    publica = f'/publicaciones/{aviso_id}'
    gestion = f'/publicaciones/mis/{aviso_id}'
    ruta = f'{publica}/metricas'
    assert (
        cliente.post(ruta, json={'evento': 'whatsapp'}).status_code
        == HTTPStatus.NOT_FOUND
    )
    assert (
        cliente.patch(
            f'{publica}/whatsapp',
            json={'whatsapp': '+5491155550199'},
            headers=editar,
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    for evento in ('visita', 'visita', 'whatsapp'):
        assert (
            cliente.post(ruta, json={'evento': evento}).status_code
            == HTTPStatus.NO_CONTENT
        )
    assert (
        cliente.post(
            ruta, json={'evento': 'visita', 'telefono': 'no se registra'}
        ).status_code
        == HTTPStatus.UNPROCESSABLE_ENTITY
    )
    cliente.patch(
        f'{gestion}/estado', json={'estado': 'pausada'}, headers=editar
    )
    assert (
        cliente.post(ruta, json={'evento': 'visita'}).status_code
        == HTTPStatus.NOT_FOUND
    )
    vistas = 2
    propio = cliente.get(gestion, headers=editar).json()
    assert propio['visitas'] == vistas
    assert propio['clics_whatsapp'] == 1
    cliente.patch(
        f'{gestion}/estado', json={'estado': 'activa'}, headers=editar
    )
    publico = cliente.get(publica).json()
    assert 'visitas' not in publico
    assert 'clics_whatsapp' not in publico


def test_editar_aviso_pausado_reutiliza_datos_y_protege_direccion(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    autenticar_como: Autenticar,
) -> None:
    gestion = f'/publicaciones/mis/{aviso_id}'
    publica = f'/publicaciones/{aviso_id}'
    propia = cliente.get(gestion, headers=headers_inmobiliaria)
    assert propia.headers['cache-control'] == 'no-store'
    propiedad = propia.json()['propiedad']
    assert propiedad['direccion'] == 'Avenida Rivadavia 5500'
    assert 'direccion' not in cliente.get(publica).json()['propiedad']
    otras = autenticar_como('otra@example.com', 'INMOBILIARIA')
    lectura_ajena = cliente.get(gestion, headers=otras)
    assert lectura_ajena.status_code == HTTPStatus.FORBIDDEN
    pausa = cliente.patch(
        f'{gestion}/estado',
        json={'estado': 'pausada'},
        headers=headers_inmobiliaria,
    )
    assert pausa.status_code == HTTPStatus.NO_CONTENT

    duracion = 24
    respuesta = cliente.put(
        publica,
        json=datos(
            propiedad=propiedad,
            duracion_contrato_meses=duracion,
            tipo_garantia_aceptada='Seguro de caución',
            tipo_ajuste='INDICE',
            serie_codigo='IPC',
        ),
        headers=headers_inmobiliaria,
    )
    assert respuesta.status_code == HTTPStatus.OK
    assert 'direccion' not in respuesta.json()['propiedad']
    editada = cliente.get(gestion, headers=headers_inmobiliaria).json()
    assert editada['estado'] == 'pausada'
    assert editada['duracion_contrato_meses'] == duracion
    assert editada['tipo_garantia_aceptada'] == 'Seguro de caución'
    assert editada['tipo_ajuste'] == 'INDICE'
    assert editada['serie_codigo'] == 'IPC'


def test_gestionar_precio_y_reactivar_aviso(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
) -> None:
    ruta = f'/publicaciones/{aviso_id}'
    gestion = f'/publicaciones/mis/{aviso_id}'
    publicar = headers_inmobiliaria
    for estado in ('pausada', 'cerrada'):
        assert (
            cliente.patch(
                f'{gestion}/estado', json={'estado': estado}, headers=publicar
            ).status_code
            == HTTPStatus.NO_CONTENT
        )
        assert cliente.get('/publicaciones').json() == []
        assert cliente.get(ruta).status_code == HTTPStatus.NOT_FOUND
        costo = cliente.get(f'{ruta}/costo-real')
        assert costo.status_code == HTTPStatus.NOT_FOUND
        propio = cliente.get(gestion, headers=publicar)
        assert propio.json()['estado'] == estado

    assert (
        cliente.patch(
            f'{gestion}/precio', json={'monto': '700000.50'}, headers=publicar
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert (
        cliente.patch(
            f'{gestion}/estado', json={'estado': 'activa'}, headers=publicar
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    aviso = cliente.get(ruta).json()
    assert aviso['precio_alquiler'] == {'monto': '700000.50', 'moneda': 'ARS'}
    assert aviso['propiedad']['zona'] == 'Caballito'


def test_gestionar_gastos_actualiza_costos_y_distingue_cero_de_faltante(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    autenticar_como: Autenticar,
) -> None:
    ruta = f'/publicaciones/{aviso_id}'
    gestion = f'/publicaciones/mis/{aviso_id}/gastos'
    cambios = {
        'expensas_mensuales': '50000.50',
        'abl_mensual': 0,
        'deposito': 120000,
        'comision': 10000,
    }
    otra = autenticar_como('otra@example.com', 'INMOBILIARIA')
    assert (
        cliente.patch(gestion, json=cambios, headers=otra).status_code
        == HTTPStatus.FORBIDDEN
    )
    guardada = cliente.patch(
        gestion, json=cambios, headers=headers_inmobiliaria
    )
    assert guardada.status_code == HTTPStatus.OK
    mensual = cliente.get(f'{ruta}/costo-real').json()
    assert mensual['total']['monto'] == '700000.50'
    assert mensual['componentes_informados']['abl']['monto'] == '0.00'
    assert 'abl' not in mensual['faltantes']
    entrada = cliente.get(f'{ruta}/costo-entrada').json()
    assert entrada['total']['monto'] == '780000.00'

    respuesta = cliente.patch(
        gestion, json={'abl_mensual': None}, headers=headers_inmobiliaria
    )
    aviso = respuesta.json()
    assert respuesta.status_code == HTTPStatus.OK
    assert aviso['abl_mensual'] is None
    assert aviso['expensas_mensuales']['monto'] == '50000.50'
    assert aviso['precio_alquiler']['monto'] == '650000.00'
    assert 'abl' in cliente.get(f'{ruta}/costo-real').json()['faltantes']
    assert (
        cliente.patch(
            gestion, json={'abl_mensual': -1}, headers=headers_inmobiliaria
        ).status_code
        == HTTPStatus.UNPROCESSABLE_ENTITY
    )


def test_gastos_de_venta_en_pesos_conservan_el_precio_en_dolares(
    cliente: TestClient,
    headers_inmobiliaria: dict[str, str],
) -> None:
    venta = cliente.post(
        '/publicaciones', json=datos_venta(), headers=headers_inmobiliaria
    ).json()
    ruta = f'/publicaciones/mis/{venta["id"]}/gastos'
    actualizada = cliente.patch(
        ruta, json={'expensas_mensuales': 42000}, headers=headers_inmobiliaria
    )
    assert actualizada.status_code == HTTPStatus.OK
    assert actualizada.json()['expensas_mensuales'] == {
        'monto': '42000.00',
        'moneda': 'ARS',
    }
    assert actualizada.json()['precio_venta'] == venta['precio_venta']
    assert (
        cliente.patch(
            ruta, json={'deposito': 200}, headers=headers_inmobiliaria
        ).status_code
        == HTTPStatus.UNPROCESSABLE_ENTITY
    )


def test_fotos_de_aviso_pausado_solo_se_sirven_al_publicador(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    carpeta_fotos: Path,
    foto_png: tuple[str, bytes, str],
) -> None:
    ruta = f'/publicaciones/{aviso_id}'
    gestion = f'/publicaciones/mis/{aviso_id}'
    cliente.patch(
        f'{gestion}/estado',
        json={'estado': 'pausada'},
        headers=headers_inmobiliaria,
    )
    respuesta = cliente.post(
        f'{ruta}/fotos',
        files=[('fotos', foto_png)],
        headers=headers_inmobiliaria,
    )
    assert respuesta.status_code == HTTPStatus.CREATED
    foto = respuesta.json()[0]
    assert cliente.get(foto['url']).status_code == HTTPStatus.NOT_FOUND
    privada = cliente.get(
        f'{gestion}/fotos/{foto["id"]}', headers=headers_inmobiliaria
    )
    assert privada.status_code == HTTPStatus.OK
    assert privada.headers['cache-control'] == 'no-store'
    assert privada.headers['content-type'] == 'image/webp'


def test_rechaza_carga_invalida_sin_guardar_el_lote(
    cliente: TestClient,
    aviso_id: int,
    headers_inmobiliaria: dict[str, str],
    carpeta_fotos: Path,
    foto_png: tuple[str, bytes, str],
) -> None:
    ruta = f'/publicaciones/{aviso_id}'
    respuesta = cliente.post(
        f'{ruta}/fotos',
        files=[
            ('fotos', foto_png),
            ('fotos', ('falsa.png', b'no', 'image/png')),
        ],
        headers=headers_inmobiliaria,
    )
    assert respuesta.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert cliente.get(ruta).json()['fotos'] == []
    assert not carpeta_fotos.exists()


@pytest.mark.usefixtures('carpeta_fotos')
def test_limite_y_permisos_de_fotos(
    cliente: TestClient,
    aviso_id: int,
    autenticar: Autenticar,
    headers_inmobiliaria: dict[str, str],
    foto_png: tuple[str, bytes, str],
) -> None:
    ruta = f'/publicaciones/{aviso_id}/fotos'
    ajeno = autenticar()
    fotos = [('fotos', foto_png)] * 20

    intento = cliente.post(ruta, files=fotos, headers=ajeno)
    assert intento.status_code == HTTPStatus.FORBIDDEN
    intento = cliente.post(
        ruta,
        files=fotos + fotos[:1],
        headers=headers_inmobiliaria,
    )
    assert intento.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    respuesta = cliente.post(ruta, files=fotos, headers=headers_inmobiliaria)
    assert respuesta.status_code == HTTPStatus.CREATED
    assert len(respuesta.json()) == len(fotos)
    intento = cliente.delete(respuesta.json()[0]['url'], headers=ajeno)
    assert intento.status_code == HTTPStatus.FORBIDDEN
    intento = cliente.post(ruta, files=fotos[:1], headers=headers_inmobiliaria)
    assert intento.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert len(
        cliente.get(f'/publicaciones/{aviso_id}').json()['fotos']
    ) == len(fotos)


# --- lectura --------------------------------------------------------------


def test_get_by_id_returns_the_listing(
    cliente: TestClient, aviso_id: int
) -> None:
    respuesta = cliente.get(f'/publicaciones/{aviso_id}')

    assert respuesta.status_code == HTTPStatus.OK
    assert respuesta.json()['id'] == aviso_id
    assert respuesta.json()['propiedad']['zona'] == 'Caballito'


def test_get_missing_listing_is_404(cliente: TestClient) -> None:
    assert (
        cliente.get('/publicaciones/999').status_code == HTTPStatus.NOT_FOUND
    )


# --- edición --------------------------------------------------------------


def test_owner_updates_the_listing(
    cliente: TestClient, aviso_id: int, headers_inmobiliaria: dict[str, str]
) -> None:
    nuevo = datos(
        propiedad={
            'direccion': 'Avenida Rivadavia 5500',
            'zona': 'Palermo',
            'tipo': 'ph',
            'ambientes': 3,
        },
        precio_alquiler={'monto': '720000', 'moneda': 'ARS'},
        comision={'monto': '720000', 'moneda': 'ARS'},
    )

    respuesta = cliente.put(
        f'/publicaciones/{aviso_id}', json=nuevo, headers=headers_inmobiliaria
    )

    assert respuesta.status_code == HTTPStatus.OK
    cuerpo = cliente.get(f'/publicaciones/{aviso_id}').json()
    assert cuerpo['propiedad']['zona'] == 'Palermo'
    assert cuerpo['precio_alquiler']['monto'] == '720000.00'
    assert cuerpo['comision']['monto'] == '720000.00'


def test_update_with_invalid_data_is_422(
    cliente: TestClient, aviso_id: int, headers_inmobiliaria: dict[str, str]
) -> None:
    invalido = datos(precio_alquiler={'monto': '0', 'moneda': 'ARS'})

    respuesta = cliente.put(
        f'/publicaciones/{aviso_id}',
        json=invalido,
        headers=headers_inmobiliaria,
    )

    assert respuesta.status_code == HTTPStatus.UNPROCESSABLE_ENTITY


def test_update_missing_listing_is_404(
    cliente: TestClient, headers_inmobiliaria: dict[str, str]
) -> None:
    respuesta = cliente.put(
        '/publicaciones/999', json=datos(), headers=headers_inmobiliaria
    )

    assert respuesta.status_code == HTTPStatus.NOT_FOUND


# --- borrado --------------------------------------------------------------


def test_owner_deletes_the_listing(
    cliente: TestClient, aviso_id: int, headers_inmobiliaria: dict[str, str]
) -> None:
    respuesta = cliente.delete(
        f'/publicaciones/{aviso_id}', headers=headers_inmobiliaria
    )

    assert respuesta.status_code == HTTPStatus.NO_CONTENT
    assert cliente.get(f'/publicaciones/{aviso_id}').status_code == 404  # noqa: PLR2004
    assert cliente.get('/publicaciones').json() == []


def test_delete_missing_listing_is_404(
    cliente: TestClient, headers_inmobiliaria: dict[str, str]
) -> None:
    respuesta = cliente.delete(
        '/publicaciones/999', headers=headers_inmobiliaria
    )

    assert respuesta.status_code == HTTPStatus.NOT_FOUND


# --- permisos (P6) --------------------------------------------------------


@pytest.mark.parametrize(
    ('email', 'rol'),
    [
        ('ajena@example.com', 'INMOBILIARIA'),
        ('busca@example.com', 'BUSCADOR'),
    ],
)
def test_only_the_owner_can_change_or_delete(
    cliente: TestClient,
    autenticar_como: Autenticar,
    aviso_id: int,
    email: str,
    rol: str,
) -> None:
    intruso = autenticar_como(email, rol)

    put = cliente.put(
        f'/publicaciones/{aviso_id}',
        json=datos(precio_alquiler={'monto': '1', 'moneda': 'ARS'}),
        headers=intruso,
    )
    borrar = cliente.delete(f'/publicaciones/{aviso_id}', headers=intruso)

    assert put.status_code == HTTPStatus.FORBIDDEN
    assert borrar.status_code == HTTPStatus.FORBIDDEN
    intacto = cliente.get(f'/publicaciones/{aviso_id}').json()
    assert intacto['precio_alquiler']['monto'] == '650000.00'


def test_changes_require_a_token(cliente: TestClient, aviso_id: int) -> None:
    put = cliente.put(f'/publicaciones/{aviso_id}', json=datos())
    borrar = cliente.delete(f'/publicaciones/{aviso_id}')

    assert put.status_code == HTTPStatus.UNAUTHORIZED
    assert borrar.status_code == HTTPStatus.UNAUTHORIZED


def test_admin_can_change_and_delete_any_listing(
    cliente: TestClient, autenticar_como: Autenticar, aviso_id: int
) -> None:
    admin = autenticar_como('admin@example.com', 'ADMIN')

    put = cliente.put(
        f'/publicaciones/{aviso_id}', json=datos(), headers=admin
    )
    borrar = cliente.delete(f'/publicaciones/{aviso_id}', headers=admin)

    assert put.status_code == HTTPStatus.OK
    assert borrar.status_code == HTTPStatus.NO_CONTENT


def test_sample_listings_belong_to_the_system_not_to_inmobiliarias(
    cliente: TestClient,
    autenticar_como: Autenticar,
    headers_inmobiliaria: dict[str, str],
) -> None:
    with Session(get_engine()) as sesion:
        cargar_publicaciones_de_ejemplo(sesion)

    inmobiliaria = cliente.put(
        '/publicaciones/1', json=datos(), headers=headers_inmobiliaria
    )
    admin = cliente.put(
        '/publicaciones/1',
        json=datos(),
        headers=autenticar_como('admin@example.com', 'ADMIN'),
    )

    assert inmobiliaria.status_code == HTTPStatus.FORBIDDEN
    assert admin.status_code == HTTPStatus.OK


# --- costo de entrada (C3) -------------------------------------------------


def test_entry_cost_endpoint_separates_concepts_and_lists_missing(
    cliente: TestClient, headers_inmobiliaria: dict[str, str]
) -> None:
    publicacion = datos(
        deposito={'monto': '650000', 'moneda': 'ARS'},
        otros_gastos_entrada={'monto': '40000', 'moneda': 'ARS'},
    )
    creado = cliente.post(
        '/publicaciones', json=publicacion, headers=headers_inmobiliaria
    ).json()

    respuesta = cliente.get(f'/publicaciones/{creado["id"]}/costo-entrada')

    assert respuesta.status_code == HTTPStatus.OK
    cuerpo = respuesta.json()
    assert cuerpo['total'] == {'monto': '1340000.00', 'moneda': 'ARS'}
    assert set(cuerpo['componentes_informados']) == {
        'primer_mes',
        'deposito',
        'otros_gastos',
    }
    assert cuerpo['faltantes'] == ['comision', 'seguro_caucion']


def test_entry_cost_of_a_missing_listing_is_404(cliente: TestClient) -> None:
    respuesta = cliente.get('/publicaciones/999/costo-entrada')

    assert respuesta.status_code == HTTPStatus.NOT_FOUND


def test_analysis_includes_the_entry_cost(
    cliente: TestClient, autenticar: Autenticar, aviso_id: int
) -> None:
    cabecera = autenticar('busca@example.com')
    cliente.put(
        '/usuarios/me/ingreso-referencia',
        json={'monto': '1500000'},
        headers=cabecera,
    )

    respuesta = cliente.get(
        f'/publicaciones/{aviso_id}/analisis', headers=cabecera
    )

    assert respuesta.status_code == HTTPStatus.OK
    assert respuesta.json()['costo_entrada']['total'] == {
        'monto': '650000.00',
        'moneda': 'ARS',
    }
