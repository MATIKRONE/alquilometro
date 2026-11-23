from sqlalchemy import CheckConstraint, ForeignKey, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column

from alquilometro_api.core.database import Base


class FotoPerfilPublicador(Base):
    __tablename__ = 'fotos_perfil_publicadores'

    publicador_id: Mapped[int] = mapped_column(
        ForeignKey('usuarios.id', ondelete='CASCADE'),
        primary_key=True,
    )
    contenido: Mapped[bytes] = mapped_column(LargeBinary)


class CalificacionPublicador(Base):
    __tablename__ = 'calificaciones_publicadores'
    __table_args__ = (
        CheckConstraint(
            'estrellas BETWEEN 1 AND 5', name='ck_calificacion_estrellas'
        ),
        CheckConstraint(
            'publicador_id <> autor_id', name='ck_calificacion_autor'
        ),
    )

    publicador_id: Mapped[int] = mapped_column(
        ForeignKey('usuarios.id', ondelete='CASCADE'),
        primary_key=True,
    )
    autor_id: Mapped[int] = mapped_column(
        ForeignKey('usuarios.id', ondelete='CASCADE'),
        primary_key=True,
    )
    estrellas: Mapped[int]
