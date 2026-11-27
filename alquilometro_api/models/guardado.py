from decimal import Decimal

from sqlalchemy import BigInteger, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from alquilometro_api.core.database import Base


class AvisoGuardado(Base):
    __tablename__ = 'avisos_guardados'

    usuario_id: Mapped[int] = mapped_column(
        ForeignKey('usuarios.id'), primary_key=True
    )
    publicacion_id: Mapped[int] = mapped_column(
        ForeignKey('publicaciones.id', ondelete='CASCADE'), primary_key=True
    )
    precio_visto: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    moneda_vista: Mapped[str | None] = mapped_column(String(3))


class BusquedaGuardada(Base):
    __tablename__ = 'busquedas_guardadas'

    usuario_id: Mapped[int] = mapped_column(
        ForeignKey('usuarios.id'), primary_key=True
    )
    enlace: Mapped[str] = mapped_column(String(700), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    ultima_revision_us: Mapped[int | None] = mapped_column(BigInteger)
