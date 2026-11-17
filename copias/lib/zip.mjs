// Lectura y escritura de archivos ZIP (deflate) sin dependencias externas.
import zlib from 'node:zlib';

const crc32 = (buf) => zlib.crc32(buf) >>> 0;

/** Fecha y hora en formato MS-DOS (el que usa ZIP). */
function fechaDos(d = new Date()) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}

/**
 * Crea un ZIP a partir de una lista de { nombre, datos: Buffer }.
 * Los nombres usan '/' como separador; se guarda cada archivo comprimido con deflate.
 */
export function crearZip(entradas) {
  const partes = [];
  const central = [];
  let desplazamiento = 0;
  const { hora, dia } = fechaDos();
  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(e.datos);
    const comprimido = zlib.deflateRawSync(e.datos, { level: 6 });
    const usarDeflate = comprimido.length < e.datos.length;
    const cuerpo = usarDeflate ? comprimido : e.datos;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // versión necesaria
    local.writeUInt16LE(0x0800, 6);        // nombres en UTF-8
    local.writeUInt16LE(usarDeflate ? 8 : 0, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(e.datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nombre, cuerpo);

    const cab = Buffer.alloc(46);
    cab.writeUInt32LE(0x02014b50, 0);
    cab.writeUInt16LE(20, 4);
    cab.writeUInt16LE(20, 6);
    cab.writeUInt16LE(0x0800, 8);
    cab.writeUInt16LE(usarDeflate ? 8 : 0, 10);
    cab.writeUInt16LE(hora, 12);
    cab.writeUInt16LE(dia, 14);
    cab.writeUInt32LE(crc, 16);
    cab.writeUInt32LE(cuerpo.length, 20);
    cab.writeUInt32LE(e.datos.length, 24);
    cab.writeUInt16LE(nombre.length, 28);
    cab.writeUInt32LE(desplazamiento, 42);
    central.push(cab, nombre);
    desplazamiento += local.length + nombre.length + cuerpo.length;
  }
  const dirCentral = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dirCentral.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...partes, dirCentral, fin]);
}

/** Lee un ZIP y devuelve [{ nombre, datos }]. Comprueba el CRC de cada archivo y rechaza rutas peligrosas. */
export function leerZip(buf, { maxTotal = 2 * 1024 * 1024 * 1024 } = {}) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no es un ZIP válido');
  const n = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const salida = [];
  let total = 0;
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP dañado');
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const tamComp = buf.readUInt32LE(p + 20);
    const tam = buf.readUInt32LE(p + 24);
    const lnom = buf.readUInt16LE(p + 28);
    const lext = buf.readUInt16LE(p + 30);
    const lcom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + lnom).toString('utf8');
    p += 46 + lnom + lext + lcom;
    if (nombre.endsWith('/')) continue;
    if (nombre.startsWith('/') || nombre.split('/').includes('..') || nombre.includes('\\')) throw new Error(`Ruta no permitida en el ZIP: ${nombre}`);
    total += tam;
    if (total > maxTotal) throw new Error('El contenido del ZIP es demasiado grande');
    const llnom = buf.readUInt16LE(local + 26);
    const llext = buf.readUInt16LE(local + 28);
    const ini = local + 30 + llnom + llext;
    const bruto = buf.subarray(ini, ini + tamComp);
    const datos = metodo === 8 ? zlib.inflateRawSync(bruto) : metodo === 0 ? Buffer.from(bruto) : null;
    if (!datos) throw new Error(`Compresión no soportada en ${nombre}`);
    if (datos.length !== tam || crc32(datos) !== crc) throw new Error(`El archivo ${nombre} del ZIP está dañado`);
    salida.push({ nombre, datos });
  }
  return salida;
}
