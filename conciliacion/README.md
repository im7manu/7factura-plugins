# Conciliación bancaria

Plugin para Facturador 1.3.0 o posterior.

## Qué hace

- Importa los movimientos del banco en **CSV** (descargado de la banca online). En la primera importación eliges qué columna es la fecha, el concepto, el importe (o cargo y abono), el saldo y la referencia; se guarda por cuenta. Formatos de fecha, separador decimal y codificación configurables.
- Detecta movimientos ya importados (no se duplican al repetir un extracto) y conserva la fila original.
- Para cada movimiento propone facturas o recibos por importe, número de factura en el concepto, NIF o nombre, cercanía al vencimiento (margen configurable) y reglas aprendidas.
- Al confirmar registra el cobro (o el pago de facturas de proveedor y gastos), total o parcial, o **repartido entre varias facturas**. Se puede deshacer.
- Reglas: «si el concepto contiene…, es de este cliente» o «…descartarlo» (comisiones, traspasos). Exportación del resultado en CSV.

## A tener en cuenta

- No pide claves bancarias ni se conecta al banco (sin PSD2 ni open banking). Nada se registra sin confirmación del usuario.
