# Alquilómetro Web

La página consume la API real del TP. La entrada web sirve la interfaz en
`/`, conecta las consultas de la página en `/api/` y conserva Swagger en
`/docs`. La lógica, los datos de ejemplo y los permisos siguen en la API.

## Desplegar en Render

1. Elegí **New → Blueprint**, conectá `MATIKRONE/alquilometro-api` y elegí
   la rama `main`.
2. En **Blueprint Path**, ingresá `frontend/render.yaml`.
3. Confirmá que Render muestra el servicio `alquilometro-tp-web` con plan
   **Free** y desplegalo.
4. Cuando esté **Live**, abrí la URL pública para ver la página o agregale
   `/docs` para probar Swagger.

El Blueprint de la raíz sigue disponible para el despliegue de la API por
separado. El servicio de la demo usa SQLite en el disco temporal de Render.
Los datos de ejemplo vuelven a cargarse al arrancar.

## Probar en local

Desde la raíz del repo con las dependencias instaladas:

```powershell
poetry run python -m alquilometro_api.semilla
poetry run uvicorn frontend.web:app --port 4173
```

Abrí `http://127.0.0.1:4173/`.

### PostgreSQL local en Windows

En la PC donde se instaló PostgreSQL portátil para Alquilómetro, iniciá la
base antes de levantar la página si todavía no está corriendo:

```powershell
$pg = Join-Path $env:LOCALAPPDATA 'Alquilometro\PostgreSQL'
& "$pg\pgsql\bin\pg_ctl.exe" -D "$pg\datos" status
# Si el estado indica que PostgreSQL está detenido:
& "$pg\pgsql\bin\pg_ctl.exe" -D "$pg\datos" -l "$pg\postgresql.log" -w start
```

El archivo local `.env` indica qué base y carpeta de fotos usa la página.
Para volver a probar con SQLite, podés usar estas variables en otra ventana
de PowerShell y abrir la página en el puerto 4174:

```powershell
$env:DATABASE_URL = 'sqlite:///./alquilometro.db'
$env:CARPETA_FOTOS = 'fotos'
poetry run uvicorn frontend.web:app --port 4174
```
