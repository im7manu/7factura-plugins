# 7DeCA

Conecta 7Factura con [7DeCA](https://github.com/im7manu/gestor-deca-ecmr) (versión 1.4.0 o posterior; para recibir los km de cada envío, 1.5.0 con el plugin «7Ruta»).

## Qué hace

- **Facturar envíos**: lista los DeCA y eCMR emitidos o cerrados de unas fechas, agrupados por cliente. Marcas los que quieres cobrar, eliges **por viaje**, **por tonelada** o **por kilómetro**, el precio y el IVA, y crea una **factura en borrador** con una línea por envío (número, fecha, ruta, mercancía, peso, matrícula y albarán) y los enlaces a los PDF en las observaciones. Si el cliente no existe en 7Factura, lo crea con los datos de 7DeCA. Las líneas quedan asociadas al vehículo si su matrícula existe en 7Factura (para el informe de gasto por vehículo).
- **Por kilómetro**: cada envío muestra sus km, que puedes **corregir antes de crear la factura** (y después, en el borrador, antes de emitirla). La línea dice, por ejemplo, «95 km × 1,10 €/km». Ver «Cobro por km».
- **Recuerda lo facturado**: cada envío muestra la factura en la que está. Si borras el borrador, el envío vuelve a quedar libre; si la factura se anula, también.
- **Sincronizar datos**: añade a 7Factura los clientes, proveedores (empresas de tipo «Transportista»), vehículos y conductores de 7DeCA que falten. Compara por NIF, matrícula y DNI. No modifica ni borra nada.

## Cobro por km

En la pestaña **Cobro por km** (el administrador la configura, los demás la ven):

- **Qué km se cobran**: *solo ida* (carga → descargas), *ida y vuelta* (más la vuelta desde la última descarga a la carga) o *desde la base* (base → carga → descargas → base; indicas la dirección de tu almacén o garaje).
- **Precio por km** general, **precio por cliente** (tiene prioridad), **importe mínimo por viaje** y **redondeo** de los km (décimas, al km o siempre hacia arriba).
- **Usar los km de 7DeCA**: si el envío tiene ruta calculada (o km corregidos) con el plugin «7Ruta» de 7DeCA, se usan esos km.

De dónde salen los km:

| Situación | Km |
|---|---|
| El envío tiene ruta en 7DeCA (plugin «7Ruta» de 7DeCA) | Los de 7DeCA. La vuelta y la base se calculan con las coordenadas que manda 7DeCA |
| Sin ruta en 7DeCA, con el plugin [«7Ruta»](../rutas/) de 7Factura configurado | Se calculan en 7Factura a partir de los lugares del envío |
| Sin ninguno de los dos | Se escriben a mano en la columna Km |

Sin el plugin «7Ruta» de 7Factura, *ida y vuelta* estima la vuelta igual que la ida y *desde la base* no está disponible.

## Conexión

1. En 7DeCA, como administrador: **Usuarios › Integraciones › Nueva integración**. Copia el token (empieza por `deca_`).
2. En 7Factura: menú **7DeCA › Conexión**. Pega la dirección del gestor y el token y pulsa **Comprobar y guardar**.

El token es de **solo lectura** y se guarda cifrado con la clave de la instalación; nunca llega al navegador. Las peticiones a 7DeCA las hace el servidor de 7Factura. Para cortar el acceso, revoca el token en 7DeCA.

## Notas

- 7DeCA no valida los NIF y 7Factura sí. Si un NIF no es válido, el cliente se crea sin NIF, con el original en las notas, y se avisa para corregirlo antes de emitir.
- Las facturas se crean con la API normal de 7Factura: se aplican las mismas comprobaciones que al crearlas a mano y quedan en borrador para revisarlas antes de emitir.
