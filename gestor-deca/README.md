# Gestor DeCA y eCMR

Conecta Facturador con [Gestor DeCA y eCMR](https://github.com/im7manu/gestor-deca-ecmr) (versión 1.4.0 o posterior).

## Qué hace

- **Facturar envíos**: lista los DeCA y eCMR emitidos o cerrados de unas fechas, agrupados por cliente. Marcas los que quieres cobrar, eliges **por viaje** o **por tonelada**, el precio y el IVA, y crea una **factura en borrador** con una línea por envío (número, fecha, ruta, mercancía, peso, matrícula y albarán) y los enlaces a los PDF en las observaciones. Si el cliente no existe en Facturador, lo crea con los datos de Gestor DeCA. Las líneas quedan asociadas al vehículo si su matrícula existe en Facturador (para el informe de gasto por vehículo).
- **Recuerda lo facturado**: cada envío muestra la factura en la que está. Si borras el borrador, el envío vuelve a quedar libre; si la factura se anula, también.
- **Sincronizar datos**: añade a Facturador los clientes, proveedores (empresas de tipo «Transportista»), vehículos y conductores de Gestor DeCA que falten. Compara por NIF, matrícula y DNI. No modifica ni borra nada.

## Conexión

1. En Gestor DeCA, como administrador: **Usuarios › Integraciones › Nueva integración**. Copia el token (empieza por `deca_`).
2. En Facturador: menú **Gestor DeCA › Conexión**. Pega la dirección del gestor y el token y pulsa **Comprobar y guardar**.

El token es de **solo lectura** y se guarda cifrado con la clave de la instalación; nunca llega al navegador. Las peticiones a Gestor DeCA las hace el servidor de Facturador. Para cortar el acceso, revoca el token en Gestor DeCA.

## Notas

- Gestor DeCA no valida los NIF y Facturador sí. Si un NIF no es válido, el cliente se crea sin NIF, con el original en las notas, y se avisa para corregirlo antes de emitir.
- Las facturas se crean con la API normal de Facturador: se aplican las mismas comprobaciones que al crearlas a mano y quedan en borrador para revisarlas antes de emitir.
