// Plugin «7Ruta» y cobro por km de «7DeCA», contra un 7Factura real y un OpenRouteService simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { arrancar, cliente, instalar, preparar } from './ayuda.mjs';

// Simulador: 100 km por tramo, sin geocodificación (las pruebas usan coordenadas)
function simulador() {
  const peticiones = [];
  const srv = http.createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    peticiones.push({ url: req.url, auth: req.headers.authorization, body: b && JSON.parse(b) });
    if (req.headers.authorization !== 'clave-test') { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"clave"}}'); }
    const { coordinates } = JSON.parse(b);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ features: [{ properties: { summary: { distance: (coordinates.length - 1) * 100000, duration: 3600 } }, geometry: { coordinates } }] }));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, peticiones, url: `http://127.0.0.1:${srv.address().port}` })));
}

test('rutas: configuración, cálculo, CSP y cobro por km', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-rutas-'));
  const sim = await simulador();
  const PF = 9321;
  const fx = await arrancar(dir, PF);
  const { api } = cliente(`http://127.0.0.1:${PF}`);
  try {
    await preparar(api);
    await instalar(api, 'rutas');
    await instalar(api, 'gestor-deca');

    let r = await api('GET', '/api/p/rutas/config');
    assert.equal(r.body.configurado, false);
    r = await api('GET', '/plugins/rutas/ui/index.html');
    assert.match(r.headers.get('content-security-policy'), /img-src 'self' data: blob: https:\/\/tile\.openstreetmap\.org/);
    assert.doesNotMatch((await api('GET', '/api/estado')).headers.get('content-security-policy') || '', /openstreetmap/);

    r = await api('PUT', '/api/p/rutas/config', { proveedor: 'ors', ors: { clave: 'clave-test', base_ruta: `${sim.url}/ors` }, opciones: { perfil: 'camion', evitar_peajes: true } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await api('GET', '/api/p/rutas/config');
    assert.equal(r.body.configurado, true);
    assert.ok(!JSON.stringify(r.body).includes('clave-test'), 'la clave no se devuelve');

    r = await api('POST', '/api/p/rutas/ruta', { textos: ['40.4, -3.7', '39.86, -4.02', '39.5, -3.0'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.km, 200);
    const p = sim.peticiones.at(-1);
    assert.match(p.url, /\/ors\/v2\/directions\/driving-hgv\/geojson$/);
    assert.deepEqual(p.body.options.avoid_features, ['tollways', 'ferries']);

    // Cobro por km
    const envios = [
      { id: 1, origen: 'Cantera (solo en DeCA)', destinos: ['Obra'], ruta: { km: 88, manual: false }, puntos: [{ lat: 40.4, lon: -3.7 }, { lat: 39.86, lon: -4.02 }] },
      { id: 2, origen: '40.4, -3.7', destinos: ['39.86, -4.02', '39.5, -3.0'], ruta: null, puntos: null },
      { id: 3, origen: 'Sitio desconocido', destinos: ['Otro'], ruta: null, puntos: null },
    ];
    const km = async (cfg) => {
      const c = await api('PUT', '/api/p/gestor-deca/km/config', { precio_km: 1.2, ...cfg });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      return (await api('POST', '/api/p/gestor-deca/km', { envios })).body.resultados;
    };
    let k = await km({ cuenta: 'ida', preferir_deca: true });
    assert.deepEqual([k[1].km, k[1].fuente], [88, 'deca']);
    assert.deepEqual([k[2].km, k[2].fuente], [200, 'facturador']);
    assert.ok(k[3].error);
    k = await km({ cuenta: 'ida_vuelta', preferir_deca: true });
    assert.equal(k[1].km, 188, 'ida de DeCA + vuelta calculada con las coordenadas que manda DeCA');
    assert.equal(k[2].km, 300);
    k = await km({ cuenta: 'base', base: '40.3, -3.73', redondeo: 'entero' });
    assert.equal(k[1].km, 300, 'base → carga → descarga → base');
    assert.equal(k[2].km, 400);
    r = await api('PUT', '/api/p/gestor-deca/km/config', { cuenta: 'base', base: '' });
    assert.equal(r.status, 400);
  } finally {
    fx.kill(); sim.srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
