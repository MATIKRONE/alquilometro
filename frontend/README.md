# Alquilómetro Web

La entrada web sirve la interfaz en /, conecta sus consultas en /api/ y
deja Swagger en /docs. El catálogo de demostración incluye los avisos,
sus fotos, sus estados y los perfiles de los anunciantes.

## Probar el catálogo de demostración

Desde la raíz del repo, con las dependencias instaladas:

```powershell
poetry run python -m frontend.cargar_demo
poetry run uvicorn frontend.web:app --port 4173
```

Abrí http://127.0.0.1:4173/.

## Acceso de Krone Inmobiliaria

El perfil y su catálogo se cargan aunque no se configure un acceso.
Para habilitar el inicio de sesión, definí estas dos variables de entorno
antes de ejecutar la carga:

- DEMO_KRONE_EMAIL — correo que querés usar para la cuenta de demostración.
- DEMO_KRONE_PASSWORD — contraseña para el despliegue.

La cuenta nueva tiene un abono de prueba de 30 días. Si ya se creó el
perfil sin acceso, la primera carga con ambas variables le asigna acceso
y conserva sus avisos. El correo y la contraseña se configuran en el
entorno del servicio. Para habilitar los botones de WhatsApp en los
avisos de ejemplo que tienen contacto, definí DEMO_WHATSAPP con un número
de contacto autorizado en formato internacional.

El catálogo usa ubicaciones aproximadas y no contiene la base de datos
local, contraseñas, hashes ni registros de pagos.

## Desplegar en Render

Conectá MATIKRONE/alquilometro y la rama main. Usá frontend/render.yaml
como Blueprint Path. Render levanta la web con el catálogo incluido.
En Environment del servicio podés cargar las variables de acceso. El
plan gratuito usa SQLite y almacenamiento temporal para las fotos. El
catálogo de demostración se precarga al arrancar. El Blueprint de la
raíz mantiene el despliegue de la API por separado.

## PostgreSQL local

Para trabajar con tu propia base PostgreSQL, configurá DATABASE_URL y
CARPETA_FOTOS en tu entorno local o en .env. Iniciá el servidor PostgreSQL
y ejecutá solo Uvicorn para conservar los registros que ya tenés.
