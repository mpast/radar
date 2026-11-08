# Organización del código

El servidor se organiza por responsabilidad. La interfaz y sus módulos permanecen en `public/`; el punto de entrada documentado sigue siendo `server.mjs`, en la raíz.

```text
server.mjs                     Punto de entrada compatible
src/
  server.mjs                   HTTP, persistencia y coordinación de búsquedas
  domain/
    core.mjs                   Validación, filtros y reglas de anuncios
  services/
    location.mjs               Resolución de códigos postales y distancias
    availability.mjs           Comprobaciones de disponibilidad de coches
    listing-photos.mjs         Validación, descarga y caché de fotos
  sources/
    official-sources.mjs       Inventarios oficiales de coches
    toyota-sources.mjs         Adaptador de Toyota
    house-sources.mjs          Adaptador de viviendas
public/                        HTML, estilos y módulos del navegador
test/                         Pruebas y datos de ejemplo
docs/screenshots/             Capturas de la guía de uso
```

## Responsabilidades

[El arranque raíz](../server.mjs) carga [el servidor](../src/server.mjs), que atiende las rutas HTTP, accede a SQLite y coordina las búsquedas. Los adaptadores de `src/sources/` convierten respuestas de los portales en anuncios; `src/services/` concentra las tareas de ubicación, disponibilidad e imágenes. [El módulo central](../src/domain/core.mjs) mantiene las reglas y utilidades existentes de anuncios, comparación y seguimiento.

El servidor también importa algunos módulos de `public/`, como el tratamiento de plazas, matriculación, localidades y etiquetas ambientales. Se comparten deliberadamente con el navegador para mantener los mismos criterios. Esta reorganización conserva esa dependencia y no introduce capas nuevas.

## Rutas que deben mantenerse

- `npm start` y `node server.mjs` conservan el punto de entrada de la raíz.
- La base de datos predeterminada continúa en `.data/radar.sqlite`, y las fotos en `.data/photos/`, dentro de la raíz del proyecto. No se trasladan a `src/` ni dependen de la carpeta desde la que se invoque Node.
- `RADAR_DATA_DIR` permite usar una carpeta de datos alternativa; las pruebas utilizan carpetas temporales para aislarse de los datos personales.
- Los archivos estáticos se sirven desde `public/`, en la raíz, con las mismas rutas del navegador.

## Desarrollo

Ejecuta los comandos desde la raíz del proyecto con Node.js 24 o posterior:

```sh
npm start
npm test
```

Si el equipo bloquea la lectura de la configuración OpenSSL del sistema:

```sh
node --openssl-config=/dev/null server.mjs
node --openssl-config=/dev/null --test
```

Tras cambiar módulos del servidor, detén el proceso con Ctrl+C y vuelve a arrancarlo. Los cambios de la interfaz requieren recargar la página. La [guía de uso](../README.md) explica la instalación y el funcionamiento de la aplicación.
