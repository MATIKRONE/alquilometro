import re
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Annotated, Literal

from pydantic import (
    AfterValidator,
    AliasChoices,
    AliasPath,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from alquilometro_api.domain.desglose_costo import CostoEntrada, DesgloseCosto
from alquilometro_api.domain.dinero import Dinero
from alquilometro_api.domain.errores import MonedaIncompatible
from alquilometro_api.domain.moneda import Moneda

if TYPE_CHECKING:
    from alquilometro_api.models.publicacion import Publicacion


def _normalizar_whatsapp(valor: str | None) -> str | None:
    if valor is None or not valor.strip():
        return None
    numero = re.sub(r'[ ().-]', '', valor.strip())
    if re.fullmatch(r'\+[1-9][0-9]{7,14}', numero) is None:
        msg = 'Ingresá el WhatsApp con +, código de país y código de área.'
        raise ValueError(msg)
    return numero


NumeroWhatsApp = Annotated[
    str | None, Field(max_length=40), AfterValidator(_normalizar_whatsapp)
]


class ContactoPublicacionActualizar(BaseModel):
    model_config = ConfigDict(extra='forbid')

    whatsapp: NumeroWhatsApp


def _limpiar_texto_opcional(valor: str | None) -> str | None:
    return (valor or '').strip() or None


DescripcionPublicacion = Annotated[
    str | None, Field(max_length=1200), AfterValidator(_limpiar_texto_opcional)
]


class DescripcionPublicacionActualizar(BaseModel):
    model_config = ConfigDict(extra='forbid')

    descripcion: DescripcionPublicacion


class DineroEntrada(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    monto: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    moneda: Moneda = Moneda.ARS

    def a_dominio(self) -> Dinero:
        return Dinero(self.monto, self.moneda)


TipoPropiedad = Literal[
    'departamento',
    'casa',
    'ph',
    'dúplex',
    'tríplex',
    'loft',
    'habitación',
    'quinta',
    'local comercial',
    'oficina',
    'consultorio',
    'galpón',
    'depósito',
    'edificio',
    'hotel',
    'terreno',
    'cochera',
    'baulera',
    'otro',
]
TIPOS_SIN_AMBIENTES = {'terreno', 'cochera', 'baulera'}


class PropiedadCrear(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    direccion: str = Field(min_length=5, max_length=200)
    zona: str = Field(min_length=2, max_length=100)
    tipo: TipoPropiedad
    ambientes: int = Field(ge=0, le=10)
    metros_cuadrados: Decimal | None = Field(
        default=None,
        gt=0,
        max_digits=8,
        decimal_places=2,
    )
    permite_mascotas: bool | None = None

    @model_validator(mode='after')
    def validar_ambientes(self) -> 'PropiedadCrear':
        if self.ambientes == 0 and self.tipo not in TIPOS_SIN_AMBIENTES:
            raise ValueError(
                'Indicá al menos un ambiente para este tipo de propiedad.'
            )
        return self


OperacionPublicacion = Literal['alquiler', 'venta']
EstadoPublicacion = Literal['activa', 'pausada', 'cerrada']
EventoPublicacion = Literal['visita', 'whatsapp']


class EventoPublicacionCrear(BaseModel):
    model_config = ConfigDict(extra='forbid')

    evento: EventoPublicacion


class CupoPublicacionesRespuesta(BaseModel):
    activas: int
    limite: int | None
    guardadas: int
    limite_guardadas: int | None
    requiere_abono: bool
    avisos_visibles: bool


class EstadoPublicacionActualizar(BaseModel):
    model_config = ConfigDict(extra='forbid')

    estado: EstadoPublicacion


class PrecioPublicacionActualizar(BaseModel):
    model_config = ConfigDict(extra='forbid')

    monto: Decimal = Field(gt=0, max_digits=12, decimal_places=2)


ImporteGasto = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]


class GastosPublicacionActualizar(BaseModel):
    model_config = ConfigDict(extra='forbid')

    expensas_mensuales: ImporteGasto | None = None
    abl_mensual: ImporteGasto | None = None
    seguro_caucion: ImporteGasto | None = None
    deposito: ImporteGasto | None = None
    comision: ImporteGasto | None = None
    otros_gastos_entrada: ImporteGasto | None = None


class PublicacionCrear(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
        from_attributes=True,
    )

    propiedad: PropiedadCrear
    operacion: OperacionPublicacion = 'alquiler'
    precio_alquiler: DineroEntrada | None = None
    precio_venta: DineroEntrada | None = None
    expensas_mensuales: DineroEntrada | None = None
    abl_mensual: DineroEntrada | None = None
    seguro_caucion: DineroEntrada | None = None
    duracion_contrato_meses: int | None = Field(default=None, ge=1, le=36)
    tipo_garantia_aceptada: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
    )
    deposito: DineroEntrada | None = None
    comision: DineroEntrada | None = None
    otros_gastos_entrada: DineroEntrada | None = None
    # TODO: cambiar cuando se cree enum INDICE!!!
    tipo_ajuste: Literal['FIJO', 'INDICE'] | None = None
    tasa_ajuste: Decimal | None = Field(
        default=None,
        ge=0,
        description='Porcentaje de ajuste expresado en puntos '
        'porcentuales (ej: 15.5 para 15.5%)',
    )
    serie_codigo: str | None = None
    patrocinada: bool = False
    fuente: str | None = None
    whatsapp: NumeroWhatsApp = None
    descripcion: DescripcionPublicacion = None
    titulo: Annotated[
        str | None,
        Field(max_length=100),
        AfterValidator(_limpiar_texto_opcional),
    ] = None

    # Validaciones
    @field_validator('precio_alquiler', 'precio_venta')
    @classmethod
    def validar_precio_gt_cero(
        cls, valor: DineroEntrada | None
    ) -> DineroEntrada | None:
        if valor is not None and valor.monto == 0:
            raise ValueError('El precio debe ser mayor a cero.')
        return valor

    @model_validator(mode='after')
    def validar_operacion(self) -> 'PublicacionCrear':
        if self.operacion == 'venta':
            if self.precio_venta is None or self.precio_alquiler is not None:
                raise ValueError('Indicá solo el precio de venta.')
            campos_alquiler = (
                self.tipo_ajuste,
                self.tasa_ajuste,
                self.serie_codigo,
                self.duracion_contrato_meses,
                self.tipo_garantia_aceptada,
                self.deposito,
                self.seguro_caucion,
            )
            if any(valor is not None for valor in campos_alquiler):
                raise ValueError(
                    'Los datos del contrato corresponden a un alquiler.'
                )
        elif self.precio_alquiler is None or self.precio_venta is not None:
            raise ValueError('Indicá solo el precio del alquiler.')
        return self

    @model_validator(mode='after')
    def validar_coherencia_ajuste(self) -> 'PublicacionCrear':
        if self.tipo_ajuste == 'FIJO' and self.tasa_ajuste is None:
            raise ValueError(
                'Si el tipo de ajuste es FIJO, especificar tasa_ajuste'
            )
        if self.tipo_ajuste == 'INDICE' and self.serie_codigo is None:
            raise ValueError(
                'Si el tipo de ajuste es INDICE, especificar serie_codigo'
            )
        return self


class FiltrosPublicacionesConsulta(BaseModel):
    """Filtros opcionales para GET /publicaciones."""

    operacion: OperacionPublicacion | None = None
    zona: str | None = Field(default=None, min_length=2, max_length=100)
    ambientes: int | None = Field(default=None, ge=1, le=10)
    permite_mascotas: bool | None = None
    tipo_garantia: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
    )
    alquiler_min: Decimal | None = Field(default=None, ge=0)
    alquiler_max: Decimal | None = Field(default=None, ge=0)
    precio_min: Decimal | None = Field(default=None, ge=0)
    precio_max: Decimal | None = Field(default=None, ge=0)
    costo_real_min: Decimal | None = Field(default=None, ge=0)
    costo_real_max: Decimal | None = Field(default=None, ge=0)
    costo_entrada_max: Decimal | None = Field(default=None, ge=0)
    moneda: Moneda | None = None
    orden: Literal['alquiler', 'precio', 'costo_real', 'precio_m2'] | None = (
        None
    )
    descendente: bool = False


class FotoPublicacionRespuesta(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str


class PropiedadRespuesta(PropiedadCrear):
    direccion: str = Field(exclude=True)
    latitud_aproximada: float | None = None
    longitud_aproximada: float | None = None


class PublicacionRespuesta(PublicacionCrear):
    propiedad: PropiedadRespuesta
    titulo: str = Field(validation_alias='titulo_visible')
    id: int
    publicador_id: int
    fotos: list[FotoPublicacionRespuesta]
    whatsapp_url: str | None
    disponibilidad_confirmada: date | None = None
    patrocinada: bool = Field(
        default=False,
        validation_alias=AliasChoices('patrocinio_activo', 'patrocinada'),
    )

    @field_validator('operacion', mode='before')
    @classmethod
    def operacion_por_defecto(cls, valor: object) -> object:
        return 'alquiler' if valor is None else valor


class CostoResumidoRespuesta(BaseModel):
    total: Dinero
    faltantes: list[str]

    @classmethod
    def desde_desglose(
        cls, costo: CostoEntrada | DesgloseCosto
    ) -> 'CostoResumidoRespuesta | None':
        try:
            return cls(total=costo.total, faltantes=costo.faltantes)
        except MonedaIncompatible:
            return None


class PublicacionCatalogoRespuesta(PublicacionRespuesta):
    costo_mensual: CostoResumidoRespuesta | None = None
    costo_entrada: CostoResumidoRespuesta | None = None

    @classmethod
    def desde_publicacion(
        cls, aviso: 'Publicacion'
    ) -> 'PublicacionCatalogoRespuesta':
        respuesta = cls.model_validate(aviso)
        if aviso.operacion == 'alquiler':
            respuesta.costo_mensual = CostoResumidoRespuesta.desde_desglose(
                aviso.calcular_costo_real()
            )
            respuesta.costo_entrada = CostoResumidoRespuesta.desde_desglose(
                aviso.calcular_costo_entrada()
            )
        return respuesta


class PublicacionGestionRespuesta(PublicacionRespuesta):
    estado: EstadoPublicacion
    visitas: int
    clics_whatsapp: int
    patrocinio_pendiente: bool = False


class PublicacionEdicionRespuesta(PublicacionGestionRespuesta):
    patrocinada: bool = False
    propiedad: PropiedadCrear
    publicador_habilitado: bool = Field(
        validation_alias=AliasPath('publicador', 'habilitada')
    )
    publicador_avisos_visibles: bool = Field(
        validation_alias=AliasPath('publicador', 'avisos_visibles')
    )


class DesgloseCostoRespuesta(BaseModel):
    """Costo mensual conocido, componentes y datos no informados."""

    model_config = ConfigDict(from_attributes=True)

    total: DineroEntrada
    componentes_informados: dict[str, DineroEntrada]
    faltantes: list[str]


class AnalisisEconomicoRespuesta(BaseModel):
    """Costo real y porcentaje que representa sobre el ingreso del usuario."""

    model_config = ConfigDict(from_attributes=True)

    costo_real: DesgloseCostoRespuesta
    costo_entrada: DesgloseCostoRespuesta
    ingreso_referencia: DineroEntrada
    porcentaje_ingreso: Decimal
