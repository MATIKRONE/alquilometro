import json
import re
from collections.abc import Callable
from urllib.parse import urlencode
from urllib.request import urlopen

Geocodificador = Callable[[str], tuple[float, float] | None]
NORMALIZADOR_USIG = 'https://servicios.usig.buenosaires.gob.ar/normalizar/'
LATITUD_CABA = (-34.72, -34.50)
LONGITUD_CABA = (-58.54, -58.32)
SRID_WGS84 = 4326


def geocodificar_direccion(direccion: str) -> tuple[float, float] | None:
    """Devuelve una referencia redondeada para una dirección única en CABA."""
    altura = re.search(r'\s+([0-9]+)\s*(?:,\s*CABA)?$', direccion, re.I)
    if altura is None:
        return None

    parametros = urlencode({
        'direccion': direccion[: altura.end(1)] + ', CABA',
        'geocodificar': 'true',
        'maxOptions': 2,
        'srid': SRID_WGS84,
    })
    try:
        with urlopen(
            f'{NORMALIZADOR_USIG}?{parametros}', timeout=3
        ) as respuesta:
            # Descartamos búsquedas sin resultado o con más de una dirección.
            (coincidencia,) = json.load(respuesta)['direccionesNormalizadas']
        punto = coincidencia['coordenadas']
        if (
            coincidencia['cod_partido'] != 'caba'
            or int(coincidencia['altura']) != int(altura[1])
            or punto['srid'] != SRID_WGS84
        ):
            return None
        latitud, longitud = float(punto['y']), float(punto['x'])
    except (OSError, KeyError, TypeError, ValueError):
        return None

    if not (
        LATITUD_CABA[0] <= latitud <= LATITUD_CABA[1]
        and LONGITUD_CABA[0] <= longitud <= LONGITUD_CABA[1]
    ):
        return None
    return round(latitud, 3), round(longitud, 3)
