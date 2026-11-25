"""Prepara los avisos ficticios para el despliegue de demostración."""

import json
import os
from pathlib import Path
from secrets import token_urlsafe
from shutil import copyfile

from sqlalchemy import select
from sqlalchemy.orm import Session

from alquilometro_api.core.config import get_config
from alquilometro_api.core.database import crear_tablas, get_engine
from alquilometro_api.core.seguridad import hashear_password
from alquilometro_api.domain.rol import Rol
from alquilometro_api.models.foto_publicacion import FotoPublicacion
from alquilometro_api.models.perfil_publicador import FotoPerfilPublicador
from alquilometro_api.models.propiedad import Propiedad
from alquilometro_api.models.publicacion import Publicacion
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.publicacion import PublicacionCrear
from alquilometro_api.semilla import (
    cargar_icl_de_ejemplo,
    cargar_ipc_de_ejemplo,
    crear_admin,
    crear_usuario_sistema,
)
from alquilometro_api.services.publicaciones import asignar_datos

DATOS = Path(__file__).with_name('datos_demo')


def cargar_publicadores(sesion: Session) -> dict[int, int]:
    perfiles = json.loads((DATOS / 'publicadores.json').read_text('utf-8'))
    ids = {}
    for perfil in perfiles:
        email = f"publicador-{perfil['id']}@alquilometro.example"
        usuario = sesion.scalar(select(Usuario).where(Usuario.email == email))
        if usuario is None:
            usuario = Usuario(
                nombre=perfil['nombre'],
                email=email,
                password_hash=hashear_password(token_urlsafe(32)),
                rol=Rol.INMOBILIARIA,
            )
            sesion.add(usuario)
            sesion.flush()
        if perfil['foto']:
            sesion.merge(
                FotoPerfilPublicador(
                    publicador_id=usuario.id,
                    contenido=(DATOS / perfil['foto']).read_bytes(),
                )
            )
        ids[perfil['id']] = usuario.id
    return ids


def cargar_avisos(sesion: Session) -> None:
    carpeta = get_config().carpeta_fotos
    carpeta.mkdir(parents=True, exist_ok=True)
    ejemplos = json.loads((DATOS / 'avisos.json').read_text(encoding='utf-8'))
    sistema = crear_usuario_sistema(sesion)
    publicadores = cargar_publicadores(sesion)
    for ejemplo in ejemplos:
        datos = PublicacionCrear.model_validate(ejemplo['aviso'])
        publicador_id = publicadores[ejemplo['publicador']]
        aviso = sesion.scalar(
            select(Publicacion).where(
                Publicacion.fuente == datos.fuente,
                Publicacion.titulo == datos.titulo,
                Publicacion.publicador_id.in_((sistema.id, publicador_id)),
            )
        )
        if aviso is None:
            aviso = Publicacion(
                propiedad=Propiedad(**datos.propiedad.model_dump()),
                publicador_id=publicador_id,
            )
            sesion.add(aviso)
        aviso.publicador_id = publicador_id
        asignar_datos(aviso, datos)
        aviso.patrocinada = datos.patrocinada
        ubicacion = ejemplo['ubicacion']
        aviso.propiedad.latitud_aproximada = ubicacion['latitud_aproximada']
        aviso.propiedad.longitud_aproximada = ubicacion['longitud_aproximada']
        sesion.flush()
        existentes = {foto.espacio: foto for foto in aviso.fotos}
        for espacio, nombre in enumerate(ejemplo['fotos'], start=1):
            foto = existentes.pop(espacio, None)
            origen = DATOS / nombre
            if foto is None:
                foto = FotoPublicacion(
                    publicacion_id=aviso.id,
                    espacio=espacio,
                )
                sesion.add(foto)
            foto.nombre_archivo = origen.stem
            foto.tipo_contenido = 'image/webp'
            destino = carpeta / foto.nombre_archivo
            if not destino.exists():
                copyfile(origen, destino)
        for foto in existentes.values():
            sesion.delete(foto)
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
