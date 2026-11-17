# Plugins de Facturador

Plugins oficiales de [Facturador](https://github.com/im7manu/facturador). Se instalan desde la página **Plugins** de la aplicación (solo administradores), que lee el `registry.json` de este repositorio.

| Plugin | Qué hace |
|---|---|
| [`copias`](copias/) | Copia semanal automática y bajo demanda de todos los datos, descargable en ZIP para guardarla fuera del servidor, y restauración |
| [`temas`](temas/) | Cambia el aspecto de toda la aplicación y las fotos de la pantalla de inicio de sesión. Incluye Metro, Gestor DeCA, Frutiger Aero, Windows clásico, Alto contraste y Nórdico, y admite temas propios |
| [`diseno-pdf`](diseno-pdf/) | Diseños de PDF por tipo de documento o serie (5 plantillas, colores, tipografía, logo, columnas, textos, marca de agua), firma manuscrita o sello en imagen, y firma digital con certificado (FNMT…) |

## Instalar

En Facturador, como administrador: **Plugins** → *Disponibles* → **Instalar**. La aplicación descarga el paquete de la *Release* correspondiente y comprueba su SHA-256 con el de `registry.json` antes de instalarlo. Las actualizaciones aparecen en la misma página.

Sin conexión: descarga el `.tar.gz` de la [Release](https://github.com/im7manu/facturador-plugins/releases) y súbelo en *Instalar desde un archivo*.

Cada plugin guarda sus datos en `data/plugins-datos/<id>/` de la instalación: nada sale del servidor.

## Publicar una versión

```bash
npm test                      # pruebas contra ../facturador
node scripts/empaquetar.mjs   # genera dist/*.tar.gz y actualiza registry.json
```

Después, para cada plugin que cambie:

1. Sube `version` en su `plugin.json`.
2. Crea la *Release* con la etiqueta `<id>-v<versión>` y su paquete:
   ```bash
   gh release create temas-v1.0.1 dist/temas-1.0.1.tar.gz --title "Temas 1.0.1"
   ```
3. Haz commit y push del `registry.json` actualizado. Las instalaciones verán la actualización en la página Plugins.

Las pruebas necesitan el repositorio de la aplicación clonado al lado (`../facturador`).

## Crear un plugin

Mira [`docs/plugins.md`](https://github.com/im7manu/facturador/blob/main/docs/plugins.md) en el repositorio de la aplicación. Además de rutas propias y una página en el menú, un plugin puede:

- `ctx.extender('pdf.generar', fn)`: dibujar el PDF de los documentos.
- `ctx.extender('pdf.postprocesar', fn)`: modificar el PDF ya generado (por ejemplo, firmarlo).
- `ctx.extender('apariencia', fn)`: cambiar el tema y la pantalla de inicio de sesión.
- `ctx.cada(ms, fn)`: tareas periódicas. `ctx.dataDir`: carpeta de datos propia. `ctx.cifrar` / `ctx.descifrar`: guardar secretos.

Las páginas de los plugins pueden usar `/plugin-sdk.css` y `/plugin-sdk.js` para verse igual que la aplicación con el tema activo.

## Licencia

MIT.
