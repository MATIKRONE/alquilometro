from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ConciliacionPago(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    importe_recibido_ars: int = Field(strict=True, gt=0, le=2_000_000_000)
    medio: Literal['transferencia', 'mercado_pago', 'otro']
    referencia_acreditada: str = Field(min_length=1, max_length=100)


class PagoRespuesta(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    concepto: str
    titulo_aviso: str | None
    referencia: str | None
    importe_ars: int | None
    estado: str
    informado_el: date
    pagado_el: date | None
    motivo: str | None
    importe_recibido_ars: int | None
    medio: str | None
    referencia_acreditada: str | None
