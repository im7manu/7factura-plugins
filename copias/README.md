# Copias de seguridad

Copia de todos los datos de Facturador: automática cada semana y cuando quieras, descargable en ZIP y restaurable.

## Qué hace

- **Copia semanal automática**: por defecto el lunes a las 3:00. Si el equipo estaba apagado a esa hora, la hace al volver a arrancar (en cuanto la última tenga más de 7 días).
- **Hacer una copia ahora**, con un botón.
- **Descargar en ZIP** para guardarla fuera del servidor (disco externo, nube de la empresa…). **Hazlo**: si el servidor se estropea, las copias que solo están en él se pierden con él.
- **Restaurar** una copia del servidor o subiendo un ZIP. Antes se guarda lo que había en `data/antes-de-restaurar-<fecha>/` y la aplicación se reinicia sola.
- Se conservan las últimas copias que elijas (8 por defecto, hasta 52).

## Qué incluye

La base de datos (copia coherente con `VACUUM INTO`, sin parar la aplicación), los adjuntos, la clave `secreto.key` y los datos de los plugins (temas, diseños de PDF, certificado cifrado…). No incluye las propias copias ni las versiones descargadas por las actualizaciones.

> El ZIP contiene todos los datos de la empresa y la clave que descifra las credenciales guardadas. Guárdalo en un sitio seguro.

Las copias se guardan en `data/plugins-datos/copias/`.

## Ajustes

Día de la semana, hora y número de copias que se conservan, en la pantalla del plugin (solo administradores).
