from pydantic import BaseModel, ConfigDict, Field, SecretStr

from alquilometro_api.schemas.auth import DatosPerfil, NombrePerfil
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


class InmobiliariaCrear(DatosPerfil):
    model_config = ConfigDict(extra='forbid')

    nombre: NombrePerfil
    email: str = Field(min_length=3, max_length=255)
    password: SecretStr = Field(min_length=8, max_length=128)
    password_confirmacion: SecretStr = Field(min_length=8, max_length=128)


class EstadoInmobiliariaActualizar(BaseModel):
    model_config = ConfigDict(extra='forbid')

    habilitada: bool = Field(strict=True)


class PatrocinioActualizar(BaseModel):
    model_config = ConfigDict(extra='forbid')

    patrocinada: bool = Field(strict=True)


class ResumenAdmin(BaseModel):
    cuentas: int
    publicaciones_por_estado: dict[str, int]
    avisos_ocultos: int
    inmobiliarias: list[InmobiliariaAdmin]


class FiltrosAdmin(BaseModel):
    buscar: str = Field(default='', max_length=100)
    estado: EstadoPublicacion | None = None
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
    precio: DineroEntrada
    visitas: int
    clics_whatsapp: int


class PublicacionesAdmin(BaseModel):
    avisos: list[PublicacionAdmin]
    total: int
    por_pagina: int
