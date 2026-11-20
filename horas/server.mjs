// Plugin «Registro de horas»: proyectos por cliente, registros de tiempo y conversión en factura BORRADOR.
// - Un registro facturado queda unido a su factura y no se vuelve a proponer.
// - Si el borrador se elimina, sus registros vuelven solos a «pendiente». Si la factura emitida se rectifica, se pueden
//   recuperar con una acción explícita que queda en la auditoría.
const AJUSTE = 'plugin_horas';
const DEFECTO = { tarifa: 40, redondeo: 15, iva: 21, irpf: 0, agrupar: 'registro', tarifas_cliente: {} };
const r2 = (n) => Math.round(n * 100) / 100;
const fechaOk = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));

export function register(ctx) {
  const { router, db, requiereAdmin, auditar } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS plugin_horas_proyectos(
      id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL, nombre TEXT NOT NULL, tarifa REAL, concepto TEXT DEFAULT '', estado TEXT NOT NULL DEFAULT 'activo', creado TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plugin_horas_registros(
      id INTEGER PRIMARY KEY, proyecto_id INTEGER NOT NULL, usuario_id INTEGER, fecha TEXT NOT NULL, minutos INTEGER, descripcion TEXT DEFAULT '',
      facturable INTEGER NOT NULL DEFAULT 1, tarifa REAL, inicio TEXT, documento_id INTEGER, facturado TEXT, creado TEXT DEFAULT (datetime('now'))
    ); CREATE INDEX IF NOT EXISTS idx_horas_proy ON plugin_horas_registros(proyecto_id, fecha);`);

  const config = () => { const c = { ...DEFECTO, ...(ctx.getAjuste(AJUSTE, {}) || {}) }; return { ...c, tarifas_cliente: c.tarifas_cliente || {} }; };
  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { const st = e.status || 500; if (st === 500) console.error('[horas]', e); res.status(st).json({ error: st === 500 ? 'Error interno' : e.message }); }
  };
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const redondear = (min, bloque) => (bloque > 1 ? Math.ceil(min / bloque) * bloque : Math.round(min));

  /** Tarifa aplicable: la del registro, la del proyecto, la del cliente o la general. */
  function tarifaDe(r, c = config()) {
    return [r.tarifa, r.tarifa_proyecto, c.tarifas_cliente[r.cliente_id]].find((x) => x != null && x !== '' && Number.isFinite(Number(x))) ?? c.tarifa;
  }

  // Borradores eliminados: sus registros vuelven a estar pendientes
  function liberarHuerfanos() {
    db.exec('UPDATE plugin_horas_registros SET documento_id = NULL, facturado = NULL WHERE documento_id IS NOT NULL AND documento_id NOT IN (SELECT id FROM documentos)');
  }

  const REG = `SELECT r.*, p.nombre AS proyecto, p.cliente_id, p.tarifa AS tarifa_proyecto, p.concepto, c.nombre AS cliente, u.nombre AS usuario, d.codigo, d.estado AS estado_doc
    FROM plugin_horas_registros r JOIN plugin_horas_proyectos p ON p.id = r.proyecto_id LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN usuarios u ON u.id = r.usuario_id LEFT JOIN documentos d ON d.id = r.documento_id`;
  const salida = (r, c = config()) => ({ ...r, facturable: !!r.facturable, horas: r.minutos != null ? r2(r.minutos / 60) : null, tarifa_aplicada: Number(tarifaDe(r, c)),
    importe: r.minutos != null ? r2((redondear(r.minutos, c.redondeo) / 60) * Number(tarifaDe(r, c))) : null,
    rectificada: !!(r.documento_id && db.prepare('SELECT 1 FROM documentos WHERE rectifica_id = ? AND numero IS NOT NULL').get(r.documento_id)) });

  // ---- Configuración ----
  router.get('/config', (_req, res) => res.json(config()));
  router.put('/config', requiereAdmin, (req, res) => {
    const b = req.body || {};
    ctx.setAjuste(AJUSTE, { tarifa: Math.max(0, Number(b.tarifa) || 0), redondeo: [1, 5, 6, 10, 15, 30, 60].includes(Number(b.redondeo)) ? Number(b.redondeo) : 15,
      iva: Math.max(0, Math.min(100, Number(b.iva ?? 21))), irpf: Math.max(0, Math.min(100, Number(b.irpf) || 0)), agrupar: b.agrupar === 'proyecto' ? 'proyecto' : 'registro',
      tarifas_cliente: Object.fromEntries(Object.entries(b.tarifas_cliente || {}).filter(([k, v]) => Number(k) && v !== '' && Number(v) >= 0).map(([k, v]) => [k, Number(v)])) });
    auditar(req, 'horas.config', '');
    res.json({ ok: true });
  });

  // ---- Proyectos ----
  router.get('/proyectos', (_req, res) => res.json(db.prepare(`SELECT p.*, c.nombre AS cliente,
      (SELECT COALESCE(SUM(minutos),0) FROM plugin_horas_registros r WHERE r.proyecto_id = p.id AND r.facturable = 1 AND r.documento_id IS NULL AND r.minutos IS NOT NULL) AS pendiente_min
    FROM plugin_horas_proyectos p LEFT JOIN clientes c ON c.id = p.cliente_id ORDER BY p.estado, c.nombre, p.nombre`).all()));
  router.post('/proyectos', envolver(async (req, res) => {
    const b = req.body || {};
    const nombre = String(b.nombre || '').trim().slice(0, 100);
    if (!nombre) throw err('Pon un nombre al proyecto.');
    if (!db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(Number(b.cliente_id))) throw err('Elige el cliente.');
    const vals = [Number(b.cliente_id), nombre, b.tarifa === '' || b.tarifa == null ? null : Math.max(0, Number(b.tarifa)), String(b.concepto || '').slice(0, 300), b.estado === 'archivado' ? 'archivado' : 'activo'];
    if (b.id) db.prepare('UPDATE plugin_horas_proyectos SET cliente_id=?, nombre=?, tarifa=?, concepto=?, estado=? WHERE id=?').run(...vals, Number(b.id));
    else b.id = Number(db.prepare('INSERT INTO plugin_horas_proyectos(cliente_id, nombre, tarifa, concepto, estado) VALUES (?,?,?,?,?)').run(...vals).lastInsertRowid);
    res.json({ id: b.id });
  }));

  // ---- Registros ----
  router.get('/registros', envolver(async (req, res) => {
    liberarHuerfanos();
    const q = req.query, w = ['1=1'], p = [];
    if (q.proyecto_id) { w.push('r.proyecto_id = ?'); p.push(Number(q.proyecto_id)); }
    if (q.cliente_id) { w.push('p.cliente_id = ?'); p.push(Number(q.cliente_id)); }
    if (fechaOk(q.desde)) { w.push('r.fecha >= ?'); p.push(q.desde); }
    if (fechaOk(q.hasta)) { w.push('r.fecha <= ?'); p.push(q.hasta); }
    if (q.estado === 'pendiente') w.push('r.documento_id IS NULL AND r.facturable = 1 AND r.minutos IS NOT NULL');
    if (q.estado === 'facturado') w.push('r.documento_id IS NOT NULL');
    if (q.mios === '1') { w.push('r.usuario_id = ?'); p.push(req.usuario.id); }
    const c = config();
    res.json(db.prepare(`${REG} WHERE ${w.join(' AND ')} ORDER BY r.fecha DESC, r.id DESC LIMIT 1000`).all(...p).map((r) => salida(r, c)));
  }));
  function datosRegistro(b, actual = {}) {
    const proyecto = db.prepare("SELECT * FROM plugin_horas_proyectos WHERE id = ?").get(Number(b.proyecto_id ?? actual.proyecto_id));
    if (!proyecto) throw err('Elige el proyecto.');
    const fecha = fechaOk(b.fecha) ? b.fecha : actual.fecha || new Date().toLocaleDateString('sv-SE');
    let minutos = b.minutos != null && b.minutos !== '' ? Math.round(Number(b.minutos)) : b.horas != null && b.horas !== '' ? Math.round(Number(String(b.horas).replace(',', '.')) * 60) : actual.minutos;
    if (b.inicio_h && b.fin_h) { const [a, z] = [b.inicio_h, b.fin_h].map((t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }); minutos = z > a ? z - a : z + 1440 - a; }
    if (minutos != null && !(minutos > 0 && minutos <= 24 * 60)) throw err('La duración no es válida (entre 1 minuto y 24 horas).');
    return { proyecto_id: proyecto.id, fecha, minutos, descripcion: String(b.descripcion ?? actual.descripcion ?? '').slice(0, 1000), facturable: b.facturable === undefined ? actual.facturable ?? 1 : b.facturable ? 1 : 0,
      tarifa: b.tarifa === undefined ? actual.tarifa ?? null : b.tarifa === '' || b.tarifa == null ? null : Math.max(0, Number(b.tarifa)) };
  }
  router.post('/registros', envolver(async (req, res) => {
    const v = datosRegistro(req.body || {});
    if (v.minutos == null) throw err('Indica la duración (o usa el cronómetro).');
    const id = Number(db.prepare('INSERT INTO plugin_horas_registros(proyecto_id, usuario_id, fecha, minutos, descripcion, facturable, tarifa) VALUES (?,?,?,?,?,?,?)').run(v.proyecto_id, req.usuario.id, v.fecha, v.minutos, v.descripcion, v.facturable, v.tarifa).lastInsertRowid);
    res.status(201).json({ id });
  }));
  router.put('/registros/:id', envolver(async (req, res) => {
    const r = db.prepare('SELECT * FROM plugin_horas_registros WHERE id = ?').get(Number(req.params.id));
    if (!r) throw err('Registro no encontrado', 404);
    if (r.documento_id) throw err('El registro ya está en una factura: no se puede cambiar.', 409);
    const v = datosRegistro(req.body || {}, r);
    db.prepare('UPDATE plugin_horas_registros SET proyecto_id=?, fecha=?, minutos=?, descripcion=?, facturable=?, tarifa=? WHERE id=?').run(v.proyecto_id, v.fecha, v.minutos, v.descripcion, v.facturable, v.tarifa, r.id);
    res.json({ ok: true });
  }));
  router.delete('/registros/:id', envolver(async (req, res) => {
    const r = db.prepare('SELECT * FROM plugin_horas_registros WHERE id = ?').get(Number(req.params.id));
    if (!r) throw err('Registro no encontrado', 404);
    if (r.documento_id) throw err('El registro ya está en una factura: no se puede borrar.', 409);
    db.prepare('DELETE FROM plugin_horas_registros WHERE id = ?').run(r.id);
    res.json({ ok: true });
  }));

  // ---- Cronómetro (uno por usuario) ----
  router.get('/cronometro', (req, res) => res.json(db.prepare(`${REG} WHERE r.usuario_id = ? AND r.inicio IS NOT NULL AND r.minutos IS NULL`).get(req.usuario.id) || null));
  router.post('/cronometro/iniciar', envolver(async (req, res) => {
    if (db.prepare('SELECT 1 FROM plugin_horas_registros WHERE usuario_id = ? AND inicio IS NOT NULL AND minutos IS NULL').get(req.usuario.id)) throw err('Ya tienes un cronómetro en marcha.', 409);
    const v = datosRegistro({ ...req.body, minutos: null });
    const id = Number(db.prepare('INSERT INTO plugin_horas_registros(proyecto_id, usuario_id, fecha, minutos, descripcion, facturable, inicio) VALUES (?,?,?,?,?,?,?)').run(v.proyecto_id, req.usuario.id, new Date().toLocaleDateString('sv-SE'), null, v.descripcion, v.facturable, new Date().toISOString()).lastInsertRowid);
    res.status(201).json({ id });
  }));
  router.post('/cronometro/parar', envolver(async (req, res) => {
    const r = db.prepare('SELECT * FROM plugin_horas_registros WHERE usuario_id = ? AND inicio IS NOT NULL AND minutos IS NULL').get(req.usuario.id);
    if (!r) throw err('No hay ningún cronómetro en marcha.', 409);
    const min = Math.max(1, Math.round((Date.now() - new Date(r.inicio).getTime()) / 60000));
    db.prepare('UPDATE plugin_horas_registros SET minutos = ?, descripcion = ? WHERE id = ?').run(Math.min(min, 24 * 60), String(req.body?.descripcion ?? r.descripcion).slice(0, 1000), r.id);
    res.json({ id: r.id, minutos: min });
  }));
  router.post('/cronometro/descartar', envolver(async (req, res) => {
    db.prepare('DELETE FROM plugin_horas_registros WHERE usuario_id = ? AND inicio IS NOT NULL AND minutos IS NULL').run(req.usuario.id);
    res.json({ ok: true });
  }));

  // ---- Facturar: crea un borrador con los registros elegidos (todos del mismo cliente) ----
  router.post('/facturar', envolver(async (req, res) => {
    liberarHuerfanos();
    const ids = (Array.isArray(req.body?.registros) ? req.body.registros : []).map(Number).filter(Boolean);
    if (!ids.length) throw err('Elige los registros que quieres facturar.');
    const c = config();
    const regs = db.prepare(`${REG} WHERE r.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    if (regs.length !== ids.length || regs.some((r) => r.documento_id || !r.facturable || r.minutos == null)) throw err('Algún registro ya está facturado, no es facturable o tiene el cronómetro en marcha. Vuelve a cargar la lista.', 409);
    const clientes = new Set(regs.map((r) => r.cliente_id));
    if (clientes.size !== 1) throw err('Factura los registros de un cliente cada vez.');
    regs.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
    const fechaEs = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-ES');
    const horasTxt = (min) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
    let lineas;
    if (c.agrupar === 'proyecto') {
      const grupos = new Map();
      for (const r of regs) { const k = `${r.proyecto_id}|${tarifaDe(r, c)}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); }
      lineas = [...grupos.values()].map((g) => { const min = g.reduce((s, r) => s + redondear(r.minutos, c.redondeo), 0); return { descripcion: `${g[0].concepto || g[0].proyecto}: ${g.length} registro(s) del ${fechaEs(g[0].fecha)} al ${fechaEs(g[g.length - 1].fecha)} (${horasTxt(min)})`, cantidad: r2(min / 60), precio: Number(tarifaDe(g[0], c)), iva: c.iva, irpf: c.irpf }; });
    } else {
      lineas = regs.map((r) => { const min = redondear(r.minutos, c.redondeo); return { descripcion: [`${r.concepto || r.proyecto} · ${fechaEs(r.fecha)} (${horasTxt(min)})`, r.descripcion].filter(Boolean).join('\n'), cantidad: r2(min / 60), precio: Number(tarifaDe(r, c)), iva: c.iva, irpf: c.irpf }; });
    }
    const docId = await ctx.app.crearBorrador({ tipo: 'factura', cliente_id: regs[0].cliente_id, referencia: `Horas ${fechaEs(regs[0].fecha)} – ${fechaEs(regs[regs.length - 1].fecha)}`.slice(0, 100), lineas }, req.usuario.id);
    // Marcado atómico: solo los que siguen libres (si otro usuario se adelantó, se deshace)
    const marcados = db.prepare(`UPDATE plugin_horas_registros SET documento_id = ?, facturado = datetime('now') WHERE id IN (${ids.map(() => '?').join(',')}) AND documento_id IS NULL`).run(docId, ...ids).changes;
    if (marcados !== ids.length) {
      db.prepare('UPDATE plugin_horas_registros SET documento_id = NULL, facturado = NULL WHERE documento_id = ?').run(docId);
      db.prepare("DELETE FROM documentos WHERE id = ? AND estado = 'borrador'").run(docId);
      throw err('Otro usuario ha facturado alguno de estos registros a la vez. Vuelve a cargar la lista.', 409);
    }
    auditar(req, 'horas.facturar', `${ids.length} registro(s) → borrador ${docId}`);
    res.status(201).json({ documento_id: docId });
  }));

  // Recuperar registros de una factura rectificada (acción explícita y auditada)
  router.post('/recuperar', requiereAdmin, envolver(async (req, res) => {
    const docId = Number(req.body?.documento_id);
    const d = db.prepare('SELECT codigo, estado FROM documentos WHERE id = ?').get(docId);
    if (!d) { liberarHuerfanos(); return res.json({ ok: true }); }
    if (d.estado !== 'borrador' && !db.prepare('SELECT 1 FROM documentos WHERE rectifica_id = ? AND numero IS NOT NULL').get(docId)) throw err('Solo se pueden recuperar las horas de una factura rectificada (anulada con una rectificativa emitida).', 409);
    const n = db.prepare('UPDATE plugin_horas_registros SET documento_id = NULL, facturado = NULL WHERE documento_id = ?').run(docId).changes;
    auditar(req, 'horas.recuperar', `${n} registro(s) de ${d.codigo || `borrador ${docId}`} vuelven a pendientes`, 'aviso');
    res.json({ ok: true, recuperados: n });
  }));

  // ---- Informe por cliente y proyecto ----
  router.get('/informe', envolver(async (req, res) => {
    const w = ['r.minutos IS NOT NULL'], p = [];
    if (fechaOk(req.query.desde)) { w.push('r.fecha >= ?'); p.push(req.query.desde); }
    if (fechaOk(req.query.hasta)) { w.push('r.fecha <= ?'); p.push(req.query.hasta); }
    const c = config();
    const filas = db.prepare(`${REG} WHERE ${w.join(' AND ')}`).all(...p).map((r) => salida(r, c));
    const m = new Map();
    for (const r of filas) {
      const k = `${r.cliente_id}|${r.proyecto_id}`;
      if (!m.has(k)) m.set(k, { cliente: r.cliente, proyecto: r.proyecto, total: 0, facturable: 0, interno: 0, facturado: 0, pendiente: 0, importe_pendiente: 0 });
      const g = m.get(k);
      g.total += r.minutos; if (r.facturable) g.facturable += r.minutos; else g.interno += r.minutos;
      if (r.documento_id) g.facturado += r.minutos; else if (r.facturable) { g.pendiente += r.minutos; g.importe_pendiente += r.importe; }
    }
    res.json([...m.values()].map((g) => ({ ...g, importe_pendiente: r2(g.importe_pendiente) })).sort((a, b) => a.cliente.localeCompare(b.cliente) || a.proyecto.localeCompare(b.proyecto)));
  }));
}
