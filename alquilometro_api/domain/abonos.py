from datetime import date, timedelta

from alquilometro_api.domain.patrocinio import hoy_en_argentina

DIAS_GRACIA = 3
DIAS_RETENCION = 30


def ocultar_desde(hasta: date) -> date:
    return min(hasta, date.max - timedelta(days=DIAS_GRACIA + 1)) + timedelta(
        days=DIAS_GRACIA + 1
    )


def eliminar_desde(hasta: date) -> date:
    limite = max(ocultar_desde(hasta), hoy_en_argentina())
    return min(limite, date.max - timedelta(days=DIAS_RETENCION)) + timedelta(
        days=DIAS_RETENCION
    )
