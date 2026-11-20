// Plugin «Gestor DeCA y eCMR»: conecta Facturador con una instalación de Gestor DeCA y eCMR mediante su API de
// integración de solo lectura (token creado en Gestor DeCA › Usuarios › Integraciones).
//
// - El token se guarda cifrado con la clave de la instalación y nunca se envía al navegador.
// - Las peticiones a Gestor DeCA las hace el servidor (sin problemas de CORS ni exponer el token).
// - Recuerda qué envíos se han incluido en qué factura (tabla plugin_gestor_deca_vinculos).
// - Cobro por kilómetro: usa los km que guarda el plugin «Rutas y mapas» de Gestor DeCA (campo «ruta» de cada envío)
//   o los calcula con el plugin «Rutas y mapas» de Facturador. Cómo se cuentan los km se elige en la configuración.

const AJUSTE = 'plugin_gestor_deca';
const AJUSTE_KM = 'plugin_gestor_deca_km';
const KM_DEFECTO = { cuenta: 'ida', base: '', precio_km: 0, minimo: 0, redondeo: 'decimas', preferir_deca: true, precios_cliente: [] };
const normNif = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fechaOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export function register(ctx) {
  const { router, db, requiereAdmin, auditar } = ctx;

  db.exec(`CREATE TABLE IF NOT EXISTS plugin_gestor_deca_vinculos(
    envio_id INTEGER PRIMARY KEY,
    envio_numero TEXT NOT NULL,
    documento_id INTEGER NOT NULL,
    creado TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS plugin_gestor_deca_km(
    envio_id INTEGER PRIMARY KEY, firma TEXT NOT NULL, resultado TEXT NOT NULL, creado TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const config = () => ctx.getAjuste(AJUSTE, {}) || {};
  const token = () => { const c = config(); try { return c.token ? ctx.descifrar(c.token) : ''; } catch { return ''; } };

  async function deca(ruta, cfg = { url: config().url, token: token() }) {
    if (!cfg.url || !cfg.token) { const e = new Error('Configura primero la conexión con Gestor DeCA (pestaña Conexión).'); e.status = 400; throw e; }
    let r;
    try {
      r = await fetch(`${cfg.url}/api/integracion/v1${ruta}`, { headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      const err = new Error(e.name === 'TimeoutError' ? 'Gestor DeCA no responde (tiempo agotado).' : `No se pudo conectar con Gestor DeCA: ${e.cause?.code || e.message}`);
      err.status = 502; throw err;
    }
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(r.status === 401 ? 'Gestor DeCA ha rechazado el token (¿revocado o mal copiado?).' : (datos.error || `Gestor DeCA respondió ${r.status}`));
      err.status = 502; throw err;
    }
    return datos;
  }
  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Error interno' }); if (!e.status) console.error(e); }
  };

  const limpiarUrl = (u) => String(u || '').trim().replace(/\/+$/, '');
  const urlValida = (u) => /^https?:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(u);

  // ---- Conexión ----
  router.get('/config', (_req, res) => { const c = config(); res.json({ url: c.url || '', configurado: !!(c.url && c.token), comprobado: c.comprobado || null, empresa: c.empresa || null }); });

  router.put('/config', requiereAdmin, envolver(async (req, res) => {
    const url = limpiarUrl(req.body?.url);
    const nuevo = String(req.body?.token || '').trim();
    if (!urlValida(url)) return res.status(400).json({ error: 'La dirección no es válida (p. ej. https://gestor.tuempresa.com).' });
    if (nuevo && !/^deca_[A-Za-z0-9_-]{20,100}$/.test(nuevo)) return res.status(400).json({ error: 'El token no tiene el formato de Gestor DeCA (empieza por «deca_»).' });
    const tk = nuevo || token();
    if (!tk) return res.status(400).json({ error: 'Pega el token creado en Gestor DeCA › Usuarios › Integraciones.' });
    // Se comprueba la conexión antes de guardar
    const estado = await deca('/estado', { url, token: tk });
    ctx.setAjuste(AJUSTE, { url, token: ctx.cifrar(tk), comprobado: new Date().toISOString(), empresa: estado.empresa || null, version: estado.version });
    auditar(req, 'gestor-deca.conexion', url, 'aviso');
    res.json({ ok: true, version: estado.version, empresa: estado.empresa });
  }));

  router.delete('/config', requiereAdmin, (req, res) => {
    ctx.setAjuste(AJUSTE, {});
    auditar(req, 'gestor-deca.desconectar', '', 'aviso');
    res.json({ ok: true });
  });

  router.get('/estado', envolver(async (_req, res) => res.json(await deca('/estado'))));

  // ---- Envíos ----
  router.get('/envios', envolver(async (req, res) => {
    const q = new URLSearchParams();
    if (fechaOk(req.query.desde)) q.set('desde', req.query.desde);
    if (fechaOk(req.query.hasta)) q.set('hasta', req.query.hasta);
    if (req.query.tipo === 'deca' || req.query.tipo === 'ecmr') q.set('tipo', req.query.tipo);
    const { envios } = await deca(`/envios?${q}`);
    // Vínculos con facturas que siguen existiendo (si se borró el borrador, el envío vuelve a estar libre)
    db.exec('DELETE FROM plugin_gestor_deca_vinculos WHERE documento_id NOT IN (SELECT id FROM documentos)');
    const vinc = new Map(db.prepare(`SELECT v.envio_id, v.documento_id, d.codigo, d.estado FROM plugin_gestor_deca_vinculos v
      JOIN documentos d ON d.id = v.documento_id`).all().map((v) => [v.envio_id, v]));
    res.json({ envios: (envios || []).map((e) => {
      const v = vinc.get(e.id);
      return { ...e, factura: v && v.estado !== 'anulada' ? { id: v.documento_id, codigo: v.codigo, estado: v.estado } : null };
    }) });
  }));

  router.post('/vinculos', envolver(async (req, res) => {
    const documentoId = Number(req.body?.documento_id);
    const envios = Array.isArray(req.body?.envios) ? req.body.envios : [];
    if (!db.prepare("SELECT 1 FROM documentos WHERE id = ? AND tipo = 'factura'").get(documentoId)) return res.status(400).json({ error: 'La factura no existe.' });
    if (!envios.length || envios.length > 500) return res.status(400).json({ error: 'Indica los envíos facturados.' });
    const ins = db.prepare('INSERT INTO plugin_gestor_deca_vinculos(envio_id, envio_numero, documento_id) VALUES (?,?,?) ON CONFLICT(envio_id) DO UPDATE SET documento_id = excluded.documento_id, envio_numero = excluded.envio_numero, creado = datetime(\'now\')');
    for (const e of envios) {
      if (!Number.isInteger(e.id)) return res.status(400).json({ error: 'Envío no válido.' });
      ins.run(e.id, String(e.numero || '').slice(0, 40), documentoId);
    }
    auditar(req, 'gestor-deca.facturar', `${envios.length} envío(s) en el documento ${documentoId}`);
    res.json({ ok: true });
  }));

  router.delete('/vinculos/:envio', envolver(async (req, res) => {
    db.prepare('DELETE FROM plugin_gestor_deca_vinculos WHERE envio_id = ?').run(Number(req.params.envio));
    res.json({ ok: true });
  }));

  // ---- Catálogo para sincronizar ----
  router.get('/catalogo', envolver(async (_req, res) => {
    const [e, v, c] = await Promise.all([deca('/empresas'), deca('/vehiculos'), deca('/conductores')]);
    res.json({ empresas: e.empresas || [], vehiculos: v.vehiculos || [], conductores: c.conductores || [] });
  }));

  // ---- Cobro por kilómetro ----
  const num = (v, def, max) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= max ? x : def; };
  function configKm() {
    const c = { ...KM_DEFECTO, ...(ctx.getAjuste(AJUSTE_KM, {}) || {}) };
    return {
      cuenta: ['ida', 'ida_vuelta', 'base'].includes(c.cuenta) ? c.cuenta : 'ida',
      base: String(c.base || '').slice(0, 300),
      precio_km: num(c.precio_km, 0, 1000), minimo: num(c.minimo, 0, 100000),
      redondeo: ['decimas', 'entero', 'arriba'].includes(c.redondeo) ? c.redondeo : 'decimas',
      preferir_deca: c.preferir_deca !== false,
      precios_cliente: (Array.isArray(c.precios_cliente) ? c.precios_cliente : []).slice(0, 500)
        .map((p) => ({ nif: normNif(p.nif), nombre: String(p.nombre || '').slice(0, 150), precio_km: num(p.precio_km, 0, 1000) })).filter((p) => p.nif),
    };
  }
  const extRutas = () => (ctx.extensionesDe ? ctx.extensionesDe('rutas')[0]?.fn : null) || null;
  const rutasListas = () => { try { return !!extRutas()?.configurado(); } catch { return false; } };

  router.get('/km/config', (_req, res) => res.json({ ...configKm(), rutas: { instalado: !!extRutas(), configurado: rutasListas() } }));
  router.put('/km/config', requiereAdmin, (req, res) => {
    const b = req.body || {};
    const c = { ...KM_DEFECTO, ...b };
    ctx.setAjuste(AJUSTE_KM, { cuenta: c.cuenta, base: c.base, precio_km: c.precio_km, minimo: c.minimo, redondeo: c.redondeo, preferir_deca: c.preferir_deca, precios_cliente: c.precios_cliente });
    const g = configKm();
    if (g.cuenta === 'base' && !g.base) return res.status(400).json({ error: 'Indica la dirección de la base (almacén o garaje) para contar los km desde allí.' });
    db.exec('DELETE FROM plugin_gestor_deca_km');
    auditar(req, 'gestor-deca.km', `Cobro por km: ${g.cuenta}, ${g.precio_km} €/km, mínimo ${g.minimo} €`, 'aviso');
    res.json(g);
  });

  const redondear = (km, modo) => (modo === 'entero' ? Math.round(km) : modo === 'arriba' ? Math.ceil(km) : Math.round(km * 10) / 10);
  const fmt = (n) => `${Number(n).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;

  /** Km a facturar de un envío según la configuración. Devuelve { km, detalle, fuente, aviso } o { error }. */
  async function kmEnvio(e, c) {
    const R = extRutas(), listo = rutasListas();
    // Si Gestor DeCA manda las coordenadas de los puntos, se usan en lugar de los nombres (que solo conoce Gestor DeCA)
    const pts = Array.isArray(e.puntos) ? e.puntos : [];
    const txt = (t, i) => { const p = pts[i]; return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? `${p.lat}, ${p.lon}` : String(t || '').trim(); };
    const destinos = (Array.isArray(e.destinos) ? e.destinos : []).map((x, i) => txt(x, i + 1)).filter(Boolean).slice(0, 20);
    const origen = txt(e.origen, 0);
    const deca = Number.isFinite(Number(e.ruta?.km)) && e.ruta?.km != null ? Number(e.ruta.km) : null;
    const sinRutas = 'Instala y configura el plugin «Rutas y mapas» en Facturador, o calcula la ruta del envío en Gestor DeCA.';
    const avisos = [];
    if (e.ruta?.revisar) avisos.push('En Gestor DeCA cambiaron los lugares después de corregir los km: revísalos.');
    let ida = null, fuente = null;
    if (c.cuenta !== 'base') {
      if (deca != null && (c.preferir_deca || !listo)) { ida = deca; fuente = 'deca'; if (e.ruta.manual) avisos.push('Km corregidos a mano en Gestor DeCA.'); }
      else if (listo && origen && destinos.length) { ida = (await R.calcular([origen, ...destinos])).km; fuente = 'facturador'; }
      else return { error: deca == null ? `El envío no tiene km. ${sinRutas}` : sinRutas };
    }
    let km, detalle;
    if (c.cuenta === 'ida') { km = ida; detalle = 'ida'; }
    else if (c.cuenta === 'ida_vuelta') {
      if (listo && origen && destinos.length) {
        const vuelta = (await R.calcular([destinos[destinos.length - 1], origen])).km;
        km = ida + vuelta; detalle = `ida ${fmt(ida)} + vuelta ${fmt(vuelta)}`;
      } else { km = ida * 2; detalle = 'ida y vuelta'; avisos.push('Vuelta estimada igual que la ida (sin el plugin «Rutas y mapas» configurado en Facturador).'); }
    } else {
      if (!listo) return { error: `Para contar los km desde la base hace falta el plugin «Rutas y mapas» de Facturador configurado.` };
      if (!origen || !destinos.length) return { error: 'El envío no tiene lugar de carga o de descarga.' };
      km = (await R.calcular([c.base, origen, ...destinos, c.base])).km; fuente = 'facturador';
      detalle = 'desde la base, con vuelta';
    }
    return { km: redondear(km, c.redondeo), detalle, fuente, aviso: avisos.join(' ') };
  }

  router.post('/km', envolver(async (req, res) => {
    const c = configKm();
    const lista = Array.isArray(req.body?.envios) ? req.body.envios.slice(0, 300) : [];
    const recalcular = !!req.body?.recalcular;
    const resultados = {};
    for (const e of lista) {
      if (!Number.isInteger(e?.id)) continue;
      const firma = JSON.stringify([c.cuenta, c.base, c.redondeo, c.preferir_deca, e.origen, e.destinos, e.puntos ?? null, e.ruta?.km ?? null, e.ruta?.manual ?? null, rutasListas()]);
      const cache = recalcular ? null : db.prepare('SELECT resultado FROM plugin_gestor_deca_km WHERE envio_id = ? AND firma = ?').get(e.id, firma);
      if (cache) { resultados[e.id] = JSON.parse(cache.resultado); continue; }
      let r;
      try { r = await kmEnvio(e, c); } catch (x) { r = { error: x.message || 'No se pudo calcular la ruta' }; }
      resultados[e.id] = r;
      if (!r.error) db.prepare('INSERT INTO plugin_gestor_deca_km(envio_id, firma, resultado) VALUES (?,?,?) ON CONFLICT(envio_id) DO UPDATE SET firma = excluded.firma, resultado = excluded.resultado, creado = datetime(\'now\')').run(e.id, firma, JSON.stringify(r));
    }
    res.json({ resultados });
  }));
}
