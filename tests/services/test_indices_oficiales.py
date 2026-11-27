from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from alquilometro_api.domain.errores import ValidacionError
from alquilometro_api.models.indice import ValorIndice
from alquilometro_api.services.indices import RepositorioIndicesDB
from alquilometro_api.services.indices_oficiales import leer_bcra, leer_ipc
from alquilometro_api.services.proyecciones import historia_para_proyectar


def test_importacion_bcra_respeta_fechas_diarias(sesion: Session) -> None:
    repositorio = RepositorioIndicesDB(sesion)
    inicio = date(2026, 11, 1)
    ajuste = date(2026, 11, 2)
    repositorio.cargar('ICL', inicio, Decimal(100))
    series = leer_bcra(b'7988;01/11/2026;37.01\r\n7988;02/11/2026;37.02\r\n')
    repositorio.guardar_oficiales('ICL', 'BCRA', series['ICL'])
    repositorio.guardar_oficiales('ICL', 'BCRA', series['ICL'])
    sesion.commit()

    assert repositorio.valor('ICL', inicio) == Decimal('37.01')
    assert repositorio.valor('ICL', ajuste) == Decimal('37.02')
    assert repositorio.valor('ICL', date(2026, 11, 3)) is None
    assert [fila.fecha for fila in repositorio.listar('ICL')] == [
        inicio,
        ajuste,
    ]
    with pytest.raises(ValidacionError, match='fuente oficial'):
        repositorio.cargar('ICL', inicio, Decimal(200))


def test_ipc_importa_nivel_general_nacional() -> None:
    contenido = (
        b'Codigo;Periodo;Indice_IPC;Region\n'
        b'0;202610;123,45;Nacional\n'
        b'0;202610;111,11;GBA\n'
        b'1;202610;222,22;Nacional\n'
    )
    assert leer_ipc(contenido) == {
        'IPC': {date(2026, 10, 1): Decimal('123.45')}
    }


def test_proyeccion_toma_un_dato_por_mes_de_una_serie_diaria() -> None:
    valores = [
        ValorIndice(
            serie='ICL', fecha=date(anio, mes, dia), valor=Decimal(mes)
        )
        for anio, mes in [
            (2025, 11),
            (2025, 12),
            *[(2026, m) for m in range(1, 12)],
        ]
        for dia in range(1, 27)
    ]
    assert historia_para_proyectar(valores) == [
        Decimal(m) for m in [11, 12, *range(1, 12)]
    ]
