from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    Enum,
    Integer,
    Numeric,
    String,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from alquilometro_api.core.database import Base
from alquilometro_api.domain.abonos import DIAS_GRACIA, ocultar_desde
from alquilometro_api.domain.dinero import Dinero
from alquilometro_api.domain.errores import ValidacionError
from alquilometro_api.domain.moneda import Moneda
from alquilometro_api.domain.patrocinio import hoy_en_argentina
from alquilometro_api.domain.rol import Rol

if TYPE_CHECKING:
    from alquilometro_api.models.publicacion import Publicacion


class Usuario(Base):
    """Persona que publica avisos o usa la plataforma."""

    __tablename__ = 'usuarios'
    __table_args__ = (
        CheckConstraint(
            '(ingreso_referencia_monto IS NULL)'
            ' AND ingreso_referencia_moneda IS NULL'
            ' OR (ingreso_referencia_moneda IS NOT NULL'
            ' AND ingreso_referencia_moneda IS NOT NULL)',
            name='ck_usuarios_ingreso_completo',
        ),
    )  # sirve para impedir monto sin especificar
    # ARS O USD o viseversa y arruinar calculo

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    apellido: Mapped[str | None] = mapped_column(String(100))
    nombre_contacto: Mapped[str | None] = mapped_column(String(100))
    telefono: Mapped[str | None] = mapped_column(String(16))
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
    )

    password_hash: Mapped[str] = mapped_column(String(255))
    habilitada: Mapped[bool] = mapped_column(Boolean, server_default=true())
    version_sesion: Mapped[int] = mapped_column(Integer, server_default='0')
    recuperacion_hash: Mapped[str | None] = mapped_column(String(64))
    recuperacion_expira: Mapped[int | None] = mapped_column(Integer)
    abono_vigente_hasta: Mapped[date | None] = mapped_column(Date)
    abono_pagado_el: Mapped[date | None] = mapped_column(Date)
    abono_referencia_pendiente: Mapped[str | None] = mapped_column(String(100))
    abono_eliminar_desde: Mapped[date | None] = mapped_column(Date)
    abono_corte_sin_pago: Mapped[date | None] = mapped_column(Date)

    rol: Mapped[Rol] = mapped_column(
        Enum(Rol, native_enum=False, lenght=20),
        default=Rol.BUSCADOR,
    )

    ingreso_referencia_monto: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )

    ingreso_referencia_moneda: Mapped[str | None] = mapped_column(
        String(3),
        nullable=True,
    )

    publicaciones: Mapped[list['Publicacion']] = relationship(
        back_populates='publicador',
    )

    @property
    def avisos_visibles(self) -> bool:
        if not self.habilitada or self.rol is not Rol.INMOBILIARIA:
            return self.habilitada
        hoy = hoy_en_argentina()
        if self.abono_vigente_hasta is None:
            return (
                self.abono_corte_sin_pago is None
                or hoy < self.abono_corte_sin_pago
            )
        return self.abono_vigente_hasta >= hoy - timedelta(days=DIAS_GRACIA)

    @property
    def abono_ocultar_desde(self) -> date | None:
        if self.abono_vigente_hasta is not None:
            return ocultar_desde(self.abono_vigente_hasta)
        return self.abono_corte_sin_pago

    @property
    def abono_vigente(self) -> bool:
        if self.abono_vigente_hasta is None:
            return False
        return self.abono_vigente_hasta >= hoy_en_argentina()

    @property  # getter: returnea Dinero
    def ingreso_referencia(self) -> Dinero | None:
        if (
            self.ingreso_referencia_monto is None
            or self.ingreso_referencia_moneda is None
        ):
            return None
        return Dinero(
            self.ingreso_referencia_monto,
            Moneda(self.ingreso_referencia_moneda),
        )

    @ingreso_referencia.setter
    def ingreso_referencia(self, valor: Dinero | None) -> None:
        if valor is None:
            self.ingreso_referencia_monto = None
            self.ingreso_referencia_moneda = None
            return
        if valor.monto <= 0:
            msg = 'El ingreso de referencia debe ser mayor a cero.'
            raise ValidacionError(msg)
        self.ingreso_referencia_monto = valor.redondear().monto
        self.ingreso_referencia_moneda = valor.moneda.value
