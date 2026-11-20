// Utilidades para probar los plugins contra un servidor real de 7Factura (../facturador).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../facturador');
export const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function empaquetar(id) {
  const archivo = path.join(os.tmpdir(), `${id}-prueba-${Date.now()}.tar.gz`);
  execFileSync('tar', ['-czf', archivo, '--exclude=test', '--exclude=node_modules/@img', '--exclude=node_modules/sharp', '--exclude=node_modules/@types', '--exclude=*.d.ts', '--exclude=*.map', '--exclude=.bin', '--exclude=package-lock.json', '-C', path.join(RAIZ, id), '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  return fs.readFileSync(archivo);
}

export async function arrancar(dir, puerto, extraEnv = {}) {
  const srv = spawn(process.execPath, ['server/index.mjs'], {
    cwd: APP,
    env: { ...process.env, PORT: String(puerto), HOST: '127.0.0.1', DATA_DIR: dir, PLUGINS_DIR: path.join(dir, 'plugins'), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  await new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error(`El servidor no arrancó:\n${log}`)), 15_000);
    const mirar = () => { if (log.includes('escuchando')) { clearTimeout(t); ok(); } };
    srv.stdout.on('data', mirar);
  });
  srv.log = () => log;
  return srv;
}

export function cliente(base) {
  let cookie = '';
  const api = async (metodo, ruta, cuerpo, cabeceras = {}) => {
    const esBinario = Buffer.isBuffer(cuerpo);
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(esBinario ? {} : { 'Content-Type': 'application/json' }), Cookie: cookie, Origin: base, ...cabeceras },
      body: cuerpo === undefined ? undefined : esBinario ? cuerpo : JSON.stringify(cuerpo),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return { api, galleta: () => cookie, ponerGalleta: (c) => { cookie = c; } };
}

export async function instalar(api, id) {
  const r = await api('POST', '/api/plugins/subir', empaquetar(id), { 'Content-Type': 'application/gzip' });
  if (r.status !== 200) throw new Error(`No se pudo instalar ${id}: ${JSON.stringify(r.body)}`);
  return r.body;
}

export async function preparar(api) {
  await api('POST', '/api/setup', { usuario: { usuario: 'admin', nombre: 'Admin', password: 'Contrasena123!' }, empresa: { razon_social: 'Transportes Prueba', nif: '12345678Z' } });
}
