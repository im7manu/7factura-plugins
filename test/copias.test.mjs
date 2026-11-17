import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { arrancar, cliente, instalar, preparar } from './ayuda.mjs';
import { leerZip } from '../copias/lib/zip.mjs';

test('copias: crear, descargar en ZIP y restaurar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-copias-'));
  const PUERTO = 9301;
  const BASE = `http://127.0.0.1:${PUERTO}`;
  let srv = await arrancar(dir, PUERTO);
  const { api, galleta, ponerGalleta } = cliente(BASE);
  try {
    await preparar(api);
    await instalar(api, 'copias');
    await api('POST', '/api/clientes', { nombre: 'Cliente antes de la copia', nif: 'B12345674' });
    // Un adjunto para comprobar que entra en la copia
    const doc = (await api('POST', '/api/documentos', { tipo: 'presupuesto', lineas: [{ descripcion: 'x', precio: 1 }] })).body;
    await api('POST', `/api/adjuntos?entidad=documento&id=${doc.id}`, Buffer.from('contenido adjunto'), { 'Content-Type': 'text/plain', 'X-Nombre-Archivo': 'nota.txt' });

    let r = await api('POST', '/api/p/copias/copias', {});
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const nombre = r.body.nombre;
    assert.match(nombre, /^copia-\d{8}-\d{6}-manual\.zip$/);

    r = await api('GET', `/api/p/copias/copias/${nombre}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/zip');
    const entradas = leerZip(r.body);
    const nombres = entradas.map((e) => e.nombre);
    assert.ok(nombres.includes('copia.json'));
    assert.ok(nombres.includes('facturador.db'));
    assert.ok(nombres.includes('secreto.key'));
    assert.ok(nombres.some((n) => n.startsWith('adjuntos/')));
    assert.ok(!nombres.some((n) => n.startsWith('plugins-datos/copias')), 'las copias no se copian a sí mismas');
    const zipDescargado = r.body;

    // Rutas peligrosas o archivos que no son copias se rechazan
    assert.equal((await api('GET', '/api/p/copias/copias/..%2F..%2Fsecreto.key')).status, 404);
    assert.equal((await api('POST', '/api/p/copias/restaurar', Buffer.from('no es un zip, pero tiene más de cien bytes de longitud para pasar el primer filtro de tamaño...........'))).status, 400);

    // Cambios después de la copia que deben desaparecer al restaurar
    await api('POST', '/api/clientes', { nombre: 'Cliente después de la copia', nif: 'A58818501' });
    assert.equal((await api('GET', '/api/clientes')).body.length, 2);

    // Restaurar desde el ZIP descargado: la app se reinicia sola
    const salida = new Promise((ok) => srv.on('exit', ok));
    r = await api('POST', '/api/p/copias/restaurar', zipDescargado, { 'Content-Type': 'application/zip' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await salida;
    const sesion = galleta();
    srv = await arrancar(dir, PUERTO);
    assert.match(srv.log(), /Copia de seguridad restaurada/);
    ponerGalleta(sesion); // la sesión estaba en la copia
    const clientes = (await api('GET', '/api/clientes')).body;
    assert.deepEqual(clientes.map((c) => c.nombre), ['Cliente antes de la copia']);
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('antes-de-restaurar-')), 'se guarda lo anterior');
    // Las copias siguen ahí después de restaurar
    r = await api('GET', '/api/p/copias/estado');
    assert.ok(r.body.copias.some((c) => c.nombre === nombre));
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
