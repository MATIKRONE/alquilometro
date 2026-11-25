from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr

from alquilometro_api.domain.patrocinio import DIAS_PATROCINIO
from alquilometro_api.domain.rol import Rol
from alquilometro_api.schemas.auth import DatosPerfil, NombrePerfil
from alquilometro_api.schemas.pagos import ConciliacionPago
from alquilometro_api.schemas.publicacion import (
    DineroEntrada,
    EstadoPublicacion,
    OperacionPublicacion,
)


class InmobiliariaAdmin(BaseModel):
    id: int
    nombre: str
    email: str
    habilitada: bool
    activas: int
    limite: int
    abono_vigente_hasta: date | None = None
    abono_pagado_el: date | None = None
    abono_referencia_pendiente: str | None = None
    abono_revision_demorada: bool = False


class InmobiliariaCrear(DatosPerfil):
    model_config = ConfigDict(extra='forbid')

    nombre: NombrePerfil
    email: str = Field(min_length=3, max_length=255)
    password: SecretStr = Field(min_length=8, max_length=128)
    password_confirmacion: SecretStr = Field(min_length=8, max_length=128)


class EstadoInmobiliariaActualizar(BaseModel):
    model_config = ConfigDict(extra='forbid')

    habilitada: bool = Field(strict=True)


class AbonoInmobiliariaActualizar(BaseModel):
    model_config = ConfigDict(extra='forbid')

    pagado_el: date | None = Field(lt=date(9999, 12, 1))
    referencia: str | None = Field(default=None, min_length=1, max_length=100)
    conciliacion: ConciliacionPago | None = None


class PatrocinioActualizar(BaseModel):
    model_config = ConfigDict(extra='forbid')

    patrocinada: bool = Field(strict=True)


class ConfirmarPatrocinioEntrada(BaseModel):
    model_config = ConfigDict(extra='forbid')

    desde: date = Field(le=date(9999, 12, 2))
    referencia: str | None = Field(default=None, min_length=1, max_length=100)
    pagado_el: date | None = None
    conciliacion: ConciliacionPago | None = None


class RechazarPagoEntrada(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    motivo: str = Field(min_length=1, max_length=500)
    referencia: str = Field(min_length=1, max_length=100)


class PatrocinioAdmin(BaseModel):
    id: int
    titulo: str
    inmobiliaria: str
    referencia: str | None
    pendiente: bool
    desde: date | None
    hasta: date | None
    aviso_vencimiento: bool
    vencido: bool
    duracion_dias: int = DIAS_PATROCINIO


class ResumenAdmin(BaseModel):
    cuentas: int
    publicaciones_por_estado: dict[str, int]
    avisos_ocultos: int
    inmobiliarias: list[InmobiliariaAdmin]


class CuentaAdmin(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    email: str
    rol: Rol
    habilitada: bool


class FiltrosCuentasAdmin(BaseModel):
    rol: Rol | None = None
    habilitada: bool | None = None
    pagina: int = Field(default=1, ge=1, le=1_000_000)


class CuentasAdmin(BaseModel):
    cuentas: list[CuentaAdmin]
    total: int
    por_pagina: int


class FiltrosAdmin(BaseModel):
    buscar: str = Field(default='', max_length=100)
    estado: EstadoPublicacion | Literal['visible'] | None = None
    operacion: OperacionPublicacion | None = None
    pagina: int = Field(default=1, ge=1, le=1_000_000)


class PublicacionAdmin(BaseModel):
    id: int
    titulo: str
    estado: EstadoPublicacion
    patrocinada: bool
    operacion: OperacionPublicacion
    zona: str
    anunciante: str
    anunciante_habilitado: bool
    anunciante_visible: bool
    precio: DineroEntrada
    visitas: int
    clics_whatsapp: int


class PublicacionesAdmin(BaseModel):
    avisos: list[PublicacionAdmin]
    total: int
    por_pagina: int
