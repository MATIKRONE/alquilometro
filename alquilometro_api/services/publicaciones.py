from dataclasses import dataclass, replace
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from alquilometro_api.core.archivos_fotos import borrar_fotos_sin_referencias
from alquilometro_api.domain.abonos import DIAS_GRACIA
from alquilometro_api.domain.analisis_economico import AnalisisEconomico
from alquilometro_api.domain.errores import (
    ConflictoDominio,
    PermisoInsuficiente,
    RecursoNoEncontrado,
    ValidacionError,
)
from alquilometro_api.domain.moneda import Moneda
from alquilometro_api.domain.patrocinio import hoy_en_argentina
from alquilometro_api.domain.rol import Rol
from alquilometro_api.models.contrato import ContratoAlquiler
from alquilometro_api.models.propiedad import Propiedad
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.publicacion import (
    CupoPublicacionesRespuesta,
    DineroEntrada,
    EstadoPublicacion,
    EventoPublicacion,
    GastosPublicacionActualizar,
    OperacionPublicacion,
    PublicacionCrear,
)
from alquilometro_api.services.geocodificacion import Geocodificador

CUPO_PILOTO = 10
CUPO_TOTAL_INMOBILIARIA = 30


def anunciante_visible():
    hoy = hoy_en_argentina()
    return Usuario.habilitada.is_(True) & or_(
        Usuario.rol != Rol.INMOBILIARIA,
        Usuario.abono_vigente_hasta.is_(None)
        & or_(
            Usuario.abono_corte_sin_pago.is_(None),
            Usuario.abono_corte_sin_pago > hoy,
        ),
        Usuario.abono_vigente_hasta >= hoy - timedelta(days=DIAS_GRACIA),
    )


_COLUMNAS_GASTOS = {
    'expensas_mensuales': 'expensas_mensuales',
    'abl_mensual': 'abl',
    'seguro_caucion': 'seguro_caucion',
    'deposito': 'deposito',
    'comision': 'comision',
    'otros_gastos_entrada': 'otros_gastos_entrada',
}


@dataclass
class FiltrosPublicaciones:
    """Criterios opcionales para buscar publicaciones."""

    zona: str | None = None
    ambientes: int | None = None
    permite_mascotas: bool | None = None
    tipo_garantia: str | None = None
    alquiler_min: Decimal | None = None
    alquiler_max: Decimal | None = None
    costo_real_min: Decimal | None = None
    costo_real_max: Decimal | None = None
    moneda: Moneda | None = None
    orden: str | None = None
    descendente: bool = False
    publicador_id: int | None = None
    operacion: OperacionPublicacion | None = None
    precio_min: Decimal | None = None
    precio_max: Decimal | None = None


class ServicioPublicaciones:
    """Alta y consulta de publicaciones guardadas en la base."""

    def __init__(
        self, sesion: Session, geocodificador: Geocodificador | None = None
    ) -> None:
        self.sesion = sesion
        self.geocodificador = geocodificador

    def crear(
        self,
        datos: PublicacionCrear,
        publicador: Usuario,
    ) -> Publicacion:
        if publicador.rol not in {Rol.INMOBILIARIA, Rol.ADMIN}:
            msg = 'Solo una inmobiliaria o un administrador puede publicar.'
            raise PermisoInsuficiente(msg)
        if datos.patrocinada and publicador.rol is not Rol.ADMIN:
            raise PermisoInsuficiente(
                'Solo un administrador puede destacar un aviso.'
            )

        self._exigir_abono(publicador)
        propiedad = Propiedad(**datos.propiedad.model_dump())
        self._ubicar_propiedad(propiedad)
        if publicador.rol is Rol.INMOBILIARIA:
            self._bloquear_cupo(publicador.id)
            self._validar_activacion(publicador)
            if (
                self._contar_publicaciones(publicador.id)
                >= CUPO_TOTAL_INMOBILIARIA
            ):
                raise ConflictoDominio(
                    f'Ya tenés {CUPO_TOTAL_INMOBILIARIA} avisos guardados. '
                    'Eliminá uno para liberar espacio.'
                )
        publicacion = Publicacion(propiedad=propiedad, publicador=publicador)
        asignar_datos(publicacion, datos)
        publicacion.patrocinada = datos.patrocinada

        self.sesion.add(propiedad)
        self.sesion.add(publicacion)
        self.sesion.commit()
        self.sesion.refresh(publicacion)
        return publicacion

    def actualizar(
        self,
        publicacion_id: int,
        datos: PublicacionCrear,
        usuario: Usuario,
    ) -> Publicacion:
        """Reemplaza los datos del aviso (solo su dueño o un admin)."""
        publicacion = self.obtener_gestionable(publicacion_id, usuario)
        if publicacion.operacion != datos.operacion:
            raise ValidacionError(
                'No se puede cambiar el tipo de operación de un aviso.'
            )
        if (
            'patrocinada' in datos.model_fields_set
            and publicacion.patrocinada != datos.patrocinada
        ):
            if usuario.rol is not Rol.ADMIN:
                raise PermisoInsuficiente(
                    'Solo un administrador puede cambiar la visibilidad.'
                )
            publicacion.patrocinada = datos.patrocinada
            publicacion.patrocinio_desde = None
            publicacion.patrocinio_hasta = None
        propiedad = publicacion.propiedad
        cambio_direccion = propiedad.direccion != datos.propiedad.direccion
        for campo, valor in datos.propiedad.model_dump().items():
            setattr(propiedad, campo, valor)
        if cambio_direccion or propiedad.latitud_aproximada is None:
            self._ubicar_propiedad(propiedad)
        asignar_datos(publicacion, datos)

        self.sesion.commit()
        self.sesion.refresh(publicacion)
        return publicacion

    def _ubicar_propiedad(self, propiedad: Propiedad) -> None:
        punto = (
            self.geocodificador(propiedad.direccion)
            if self.geocodificador
            else None
        )
        propiedad.latitud_aproximada, propiedad.longitud_aproximada = (
            punto or (None, None)
        )

    def actualizar_whatsapp(
        self, publicacion_id: int, numero: str | None, usuario: Usuario
    ) -> None:
        publicacion = self.obtener_gestionable(publicacion_id, usuario)
        publicacion.whatsapp = numero
        self.sesion.commit()

    def actualizar_descripcion(
        self, publicacion_id: int, descripcion: str | None, usuario: Usuario
    ) -> None:
        publicacion = self.obtener_gestionable(publicacion_id, usuario)
        publicacion.descripcion = descripcion
        self.sesion.commit()

    def eliminar(self, publicacion_id: int, usuario: Usuario) -> None:
        """Borra el aviso y su propiedad si no tiene otros avisos."""
        publicacion = self.obtener_gestionable(publicacion_id, usuario)
        if publicacion.patrocinio_pendiente:
            raise ConflictoDominio(
                'El pago del aviso destacado está en revisión. '
                'Resolvelo antes de eliminar el aviso.'
            )
        archivos = self.preparar_eliminacion(publicacion)
        self.sesion.commit()
        borrar_fotos_sin_referencias(self.sesion, archivos)

    def preparar_eliminacion(self, publicacion: Publicacion) -> list[str]:
        archivos = [foto.nombre_archivo for foto in publicacion.fotos]
        propiedad = publicacion.propiedad
        otro_aviso = self.sesion.scalar(
            select(Publicacion.id)
            .where(
                Publicacion.propiedad_id == propiedad.id,
                Publicacion.id != publicacion.id,
            )
            .limit(1)
        )

        self.sesion.execute(
            update(ContratoAlquiler)
            .where(ContratoAlquiler.publicacion_id == publicacion.id)
            .values(publicacion_id=None)
        )
        self.sesion.delete(publicacion)
        if otro_aviso is None:
            self.sesion.delete(propiedad)
        return archivos

    def obtener_gestionable(
        self, publicacion_id: int, usuario: Usuario
    ) -> Publicacion:
        publicacion = self._obtener(publicacion_id)
        if usuario.rol is not Rol.ADMIN and (
            publicacion.publicador_id != usuario.id
        ):
            msg = (
                'Solo quien publicó el aviso o un administrador puede hacerlo.'
            )
            raise PermisoInsuficiente(msg)
        return publicacion

    def listar_propias(self, usuario: Usuario) -> list[Publicacion]:
        if usuario.rol not in {Rol.INMOBILIARIA, Rol.ADMIN}:
            raise PermisoInsuficiente('Esta cuenta no puede publicar avisos.')
        consulta = (
            select(Publicacion)
            .where(Publicacion.publicador_id == usuario.id)
            .order_by(Publicacion.id.desc())
        )
        return list(self.sesion.scalars(consulta))

    def consultar_cupo(self, usuario: Usuario) -> CupoPublicacionesRespuesta:
        if usuario.rol not in {Rol.INMOBILIARIA, Rol.ADMIN}:
            raise PermisoInsuficiente('Esta cuenta no puede publicar avisos.')
        return CupoPublicacionesRespuesta(
            activas=self._contar_activas(usuario.id),
            limite=CUPO_PILOTO if usuario.rol is Rol.INMOBILIARIA else None,
            guardadas=self._contar_publicaciones(usuario.id),
            limite_guardadas=(
                CUPO_TOTAL_INMOBILIARIA
                if usuario.rol is Rol.INMOBILIARIA
                else None
            ),
            requiere_abono=(
                usuario.rol is Rol.INMOBILIARIA and not usuario.abono_vigente
            ),
            avisos_visibles=usuario.avisos_visibles,
        )

    def _contar_activas(self, publicador_id: int) -> int:
        return self._contar_publicaciones(publicador_id, solo_activas=True)

    def _contar_publicaciones(
        self, publicador_id: int, *, solo_activas: bool = False
    ) -> int:
        consulta = (
            select(func.count())
            .select_from(Publicacion)
            .where(
                Publicacion.publicador_id == publicador_id,
            )
        )
        if solo_activas:
            consulta = consulta.where(Publicacion.estado == 'activa')
        return self.sesion.execute(consulta).scalar_one()

    def _bloquear_cupo(self, publicador_id: int) -> None:
        # Serializa las altas y reactivaciones antes de contar el cupo.
        if self.sesion.get_bind().dialect.name == 'sqlite':
            self.sesion.execute(
                update(Usuario)
                .where(Usuario.id == publicador_id)
                .values(nombre=Usuario.nombre)
            )
        else:
            self.sesion.execute(
                select(Usuario.id)
                .where(Usuario.id == publicador_id)
                .with_for_update()
            )

    def _validar_cupo(self, publicador_id: int) -> None:
        if self._contar_activas(publicador_id) >= CUPO_PILOTO:
            raise ConflictoDominio(
                f'Alcanzaste el cupo de {CUPO_PILOTO} avisos activos. '
                'Pausá o cerrá un aviso para liberar un lugar.'
            )

    @staticmethod
    def _exigir_abono(publicador: Usuario) -> None:
        if publicador.rol is Rol.INMOBILIARIA and not publicador.abono_vigente:
            raise PermisoInsuficiente(
                'Necesitás un abono vigente para publicar o reactivar avisos.'
            )

    def _validar_activacion(self, publicador: Usuario) -> None:
        self.sesion.refresh(publicador, ['abono_vigente_hasta'])
        self._exigir_abono(publicador)
        self._validar_cupo(publicador.id)

    def actualizar_estado(
        self, publicacion_id: int, estado: EstadoPublicacion, usuario: Usuario
    ) -> None:
        publicacion = self.obtener_gestionable(publicacion_id, usuario)
        if (
            estado == 'activa'
            and publicacion.publicador.rol is Rol.INMOBILIARIA
        ):
            self._bloquear_cupo(publicacion.publicador_id)
            self.sesion.refresh(publicacion, ['estado'])
            if publicacion.estado != 'activa':
                self._validar_activacion(publicacion.publicador)
        publicacion.estado = estado
        self.sesion.commit()

    def registrar_evento(
        self, publicacion_id: int, evento: EventoPublicacion
    ) -> None:
        consulta = update(Publicacion).where(
            Publicacion.id == publicacion_id,
            Publicacion.estado == 'activa',
            Publicacion.publicador.has(anunciante_visible()),
        )
        if evento == 'visita':
            consulta = consulta.values(visitas=Publicacion.visitas + 1)
        else:
            consulta = consulta.where(
                Publicacion.whatsapp.is_not(None)
            ).values(clics_whatsapp=Publicacion.clics_whatsapp + 1)
        registrado = self.sesion.scalar(consulta.returning(Publicacion.id))
        if registrado is None:
            raise RecursoNoEncontrado('Este aviso no está disponible.')
        self.sesion.commit()

    def actualizar_precio(
        self, publicacion_id: int, monto: Decimal, usuario: Usuario
    ) -> None:
        publicacion = self.obtener_gestionable(publicacion_id, usuario)
        publicacion.precio_alquiler_monto = monto
        self.sesion.commit()

    def actualizar_gastos(
        self,
        publicacion_id: int,
        datos: GastosPublicacionActualizar,
        usuario: Usuario,
    ) -> Publicacion:
        publicacion = self.obtener_gestionable(publicacion_id, usuario)
        cambios = datos.model_dump(exclude_unset=True)
        if publicacion.operacion == 'venta' and (
            cambios.keys() - {'expensas_mensuales', 'abl_mensual'}
        ):
            raise ValidacionError('En una venta podés editar expensas y ABL.')
        moneda_base = (
            Moneda.ARS.value
            if publicacion.operacion == 'venta'
            else publicacion.precio_alquiler_moneda
        )
        for campo, monto in cambios.items():
            columna = _COLUMNAS_GASTOS[campo]
            campo_moneda = f'{columna}_moneda'
            moneda = getattr(publicacion, campo_moneda) or moneda_base
            setattr(publicacion, f'{columna}_monto', monto)
            setattr(
                publicacion, campo_moneda, None if monto is None else moneda
            )
        self.sesion.commit()
        return publicacion

    def listar(
        self,
        filtros: FiltrosPublicaciones | None = None,
    ) -> list[Publicacion]:
        if filtros is None:
            filtros = FiltrosPublicaciones()

        filtros = self._preparar_filtros(filtros)
        self._validar_filtros(filtros)
        publicaciones = self._consultar_publicaciones(filtros)

        if (
            filtros.costo_real_min is not None
            or filtros.costo_real_max is not None
        ):
            publicaciones = [
                publicacion
                for publicacion in publicaciones
                if _esta_dentro_del_rango_de_costo_real(
                    publicacion,
                    filtros,
                )
            ]

        return self._ordenar_publicaciones(publicaciones, filtros)

    @staticmethod
    def _preparar_filtros(
        filtros: FiltrosPublicaciones,
    ) -> FiltrosPublicaciones:
        solo_alquiler = filtros.orden in {'alquiler', 'costo_real'} or any(
            valor is not None
            for valor in (
                filtros.alquiler_min,
                filtros.alquiler_max,
                filtros.costo_real_min,
                filtros.costo_real_max,
                filtros.tipo_garantia,
            )
        )
        if solo_alquiler and filtros.operacion == 'venta':
            raise ValidacionError(
                'Estos filtros solo se aplican a alquileres.'
            )
        return replace(
            filtros,
            operacion=filtros.operacion
            or ('alquiler' if solo_alquiler else None),
            precio_min=filtros.precio_min
            if filtros.precio_min is not None
            else filtros.alquiler_min,
            precio_max=filtros.precio_max
            if filtros.precio_max is not None
            else filtros.alquiler_max,
        )

    @staticmethod
    def _validar_filtros(
        filtros: FiltrosPublicaciones,
    ) -> None:
        if (
            filtros.precio_min is not None
            and filtros.precio_max is not None
            and filtros.precio_min > filtros.precio_max
        ):
            msg = 'El precio mínimo no puede ser mayor al máximo.'
            raise ValidacionError(msg)

        if (
            filtros.costo_real_min is not None
            and filtros.costo_real_max is not None
            and filtros.costo_real_min > filtros.costo_real_max
        ):
            msg = 'El costo real mínimo no puede ser mayor al máximo.'
            raise ValidacionError(msg)

        hay_rango_monetario = (
            filtros.precio_min is not None
            or filtros.precio_max is not None
            or filtros.costo_real_min is not None
            or filtros.costo_real_max is not None
        )

        if hay_rango_monetario and filtros.moneda is None:
            msg = 'Indicá una moneda para filtrar por rangos monetarios.'
            raise ValidacionError(msg)

        if filtros.orden is not None and filtros.moneda is None:
            msg = 'Indicá una moneda para ordenar por un valor monetario.'
            raise ValidacionError(msg)

    def _consultar_publicaciones(
        self,
        filtros: FiltrosPublicaciones,
    ) -> list[Publicacion]:
        consulta = (
            select(Publicacion)
            .join(Publicacion.propiedad)
            .join(Publicacion.publicador)
            .where(Publicacion.estado == 'activa', anunciante_visible())
        )

        if filtros.operacion is not None:
            consulta = consulta.where(
                Publicacion.operacion == filtros.operacion
            )

        if filtros.publicador_id is not None:
            consulta = consulta.where(
                Publicacion.publicador_id == filtros.publicador_id,
            )

        if filtros.zona is not None:
            consulta = consulta.where(Propiedad.zona == filtros.zona)

        if filtros.ambientes is not None:
            consulta = consulta.where(
                Propiedad.ambientes == filtros.ambientes,
            )

        if filtros.permite_mascotas is not None:
            consulta = consulta.where(
                Propiedad.permite_mascotas.is_(filtros.permite_mascotas),
            )

        if filtros.tipo_garantia is not None:
            consulta = consulta.where(
                Publicacion.tipo_garantia_aceptada == filtros.tipo_garantia,
            )

        if filtros.moneda is not None:
            consulta = consulta.where(
                Publicacion.precio_alquiler_moneda == filtros.moneda.value,
            )

        if filtros.precio_min is not None:
            consulta = consulta.where(
                Publicacion.precio_alquiler_monto >= filtros.precio_min,
            )

        if filtros.precio_max is not None:
            consulta = consulta.where(
                Publicacion.precio_alquiler_monto <= filtros.precio_max,
            )

        if filtros.orden in {'alquiler', 'precio'}:
            orden_alquiler = Publicacion.precio_alquiler_monto

            if filtros.descendente:
                orden_alquiler = orden_alquiler.desc()

            consulta = consulta.order_by(
                orden_alquiler,
                Publicacion.id,
            )
        else:
            consulta = consulta.order_by(Publicacion.id)

        return list(self.sesion.scalars(consulta))

    @staticmethod
    def _ordenar_publicaciones(
        publicaciones: list[Publicacion],
        filtros: FiltrosPublicaciones,
    ) -> list[Publicacion]:
        if filtros.orden == 'costo_real':
            return sorted(
                publicaciones,
                key=_monto_costo_real,
                reverse=filtros.descendente,
            )

        if filtros.orden == 'precio_m2':
            return _ordenar_por_precio_m2(
                publicaciones,
                filtros.descendente,
            )

        return publicaciones

    def obtener(self, publicacion_id: int) -> Publicacion:
        publicacion = self._obtener(publicacion_id)
        if (
            publicacion.estado != 'activa'
            or not publicacion.publicador.avisos_visibles
        ):
            raise RecursoNoEncontrado('Este aviso no está disponible.')
        return publicacion

    def _obtener(self, publicacion_id: int) -> Publicacion:
        publicacion = self.sesion.get(Publicacion, publicacion_id)
        if publicacion is None:
            msg = 'No encontramos esa publicación.'
            raise RecursoNoEncontrado(msg)
        return publicacion

    def analizar_para_usuario(
        self,
        publicacion_id: int,
        usuario: Usuario,
    ) -> AnalisisEconomico:
        if usuario.ingreso_referencia is None:
            msg = 'Primero cargá tu ingreso de referencia.'
            raise ValidacionError(msg)

        publicacion = self.obtener(publicacion_id)
        costo_real = publicacion.calcular_costo_real()
        ingreso = usuario.ingreso_referencia
        # Sin una cotización no se pueden comparar pesos con dólares: se
        # avisa con un 422 en lugar de fallar al armar la respuesta.
        if costo_real.total.moneda != ingreso.moneda:
            msg = (
                f'La publicación está en {costo_real.total.moneda} y tu '
                f'ingreso en {ingreso.moneda}: no se puede calcular el '
                'porcentaje sin una cotización.'
            )
            raise ValidacionError(msg)

        return AnalisisEconomico(
            costo_real=costo_real,
            costo_entrada=publicacion.calcular_costo_entrada(),
            ingreso_referencia=usuario.ingreso_referencia,
        )


def asignar_datos(publicacion: Publicacion, datos: PublicacionCrear) -> None:
    """Copia los datos del aviso a las columnas del modelo."""
    precio = datos.precio_venta or datos.precio_alquiler
    assert precio is not None
    publicacion.operacion = datos.operacion
    publicacion.precio_alquiler_monto = precio.monto
    publicacion.precio_alquiler_moneda = precio.moneda.value
    for campo, prefijo in _COLUMNAS_GASTOS.items():
        monto, moneda = _columnas_dinero(getattr(datos, campo))
        setattr(publicacion, f'{prefijo}_monto', monto)
        setattr(publicacion, f'{prefijo}_moneda', moneda)
    publicacion.duracion_contrato_meses = datos.duracion_contrato_meses
    publicacion.tipo_garantia_aceptada = datos.tipo_garantia_aceptada
    publicacion.tipo_ajuste = datos.tipo_ajuste
    publicacion.tasa_ajuste = datos.tasa_ajuste
    publicacion.serie_codigo = datos.serie_codigo
    publicacion.fuente = datos.fuente
    if 'whatsapp' in datos.model_fields_set:
        publicacion.whatsapp = datos.whatsapp
    if 'descripcion' in datos.model_fields_set:
        publicacion.descripcion = datos.descripcion
    if 'titulo' in datos.model_fields_set:
        publicacion.titulo = datos.titulo


def _columnas_dinero(
    dinero: DineroEntrada | None,
) -> tuple[Decimal | None, str | None]:
    """Convierte un importe opcional a las dos columnas de la base."""
    if dinero is None:
        return None, None

    return dinero.monto, dinero.moneda.value


def _esta_dentro_del_rango_de_costo_real(
    publicacion: Publicacion,
    filtros: FiltrosPublicaciones,
) -> bool:
    costo_real = publicacion.calcular_costo_real().total

    if costo_real.moneda is not filtros.moneda:
        return False

    if (
        filtros.costo_real_min is not None
        and costo_real.monto < filtros.costo_real_min
    ):
        return False

    if (
        filtros.costo_real_max is not None
        and costo_real.monto > filtros.costo_real_max
    ):
        return False

    return True


def _monto_costo_real(
    publicacion: Publicacion,
) -> Decimal:
    return publicacion.calcular_costo_real().total.monto


def _ordenar_por_precio_m2(
    publicaciones: list[Publicacion],
    descendente: bool,
) -> list[Publicacion]:
    con_metros = [
        publicacion
        for publicacion in publicaciones
        if publicacion.propiedad.metros_cuadrados is not None
    ]
    sin_metros = [
        publicacion
        for publicacion in publicaciones
        if publicacion.propiedad.metros_cuadrados is None
    ]

    con_metros.sort(
        key=lambda publicacion: _precio_por_m2(publicacion) or Decimal(0),
        reverse=descendente,
    )

    return con_metros + sin_metros


def _precio_por_m2(
    publicacion: Publicacion,
) -> Decimal | None:
    metros_cuadrados = publicacion.propiedad.metros_cuadrados

    if metros_cuadrados is None:
        return None

    return publicacion.precio_publicado.monto / metros_cuadrados
