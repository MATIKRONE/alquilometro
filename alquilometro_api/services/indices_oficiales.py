"""Importación periódica de índices desde los organismos que los publican."""

import asyncio
import csv
import logging
import re
from calendar import monthrange
from collections.abc import Callable
from datetime import date
from decimal import Decimal
from http import HTTPStatus
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import xlrd
from sqlalchemy.orm import Session

from alquilometro_api.core.database import get_engine
from alquilometro_api.services.indices import (
    RepositorioIndicesDB,
    hoy_argentina,
)

BCRA = 'https://www.bcra.gob.ar/Pdfs/PublicacionesEstadisticas/tas5_ser.txt'
INDEC = 'https://www.indec.gob.ar/ftp/cuadros'
IPC = f'{INDEC}/economia/serie_ipc_divisiones.csv'
ICC = f'{INDEC}/economia/indice_icc_general_capitulos.csv'
RIPTE = 'https://www.argentina.gob.ar/trabajo/seguridadsocial/ripte'
CODIGOS_BCRA = {'7988': 'ICL', '3540': 'CER', '7913': 'UVA', '7914': 'UVI'}
MESES = {
    nombre: mes
    for mes, nombre in enumerate(
        'enero febrero marzo abril mayo junio julio agosto septiembre octubre '
        'noviembre diciembre'.split(),
        start=1,
    )
}
MESES['setiembre'] = MESES['septiembre']
COLUMNAS_RIPTE = 5

type Serie = dict[date, Decimal]
type Series = dict[str, Serie]

logger = logging.getLogger(__name__)


def descargar(url: str) -> bytes:
    # Identificación del cliente requerida por algunos de los portales.
    solicitud = Request(
        url, headers={'User-Agent': 'Mozilla/5.0 Alquilometro'}
    )
    with urlopen(solicitud, timeout=20) as respuesta:
        return respuesta.read()


def fecha_publicada(texto: str) -> date:
    dia, mes, anio = map(int, texto.split('/'))
    return date(anio, mes, dia)


def leer_bcra(contenido: bytes) -> Series:
    series: Series = {serie: {} for serie in CODIGOS_BCRA.values()}
    for linea in contenido.decode('utf-8-sig', errors='replace').splitlines():
        codigo, _, datos = linea.partition(';')
        if codigo in CODIGOS_BCRA:
            periodo, valor = datos.split(';')
            series[CODIGOS_BCRA[codigo]][fecha_publicada(periodo)] = Decimal(
                valor
            )
    return series


def leer_ipc(contenido: bytes) -> Series:
    filas = csv.DictReader(
        contenido.decode('utf-8-sig', errors='replace').splitlines(),
        delimiter=';',
    )
    serie = {
        date(int(fila['Periodo'][:4]), int(fila['Periodo'][4:]), 1): Decimal(
            fila['Indice_IPC'].replace(',', '.')
        )
        for fila in filas
        if fila['Codigo'] == '0' and fila['Region'] == 'Nacional'
    }
    return {'IPC': serie}


def leer_icc(contenido: bytes) -> Series:
    filas = csv.DictReader(
        contenido.decode('utf-8-sig').splitlines(), delimiter=';'
    )
    serie = {
        fecha_publicada(fila['periodo']): Decimal(
            fila['indice_icc'].replace(',', '.')
        )
        for fila in filas
        if fila['nivel_general_aperturas'] == 'nivel_general'
    }
    return {'ICC': serie}


def leer_ripte(contenido: bytes) -> Series:
    html = contenido.decode('utf-8')
    serie = {}
    for tabla in re.findall(r'<table\b[^>]*>(.*?)</table>', html, re.S):
        if 'IB 07/1994 = 100' not in tabla:
            continue
        for fila in re.findall(r'<tr\b[^>]*>(.*?)</tr>', tabla, re.S):
            celdas = re.findall(r'<td\b[^>]*>(.*?)</td>', fila, re.S)
            if len(celdas) == COLUMNAS_RIPTE:
                mes, anio = celdas[0].strip().lower().split('/')
                nivel = celdas[3].strip().replace('.', '').replace(',', '.')
                serie[date(int(anio), MESES[mes], 1)] = Decimal(nivel)
    return {'RIPTE': serie}


def leer_cvs(contenido: bytes) -> Series:
    libro = xlrd.open_workbook(file_contents=contenido)
    hoja = libro.sheet_by_index(
        next(
            i
            for i, nombre in enumerate(libro.sheet_names())
            if nombre.endswith('_IS')
        )
    )
    serie = {}
    anio = None
    for fila in hoja.get_rows():
        cabecera = re.fullmatch(r'Año (\d{4})', str(fila[1].value))
        if cabecera:
            anio = int(cabecera[1])
        elif anio and fila[0].ctype == xlrd.XL_CELL_NUMBER:
            dia = int(fila[0].value)
            for mes, celda in enumerate(fila[1:13], 1):
                if (
                    celda.ctype == xlrd.XL_CELL_NUMBER
                    and dia <= monthrange(anio, mes)[1]
                ):
                    serie[date(anio, mes, dia)] = Decimal(str(celda.value))
    return {'CVS': serie}


def descargar_cvs() -> bytes:
    anio = hoy_argentina().year
    url = f'{INDEC}/sociedad/sh_cvs_diarios_{{}}.xls'
    try:
        return descargar(url.format(anio))
    except HTTPError as error:
        if error.code != HTTPStatus.NOT_FOUND:
            raise
    return descargar(url.format(anio - 1))


def sincronizar_indices() -> dict[str, date]:
    fuentes: tuple[
        tuple[str, Callable[[], bytes], Callable[[bytes], Series]], ...
    ] = (
        ('BCRA', lambda: descargar(BCRA), leer_bcra),
        ('INDEC', lambda: descargar(IPC), leer_ipc),
        ('INDEC', lambda: descargar(ICC), leer_icc),
        ('Seguridad Social', lambda: descargar(RIPTE), leer_ripte),
        ('INDEC', descargar_cvs, leer_cvs),
    )
    actualizadas = {}
    for fuente, obtener, leer in fuentes:
        try:
            series = leer(obtener())
            with Session(get_engine()) as sesion, sesion.begin():
                repositorio = RepositorioIndicesDB(sesion)
                for serie, valores in series.items():
                    repositorio.guardar_oficiales(serie, fuente, valores)
            actualizadas.update({
                serie: max(valores) for serie, valores in series.items()
            })
        except Exception:  # noqa: BLE001
            # Una falla deja intactos el historial y las demás fuentes.
            logger.exception(
                'No se pudo actualizar el índice desde %s (%s).',
                fuente,
                leer.__name__,
            )
    for serie, fecha in actualizadas.items():
        logger.info('%s actualizado hasta %s.', serie, fecha)
    return actualizadas


async def actualizar_periodicamente(horas: int) -> None:
    while True:
        await asyncio.to_thread(sincronizar_indices)
        await asyncio.sleep(horas * 3600)
