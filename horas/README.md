# Registro de horas

Plugin para Facturador 1.3.0 o posterior.

## Qué hace

- Proyectos por cliente y registros de tiempo con **cronómetro** o a mano (horas o de… a…), facturables o internos.
- Tarifa general, por cliente, por proyecto o por registro; redondeo por minuto o en bloques (5, 10, 15, 30 o 60 min, siempre hacia arriba).
- Las horas pendientes de un cliente se convierten en una **factura en borrador** (una línea por registro o por proyecto) y quedan marcadas como facturadas.
- Informe de horas por cliente y proyecto: totales, facturables, internas, facturadas, pendientes e importe pendiente.

## A tener en cuenta

- No emite facturas y no factura dos veces el mismo registro. Si eliminas el borrador, sus horas vuelven a estar pendientes; si la factura emitida se rectifica, un administrador puede recuperarlas (queda en la auditoría).
