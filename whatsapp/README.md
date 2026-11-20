# WhatsApp Web

Plugin para Facturador 1.3.0 o posterior.

## Qué hace

- Envía por WhatsApp el **PDF real** de facturas, rectificativas, presupuestos, proformas, pedidos, albaranes y documentos de compra, desde el número de la empresa.
- En cada documento emitido aparece **«Enviar por WhatsApp»**: propone el teléfono de la ficha del cliente o proveedor, permite cambiarlo, revisar el mensaje y confirmar.
- Plantilla de mensaje por tipo de documento, con variables ({cliente}, {empresa}, {numero}, {fecha}, {total}, {vencimiento}…). Opción de proponer el envío al emitir.
- Historial con documento, destinatario, fecha, usuario y estado: *Enviado* (WhatsApp lo ha aceptado), *Entregado* (solo si el teléfono lo confirma) o *Error*. Nunca se da por enviado algo que no se ha confirmado.

## A tener en cuenta

- **Conexión**: el administrador pulsa *Vincular WhatsApp* y escanea el código QR desde *Ajustes › Dispositivos vinculados* del teléfono de la empresa. Se ve el número conectado y se puede desconectar. No se pide ni se guarda la contraseña de WhatsApp.
- **Independiente** del WhatsApp que usa Facturador para recuperar contraseñas: sesión y configuración propias.
- Usa [Baileys](https://github.com/WhiskeySockets/Baileys) (protocolo de WhatsApp Web, MIT), **no** la API de pago de WhatsApp Business. No es una integración oficial de Meta: puede dejar de funcionar si WhatsApp cambia su web, la sesión puede caducar y hay que volver a vincularla, y WhatsApp puede limitar cuentas que hagan envíos masivos. Úsalo para envíos individuales.
