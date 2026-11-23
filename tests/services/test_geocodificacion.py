import json
from io import BytesIO
from urllib.parse import parse_qs, urlsplit

import pytest

from alquilometro_api.services import geocodificacion


def test_geocodifica_calle_y_altura_y_redondea(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def consultar(url: str, timeout: int) -> BytesIO:
        assert parse_qs(urlsplit(url).query)['direccion'] == [
            'Av. San Juan 350, CABA'
        ]
        assert timeout > 0
        datos = {
            'direccionesNormalizadas': [
                {
                    'altura': 350,
                    'cod_partido': 'caba',
                    'coordenadas': {
                        'srid': 4326,
                        'x': '-58.370727',
                        'y': '-34.621892',
                    },
                }
            ]
        }
        return BytesIO(json.dumps(datos).encode())

    monkeypatch.setattr(geocodificacion, 'urlopen', consultar)
    assert geocodificacion.geocodificar_direccion('Av. San Juan 350') == (
        -34.622,
        -58.371,
    )


@pytest.mark.parametrize('coincidencias', [[], [{}, {}], [{'altura': 350}]])
def test_geocodificacion_sin_resultado_util(
    monkeypatch: pytest.MonkeyPatch,
    coincidencias: list[dict],
) -> None:
    contenido = json.dumps({'direccionesNormalizadas': coincidencias}).encode()
    monkeypatch.setattr(
        geocodificacion, 'urlopen', lambda *_, **__: BytesIO(contenido)
    )
    assert geocodificacion.geocodificar_direccion('Av. San Juan 350') is None


def test_geocodificacion_sigue_sin_red(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def sin_red(*_, **__) -> BytesIO:
        raise TimeoutError

    monkeypatch.setattr(geocodificacion, 'urlopen', sin_red)
    assert geocodificacion.geocodificar_direccion('Av. San Juan 350') is None
    assert geocodificacion.geocodificar_direccion('Av. San Juan') is None
