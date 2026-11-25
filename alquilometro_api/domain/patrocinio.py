from datetime import date, datetime
from zoneinfo import ZoneInfo

DIAS_PATROCINIO = 30


def hoy_en_argentina() -> date:
    return datetime.now(ZoneInfo('America/Argentina/Buenos_Aires')).date()
