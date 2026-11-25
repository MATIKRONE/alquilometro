from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from alquilometro_api.core.database import Base


class Pago(Base):
    __tablename__ = 'pagos'

    id: Mapped[int] = mapped_column(primary_key=True)
    inmobiliaria_id: Mapped[int] = mapped_column(
        ForeignKey('usuarios.id'), index=True
    )
    aviso_id: Mapped[int | None] = mapped_column(Integer)
    titulo_aviso: Mapped[str | None] = mapped_column(String(150))
    concepto: Mapped[str] = mapped_column(String(12))
    referencia: Mapped[str | None] = mapped_column(String(100))
    referencia_en_uso: Mapped[str | None] = mapped_column(
        String(300), unique=True
    )
    importe_ars: Mapped[int | None] = mapped_column(Integer)
    estado: Mapped[str] = mapped_column(String(12), default='pendiente')
    informado_el: Mapped[date] = mapped_column(Date)
    pagado_el: Mapped[date | None] = mapped_column(Date)
    motivo: Mapped[str | None] = mapped_column(Text)
    importe_recibido_ars: Mapped[int | None] = mapped_column(Integer)
    medio: Mapped[str | None] = mapped_column(String(20))
    referencia_acreditada: Mapped[str | None] = mapped_column(String(100))
    referencia_acreditada_en_uso: Mapped[str | None] = mapped_column(
        String(300), unique=True
    )
    revisado_por_id: Mapped[int | None] = mapped_column(Integer)


class AvisoAbonoEnviado(Base):
    __tablename__ = 'avisos_abono_enviados'

    inmobiliaria_id: Mapped[int] = mapped_column(
        ForeignKey('usuarios.id'), primary_key=True
    )
    tipo: Mapped[str] = mapped_column(String(20), primary_key=True)
    fecha_limite: Mapped[date] = mapped_column(Date, primary_key=True)
