// Plugin «WhatsApp Web» para 7Factura: envía el PDF real de un documento al WhatsApp del cliente o proveedor desde
// el número de la empresa vinculado como WhatsApp Web. Sesión propia en la carpeta del plugin, independiente del
// WhatsApp de recuperación de contraseñas de 7Factura.
import fs from 'node:fs';
import { crearWhatsApp, normalizarTelefono, rellenar } from './lib/whatsapp.mjs';

const AJUSTE = 'plugin_whatsapp';
const NOMBRES = { factura: 'factura', presupuesto: 'presupuesto', proforma: 'factura proforma', pedido: 'pedido', albaran: 'albarán',
  presupuesto_compra: 'solicitud de presupuesto', pedido_compra: 'pedido', albaran_compra: 'albarán', factura_compra: 'factura', gasto: 'justificante' };
const PLANTILLA = 'Hola {cliente}, te enviamos {el_documento} {numero} del {fecha}{importe}. Cualquier duda, responde a este mensaje.\n{empresa}';
const PLANTILLAS_DEFECTO = {
  factura: 'Hola {cliente}, te enviamos la factura {numero} del {fecha} por {total}{vencimiento_txt}. Gracias.\n{empresa}',
  rectificativa: 'Hola {cliente}, te enviamos la factura rectificativa {numero} del {fecha} por {total}.\n{empresa}',
  presupuesto: 'Hola {cliente}, te enviamos el presupuesto {numero} por {total}. Quedamos a tu disposición para cualquier duda.\n{empresa}',
};

export function register(ctx) {
  const { router, db, requiereAdmin, auditar } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS plugin_whatsapp_envios(
    id INTEGER PRIMARY KEY, documento_id INTEGER NOT NULL, codigo TEXT, telefono TEXT NOT NULL, destinatario TEXT DEFAULT '',
    texto TEXT, archivo TEXT, usuario TEXT, fecha TEXT NOT NULL DEFAULT (datetime('now')), estado TEXT NOT NULL, error TEXT, mensaje_id TEXT
  ); CREATE INDEX IF NOT EXISTS idx_pwa_doc ON plugin_whatsapp_envios(documento_id)`);

  const wa = crearWhatsApp({ carpeta: ctx.dataDir, nombreDispositivo: '7Factura' });
  wa.arrancar();
  ctx.alParar(() => wa.parar());

  const config = () => {
    const c = ctx.getAjuste(AJUSTE, {}) || {};
    return { proponer_al_emitir: !!c.proponer_al_emitir, plantillas: { ...PLANTILLAS_DEFECTO, ...(c.plantillas || {}) } };
  };
  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { const st = e.status || 500; if (st === 500) console.error('[whatsapp]', e); res.status(st).json({ error: st === 500 ? 'Error interno' : e.message }); }
  };
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const eur = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const fechaEs = (f) => (f ? new Date(`${f}T00:00:00`).toLocaleDateString('es-ES') : '');

  // Acción en los documentos emitidos (y propuesta al emitir, si está activada)
  ctx.extender('documento.acciones', (doc, { evento }) => {
    if (doc.estado === 'borrador') return [];
    return [{ titulo: 'Enviar por WhatsApp', ruta: 'ui/enviar.html', proponer: evento === 'emitido' && config().proponer_al_emitir }];
  });

  // ---- Conexión ----
  router.get('/estado', envolver(async (req, res) => {
    const s = wa.estado();
    const out = { estado: s.estado, numero: s.numero, nombre: s.nombre, error: s.error, desde: s.desde };
    if (req.usuario.rol === 'admin' && s.qr) out.qr = await (await import('qrcode')).default.toString(s.qr, { type: 'svg', margin: 1, width: 260 });
    res.json(out);
  }));
  router.post('/vincular', requiereAdmin, envolver(async (req, res) => { await wa.conectar(); auditar(req, 'whatsapp.vincular', '', 'aviso'); res.json({ ok: true }); }));
  router.post('/desconectar', requiereAdmin, envolver(async (req, res) => { await wa.desconectar(); auditar(req, 'whatsapp.desconectar', '', 'aviso'); res.json({ ok: true }); }));
  router.get('/config', (_req, res) => res.json({ ...config(), defecto: PLANTILLA, nombres: NOMBRES, plantillas_defecto: PLANTILLAS_DEFECTO }));
  router.put('/config', requiereAdmin, envolver(async (req, res) => {
    const b = req.body || {};
    const plantillas = {};
    for (const [k, v] of Object.entries(b.plantillas || {})) if ((NOMBRES[k] || k === 'rectificativa') && String(v || '').trim()) plantillas[k] = String(v).trim().slice(0, 2000);
    ctx.setAjuste(AJUSTE, { proponer_al_emitir: !!b.proponer_al_emitir, plantillas });
    auditar(req, 'whatsapp.config', '');
    res.json({ ok: true });
  }));
  router.get('/historial', envolver(async (_req, res) => {
    res.json(db.prepare(`SELECT w.*, d.tipo FROM plugin_whatsapp_envios w LEFT JOIN documentos d ON d.id = w.documento_id ORDER BY w.id DESC LIMIT 200`).all());
  }));

  // ---- Envío ----
  async function preparar(id) {
    const d = await ctx.app.cargarDocumento(id);
    if (!d) throw err('Documento no encontrado', 404);
    const tabla = d.proveedor_id ? 'proveedores' : 'clientes';
    const terceroId = d.proveedor_id || d.cliente_id;
    const t = terceroId ? db.prepare(`SELECT nombre, telefono FROM ${tabla} WHERE id = ?`).get(terceroId) : null;
    const empresa = ctx.getAjuste('empresa', {}) || {};
    const clave = d.rectifica_id ? 'rectificativa' : d.tipo;
    const pendienteVenc = (d.recibos || []).find((r) => Math.abs(r.pendiente ?? r.importe) > 0.005);
    const vars = {
      cliente: t?.nombre || d.cliente?.nombre || '', empresa: empresa.razon_social || '', numero: d.codigo || '', fecha: fechaEs(d.fecha),
      total: eur(d.total), vencimiento: fechaEs(pendienteVenc?.vencimiento || d.vencimiento), tipo: NOMBRES[d.tipo] || d.tipo,
      el_documento: `${['factura', 'proforma', 'factura_compra'].includes(d.tipo) ? 'la' : 'el'} ${d.rectifica_id ? 'factura rectificativa' : NOMBRES[d.tipo] || d.tipo}`,
    };
    vars.importe = d.total ? ` por ${vars.total}` : '';
    vars.vencimiento_txt = vars.vencimiento ? `, con vencimiento el ${vars.vencimiento}` : '';
    const plantilla = config().plantillas[clave] || PLANTILLA;
    return { d, t, vars, plantilla, archivo: `${(d.codigo || `borrador-${d.id}`).replace(/[^\w.-]+/g, '-')}.pdf` };
  }

  router.get('/envios/:id', envolver(async (req, res) => {
    const { d, t, vars, plantilla, archivo } = await preparar(Number(req.params.id));
    res.json({
      codigo: d.codigo, tipo: vars.tipo, archivo, borrador: d.estado === 'borrador', conexion: wa.estado().estado,
      destinatario: { nombre: vars.cliente, telefono: t?.telefono || d.cliente?.telefono || '' }, texto: rellenar(plantilla, vars),
      historial: db.prepare('SELECT id, telefono, destinatario, usuario, fecha, estado, error FROM plugin_whatsapp_envios WHERE documento_id = ? ORDER BY id DESC LIMIT 20').all(d.id),
    });
  }));

  router.post('/envios/:id', envolver(async (req, res) => {
    const { d, vars, archivo } = await preparar(Number(req.params.id));
    if (d.estado === 'borrador') throw err('Emite el documento antes de enviarlo.', 409);
    const telefono = normalizarTelefono(req.body?.telefono);
    if (!telefono) throw err('Indica un teléfono válido (con prefijo si no es español).');
    const texto = String(req.body?.texto ?? '').slice(0, 3000);
    const buffer = await ctx.app.pdfDocumento(d.id, d.tipo === 'albaran' && d.valorado ? { valorar: true } : {});
    const reg = Number(db.prepare('INSERT INTO plugin_whatsapp_envios(documento_id, codigo, telefono, destinatario, texto, archivo, usuario, estado) VALUES (?,?,?,?,?,?,?,?)')
      .run(d.id, d.codigo, telefono, String(req.body?.destinatario || vars.cliente).slice(0, 150), texto, archivo, req.usuario.usuario, 'pendiente').lastInsertRowid);
    try {
      const r = await wa.enviarDocumento(telefono, { buffer, nombre: archivo, texto }, (estado) => db.prepare('UPDATE plugin_whatsapp_envios SET estado = ? WHERE id = ?').run(estado, reg));
      db.prepare('UPDATE plugin_whatsapp_envios SET estado = ?, mensaje_id = ? WHERE id = ?').run('enviado', r.id, reg);
      auditar(req, 'whatsapp.enviar', `${d.codigo} → +${telefono}`);
      res.json({ ok: true, estado: 'enviado' });
    } catch (e) {
      db.prepare('UPDATE plugin_whatsapp_envios SET estado = ?, error = ? WHERE id = ?').run(wa.estado().estado === 'conectado' ? 'error' : 'sesion_desconectada', String(e.message).slice(0, 300), reg);
      throw err(e.message, e.status || 502);
    }
  }));
}
