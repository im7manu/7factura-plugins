# Rutas y mapas

Mapas y rutas para [Facturador](https://github.com/im7manu/facturador) 1.3.0 o posterior.

## Qué hace

- **Calcular ruta**: escribe el origen y uno o varios destinos (dirección, población o coordenadas como `40.4168, -3.7038`), elige el vehículo y las opciones y verás la ruta en el mapa con los km y la duración.
- **Direcciones que se completan solas**: en clientes, proveedores y datos de la empresa, al escribir la dirección aparecen sugerencias; al elegir una se rellenan el C.P., la ciudad y la provincia (necesita Facturador 1.3.0).
- **Opciones de ruta**: camión (con peso, altura, anchura, longitud y carga por eje) o turismo, y evitar peajes, autopistas y autovías o ferris.
- **Para otros plugins**: el plugin [`gestor-deca`](../gestor-deca/) lo usa para facturar por kilómetro los envíos de Gestor DeCA (los km que falten, la vuelta y los km desde tu base).

## Proveedores

| | OpenRouteService (por defecto) | Google Maps |
|---|---|---|
| Precio | Gratis (cuenta en [account.heigit.org](https://account.heigit.org); unas 2.000 rutas al día) | Necesita una cuenta de facturación en Google Cloud; Google incluye un uso mensual gratuito por servicio |
| Camiones | Sí (`driving-hgv` con restricciones de peso y dimensiones) | No: calcula como turismo (se avisa) |
| Evitar peajes, autopistas o ferris | Sí (los peajes, fiable dentro de un país) | Sí |
| Mapa | OpenStreetMap con [Leaflet](https://leafletjs.com) (incluido en el plugin) | Google Maps (clave de navegador) |
| Búsqueda de direcciones | Pelias de OpenRouteService; sin clave, Nominatim de OpenStreetMap | Geocoding API |

Con Google hacen falta dos claves: una **de servidor** (Routes API y Geocoding API, restringida a la IP del servidor) y una **de navegador** (Maps JavaScript API, restringida a la dirección de Facturador). Las rutas de Google solo se muestran sobre un mapa de Google, como exigen sus condiciones.

## Seguridad y privacidad

- Las claves se guardan **cifradas** con la clave de la instalación y nunca llegan al navegador (salvo la clave de navegador de Google, que es pública por diseño).
- Las rutas y las búsquedas las pide el servidor de Facturador. Al proveedor solo se envían las direcciones o coordenadas de la ruta.
- El plugin declara en `plugin.json` los orígenes del mapa (teselas de OpenStreetMap y Google Maps); Facturador los permite solo en las páginas de este plugin.

## Archivos compartidos

`lib/proveedores.mjs` y `ui/mapa.js` son los mismos que en el plugin «Rutas y mapas» de [Gestor DeCA](https://github.com/im7manu/gestor-deca-plugins). Si cambias uno, cópialo en el otro repositorio.
