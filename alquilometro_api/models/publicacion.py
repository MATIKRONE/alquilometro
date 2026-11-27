from __future__ import annotations

from datetime import date
from decimal import Decimal
from time import time_ns
from typing import TYPE_CHECKING
from urllib.parse import quote

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from alquilometro_api.core.database import Base
from alquilometro_api.domain.desglose_costo import CostoEntrada, DesgloseCosto
from alquilometro_api.domain.dinero import Dinero
from alquilometro_api.domain.errores import ValidacionError
from alquilometro_api.domain.moneda import Moneda
from alquilometro_api.domain.patrocinio import hoy_en_argentina

if TYPE_CHECKING:
    from alquilometro_api.models.foto_publicacion import FotoPublicacion
    from alquilometro_api.models.propiedad import Propiedad
    from alquilometro_api.models.usuario import Usuario


class Publicacion(Base):
    """Aviso de alquiler publicado para una propiedad."""

    __tablename__ = 'publicaciones'

    id: Mapped[int] = mapped_column(primary_key=True)

    propiedad_id: Mapped[int] = mapped_column(
        ForeignKey('propiedades.id'),
        index=True,
    )
    publicador_id: Mapped[int] = mapped_column(
        ForeignKey('usuarios.id'),
        index=True,
    )

    operacion: Mapped[str] = mapped_column(String(8), default='alquiler')
    estado: Mapped[str] = mapped_column(String(8), server_default='activa')
    disponibilidad_confirmada: Mapped[date | None] = mapped_column(Date)
    creada_us: Mapped[int | None] = mapped_column(
        BigInteger, default=lambda: time_ns() // 1000
    )
    visitas: Mapped[int] = mapped_column(Integer, server_default='0')
    clics_whatsapp: Mapped[int] = mapped_column(Integer, server_default='0')
    # Las columnas históricas guardan el precio de la operación.
    precio_alquiler_monto: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    precio_alquiler_moneda: Mapped[str] = mapped_column(String(3))

    expensas_mensuales_monto: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    expensas_mensuales_moneda: Mapped[str | None] = mapped_column(
        String(3),
        nullable=True,
    )

    abl_monto: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    abl_moneda: Mapped[str | None] = mapped_column(
        String(3),
        nullable=True,
    )

    seguro_caucion_monto: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    seguro_caucion_moneda: Mapped[str | None] = mapped_column(
        String(3),
        nullable=True,
    )

    deposito_monto: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    deposito_moneda: Mapped[str | None] = mapped_column(
        String(3),
        nullable=True,
    )

    comision_monto: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    comision_moneda: Mapped[str | None] = mapped_column(
        String(3),
        nullable=True,
    )

    otros_gastos_entrada_monto: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    otros_gastos_entrada_moneda: Mapped[str | None] = mapped_column(
        String(3),
        nullable=True,
    )

    duracion_contrato_meses: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    tipo_garantia_aceptada: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )
    tipo_ajuste: Mapped[str | None] = mapped_column(
        String(10),
        nullable=True,
    )
    tasa_ajuste: Mapped[Decimal | None] = mapped_column(
        Numeric(8, 2),
        nullable=True,
    )
    serie_codigo: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )
    patrocinada: Mapped[bool] = mapped_column(Boolean, default=False)
    patrocinio_desde: Mapped[date | None] = mapped_column(Date)
    patrocinio_hasta: Mapped[date | None] = mapped_column(Date)
    patrocinio_referencia: Mapped[str | None] = mapped_column(String(100))
    patrocinio_pendiente: Mapped[bool] = mapped_column(
        Boolean, server_default=false()
    )
    patrocinio_vencimiento_visto: Mapped[bool] = mapped_column(
        Boolean, server_default=false()
    )
    fuente: Mapped[str | None] = mapped_column(String(100), nullable=True)
    whatsapp: Mapped[str | None] = mapped_column(String(16))
    descripcion: Mapped[str | None] = mapped_column(String(1200))
    titulo: Mapped[str | None] = mapped_column(String(100))

    propiedad: Mapped[Propiedad] = relationship(
        back_populates='publicaciones',
    )
    publicador: Mapped[Usuario] = relationship(
        back_populates='publicaciones',
    )
    fotos: Mapped[list[FotoPublicacion]] = relationship(
        cascade='all, delete-orphan',
        lazy='selectin',
        order_by='FotoPublicacion.id',
    )

    @property
    def patrocinio_activo(self) -> bool:
        if not self.patrocinada or self.patrocinio_desde is None:
            return bool(self.patrocinada)
        hoy = hoy_en_argentina()
        return (
            self.patrocinio_hasta is not None
            and self.patrocinio_desde <= hoy <= self.patrocinio_hasta
        )

    @property
    def titulo_visible(self) -> str:
        if self.titulo:
            return self.titulo
        propiedad = self.propiedad
        tipo = 'PH' if propiedad.tipo == 'ph' else propiedad.tipo.capitalize()
        if propiedad.ambientes == 0:
            return f'{tipo} en {propiedad.zona}'
        ambientes = 'ambiente' if propiedad.ambientes == 1 else 'ambientes'
        return (
            f'{tipo} de {propiedad.ambientes} {ambientes} en {propiedad.zona}'
        )

    @property
    def whatsapp_url(self) -> str | None:
        if self.whatsapp is None:
            return None
        numero = self.whatsapp.removeprefix('+')
        mensaje = (
            f'Hola, vi el aviso #{self.id} en Alquilómetro. ¿Sigue disponible?'
        )
        return f'https://wa.me/{numero}?text={quote(mensaje)}'

    @property
    def precio_publicado(self) -> Dinero:
        return Dinero(
            self.precio_alquiler_monto,
            Moneda(self.precio_alquiler_moneda),
        )

    @property
    def precio_alquiler(self) -> Dinero | None:
        return None if self.operacion == 'venta' else self.precio_publicado

    @property
    def precio_venta(self) -> Dinero | None:
        return self.precio_publicado if self.operacion == 'venta' else None

    def exigir_alquiler(self) -> None:
        if self.operacion == 'venta':
            raise ValidacionError(
                'Esta operación solo está disponible para avisos de alquiler.'
            )

    @property
    def expensas_mensuales(self) -> Dinero | None:
        return self._dinero_opcional(
            self.expensas_mensuales_monto,
            self.expensas_mensuales_moneda,
        )

    @property
    def abl_mensual(self) -> Dinero | None:
        return self._dinero_opcional(
            self.abl_monto,
            self.abl_moneda,
        )

    @property
    def seguro_caucion(self) -> Dinero | None:
        return self._dinero_opcional(
            self.seguro_caucion_monto,
            self.seguro_caucion_moneda,
        )

    @property
    def deposito(self) -> Dinero | None:
        return self._dinero_opcional(
            self.deposito_monto,
            self.deposito_moneda,
        )

    @property
    def comision(self) -> Dinero | None:
        return self._dinero_opcional(
            self.comision_monto,
            self.comision_moneda,
        )

    @property
    def otros_gastos_entrada(self) -> Dinero | None:
        return self._dinero_opcional(
            self.otros_gastos_entrada_monto,
            self.otros_gastos_entrada_moneda,
        )

    def calcular_costo_entrada(self) -> CostoEntrada:
        """Gastos de firma separados por concepto (seguro: prima total)."""
        self.exigir_alquiler()
        return CostoEntrada(
            primer_mes=self.precio_publicado,
            deposito=self.deposito,
            comision=self.comision,
            seguro_caucion=self.seguro_caucion,
            otros_gastos=self.otros_gastos_entrada,
        )

    def calcular_costo_real(self) -> DesgloseCosto:
        """Arma el desglose mensual con los datos de la publicación."""
        self.exigir_alquiler()
        return DesgloseCosto(
            alquiler=self.precio_publicado,
            expensas=self.expensas_mensuales,
            abl=self.abl_mensual,
            seguro_caucion=self.seguro_caucion,
            duracion_contrato_meses=self.duracion_contrato_meses,
        )

    @staticmethod
    def _dinero_opcional(
        monto: Decimal | None,
        moneda: str | None,
    ) -> Dinero | None:
        if monto is None or moneda is None:
            return None

        return Dinero(monto, Moneda(moneda))
