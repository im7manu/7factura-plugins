# Recordatorios de cobro

Plugin para 7Factura 1.3.0 o posterior.

## Qué hace

- Envía a los clientes recordatorios por correo de las facturas que van a vencer, vencen hoy o están vencidas, con la cuenta de correo ya conectada en 7Factura (Ajustes › Correo).
- Fases configurables: X días antes, el día del vencimiento y a los X, Y, Z días después. Tras un apagado, solo se envía la fase que corresponde (no todas de golpe).
- Recalcula el pendiente con los cobros parciales; no avisa de recibos cobrados, facturas rectificadas ni clientes sin correo válido.
- Nunca repite la misma fase de un recibo. Plantillas de asunto y mensaje, PDF adjunto (siempre, solo en el primer aviso o nunca), horario y días laborables, clientes excluidos, facturas excluidas y pausas por cliente.
- Vista de próximos avisos con vista previa, envío manual, correo de prueba a uno mismo y registro de todo lo enviado o fallido.

## A tener en cuenta

- Viene en **modo de prueba**: no envía nada hasta que un administrador activa el envío automático (con confirmación). No sustituye la campana de avisos de 7Factura.
- No añade recargos, intereses ni amenazas: solo informa del importe pendiente.
