import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { arrancar, cliente, instalar, preparar } from './ayuda.mjs';
import { validarTema } from '../temas/server.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('temas incluidos son válidos', () => {
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../temas/temas');
  const ids = fs.readdirSync(dir).map((f) => validarTema(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), { incluido: true }).id);
  assert.deepEqual(ids.sort(), ['alto-contraste', 'deca', 'frutiger-aero', 'metro', 'nordico', 'windows-clasico']);
  assert.throws(() => validarTema({ id: 'xx', claro: { brand: 'rojo' } }), /Color no válido/);
  assert.throws(() => validarTema({ id: 'malo', claro: { brand: '#000000', fg: '#000000', surface: '#ffffff' }, fondo_app: 'url(https://espia.example/x.png)' }), /degradados/);
});

test('temas: elegir tema y fotos de inicio de sesión públicas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-temas-'));
  const PUERTO = 9302;
  const BASE = `http://127.0.0.1:${PUERTO}`;
  const srv = await arrancar(dir, PUERTO);
  const { api } = cliente(BASE);
  try {
    await preparar(api);
    assert.equal((await (await fetch(`${BASE}/api/apariencia`)).json()).tema, null); // sin plugin: diseño por defecto
    await instalar(api, 'temas');
    let r = await api('GET', '/api/p/temas/temas');
    assert.equal(r.body.temas.length, 6);
    r = await api('PUT', '/api/p/temas/activo', { id: 'frutiger-aero' });
    assert.equal(r.status, 200);
    // Subir una foto (solo imágenes reales)
    assert.equal((await api('POST', '/api/p/temas/fondos', Buffer.from('<html>no soy una imagen</html>'.repeat(5)))).status, 400);
    r = await api('POST', '/api/p/temas/fondos', Buffer.concat([PNG, Buffer.alloc(200)]), { 'Content-Type': 'image/png' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await api('PUT', '/api/p/temas/login', { intervalo: 5, texto_login: 'Hola <script>' });
    // La apariencia es pública (la usa la pantalla de inicio de sesión)
    const ap = await (await fetch(`${BASE}/api/apariencia`)).json();
    assert.equal(ap.tema.id, 'frutiger-aero');
    assert.equal(ap.tema.cristal, true);
    assert.equal(ap.fondos.length, 1);
    assert.equal(ap.intervalo, 5);
    assert.equal(ap.texto_login, 'Hola script');
    const img = await fetch(BASE + ap.fondos[0]);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${BASE}/api/apariencia/archivo/..%2Fsecreto.key`)).status, 404);
    // Importar un tema propio y que solo el admin pueda cambiarlo
    r = await api('POST', '/api/p/temas/importar', { id: 'mi-empresa', nombre: 'Mi empresa', claro: { brand: '#AA0000', fg: '#111111', surface: '#FFFFFF' }, menu: 'superior' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await api('POST', '/api/p/temas/importar', { id: 'metro', claro: { brand: '#AA0000', fg: '#111111', surface: '#FFFFFF' } })).status, 400);
    await api('PUT', '/api/p/temas/activo', { id: 'mi-empresa' });
    assert.equal((await (await fetch(`${BASE}/api/apariencia`)).json()).tema.menu, 'superior');
    await api('POST', '/api/usuarios', { usuario: 'pepe', nombre: 'Pepe', password: 'Contrasena123!', rol: 'usuario' });
    const otro = cliente(BASE);
    await otro.api('POST', '/api/login', { usuario: 'pepe', password: 'Contrasena123!' });
    assert.equal((await otro.api('PUT', '/api/p/temas/activo', { id: 'metro' })).status, 403);
    // Al desactivar el plugin vuelve el diseño por defecto
    await api('POST', '/api/plugins/temas/activo', { activo: false });
    assert.equal((await (await fetch(`${BASE}/api/apariencia`)).json()).tema, null);
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
