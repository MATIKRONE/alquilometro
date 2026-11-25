from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from alquilometro_api.core.database import Base

MAX_FOTOS = 20


class FotoPublicacion(Base):
    __tablename__ = 'fotos_publicaciones'
    __table_args__ = (
        UniqueConstraint('publicacion_id', 'espacio'),
        CheckConstraint(
            f'espacio BETWEEN 1 AND {MAX_FOTOS}',
            name=f'ck_fotos_publicaciones_espacio_{MAX_FOTOS}',
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    publicacion_id: Mapped[int] = mapped_column(ForeignKey('publicaciones.id'))
    espacio: Mapped[int]
    nombre_archivo: Mapped[str] = mapped_column(String(40), index=True)
    tipo_contenido: Mapped[str] = mapped_column(String(20))

    @property
    def url(self) -> str:
        return f'/publicaciones/{self.publicacion_id}/fotos/{self.id}'
