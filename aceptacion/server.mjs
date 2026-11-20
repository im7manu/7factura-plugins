// Plugin «Aceptación de presupuestos»: enlace privado y revocable para que el cliente acepte o rechace un presupuesto.
// - Token aleatorio de 32 bytes; en la base de datos se guarda su hash (para buscarlo) y el token cifrado (para volver a copiarlo).
// - La página pública solo puede ver el presupuesto de ese enlace: nunca otros documentos ni datos de la empresa.
// - Se registra la versión exacta: huella del contenido y copia del PDF que se aceptó o rechazó.
// - Aceptar marca el presupuesto como «aceptado» (estado que ya existe) y avisa, pero no emite ninguna factura.
// - Es una evidencia de la respuesta, no una firma electrónica avanzada ni cualificada.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const AJUSTE = 'plugin_aceptacion';
const DEFECTO = { caducidad_dias: 30, comentarios: true, pedir_nombre: true, pedir_email: false, avisar_correo: false, url_publica: '' };
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function register(ctx) {
  const { router, routerPublico, db, requiereAdmin, auditar } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS plugin_aceptacion_enlaces(
    id INTEGER PRIMARY KEY, documento_id INTEGER NOT NULL, hash TEXT NOT NULL UNIQUE, token TEXT NOT NULL, huella TEXT NOT NULL,
    creado TEXT NOT NULL DEFAULT (datetime('now')), creado_por INTEGER, caduca TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente',
    respuesta_nombre TEXT, respuesta_email TEXT, comentario TEXT, respondido TEXT, ip TEXT, navegador TEXT, pdf_sha TEXT, visto INTEGER DEFAULT 0, abierto TEXT
  ); CREATE INDEX IF NOT EXISTS idx_acep_doc ON plugin_aceptacion_enlaces(documento_id)`);
  const dirPdf = path.join(ctx.dataDir, 'respuestas');
  fs.mkdirSync(dirPdf, { recursive: true });

  const config = () => ({ ...DEFECTO, ...(ctx.getAjuste(AJUSTE, {}) || {}) });
  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { const st = e.status || 500; if (st === 500) console.error('[aceptacion]', e); res.status(st).json({ error: st === 500 ? 'Error interno' : e.message }); }
  };
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const ahora = () => new Date().toISOString();

  /** Huella del contenido del presupuesto: cambia si cambia cualquier dato que el cliente ve. */
  const huella = (d) => sha(JSON.stringify({ codigo: d.codigo, fecha: d.fecha, cliente: d.cliente_id, total: d.total, obs: d.observaciones || '', lineas: (d.lineas || []).map((l) => [l.descripcion, l.cantidad, l.precio, l.dto, l.iva, l.irpf, l.recargo]) }));
  const caducado = (e) => e.caduca < ahora();
  function estadoEnlace(e, d) {
    if (e.estado !== 'pendiente') return e.estado;
    if (caducado(e)) return 'caducado';
    if (!d || huella(d) !== e.huella) return 'modificado';
    if (!['emitido'].includes(d.estado)) return 'no_disponible';
    return 'pendiente';
  }
  const urlBase = (req) => (config().url_publica || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const urlDe = (req, token) => `${urlBase(req)}/pub/aceptacion/#${token}`;
  const publico = (e, req) => ({ id: e.id, creado: e.creado, caduca: e.caduca, estado: e.estado, respuesta_nombre: e.respuesta_nombre, respuesta_email: e.respuesta_email, comentario: e.comentario, respondido: e.respondido, abierto: e.abierto,
    url: e.estado === 'pendiente' ? urlDe(req, ctx.descifrar(e.token)) : null });

  // Acción en los presupuestos emitidos
  ctx.extender('documento.acciones', (doc) => (doc.tipo === 'presupuesto' && doc.estado !== 'borrador' ? [{ titulo: 'Enlace de aceptación', ruta: 'ui/enlace.html' }] : []));
  // Aviso cuando un cliente responde
  ctx.extender('avisos', () => db.prepare(`SELECT e.estado, d.codigo, json_extract(d.cliente, '$.nombre') AS cliente, e.documento_id FROM plugin_aceptacion_enlaces e JOIN documentos d ON d.id = e.documento_id
    WHERE e.estado IN ('aceptado', 'rechazado') AND e.visto = 0 ORDER BY e.respondido DESC LIMIT 10`).all()
    .map((x) => ({ titulo: `Presupuesto ${x.codigo} ${x.estado}`, detalle: `${x.cliente || ''} ha respondido al enlace de aceptación.`, enlace: `/presupuestos/${x.documento_id}` })));

  // ---- Interno (con sesión) ----
  router.get('/config', (_req, res) => res.json(config()));
  router.put('/config', requiereAdmin, envolver(async (req, res) => {
    const b = req.body || {};
    const url = String(b.url_publica || '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(url)) throw err('La dirección pública no es válida.');
    ctx.setAjuste(AJUSTE, { caducidad_dias: Math.max(1, Math.min(365, Number(b.caducidad_dias) || 30)), comentarios: !!b.comentarios, pedir_nombre: !!b.pedir_nombre, pedir_email: !!b.pedir_email, avisar_correo: !!b.avisar_correo, url_publica: url });
    auditar(req, 'aceptacion.config', '');
    res.json({ ok: true });
  }));
  router.get('/documentos/:id', envolver(async (req, res) => {
    const d = await ctx.app.cargarDocumento(Number(req.params.id));
    if (!d || d.tipo !== 'presupuesto') throw err('Presupuesto no encontrado', 404);
    db.prepare("UPDATE plugin_aceptacion_enlaces SET visto = 1 WHERE documento_id = ? AND estado IN ('aceptado','rechazado')").run(d.id);
    const enlaces = db.prepare('SELECT * FROM plugin_aceptacion_enlaces WHERE documento_id = ? ORDER BY id DESC').all(d.id)
      .map((e) => ({ ...publico(e, req), estado: estadoEnlace(e, d) }));
    const email = d.cliente_id ? db.prepare('SELECT email FROM clientes WHERE id = ?').get(d.cliente_id)?.email : '';
    res.json({ codigo: d.codigo, estado: d.estado, cliente: d.cliente?.nombre || '', email: email || d.cliente?.email || '', total: d.total, enlaces, config: config() });
  }));
  router.post('/documentos/:id/enlace', envolver(async (req, res) => {
    const d = await ctx.app.cargarDocumento(Number(req.params.id));
    if (!d || d.tipo !== 'presupuesto') throw err('Presupuesto no encontrado', 404);
    if (d.estado !== 'emitido') throw err(d.estado === 'borrador' ? 'Emite el presupuesto antes de generar el enlace.' : `El presupuesto está ${d.estado}: no admite respuestas.`, 409);
    // Un enlace nuevo revoca los anteriores pendientes
    db.prepare("UPDATE plugin_aceptacion_enlaces SET estado = 'revocado' WHERE documento_id = ? AND estado = 'pendiente'").run(d.id);
    const token = crypto.randomBytes(32).toString('base64url');
    const dias = Math.max(1, Math.min(365, Number(req.body?.dias) || config().caducidad_dias));
    const caduca = new Date(Date.now() + dias * 864e5).toISOString();
    db.prepare('INSERT INTO plugin_aceptacion_enlaces(documento_id, hash, token, huella, creado_por, caduca) VALUES (?,?,?,?,?,?)').run(d.id, sha(token), ctx.cifrar(token), huella(d), req.usuario.id, caduca);
    auditar(req, 'aceptacion.enlace', `${d.codigo} (caduca ${caduca.slice(0, 10)})`);
    res.status(201).json({ url: urlDe(req, token), caduca });
  }));
  router.post('/enlaces/:id/revocar', envolver(async (req, res) => {
    const r = db.prepare("UPDATE plugin_aceptacion_enlaces SET estado = 'revocado' WHERE id = ? AND estado = 'pendiente'").run(Number(req.params.id));
    if (!r.changes) throw err('El enlace ya no está pendiente.', 409);
    auditar(req, 'aceptacion.revocar', `enlace ${req.params.id}`, 'aviso');
    res.json({ ok: true });
  }));
  router.post('/enlaces/:id/enviar', envolver(async (req, res) => {
    const e = db.prepare("SELECT * FROM plugin_aceptacion_enlaces WHERE id = ? AND estado = 'pendiente'").get(Number(req.params.id));
    if (!e) throw err('El enlace ya no está pendiente.', 409);
    const para = String(req.body?.para || '').trim();
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(para)) throw err('Indica un correo válido.');
    const texto = String(req.body?.texto || '').replace('{enlace}', urlDe(req, ctx.descifrar(e.token))).slice(0, 10000);
    await ctx.app.enviarCorreo(req.usuario.id, { para: [para], asunto: String(req.body?.asunto || 'Presupuesto').slice(0, 250), texto, documentoId: e.documento_id });
    auditar(req, 'aceptacion.enviar', `enlace ${e.id} → ${para}`);
    res.json({ ok: true });
  }));
  router.get('/respuestas/:id.pdf', envolver(async (req, res) => {
    const e = db.prepare('SELECT * FROM plugin_aceptacion_enlaces WHERE id = ?').get(Number(req.params.id));
    const f = e && path.join(dirPdf, `${e.id}.pdf`);
    if (!f || !fs.existsSync(f)) throw err('No hay PDF guardado para esta respuesta.', 404);
    res.setHeader('Content-Type', 'application/pdf'); res.send(fs.readFileSync(f));
  }));
  router.get('/historial', (req, res) => res.json(db.prepare(`SELECT e.*, d.codigo, d.estado AS estado_doc, json_extract(d.cliente, '$.nombre') AS cliente FROM plugin_aceptacion_enlaces e
    LEFT JOIN documentos d ON d.id = e.documento_id ORDER BY e.id DESC LIMIT 200`).all().map((e) => ({ id: e.id, documento_id: e.documento_id, codigo: e.codigo, cliente: e.cliente, creado: e.creado, caduca: e.caduca, estado: e.estado === 'pendiente' && caducado(e) ? 'caducado' : e.estado, respondido: e.respondido, respuesta_nombre: e.respuesta_nombre, comentario: e.comentario, abierto: e.abierto }))));

  // ---- Público (sin sesión): solo el presupuesto del enlace ----
  async function porToken(token) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(token || ''))) throw err('Enlace no válido.', 404);
    const e = db.prepare('SELECT * FROM plugin_aceptacion_enlaces WHERE hash = ?').get(sha(token));
    if (!e) throw err('Enlace no válido.', 404);
    const d = await ctx.app.cargarDocumento(e.documento_id);
    return { e, d };
  }
  routerPublico.get('/presupuesto/:token', envolver(async (req, res) => {
    const { e, d } = await porToken(req.params.token);
    const estado = estadoEnlace(e, d);
    if (!e.abierto && estado === 'pendiente') db.prepare('UPDATE plugin_aceptacion_enlaces SET abierto = ? WHERE id = ?').run(ahora(), e.id);
    const emp = ctx.getAjuste('empresa', {}) || {};
    const c = config();
    if (['revocado', 'caducado', 'modificado', 'no_disponible'].includes(estado)) return res.json({ estado, empresa: emp.razon_social || '' });
    res.json({
      estado, empresa: emp.razon_social || '', caduca: e.caduca, respondido: e.respondido, respuesta_nombre: e.respuesta_nombre, comentario: e.comentario,
      pide: { nombre: c.pedir_nombre, email: c.pedir_email, comentarios: c.comentarios },
      presupuesto: { codigo: d.codigo, fecha: d.fecha, cliente: d.cliente?.nombre || '', observaciones: d.observaciones || '', base: d.base ?? d.totales?.base, total: d.total,
        lineas: d.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, dto: l.dto, iva: l.iva })) },
    });
  }));
  routerPublico.get('/presupuesto/:token/pdf', envolver(async (req, res) => {
    const { e, d } = await porToken(req.params.token);
    if (['revocado', 'caducado', 'modificado', 'no_disponible'].includes(estadoEnlace(e, d))) throw err('Este enlace ya no está disponible.', 410);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="presupuesto-${String(d.codigo).replace(/[^\w.-]+/g, '-')}.pdf"`);
    res.send(await ctx.app.pdfDocumento(d.id));
  }));
  routerPublico.post('/presupuesto/:token/responder', envolver(async (req, res) => {
    const { e, d } = await porToken(req.params.token);
    const estado = estadoEnlace(e, d);
    if (estado !== 'pendiente') throw err(estado === 'aceptado' || estado === 'rechazado' ? 'Este presupuesto ya se respondió.' : 'Este enlace ya no está disponible.', 409);
    const c = config(), b = req.body || {};
    const accion = b.accion === 'aceptar' ? 'aceptado' : b.accion === 'rechazar' ? 'rechazado' : null;
    if (!accion) throw err('Elige aceptar o rechazar.');
    const nombre = String(b.nombre || '').trim().slice(0, 120), email = String(b.email || '').trim().slice(0, 150);
    if (c.pedir_nombre && !nombre) throw err('Escribe tu nombre.');
    if (c.pedir_email && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) throw err('Escribe un correo válido.');
    // Versión exacta: PDF en este momento, guardado con su huella
    const pdf = await ctx.app.pdfDocumento(d.id);
    fs.writeFileSync(path.join(dirPdf, `${e.id}.pdf`), pdf);
    const r = db.prepare(`UPDATE plugin_aceptacion_enlaces SET estado = ?, respuesta_nombre = ?, respuesta_email = ?, comentario = ?, respondido = ?, ip = ?, navegador = ?, pdf_sha = ? WHERE id = ? AND estado = 'pendiente'`)
      .run(accion, nombre, email, c.comentarios ? String(b.comentario || '').slice(0, 2000) : '', ahora(), String(req.ip || '').slice(0, 60), String(req.get('user-agent') || '').slice(0, 300), sha(pdf), e.id);
    if (!r.changes) throw err('Este presupuesto ya se respondió.', 409);
    db.prepare("UPDATE documentos SET estado = ?, actualizado = datetime('now') WHERE id = ? AND estado = 'emitido'").run(accion, d.id);
    auditar({ ip: req.ip, usuario: { usuario: `cliente${nombre ? `: ${nombre}` : ''}` } }, `presupuesto.${accion}`, `${d.codigo} por enlace de aceptación`, 'aviso');
    ctx.hooks.emit('presupuesto.respondido', { documento: d, respuesta: accion, nombre, email });
    if (c.avisar_correo && e.creado_por) {
      const u = db.prepare('SELECT email FROM cuentas_correo WHERE usuario_id = ?').get(e.creado_por);
      if (u?.email) ctx.app.enviarCorreo(e.creado_por, { para: [u.email], asunto: `Presupuesto ${d.codigo} ${accion}`, texto: `${d.cliente?.nombre || 'El cliente'} ha ${accion === 'aceptado' ? 'ACEPTADO' : 'RECHAZADO'} el presupuesto ${d.codigo}${nombre ? ` (respondió ${nombre}${email ? `, ${email}` : ''})` : ''}.${b.comentario ? `\n\nComentario:\n${b.comentario}` : ''}\n\nSi lo ha aceptado, puedes convertirlo en pedido o factura desde Facturador.` }).catch((x) => console.error('[aceptacion] aviso por correo:', x.message));
    }
    res.json({ ok: true, estado: accion });
  }));
}
