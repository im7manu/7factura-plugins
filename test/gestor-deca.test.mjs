// Prueba de extremo a extremo del plugin «Gestor DeCA y eCMR» contra un Gestor DeCA real (../gestor-deca-ecmr)
// y un Facturador real (../facturador), cada uno con su base de datos temporal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { arrancar, cliente, instalar, preparar, RAIZ } from './ayuda.mjs';

const DECA = path.resolve(RAIZ, '../gestor-deca-ecmr');

async function arrancarDeca(dir, puerto) {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: DECA, env: { ...process.env, PORT: String(puerto), HOST: '127.0.0.1', DECA_DATA: dir, BASE_URL: `http://127.0.0.1:${puerto}`, UPDATE_DISABLED: '1', WHATSAPP_API: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  await new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error(`Gestor DeCA no arrancó:\n${log}`)), 15_000);
    srv.stdout.on('data', () => { if (log.includes('activo en')) { clearTimeout(t); ok(); } });
  });
  return srv;
}

test('gestor-deca: conexión, envíos, factura y sincronización', { skip: !fs.existsSync(path.join(DECA, 'integracion.js')) && 'falta ../gestor-deca-ecmr con la API de integración' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-gestor-deca-'));
  const PD = 9311, PF = 9312;
  const deca = await arrancarDeca(path.join(dir, 'deca'), PD);
  const fx = await arrancar(path.join(dir, 'fx'), PF);
  try {
    // ---- Gestor DeCA: datos y token ----
    const { api: d } = cliente(`http://127.0.0.1:${PD}`);
    await d('POST', '/api/setup', { usuario: 'admin', nombre: 'Admin', clave: 'Contrasena123!', claveConfirm: 'Contrasena123!', empresa_nombre: 'Transportes Prueba', empresa_nif: '12345678Z' });
    await d('POST', '/api/empresas', { nombre: 'Áridos del Guadiana S.A.', nif: 'A06111222', direccion: 'Ctra. N-630', cp: '06800', ciudad: 'Mérida', tipo: 'Cliente' });
    await d('POST', '/api/empresas', { nombre: 'Logística Ruta', nif: 'B10777888', tipo: 'Transportista' });
    await d('POST', '/api/vehiculos', { matricula: '1234 KLM', tipo: 'Tractora', modelo: 'Volvo', itv: '2027-01-01' });
    await d('POST', '/api/conductores', { nombre: 'Juan Pérez', dni: '12345678Z', telefono: '600111222', activo: true });
    const emp = (await d('GET', '/api/empresas')).body.find((x) => x.nif === 'A06111222');
    for (const [peso, fecha] of [[24000, '2026-11-10'], [18500, '2026-11-12']]) {
      const r = await d('POST', '/api/docs', { tipo: 'deca', estado: 'emitido', datos: { contraparte_id: emp.id, destinatario: 'Obra', matricula: '1234 KLM', origen: 'Cantera', destinos: ['Obra Hospital'], f_carga: fecha, mercancia: 'Zahorra', peso, conductor_nombre: 'Juan Pérez', conductor_dni: '12345678Z' } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const token = (await d('POST', '/api/integraciones', { nombre: 'Facturador' })).body.token;
    assert.match(token, /^deca_/);

    // ---- Facturador: plugin ----
    const { api } = cliente(`http://127.0.0.1:${PF}`);
    await preparar(api);
    await instalar(api, 'gestor-deca');
    let r = await api('GET', '/api/p/gestor-deca/config');
    assert.equal(r.body.configurado, false);
    r = await api('GET', '/api/p/gestor-deca/envios');
    assert.equal(r.status, 400, 'sin configurar avisa');
    r = await api('PUT', '/api/p/gestor-deca/config', { url: `http://127.0.0.1:${PD}`, token: 'deca_tokenfalsotokenfalsotokenfalso' });
    assert.equal(r.status, 502, 'un token falso no se guarda');
    r = await api('PUT', '/api/p/gestor-deca/config', { url: `http://127.0.0.1:${PD}/`, token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.empresa.nif, '12345678Z');
    r = await api('GET', '/api/p/gestor-deca/config');
    assert.equal(r.body.configurado, true);
    assert.equal(r.body.token, undefined, 'el token no llega al navegador');
    // El token se guarda cifrado
    const ajuste = JSON.stringify(fs.readdirSync(path.join(dir, 'fx')));
    assert.ok(!ajuste.includes(token));

    r = await api('GET', '/api/p/gestor-deca/envios?desde=2026-11-01&hasta=2026-11-30');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.envios.length, 2);
    assert.ok(r.body.envios.every((x) => x.factura === null));

    // Flujo de la interfaz: cliente + factura con la API normal y vínculo de los envíos
    const c = (await api('POST', '/api/clientes', { nombre: 'Áridos del Guadiana S.A.', nif: 'A06111222' })).body;
    const lineas = r.body.envios.map((x) => ({ descripcion: `Transporte ${x.numero}`, cantidad: x.peso_kg / 1000, precio: 8, iva: 21 }));
    const doc = (await api('POST', '/api/documentos', { tipo: 'factura', cliente_id: c.id, lineas })).body;
    assert.equal(doc.totales.neto, 340, '42,5 t × 8 €');
    r = await api('POST', '/api/p/gestor-deca/vinculos', { documento_id: doc.id, envios: r.body.envios.map((x) => ({ id: x.id, numero: x.numero })) });
    assert.equal(r.status, 200);
    r = await api('GET', '/api/p/gestor-deca/envios?desde=2026-11-01&hasta=2026-11-30');
    assert.ok(r.body.envios.every((x) => x.factura?.id === doc.id), 'los envíos quedan marcados como facturados');

    // Si se borra el borrador, los envíos vuelven a estar libres
    r = await api('DELETE', `/api/documentos/${doc.id}`);
    assert.ok([200, 204].includes(r.status), JSON.stringify(r.body));
    r = await api('GET', '/api/p/gestor-deca/envios?desde=2026-11-01&hasta=2026-11-30');
    assert.ok(r.body.envios.every((x) => x.factura === null));

    // Catálogo para sincronizar
    r = await api('GET', '/api/p/gestor-deca/catalogo');
    assert.equal(r.status, 200);
    assert.equal(r.body.empresas.length, 2);
    assert.equal(r.body.vehiculos[0].matricula, '1234 KLM');
    assert.equal(r.body.conductores[0].dni, '12345678Z');

    // La interfaz se sirve
    r = await api('GET', '/plugins/gestor-deca/ui/index.html');
    assert.equal(r.status, 200);
  } finally {
    deca.kill(); fx.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
