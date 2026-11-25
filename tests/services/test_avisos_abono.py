from datetime import date

from alquilometro_api.models.usuario import Usuario
from alquilometro_api.services.avisos_abono import aviso_correspondiente


def test_avisa_al_vencer_al_ocultar_y_antes_de_eliminar() -> None:
    usuario = Usuario(
        abono_vigente_hasta=date(2026, 11, 23),
        abono_eliminar_desde=date(2026, 12, 27),
    )
    assert aviso_correspondiente(usuario, date(2026, 11, 19)) is None
    assert aviso_correspondiente(usuario, date(2026, 11, 20)) == (
        'por_vencer',
        date(2026, 11, 23),
    )
    assert aviso_correspondiente(usuario, date(2026, 11, 25)) is None
    assert aviso_correspondiente(usuario, date(2026, 11, 27)) == (
        'ocultos',
        date(2026, 11, 27),
    )
    assert aviso_correspondiente(usuario, date(2026, 12, 24)) == (
        'por_eliminar',
        date(2026, 12, 27),
    )
    usuario.abono_referencia_pendiente = 'TRANSFERENCIA-123'
    assert aviso_correspondiente(usuario, date(2026, 12, 24)) is None
