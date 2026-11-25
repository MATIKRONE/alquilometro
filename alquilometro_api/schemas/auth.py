import re
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
)

from alquilometro_api.domain.moneda import Moneda
from alquilometro_api.domain.rol import Rol

NombrePerfil = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]


class DatosPerfil(BaseModel):
    apellido: NombrePerfil | None = None
    nombre_contacto: NombrePerfil | None = None
    telefono: str | None = Field(default=None, max_length=32)

    @field_validator('telefono')
    @classmethod
    def formatear_telefono(cls, valor: str | None) -> str | None:
        if not valor or not valor.strip():
            return None
        numero = re.sub(r'[ ().-]', '', valor.strip())
        if not re.fullmatch(r'\+?[0-9]{7,15}', numero):
            raise ValueError('Ingresá un teléfono con código de área.')
        return numero


class PerfilActualizar(DatosPerfil):
    nombre: NombrePerfil


class RegistroEntrada(DatosPerfil):
    """Datos que recibe POST /auth/registro."""

    nombre: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8)
    password_confirmacion: str | None = None
    rol: Rol = Rol.BUSCADOR


class LoginEntrada(BaseModel):
    """Datos que recibe POST /auth/login."""

    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1)


class TokenRespuesta(BaseModel):
    """Token que se entrega después de un login correcto."""

    access_token: str
    token_type: Literal['bearer'] = 'bearer'


class IngresoEntrada(BaseModel):
    """Datos que recibe PUT /usuarios/me/ingreso-referencia"""

    monto: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    moneda: Moneda = Moneda.ARS


class IngresoRespuesta(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    monto: Decimal
    moneda: Moneda


class UsuarioRespuesta(BaseModel):
    """Datos de la cuenta para su titular."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    apellido: str | None = None
    nombre_contacto: str | None = None
    telefono: str | None = None
    email: str
    rol: Rol
    ingreso_referencia: IngresoRespuesta | None = None
    abono_vigente: bool = False
    abono_vigente_hasta: date | None = None
    abono_ocultar_desde: date | None = None
