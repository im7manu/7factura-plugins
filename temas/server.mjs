// Plugin «Temas»: el administrador elige el aspecto de la aplicación para toda la empresa y sube las fotos
// de la pantalla de inicio de sesión (rotan si hay más de una). Incluye temas de ejemplo y permite importar
// temas propios en JSON (ver README del plugin para el formato).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HEX = /^#[0-9a-f]{6}$/i;
const CLAVES_COLOR = ['canvas', 'surface', 'subtle', 'stroke', 'fg', 'muted', 'brand', 'brand-hover', 'brand-fg', 'brand-soft', 'brand-on', 'suite', 'suite-fg', 'danger', 'success', 'warning'];
const CLAVES_MOSAICO = ['blue', 'teal', 'purple', 'orange', 'green', 'magenta', 'slate'];
const MAX_FONDOS = 10;

/** Valida y normaliza un tema (los importados no pueden traer url() ni CSS arbitrario). */
export function validarTema(t, { incluido = false } = {}) {
  if (!t || typeof t !== 'object') throw new Error('El tema no es un objeto JSON');
  const texto = (v, max) => String(v ?? '').replace(/[<>{};]/g, '').slice(0, max);
  const id = String(t.id || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw new Error('El tema necesita un "id" (minúsculas, números y guiones)');
  const colores = (c, obligatorio) => {
    if (!c) { if (obligatorio) throw new Error('Faltan los colores "claro"'); return null; }
    const out = {};
    for (const k of CLAVES_COLOR) if (c[k] !== undefined) {
      if (!HEX.test(c[k])) throw new Error(`Color no válido en "${k}": usa el formato #RRGGBB`);
      out[k] = c[k].toUpperCase();
    }
    if (obligatorio && (!out.brand || !out.fg || !out.surface)) throw new Error('Los colores necesitan al menos "brand", "fg" y "surface"');
    return out;
  };
  const fondo = String(t.fondo_app || '');
  if (fondo && (!incluido && /url\s*\(/i.test(fondo))) throw new Error('"fondo_app" solo admite degradados (sin url())');
  if (fondo && !/^(\s*(linear|radial|conic)-gradient\([^;{}<>]*\)\s*,?)+$/i.test(fondo)) throw new Error('"fondo_app" debe ser uno o varios degradados CSS');
  const mosaicos = {};
  for (const k of CLAVES_MOSAICO) if (t.mosaicos?.[k] && HEX.test(t.mosaicos[k])) mosaicos[k] = t.mosaicos[k];
  return {
    id, nombre: texto(t.nombre, 60) || id, descripcion: texto(t.descripcion, 300), autor: texto(t.autor, 80),
    claro: colores(t.claro, true), oscuro: colores(t.oscuro, false),
    modo: ['auto', 'claro', 'oscuro'].includes(t.modo) ? t.modo : 'auto',
    fuente: texto(t.fuente, 300) || undefined,
    radio: Math.max(0, Math.min(28, Number(t.radio ?? 4))),
    sombra: ['ninguna', 'suave', 'marcada'].includes(t.sombra) ? t.sombra : 'suave',
    cristal: !!t.cristal, relieve: !!t.relieve, bordes: !!t.bordes,
    menu: t.menu === 'superior' ? 'superior' : 'lateral',
    iconos: { trazo: Math.max(0.75, Math.min(3, Number(t.iconos?.trazo ?? 2))) },
    densidad: t.densidad === 'compacta' ? 'compacta' : 'normal',
    fondo_app: fondo || undefined,
    mosaicos,
  };
}

export function register(ctx) {
  const { router, requiereAdmin, auditar, express } = ctx;
  const dirPropios = path.join(ctx.dataDir, 'temas-propios');
  const dirFondos = path.join(ctx.dataDir, 'fondos');
  fs.mkdirSync(dirPropios, { recursive: true });
  fs.mkdirSync(dirFondos, { recursive: true });
  const ajustes = () => ({ activo: 'metro', intervalo: 8, texto_login: '', ...ctx.getAjuste('plugin_temas', {}) });
  const guardar = (a) => ctx.setAjuste('plugin_temas', a);

  const incluidos = () => fs.readdirSync(path.join(ctx.dir, 'temas')).filter((f) => f.endsWith('.json')).map((f) => {
    try { return { ...validarTema(JSON.parse(fs.readFileSync(path.join(ctx.dir, 'temas', f), 'utf8')), { incluido: true }), propio: false }; } catch (e) { console.error(`[temas] ${f}:`, e.message); return null; }
  }).filter(Boolean);
  const propios = () => fs.readdirSync(dirPropios).filter((f) => f.endsWith('.json')).map((f) => {
    try { return { ...validarTema(JSON.parse(fs.readFileSync(path.join(dirPropios, f), 'utf8'))), propio: true }; } catch { return null; }
  }).filter(Boolean);
  const todos = () => {
    const mapa = new Map(incluidos().map((t) => [t.id, t]));
    for (const t of propios()) mapa.set(t.id, t);
    return [...mapa.values()];
  };
  const fondos = () => fs.readdirSync(dirFondos).filter((f) => /^[a-f0-9]{24}\.(jpg|png|webp)$/.test(f)).sort()
    .map((f) => ({ nombre: f, ruta: path.join(dirFondos, f) }));

  // El núcleo pide la apariencia (también en la pantalla de inicio de sesión, sin sesión)
  ctx.extender('apariencia', () => {
    const a = ajustes();
    const tema = todos().find((t) => t.id === a.activo) || null;
    return { tema, fondos: fondos(), intervalo: a.intervalo, texto_login: a.texto_login };
  });

  const envolver = (fn) => (req, res) => {
    try { fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  };

  router.use(requiereAdmin);
  router.get('/temas', envolver((_req, res) => {
    const a = ajustes();
    res.json({ activo: a.activo, temas: todos(), fondos: fondos().map((f) => `/api/apariencia/archivo/${f.nombre}`), intervalo: a.intervalo, texto_login: a.texto_login });
  }));
  router.put('/activo', envolver((req, res) => {
    const id = String(req.body.id || '');
    if (!todos().some((t) => t.id === id)) throw new Error('Ese tema no existe');
    guardar({ ...ajustes(), activo: id });
    auditar(req, 'tema.activar', id, 'aviso');
    res.json({ ok: true });
  }));
  router.post('/importar', envolver((req, res) => {
    const t = validarTema(req.body);
    if (incluidos().some((x) => x.id === t.id)) throw new Error(`"${t.id}" es un tema incluido; usa otro id`);
    fs.writeFileSync(path.join(dirPropios, `${t.id}.json`), JSON.stringify(t, null, 2));
    auditar(req, 'tema.importar', t.id);
    res.status(201).json(t);
  }));
  router.delete('/propios/:id', envolver((req, res) => {
    const id = String(req.params.id);
    if (!/^[a-z0-9-]{2,41}$/.test(id)) throw new Error('Id no válido');
    fs.rmSync(path.join(dirPropios, `${id}.json`), { force: true });
    if (ajustes().activo === id) guardar({ ...ajustes(), activo: 'metro' });
    res.json({ ok: true });
  }));
  router.put('/login', envolver((req, res) => {
    const a = { ...ajustes(), intervalo: Math.max(3, Math.min(120, Number(req.body.intervalo) || 8)), texto_login: String(req.body.texto_login || '').replace(/[<>]/g, '').slice(0, 160) };
    guardar(a);
    res.json(a);
  }));
  router.post('/fondos', express.raw({ type: () => true, limit: 8 * 1024 * 1024 }), envolver((req, res) => {
    const b = req.body;
    if (!Buffer.isBuffer(b) || b.length < 100) throw new Error('Sube una imagen');
    const ext = b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.subarray(1, 4).toString() === 'PNG' ? 'png'
      : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
    if (!ext) throw new Error('Formato no admitido: usa JPG, PNG o WEBP');
    if (fondos().length >= MAX_FONDOS) throw new Error(`Máximo ${MAX_FONDOS} fotos`);
    const nombre = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dirFondos, nombre), b);
    auditar(req, 'tema.fondo_subir', nombre);
    res.status(201).json({ url: `/api/apariencia/archivo/${nombre}` });
  }));
  router.delete('/fondos/:nombre', envolver((req, res) => {
    const nombre = String(req.params.nombre);
    if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(nombre)) throw new Error('Nombre no válido');
    fs.rmSync(path.join(dirFondos, nombre), { force: true });
    res.json({ ok: true });
  }));
}
