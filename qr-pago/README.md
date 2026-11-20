# QR de pago por transferencia

Plugin para 7Factura 1.3.0 o posterior.

## Qué hace

- Añade al final del PDF de las facturas (y, si quieres, proformas o pedidos) un **código QR SEPA** (estándar europeo EPC) con el beneficiario, el IBAN, el BIC opcional, el importe y la referencia.
- El importe es el **pendiente real** (descontando cobros parciales). No aparece en facturas pagadas, borradores ni rectificativas.
- Opcionalmente muestra también el IBAN, el importe y el concepto en texto. Vista previa en la configuración.

## A tener en cuenta

- El QR solo **prepara** una transferencia que el cliente revisa y confirma en su banco: no realiza el pago ni marca la factura como pagada. Algunas apps bancarias no leen este formato.
- Usa el IBAN y la razón social de los datos de la empresa si no se indican otros.
