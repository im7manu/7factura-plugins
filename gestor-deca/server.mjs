// Plugin «Gestor DeCA y eCMR»: conecta Facturador con una instalación de Gestor DeCA y eCMR mediante su API de
// integración de solo lectura (token creado en Gestor DeCA › Usuarios › Integraciones).
//
// - El token se guarda cifrado con la clave de la instalación y nunca se envía al navegador.
// - Las peticiones a Gestor DeCA las hace el servidor (sin problemas de CORS ni exponer el token).
// - Recuerda qué envíos se han incluido en qué factura (tabla plugin_gestor_deca_vinculos).

const AJUSTE = 'plugin_gestor_deca';
const fechaOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export function register(ctx) {
  const { router, db, requiereAdmin, auditar } = ctx;

  db.exec(`CREATE TABLE IF NOT EXISTS plugin_gestor_deca_vinculos(
    envio_id INTEGER PRIMARY KEY,
    envio_numero TEXT NOT NULL,
    documento_id INTEGER NOT NULL,
    creado TEXT NOT NULL DEFAULT (datetime('now'))
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
}
