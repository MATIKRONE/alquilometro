"""Prepara los avisos ficticios para el despliegue de demostración."""

import json
import os
from pathlib import Path
from shutil import copyfile
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from alquilometro_api.core.config import get_config
from alquilometro_api.core.database import crear_tablas, get_engine
from alquilometro_api.models.foto_publicacion import FotoPublicacion
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.schemas.publicacion import PublicacionCrear
from alquilometro_api.semilla import (
    cargar_icl_de_ejemplo,
    cargar_ipc_de_ejemplo,
    crear_admin,
    crear_usuario_sistema,
)
from alquilometro_api.services.publicaciones import ServicioPublicaciones

DATOS = Path(__file__).with_name('datos_demo')


def cargar_avisos(sesion: Session) -> None:
    carpeta = get_config().carpeta_fotos
    carpeta.mkdir(parents=True, exist_ok=True)
    ejemplos = json.loads((DATOS / 'avisos.json').read_text(encoding='utf-8'))
    servicio = ServicioPublicaciones(sesion)
    sistema = crear_usuario_sistema(sesion)
    for ejemplo in ejemplos:
        datos = PublicacionCrear.model_validate(ejemplo['aviso'])
        aviso = sesion.scalar(
            select(Publicacion).where(
                Publicacion.fuente == datos.fuente,
                Publicacion.titulo == datos.titulo,
                Publicacion.publicador_id == sistema.id,
            )
        )
        if aviso is None:
            aviso = servicio.crear(datos, sistema)
        existentes = {foto.espacio: foto for foto in aviso.fotos}
        for espacio, imagen in enumerate(ejemplo['fotos'], start=1):
            foto = existentes.get(espacio)
            origen = DATOS / imagen['nombre']
            if foto is None:
                foto = FotoPublicacion(
                    publicacion_id=aviso.id,
                    espacio=espacio,
                    nombre_archivo=f'{uuid4().hex}{origen.suffix}',
                    tipo_contenido=imagen['tipo'],
                )
                sesion.add(foto)
            destino = carpeta / foto.nombre_archivo
            if not destino.exists():
                copyfile(origen, destino)
        sesion.commit()


def main() -> None:
    engine = get_engine()
    crear_tablas(engine)
    with Session(engine) as sesion:
        cargar_icl_de_ejemplo(sesion)
        cargar_ipc_de_ejemplo(sesion)
        cargar_avisos(sesion)
        email = os.environ.get('ADMIN_EMAIL')
        password = os.environ.get('ADMIN_PASSWORD')
        if email and password:
            crear_admin(sesion, email, password)


if __name__ == '__main__':
    main()
