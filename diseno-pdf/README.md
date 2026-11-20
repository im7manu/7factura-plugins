# Diseño de PDF

Personaliza el aspecto de los PDF de todos los documentos (facturas, presupuestos, proformas, albaranes, pedidos…) y fírmalos.

## Qué se puede cambiar

- **Plantilla**: Moderna, Clásica, Minimalista, Banda lateral o Compacta.
- **Colores** (principal, texto, fondo de cabeceras…), **tipografía** (Helvetica, Times, Courier o una fuente propia `.ttf`/`.otf`) y tamaño de letra.
- **Logo**, posición y tamaño.
- **Columnas** de la tabla de líneas (referencia, descuento, IVA…) y sus títulos.
- **Títulos** de cada tipo de documento, textos de cabecera, condiciones y pie.
- **Marca de agua** (por ejemplo «COPIA» o «BORRADOR»).
- **Diseños distintos** por tipo de documento o por serie.
- **Vista previa en vivo** con un documento real.

## Firma

- **Imagen**: firma manuscrita escaneada o sello de la empresa en el pie.
- **Firma digital** con certificado (`.p12` / `.pfx`, por ejemplo el de la FNMT). El PDF queda firmado y es verificable en Adobe Acrobat y otros lectores. El certificado y su contraseña se guardan cifrados en el servidor y nunca se descargan.

Se pueden usar las dos a la vez.

## Novedades de la 1.1.0

- Deja sitio al final del documento para los plugins que añaden contenido (p. ej. el QR de pago) antes del pie.
- Ofrece el logotipo del diseño por defecto a otros plugins (p. ej. el estado de cuenta).

## Cómo funciona

Usa los puntos de extensión `pdf.generar` (dibuja el documento) y `pdf.postprocesar` (aplica la firma digital). Si se desactiva el plugin, se vuelve al diseño estándar de 7Factura.

Dependencias incluidas en el paquete: `node-forge` (lectura del certificado) y `@signpdf` (firma PAdES).
