# Control de stock

Plugin para Facturador 1.3.0 o posterior.

## Qué hace

- Control de existencias en los productos que elijas (almacén único): cantidad inicial, stock mínimo con aviso en la campana y opción de permitir o impedir stock negativo.
- **Salidas** al emitir el albarán (o la factura, si se factura sin albarán), o solo al emitir la factura. Las rectificativas devuelven las unidades.
- **Entradas** de compras: se confirman las unidades recibidas de albaranes, facturas o pedidos de proveedor (emitir una factura de proveedor no implica que la mercancía haya llegado).
- Ajustes manuales (sumar/restar o recuento) con motivo y observaciones, e historial de movimientos por producto y periodo.

## A tener en cuenta

- Los borradores nunca mueven stock y cada movimiento automático tiene una clave única: reintentos o repeticiones no duplican nada. No actives el control en productos que sean servicios.
