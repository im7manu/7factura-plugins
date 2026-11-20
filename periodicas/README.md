# Facturación periódica

Plugin para 7Factura 1.3.0 o posterior.

## Qué hace

- Plantillas de facturas que se repiten para un cliente: semanal, mensual (día del mes; si no existe, el último), trimestral, semestral o anual, con fecha de inicio y de fin opcionales.
- Líneas con concepto, cantidad, precio, descuento, IVA e IRPF; serie, forma de pago, vencimiento y referencia. En los textos, {periodo}, {mes}, {año}, {trimestre} o {fecha} se sustituyen en cada factura.
- Cuando llega la fecha prepara la factura **en borrador**; la revisas y la emites como siempre. Aviso en la campana de los borradores por revisar.
- Pausar, reanudar (decidiendo si se recuperan los periodos en pausa), duplicar y cancelar.

## A tener en cuenta

- Nunca emite facturas solo y nunca repite un periodo. Si la aplicación estuvo apagada, al arrancar prepara los borradores pendientes.
- Las facturas se crean con la API del núcleo (mismas validaciones y cálculos). Cambiar la plantilla no modifica las facturas ya creadas.
