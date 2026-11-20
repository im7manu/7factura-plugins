# Gestor DeCA y eCMR

Conecta Facturador con [Gestor DeCA y eCMR](https://github.com/im7manu/gestor-deca-ecmr) (versión 1.4.0 o posterior; para recibir los km de cada envío, 1.5.0 con el plugin «Rutas y mapas»).

## Qué hace

- **Facturar envíos**: lista los DeCA y eCMR emitidos o cerrados de unas fechas, agrupados por cliente. Marcas los que quieres cobrar, eliges **por viaje**, **por tonelada** o **por kilómetro**, el precio y el IVA, y crea una **factura en borrador** con una línea por envío (número, fecha, ruta, mercancía, peso, matrícula y albarán) y los enlaces a los PDF en las observaciones. Si el cliente no existe en Facturador, lo crea con los datos de Gestor DeCA. Las líneas quedan asociadas al vehículo si su matrícula existe en Facturador (para el informe de gasto por vehículo).
- **Por kilómetro**: cada envío muestra sus km, que puedes **corregir antes de crear la factura** (y después, en el borrador, antes de emitirla). La línea dice, por ejemplo, «95 km × 1,10 €/km». Ver «Cobro por km».
- **Recuerda lo facturado**: cada envío muestra la factura en la que está. Si borras el borrador, el envío vuelve a quedar libre; si la factura se anula, también.
- **Sincronizar datos**: añade a Facturador los clientes, proveedores (empresas de tipo «Transportista»), vehículos y conductores de Gestor DeCA que falten. Compara por NIF, matrícula y DNI. No modifica ni borra nada.

## Cobro por km

En la pestaña **Cobro por km** (el administrador la configura, los demás la ven):

- **Qué km se cobran**: *solo ida* (carga → descargas), *ida y vuelta* (más la vuelta desde la última descarga a la carga) o *desde la base* (base → carga → descargas → base; indicas la dirección de tu almacén o garaje).
- **Precio por km** general, **precio por cliente** (tiene prioridad), **importe mínimo por viaje** y **redondeo** de los km (décimas, al km o siempre hacia arriba).
- **Usar los km de Gestor DeCA**: si el envío tiene ruta calculada (o km corregidos) con el plugin «Rutas y mapas» de Gestor DeCA, se usan esos km.

De dónde salen los km:

| Situación | Km |
|---|---|
| El envío tiene ruta en Gestor DeCA (plugin «Rutas y mapas» de Gestor DeCA) | Los de Gestor DeCA. La vuelta y la base se calculan con las coordenadas que manda Gestor DeCA |
| Sin ruta en Gestor DeCA, con el plugin [«Rutas y mapas»](../rutas/) de Facturador configurado | Se calculan en Facturador a partir de los lugares del envío |
| Sin ninguno de los dos | Se escriben a mano en la columna Km |

Sin el plugin «Rutas y mapas» de Facturador, *ida y vuelta* estima la vuelta igual que la ida y *desde la base* no está disponible.

## Conexión

1. En Gestor DeCA, como administrador: **Usuarios › Integraciones › Nueva integración**. Copia el token (empieza por `deca_`).
2. En Facturador: menú **Gestor DeCA › Conexión**. Pega la dirección del gestor y el token y pulsa **Comprobar y guardar**.

El token es de **solo lectura** y se guarda cifrado con la clave de la instalación; nunca llega al navegador. Las peticiones a Gestor DeCA las hace el servidor de Facturador. Para cortar el acceso, revoca el token en Gestor DeCA.

## Notas

- Gestor DeCA no valida los NIF y Facturador sí. Si un NIF no es válido, el cliente se crea sin NIF, con el original en las notas, y se avisa para corregirlo antes de emitir.
- Las facturas se crean con la API normal de Facturador: se aplican las mismas comprobaciones que al crearlas a mano y quedan en borrador para revisarlas antes de emitir.
