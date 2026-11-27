from datetime import date

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from alquilometro_api.core.database import Base


class MetricaDiariaAviso(Base):
    __tablename__ = 'metricas_diarias_avisos'

    publicacion_id: Mapped[int] = mapped_column(
        ForeignKey('publicaciones.id', ondelete='CASCADE'), primary_key=True
    )
    dia: Mapped[date] = mapped_column(primary_key=True, index=True)
    destacado: Mapped[bool] = mapped_column(primary_key=True)
    visitas: Mapped[int]
    clics_whatsapp: Mapped[int]


class ReporteAviso(Base):
    __tablename__ = 'reportes_avisos'
    __table_args__ = (
        UniqueConstraint('publicacion_id', 'autor_id', 'motivo'),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    publicacion_id: Mapped[int | None] = mapped_column(
        ForeignKey('publicaciones.id', ondelete='SET NULL'), index=True
    )
    autor_id: Mapped[int | None] = mapped_column(
        ForeignKey('usuarios.id', ondelete='SET NULL')
    )
    titulo: Mapped[str] = mapped_column(String(200))
    motivo: Mapped[str] = mapped_column(String(24))
    comentario: Mapped[str | None] = mapped_column(String(500))
    fecha: Mapped[date]
    revisado: Mapped[bool] = mapped_column(default=False, index=True)
