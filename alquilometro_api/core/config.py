from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, HttpUrl, PositiveInt, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Configuracion(BaseSettings):
    """
    Configuración de la app: variables de entorno o archivo '.env'
    """

    DATABASE_URL: str = 'sqlite:///./alquilometro.db'
    sql_echo: bool = False
    carpeta_fotos: Path = Path('fotos')
    fotos_eliminar_huerfanas: bool = False
    indices_actualizacion_automatica: bool = True
    indices_intervalo_horas: PositiveInt = 6

    # Cambiar jwt_secret_key en produccion
    jwt_secret_key: str = 'clave-desarrollo'
    jwt_algoritmo: str = 'HS256'
    jwt_minutos_expiracion: int = 60

    planes_modo_prueba: bool = True
    planes_abono_mensual_ars: PositiveInt = 15_000
    planes_patrocinio_ars: PositiveInt = 5_000
    planes_abono_mercado_pago_url: HttpUrl | None = None
    planes_patrocinio_mercado_pago_url: HttpUrl | None = None
    planes_transferencia_titular: str = ''
    planes_transferencia_alias: str = ''
    planes_transferencia_cvu: Annotated[
        str, Field(pattern=r'^([0-9]{22})?$')
    ] = ''
    avisos_smtp_host: str = ''
    avisos_smtp_usuario: str = ''
    avisos_smtp_clave: SecretStr = SecretStr('')
    avisos_email_desde: str = ''
    avisos_url_publica: HttpUrl | None = None

    model_config = SettingsConfigDict(
        env_file='.env',
        env_file_encoding='utf-8',
        extra='ignore',
    )


@lru_cache
def get_config() -> Configuracion:
    return Configuracion()
