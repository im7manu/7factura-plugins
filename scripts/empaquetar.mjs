// Empaqueta cada plugin en dist/<id>-<version>.tar.gz y genera registry.json con su SHA-256.
// Uso: node scripts/empaquetar.mjs [usuario/repo]   (por defecto im7manu/facturador-plugins)
// Después: crea en GitHub una Release con la etiqueta <id>-v<version> para cada plugin y sube su .tar.gz.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.argv[2] || 'im7manu/facturador-plugins';
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(raiz, 'dist');
fs.mkdirSync(dist, { recursive: true });
const plugins = [];
for (const dir of fs.readdirSync(raiz).sort()) {
  const manifiesto = path.join(raiz, dir, 'plugin.json');
  if (!fs.existsSync(manifiesto)) continue;
  const m = JSON.parse(fs.readFileSync(manifiesto, 'utf8'));
  if (m.id !== dir) throw new Error(`La carpeta ${dir} debe llamarse como su id (${m.id})`);
  const archivo = path.join(dist, `${m.id}-${m.version}.tar.gz`);
  execFileSync('tar', ['-czf', archivo, '--exclude=test', '--exclude=.DS_Store', '--exclude=package-lock.json', '--exclude=.bin', '-C', path.join(raiz, dir), '.'],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archivo)).digest('hex');
  plugins.push({
    id: m.id, nombre: m.nombre, version: m.version, descripcion: m.descripcion, autor: m.autor,
    url: `https://github.com/${repo}/releases/download/${m.id}-v${m.version}/${m.id}-${m.version}.tar.gz`,
    sha256, repo: `https://github.com/${repo}/tree/main/${m.id}`,
  });
  console.log(`${m.id} ${m.version} → ${path.relative(raiz, archivo)} (${(fs.statSync(archivo).size / 1024).toFixed(0)} KB)`);
}
fs.writeFileSync(path.join(raiz, 'registry.json'), `${JSON.stringify({ plugins }, null, 2)}\n`);
console.log(`registry.json actualizado con ${plugins.length} plugins`);
