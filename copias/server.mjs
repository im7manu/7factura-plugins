// Plugin «Copias de seguridad»: copia semanal automática y bajo demanda, descargable en ZIP para guardarla
// fuera del servidor, y restauración (solo administradores).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { crearZip, leerZip } from './lib/zip.mjs';

const DEFECTO = { dia: 1, hora: 3, conservar: 8 }; // lunes a las 3:00, se guardan las 8 últimas
const NOMBRE = /^copia-\d{8}-\d{6}(-manual)?\.zip$/;

export function register(ctx) {
  const { router, db, requiereAdmin, auditar, express } = ctx;
  const carpeta = path.join(ctx.dataDir, 'copias');
  fs.mkdirSync(carpeta, { recursive: true });
  const ajustes = () => ({ ...DEFECTO, ...ctx.getAjuste('plugin_copias', {}) });

  const listar = () => fs.readdirSync(carpeta).filter((f) => NOMBRE.test(f)).map((f) => {
    const st = fs.statSync(path.join(carpeta, f));
    return { nombre: f, tamano: st.size, fecha: st.mtime.toISOString(), manual: f.includes('-manual') };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha));

  /** Añade a la lista los archivos de una carpeta (recursivo), con su ruta dentro del ZIP. */
  function agregarCarpeta(entradas, dirAbs, prefijo, excluir = () => false) {
    if (!fs.existsSync(dirAbs)) return;
    for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      const abs = path.join(dirAbs, e.name);
      const rel = `${prefijo}/${e.name}`;
      if (excluir(rel) || e.isSymbolicLink()) continue;
      if (e.isDirectory()) agregarCarpeta(entradas, abs, rel, excluir);
      else if (e.isFile()) entradas.push({ nombre: rel, datos: fs.readFileSync(abs) });
    }
  }

  function crearCopia(manual = false, usuario = null) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facturador-copia-'));
    try {
      // Copia coherente de la base de datos aunque la aplicación esté en uso
      const dbTmp = path.join(tmp, 'facturador.db');
      db.exec(`VACUUM INTO '${dbTmp.replace(/'/g, "''")}'`);
      const entradas = [{ nombre: 'facturador.db', datos: fs.readFileSync(dbTmp) }];
      const secreto = path.join(ctx.dataRoot, 'secreto.key');
      if (fs.existsSync(secreto)) entradas.push({ nombre: 'secreto.key', datos: fs.readFileSync(secreto) });
      agregarCarpeta(entradas, path.join(ctx.dataRoot, 'adjuntos'), 'adjuntos');
      // Datos de otros plugins (temas, diseños de PDF…), pero no las propias copias
      agregarCarpeta(entradas, path.join(ctx.dataRoot, 'plugins-datos'), 'plugins-datos', (rel) => rel.startsWith('plugins-datos/copias'));
      const plugins = db.prepare('SELECT id, version, activo FROM plugins ORDER BY id').all();
      entradas.unshift({ nombre: 'copia.json', datos: Buffer.from(JSON.stringify({
        formato: 1, aplicacion: 'facturador', fecha: new Date().toISOString(), manual, plugins,
        empresa: ctx.getAjuste('empresa', {})?.razon_social || '', archivos: entradas.length,
      }, null, 2)) });
      const sello = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const nombre = `copia-${sello}${manual ? '-manual' : ''}.zip`;
      fs.writeFileSync(path.join(carpeta, nombre), crearZip(entradas), { mode: 0o600 });
      auditar({ usuario: usuario ? { usuario } : { usuario: 'sistema' } }, 'copia.crear', nombre, manual ? 'info' : 'info');
      // Conserva solo las N más recientes
      for (const c of listar().slice(ajustes().conservar)) fs.rmSync(path.join(carpeta, c.nombre), { force: true });
      return nombre;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** Comprueba si toca la copia semanal (cada hora). También la hace si la última tiene más de 7 días. */
  function revisarProgramada() {
    const a = ajustes();
    const ahora = new Date();
    const ultima = listar().find((c) => !c.manual);
    const dias = ultima ? (ahora - new Date(ultima.fecha)) / 86_400_000 : Infinity;
    const diaSemana = ahora.getDay() === 0 ? 7 : ahora.getDay();
    const toca = (diaSemana === a.dia && ahora.getHours() === a.hora && dias > 6) || dias > 7.5;
    if (toca) {
      try { console.log(`[copias] Copia automática creada: ${crearCopia(false)}`); } catch (e) { console.error('[copias] Error en la copia automática:', e.message); }
    }
  }
  ctx.cada(60 * 60 * 1000, revisarProgramada);
  setTimeout(revisarProgramada, 30_000).unref(); // al arrancar, por si se pasó la hora estando apagado

  /** Prepara la restauración: extrae el ZIP en data/restaurar y reinicia la aplicación. */
  function prepararRestauracion(zipBuf, usuario) {
    const entradas = leerZip(zipBuf);
    const meta = entradas.find((e) => e.nombre === 'copia.json');
    const base = entradas.find((e) => e.nombre === 'facturador.db');
    if (!meta || !base) throw Object.assign(new Error('El ZIP no es una copia de seguridad de Facturador'), { status: 400 });
    const info = JSON.parse(meta.datos.toString('utf8'));
    if (info.aplicacion !== 'facturador') throw Object.assign(new Error('El ZIP no es una copia de seguridad de Facturador'), { status: 400 });
    if (base.datos.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') throw Object.assign(new Error('La base de datos de la copia está dañada'), { status: 400 });
    const destino = path.join(ctx.dataRoot, 'restaurar');
    fs.rmSync(destino, { recursive: true, force: true });
    for (const e of entradas) {
      if (e.nombre === 'copia.json') continue;
      if (!/^(facturador\.db|secreto\.key|adjuntos\/.+|plugins-datos\/.+)$/.test(e.nombre)) continue; // solo lo que es de una copia
      const abs = path.resolve(destino, e.nombre);
      if (!abs.startsWith(destino + path.sep)) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, e.datos, { mode: 0o600 });
    }
    fs.writeFileSync(path.join(destino, 'listo'), info.fecha || '');
    auditar({ usuario: { usuario } }, 'copia.restaurar', `copia del ${info.fecha}`, 'alerta');
    return info;
  }

  const envolver = (fn) => (req, res) => {
    try { fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  };

  router.use(requiereAdmin);
  router.get('/estado', envolver((_req, res) => {
    const copias = listar();
    const ultima = copias[0];
    res.json({ ajustes: ajustes(), copias, ultima: ultima || null, dias_desde_ultima: ultima ? Math.floor((Date.now() - new Date(ultima.fecha)) / 86_400_000) : null });
  }));
  router.post('/copias', envolver((req, res) => res.status(201).json({ nombre: crearCopia(true, req.usuario.usuario) })));
  router.get('/copias/:nombre', envolver((req, res) => {
    const nombre = String(req.params.nombre);
    if (!NOMBRE.test(nombre) || !fs.existsSync(path.join(carpeta, nombre))) throw Object.assign(new Error('No encontrada'), { status: 404 });
    auditar(req, 'copia.descargar', nombre, 'aviso');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    fs.createReadStream(path.join(carpeta, nombre)).pipe(res);
  }));
  router.delete('/copias/:nombre', envolver((req, res) => {
    const nombre = String(req.params.nombre);
    if (!NOMBRE.test(nombre)) throw Object.assign(new Error('No encontrada'), { status: 404 });
    fs.rmSync(path.join(carpeta, nombre), { force: true });
    auditar(req, 'copia.borrar', nombre, 'aviso');
    res.json({ ok: true });
  }));
  router.put('/ajustes', envolver((req, res) => {
    const a = {
      dia: Math.min(7, Math.max(1, Number(req.body.dia) || 1)),
      hora: Math.min(23, Math.max(0, Number(req.body.hora) || 0)),
      conservar: Math.min(52, Math.max(1, Number(req.body.conservar) || 8)),
    };
    ctx.setAjuste('plugin_copias', a);
    res.json(a);
  }));
  // Restaurar una copia guardada en el servidor o un ZIP subido
  router.post('/restaurar/:nombre', envolver((req, res) => {
    const nombre = String(req.params.nombre);
    if (!NOMBRE.test(nombre) || !fs.existsSync(path.join(carpeta, nombre))) throw Object.assign(new Error('No encontrada'), { status: 404 });
    const info = prepararRestauracion(fs.readFileSync(path.join(carpeta, nombre)), req.usuario.usuario);
    res.json({ ok: true, fecha: info.fecha });
    ctx.reiniciar();
  }));
  router.post('/restaurar', express.raw({ type: () => true, limit: 512 * 1024 * 1024 }), envolver((req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw Object.assign(new Error('Sube el ZIP de la copia'), { status: 400 });
    const info = prepararRestauracion(req.body, req.usuario.usuario);
    res.json({ ok: true, fecha: info.fecha });
    ctx.reiniciar();
  }));
}
