# Aceptación de presupuestos

Plugin para 7Factura 1.3.0 o posterior.

## Qué hace

- En cada presupuesto emitido, **«Enlace de aceptación»** crea un enlace privado con caducidad para que el cliente vea el presupuesto, descargue el PDF y lo **acepte o rechace** con un comentario.
- Se envía por correo desde el propio 7Factura o se copia para mandarlo por WhatsApp u otro medio. Se puede revocar.
- Registra la respuesta con fecha y hora, nombre y correo (si se piden), IP y navegador, y guarda **el PDF exacto** que vio el cliente. Aviso en la campana y, opcionalmente, por correo.
- Al aceptar, el presupuesto pasa a «aceptado»; después lo conviertes en pedido o factura como siempre.

## A tener en cuenta

- El enlace es aleatorio (32 bytes) y revocable; la página pública solo muestra ese presupuesto. Si el presupuesto cambia, el enlace queda invalidado.
- Es una **evidencia** de la respuesta, no una firma electrónica avanzada ni cualificada. Aceptar no emite ninguna factura.
- Los clientes deben poder abrir la dirección de 7Factura desde Internet (configurable en el plugin).
