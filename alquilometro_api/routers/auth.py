from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from alquilometro_api.core.config import get_config
from alquilometro_api.core.database import get_session
from alquilometro_api.core.dependencias import usuario_actual
from alquilometro_api.domain.errores import ValidacionError
from alquilometro_api.models.usuario import Usuario
from alquilometro_api.schemas.auth import (
    LoginEntrada,
    RecuperacionEntrada,
    RegistroEntrada,
    RestablecerPasswordEntrada,
    TokenRespuesta,
    UsuarioRespuesta,
)
from alquilometro_api.services.auth import ServicioAuth
from alquilometro_api.services.correo import correo_configurado
from alquilometro_api.services.recuperacion import (
    enviar_recuperacion,
    iniciar_recuperacion,
    restablecer_password,
)

router = APIRouter(tags=['autenticación'])


@router.post(
    '/auth/registro',
    response_model=UsuarioRespuesta,
    status_code=status.HTTP_201_CREATED,
)
def registrar(
    datos: RegistroEntrada,
    sesion: Session = Depends(get_session),
) -> Usuario:
    if (
        datos.password_confirmacion is not None
        and datos.password_confirmacion != datos.password
    ):
        raise ValidacionError('Las contraseñas no coinciden.')

    servicio_auth = ServicioAuth(sesion)

    return servicio_auth.registrar(
        nombre=datos.nombre,
        email=datos.email,
        password=datos.password,
        rol=datos.rol,
        perfil=datos,
    )


@router.post('/auth/login', response_model=TokenRespuesta)
def login(
    datos: LoginEntrada,
    sesion: Session = Depends(get_session),
) -> TokenRespuesta:
    servicio_auth = ServicioAuth(sesion)
    token = servicio_auth.autenticar(datos.email, datos.password)

    return TokenRespuesta(access_token=token)


@router.get('/usuarios/me', response_model=UsuarioRespuesta)
def ver_mi_usuario(
    usuario: Usuario = Depends(usuario_actual),
) -> Usuario:
    return usuario


@router.post('/auth/recuperar', status_code=202)
def recuperar(
    datos: RecuperacionEntrada,
    tareas: BackgroundTasks,
    sesion: Session = Depends(get_session),
) -> dict[str, str]:
    config = get_config()
    if not correo_configurado(config):
        raise HTTPException(
            503, 'El correo de recuperación no está configurado.'
        )
    email = datos.email.lower()
    token = iniciar_recuperacion(sesion, email)
    if token:
        tareas.add_task(enviar_recuperacion, config, email, token)
    return {
        'mensaje': (
            'Si el correo corresponde a una cuenta, te enviamos un enlace.'
        )
    }


@router.post('/auth/restablecer', status_code=204)
def restablecer(
    datos: RestablecerPasswordEntrada, sesion: Session = Depends(get_session)
) -> None:
    restablecer_password(sesion, datos.token, datos.password)
