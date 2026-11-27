from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from itertools import batched

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as insertar_postgresql
from sqlalchemy.dialects.sqlite import insert as insertar_sqlite
from sqlalchemy.orm import Session

from alquilometro_api.domain.ajuste import normalizar_serie, primer_dia_del_mes
from alquilometro_api.domain.errores import ValidacionError
from alquilometro_api.models.indice import ValorIndice

SERIES_DIARIAS = frozenset({'ICL', 'CER', 'UVA', 'UVI', 'CVS'})


def hoy_argentina() -> date:
    return datetime.now(UTC).astimezone(timezone(timedelta(hours=-3))).date()


class RepositorioIndicesDB:
    """Valores guardados en la base para los mecanismos de ajuste."""

    def __init__(self, sesion: Session) -> None:
        self.sesion = sesion

    def valor(self, serie: str, momento: date) -> Decimal | None:
        serie = normalizar_serie(serie)
        fuente = self.fuente_oficial(serie)
        fecha = (
            momento
            if fuente and serie in SERIES_DIARIAS
            else primer_dia_del_mes(momento)
        )
        fila = self._buscar(serie, fecha)
        return fila.valor if fila and fila.fuente == fuente else None

    def fuente_oficial(self, serie: str) -> str | None:
        consulta = (
            select(ValorIndice.fuente)
            .where(
                ValorIndice.serie == normalizar_serie(serie),
                ValorIndice.fuente.is_not(None),
            )
            .limit(1)
        )
        return self.sesion.scalar(consulta)

    def cargar(self, serie: str, momento: date, valor: Decimal) -> ValorIndice:
        """Carga o corrige el valor de un mes de una serie manual."""
        if not valor.is_finite() or valor <= 0:
            msg = 'El valor de un índice debe ser mayor a cero.'
            raise ValidacionError(msg)
        serie = normalizar_serie(serie)
        if self.fuente_oficial(serie):
            msg = f'{serie} se actualiza desde su fuente oficial.'
            raise ValidacionError(msg)
        fecha = primer_dia_del_mes(momento)
        fila = self._buscar(serie, fecha)
        if fila is None:
            fila = ValorIndice(serie=serie, fecha=fecha, valor=valor)
            self.sesion.add(fila)
        else:
            fila.valor = valor
        self.sesion.commit()
        return fila

    def guardar_oficiales(
        self, serie: str, fuente: str, valores: dict[date, Decimal]
    ) -> None:
        """Actualiza una serie dentro de la transacción de la fuente."""
        if not valores or any(
            not valor.is_finite() or valor <= 0 for valor in valores.values()
        ):
            msg = f'La fuente devolvió datos inválidos para {serie}.'
            raise ValueError(msg)
        insertar = (
            insertar_sqlite
            if self.sesion.get_bind().dialect.name == 'sqlite'
            else insertar_postgresql
        )
        for lote in batched(valores.items(), 500):
            consulta = insertar(ValorIndice).values([
                {
                    'serie': serie,
                    'fecha': fecha,
                    'valor': valor,
                    'fuente': fuente,
                }
                for fecha, valor in lote
            ])
            self.sesion.execute(
                consulta.on_conflict_do_update(
                    index_elements=['serie', 'fecha'],
                    set_={'valor': consulta.excluded.valor, 'fuente': fuente},
                    where=(
                        ValorIndice.fuente.is_distinct_from(fuente)
                        | (ValorIndice.valor != consulta.excluded.valor)
                    ),
                )
            )

    def listar(self, serie: str) -> list[ValorIndice]:
        serie = normalizar_serie(serie)
        consulta = (
            select(ValorIndice)
            .where(
                ValorIndice.serie == serie,
                ValorIndice.fuente == self.fuente_oficial(serie),
            )
            .order_by(ValorIndice.fecha)
        )
        return list(self.sesion.scalars(consulta))

    def _buscar(self, serie: str, fecha: date) -> ValorIndice | None:
        consulta = select(ValorIndice).where(
            ValorIndice.serie == serie, ValorIndice.fecha == fecha
        )
        return self.sesion.scalar(consulta)
