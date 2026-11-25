from collections.abc import Callable
from datetime import date, timedelta
from http import HTTPStatus

import pytest
from fastapi.testclient import TestClient
from pydantic import HttpUrl

from alquilometro_api.core.config import get_config
from alquilometro_api.domain.patrocinio import hoy_en_argentina
from alquilometro_api.models import publicacion
from alquilometro_api.routers import admin
from alquilometro_api.services import patrocinios


@pytest.mark.parametrize('rol', ['INMOBILIARIA', 'ADMIN'])
def test_planes_y_transferencias(
    rol: str,
    cliente: TestClient,
    autenticar_como: Callable[..., dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = autenticar_como('planes@example.com', rol)
    config = get_config()
    monkeypatch.setattr(config, 'planes_modo_prueba', True)
    monkeypatch.setattr(config, 'planes_abono_mensual_ars', 12_500)
    monkeypatch.setattr(config, 'planes_patrocinio_ars', 4_000)
    monkeypatch.setattr(config, 'planes_transferencia_titular', 'Demo')
    monkeypatch.setattr(config, 'planes_transferencia_alias', 'alias.demo')
    cvu = '0000000000000000000000'
    monkeypatch.setattr(config, 'planes_transferencia_cvu', cvu)
    monkeypatch.setattr(
        config,
        'planes_abono_mercado_pago_url',
        HttpUrl('https://mpago.la/prueba-abono'),
    )
    monkeypatch.setattr(
        config,
        'planes_patrocinio_mercado_pago_url',
        HttpUrl('https://mpago.la/prueba-patrocinio'),
    )

    precio = cliente.get('/planes', headers=headers)
    assert precio.status_code == HTTPStatus.OK
    assert precio.json() == {
        'modo_prueba': True,
        'abono_mensual_ars': 12_500,
        'patrocinio_ars': 4_000,
        'cupo_avisos_activos': 10,
        'patrocinio_dias': 30,
        'abono_mercado_pago_url': None,
        'patrocinio_mercado_pago_url': None,
        'abono_pago_pendiente': False,
        'abono_vigente_hasta': None,
        'abono_ocultar_desde': None,
        'abono_eliminar_desde': None,
    }
    for codigo, importe in [('abono', 12_500), ('patrocinio', 4_000)]:
        respuesta = cliente.get(
            f'/planes/{codigo}/transferencia', headers=headers
        )
        assert respuesta.status_code == HTTPStatus.OK
        assert respuesta.headers['cache-control'] == 'no-store'
        assert respuesta.json() == {
            'modo_prueba': True,
            'importe_ars': importe,
            'titular': 'Demo',
            'alias': 'alias.demo',
            'cvu': cvu,
        }
    monkeypatch.setattr(config, 'planes_modo_prueba', False)
    planes = cliente.get('/planes', headers=headers).json()
    assert planes['abono_mercado_pago_url'] == 'https://mpago.la/prueba-abono'
    assert planes['patrocinio_mercado_pago_url'] == (
        'https://mpago.la/prueba-patrocinio'
    )


@pytest.mark.parametrize('ruta', ['/planes', '/planes/abono/transferencia'])
def test_planes_requieren_un_rol_habilitado(
    ruta: str,
    cliente: TestClient,
    autenticar: Callable[..., dict[str, str]],
) -> None:
    assert cliente.get(ruta).status_code == HTTPStatus.UNAUTHORIZED
    assert cliente.get(ruta, headers=autenticar()).status_code == (
        HTTPStatus.FORBIDDEN
    )


def test_transferencia_sin_configurar(
    cliente: TestClient,
    headers_inmobiliaria: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_config(), 'planes_transferencia_cvu', '')
    respuesta = cliente.get(
        '/planes/abono/transferencia', headers=headers_inmobiliaria
    )
    assert respuesta.status_code == HTTPStatus.SERVICE_UNAVAILABLE


def test_inmobiliaria_informa_pago_y_admin_confirma_abono(
    cliente: TestClient, autenticar_como: Callable[..., dict[str, str]]
) -> None:
    agencia = autenticar_como('abono@example.com', 'INMOBILIARIA')
    administrador = autenticar_como('admin@example.com', 'ADMIN')
    informar = '/planes/abono/pago'
    referencia = 'OPERACION-123'
    datos = {'referencia': referencia}
    assert cliente.post(informar, json=datos).status_code == (
        HTTPStatus.UNAUTHORIZED
    )
    assert cliente.post(
        informar, json=datos, headers=administrador
    ).status_code == (HTTPStatus.FORBIDDEN)
    for _ in range(2):
        assert cliente.post(
            informar, json=datos, headers=agencia
        ).status_code == (HTTPStatus.NO_CONTENT)
    assert (
        cliente.post(
            informar, json={'referencia': 'OTRA'}, headers=agencia
        ).status_code
        == HTTPStatus.CONFLICT
    )
    perfil = cliente.get('/usuarios/me', headers=agencia).json()
    assert perfil['abono_vigente'] is False
    assert cliente.get('/planes', headers=agencia).json()[
        'abono_pago_pendiente'
    ]

    panel = '/admin/resumen'
    agencia_admin = cliente.get(panel, headers=administrador).json()
    assert (
        agencia_admin['inmobiliarias'][0]['abono_referencia_pendiente']
        == referencia
    )
    abono = f'/admin/inmobiliarias/{perfil["id"]}/abono'
    confirmacion = {'pagado_el': '2099-01-31', 'referencia': referencia}
    assert (
        cliente.patch(
            abono,
            json=confirmacion | {'referencia': 'OTRA'},
            headers=administrador,
        ).status_code
        == HTTPStatus.CONFLICT
    )
    assert (
        cliente.patch(
            abono, json=confirmacion, headers=administrador
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    agencia_admin = cliente.get(panel, headers=administrador).json()
    assert (
        agencia_admin['inmobiliarias'][0]['abono_referencia_pendiente'] is None
    )
    assert (
        agencia_admin['inmobiliarias'][0]['abono_vigente_hasta']
        == '2099-02-28'
    )
    assert cliente.get('/usuarios/me', headers=agencia).json()['abono_vigente']
    assert not cliente.get('/planes', headers=agencia).json()[
        'abono_pago_pendiente'
    ]
    historial = cliente.get('/planes/pagos', headers=agencia).json()
    assert historial[0]['estado'] == 'confirmado'
    assert historial[0]['referencia'] == referencia
    assert cliente.post(informar, json=datos, headers=agencia).status_code == (
        HTTPStatus.CONFLICT
    )


def test_pago_rechazado_se_puede_corregir(
    cliente: TestClient, autenticar_como: Callable[..., dict[str, str]]
) -> None:
    agencia = autenticar_como('abono@example.com', 'INMOBILIARIA')
    admin = autenticar_como('admin@example.com', 'ADMIN')
    agencia_id = cliente.get('/usuarios/me', headers=agencia).json()['id']
    ruta = '/planes/abono/pago'
    pago = {'referencia': 'OPERACION-45'}
    assert cliente.post(ruta, json=pago, headers=agencia).status_code == (
        HTTPStatus.NO_CONTENT
    )
    rechazo = f'/admin/inmobiliarias/{agencia_id}/abono/rechazar'
    assert (
        cliente.patch(
            rechazo,
            json=pago | {'motivo': 'El importe no coincide.'},
            headers=admin,
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    historial = cliente.get('/planes/pagos', headers=agencia).json()
    assert historial[0]['estado'] == 'rechazado'
    assert historial[0]['motivo'] == 'El importe no coincide.'
    assert cliente.post(ruta, json=pago, headers=agencia).status_code == (
        HTTPStatus.NO_CONTENT
    )
    historial_admin = cliente.get(
        f'/admin/inmobiliarias/{agencia_id}/pagos', headers=admin
    ).json()
    assert [pago['estado'] for pago in historial_admin] == [
        'pendiente',
        'rechazado',
    ]


def test_pago_patrocinio_y_vencimiento(
    cliente: TestClient,
    headers_inmobiliaria: dict[str, str],
    autenticar_como: Callable[..., dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fecha_actual = date(2026, 11, 24)

    def hoy() -> date:
        return fecha_actual

    for modulo in (publicacion, admin, patrocinios):
        monkeypatch.setattr(modulo, 'hoy_en_argentina', hoy)

    administrador = autenticar_como('admin@example.com', 'ADMIN')
    otro = autenticar_como('otra@example.com', 'INMOBILIARIA')
    creado = cliente.post(
        '/publicaciones',
        json={
            'propiedad': {
                'direccion': 'Avenida de prueba 1000',
                'zona': 'Caballito',
                'tipo': 'departamento',
                'ambientes': 2,
            },
            'precio_alquiler': {'monto': '600000', 'moneda': 'ARS'},
        },
        headers=headers_inmobiliaria,
    )
    assert creado.status_code == HTTPStatus.CREATED
    aviso = creado.json()['id']
    detalle = f'/publicaciones/{aviso}'
    informar = f'/planes/patrocinios/{aviso}/pago'
    confirmar = f'/admin/patrocinios/{aviso}/confirmar'
    visto = f'/admin/patrocinios/{aviso}/vencimiento-visto'
    pago = {'referencia': 'TRANSFERENCIA-001'}
    calendario = {'desde': '2026-11-25'}

    assert cliente.post(informar, json=pago, headers=otro).status_code == (
        HTTPStatus.FORBIDDEN
    )
    assert (
        cliente.post(
            informar, json=pago, headers=headers_inmobiliaria
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert (
        cliente.post(
            informar, json=pago, headers=headers_inmobiliaria
        ).status_code
        == HTTPStatus.CONFLICT
    )
    assert cliente.patch(
        confirmar, json=calendario, headers=otro
    ).status_code == (HTTPStatus.FORBIDDEN)
    assert 'patrocinio_referencia' not in cliente.get(detalle).json()
    registro = cliente.get('/admin/patrocinios', headers=administrador)
    assert registro.json()[0]['referencia'] == pago['referencia']
    assert registro.json()[0]['pendiente'] is True

    assert (
        cliente.patch(
            confirmar, json=calendario, headers=administrador
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    registro = cliente.get('/admin/patrocinios', headers=administrador).json()[
        0
    ]
    assert registro['hasta'] == '2026-12-24'
    assert registro['pendiente'] is False
    assert cliente.get(detalle).json()['patrocinada'] is False

    fecha_actual = date(2026, 11, 25)
    assert cliente.get(detalle).json()['patrocinada'] is True
    fecha_actual = date(2026, 12, 24)
    assert cliente.get(detalle).json()['patrocinada'] is True
    registro = cliente.get('/admin/patrocinios', headers=administrador).json()[
        0
    ]
    assert registro['aviso_vencimiento'] is True
    assert registro['vencido'] is False

    fecha_actual = date(2026, 12, 25)
    assert cliente.get(detalle).json()['patrocinada'] is False
    registro = cliente.get('/admin/patrocinios', headers=administrador).json()[
        0
    ]
    assert registro['aviso_vencimiento'] is True
    assert registro['vencido'] is True
    assert cliente.patch(visto, headers=administrador).status_code == (
        HTTPStatus.NO_CONTENT
    )
    assert (
        cliente.get('/admin/patrocinios', headers=administrador).json() == []
    )

    assert (
        cliente.post(
            informar,
            json={'referencia': 'TRANSFERENCIA-002'},
            headers=headers_inmobiliaria,
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert (
        cliente.patch(
            confirmar, json={'desde': '2026-12-25'}, headers=administrador
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    baja = f'/admin/publicaciones/{aviso}/patrocinio'
    assert (
        cliente.patch(
            baja, json={'patrocinada': False}, headers=administrador
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    publicado = cliente.get(detalle)
    assert publicado.status_code == HTTPStatus.OK
    assert publicado.json()['patrocinada'] is False
    assert (
        cliente.get('/admin/patrocinios', headers=administrador).json() == []
    )


def test_patrocinio_renueva_sin_perder_dias_y_exige_visibilidad(
    cliente: TestClient,
    headers_inmobiliaria: dict[str, str],
    autenticar_como: Callable[..., dict[str, str]],
) -> None:
    hoy = hoy_en_argentina()
    agencia = headers_inmobiliaria
    administrador = autenticar_como('admin@example.com', 'ADMIN')
    inmueble = cliente.post(
        '/publicaciones',
        json={
            'propiedad': {
                'direccion': 'Avenida de prueba 1000',
                'zona': 'Caballito',
                'tipo': 'departamento',
                'ambientes': 2,
            },
            'precio_alquiler': {'monto': '600000', 'moneda': 'ARS'},
        },
        headers=agencia,
    )
    assert inmueble.status_code == HTTPStatus.CREATED
    aviso = inmueble.json()['id']
    ruta = f'/publicaciones/{aviso}'
    informar = f'/planes/patrocinios/{aviso}/pago'
    confirmar = f'/admin/patrocinios/{aviso}/confirmar'
    for referencia in ('PRIMERO-001', 'RENOVACION-001'):
        assert (
            cliente.post(
                informar, json={'referencia': referencia}, headers=agencia
            ).status_code
            == HTTPStatus.NO_CONTENT
        )
        assert (
            cliente.patch(
                confirmar,
                json={'desde': hoy.isoformat(), 'referencia': referencia},
                headers=administrador,
            ).status_code
            == HTTPStatus.NO_CONTENT
        )
    patrocinio = cliente.get(
        '/admin/patrocinios', headers=administrador
    ).json()[0]
    assert patrocinio['desde'] == hoy.isoformat()
    assert (
        patrocinio['hasta']
        == (
            hoy + timedelta(days=2 * patrocinios.DIAS_PATROCINIO - 1)
        ).isoformat()
    )
    assert cliente.get(ruta).json()['patrocinada'] is True
    agencia_id = cliente.get('/usuarios/me', headers=agencia).json()['id']
    assert (
        cliente.patch(
            f'/admin/inmobiliarias/{agencia_id}/abono',
            json={'pagado_el': None},
            headers=administrador,
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert cliente.get(ruta).status_code == HTTPStatus.NOT_FOUND
    assert (
        cliente.post(
            informar, json={'referencia': 'OCULTO-001'}, headers=agencia
        ).status_code
        == HTTPStatus.CONFLICT
    )


def test_conciliacion_valida_importe_y_acreditacion_unica(
    cliente: TestClient, autenticar_como: Callable[..., dict[str, str]]
) -> None:
    agencia = autenticar_como('abono@example.com', 'INMOBILIARIA')
    administrador = autenticar_como('admin@example.com', 'ADMIN')
    agencia_id = cliente.get('/usuarios/me', headers=agencia).json()['id']
    editar = f'/admin/inmobiliarias/{agencia_id}/abono'
    importe = cliente.get('/planes', headers=agencia).json()[
        'abono_mensual_ars'
    ]
    conciliacion = {
        'importe_recibido_ars': importe - 1,
        'medio': 'transferencia',
        'referencia_acreditada': 'BANCO-123',
    }
    datos = {
        'pagado_el': hoy_en_argentina().isoformat(),
        'referencia': 'OPERACION-001',
        'conciliacion': conciliacion,
    }
    informar = '/planes/abono/pago'
    assert (
        cliente.post(
            informar, json={'referencia': datos['referencia']}, headers=agencia
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert (
        cliente.patch(editar, json=datos, headers=administrador).status_code
        == HTTPStatus.CONFLICT
    )
    assert (
        cliente.get('/usuarios/me', headers=agencia).json()['abono_vigente']
        is False
    )
    conciliacion['importe_recibido_ars'] = importe
    assert (
        cliente.patch(editar, json=datos, headers=administrador).status_code
        == HTTPStatus.NO_CONTENT
    )
    acreditado = cliente.get('/planes/pagos', headers=agencia).json()[0]
    assert acreditado['importe_recibido_ars'] == importe
    assert acreditado['referencia_acreditada'] == 'BANCO-123'
    assert acreditado['medio'] == 'transferencia'
    datos['referencia'] = 'OPERACION-002'
    assert (
        cliente.post(
            informar, json={'referencia': datos['referencia']}, headers=agencia
        ).status_code
        == HTTPStatus.NO_CONTENT
    )
    assert (
        cliente.patch(editar, json=datos, headers=administrador).status_code
        == HTTPStatus.CONFLICT
    )
    historial = cliente.get('/planes/pagos', headers=agencia).json()
    assert [pago['estado'] for pago in historial] == [
        'pendiente',
        'confirmado',
    ]
