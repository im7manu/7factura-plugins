// Plugin «Recordatorios de cobro»: envía avisos por correo a los clientes según el vencimiento de sus recibos.
// - Usa la cuenta de correo ya conectada en Facturador por el usuario que se elija (Ajustes › Correo).
// - Por defecto está en modo de prueba: calcula y previsualiza, pero no envía hasta que un administrador lo activa.
// - Nunca envía dos veces la misma fase del mismo recibo, ni avisa de recibos cobrados, rectificados o sin correo válido.
// - No añade recargos, intereses ni amenazas: solo informa del importe pendiente.
const AJUSTE = 'plugin_recordatorios';
const DEFECTO = {
  envio_real: false, usuario_id: null,
  antes: { activo: true, dias: 3 }, dia: { activo: true }, despues: { activo: true, dias: [7, 15, 30] },
  adjuntar: 'primero', // siempre | primero | nunca
  horario: { desde: 9, hasta: 19, laborables: true },
  excluir_clientes: [], excluir_documentos: [], pausas: {}, // pausas: { cliente_id: 'AAAA-MM-DD' }
  plantillas: {
    antes: { asunto: 'Recordatorio: la factura {numero} vence el {vencimiento}', cuerpo: 'Hola {cliente}:\n\nTe recordamos que la factura {numero} del {fecha} vence el {vencimiento}. Importe pendiente: {pendiente}.\n\n{datos_pago}\n\nSi ya la has pagado, ignora este mensaje.\n\nUn saludo,\n{empresa}\n{contacto}' },
    dia: { asunto: 'La factura {numero} vence hoy', cuerpo: 'Hola {cliente}:\n\nTe recordamos que hoy, {vencimiento}, vence la factura {numero} del {fecha}. Importe pendiente: {pendiente}.\n\n{datos_pago}\n\nSi ya la has pagado, ignora este mensaje.\n\nUn saludo,\n{empresa}\n{contacto}' },
    despues: { asunto: 'Factura {numero} pendiente de pago', cuerpo: 'Hola {cliente}:\n\nSegún nuestros registros, la factura {numero} del {fecha}, que vencía el {vencimiento}, tiene pendiente {pendiente}.\n\n{datos_pago}\n\nSi ya la has pagado, por favor, ignora este mensaje o indícanos la fecha del pago para comprobarlo.\n\nUn saludo,\n{empresa}\n{contacto}' },
  },
};
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const hoyISO = (d = new Date()) => d.toLocaleDateString('sv-SE');
const sumar = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return hoyISO(d); };
const eur = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const fechaEs = (f) => (f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-ES') : '');

export function register(ctx) {
  const { router, db, requiereAdmin, auditar } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS plugin_recordatorios_envios(
    id INTEGER PRIMARY KEY, recibo_id INTEGER NOT NULL, documento_id INTEGER NOT NULL, fase TEXT NOT NULL, para TEXT, asunto TEXT,
    pendiente REAL, estado TEXT NOT NULL, error TEXT, fecha TEXT NOT NULL DEFAULT (datetime('now')), usuario TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_rec_unico ON plugin_recordatorios_envios(recibo_id, fase) WHERE estado = 'enviado';`);

  const config = () => {
    const c = ctx.getAjuste(AJUSTE, {}) || {};
    return { ...DEFECTO, ...c, antes: { ...DEFECTO.antes, ...c.antes }, dia: { ...DEFECTO.dia, ...c.dia }, despues: { ...DEFECTO.despues, ...c.despues },
      horario: { ...DEFECTO.horario, ...c.horario }, plantillas: { antes: { ...DEFECTO.plantillas.antes, ...c.plantillas?.antes }, dia: { ...DEFECTO.plantillas.dia, ...c.plantillas?.dia }, despues: { ...DEFECTO.plantillas.despues, ...c.plantillas?.despues } } };
  };
  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { const st = e.status || 500; if (st === 500) console.error('[recordatorios]', e); res.status(st).json({ error: st === 500 ? 'Error interno' : e.message }); }
  };
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });

  /** Recibos de facturas de venta con importe pendiente (sin rectificar), con los datos para el aviso. */
  function recibosPendientes() {
    return db.prepare(`SELECT r.id AS recibo_id, r.numero AS recibo_num, r.vencimiento, r.importe, d.id AS documento_id, d.codigo, d.fecha, d.cliente_id,
        json_extract(d.cliente, '$.nombre') AS cliente_nombre, json_extract(d.cliente, '$.email') AS email_snap, c.email AS email_ficha, c.nombre AS cliente_ficha,
        (SELECT COUNT(*) FROM recibos x WHERE x.documento_id = d.id) AS num_recibos,
        ROUND(r.importe - COALESCE((SELECT SUM(importe) FROM cobros WHERE recibo_id = r.id), 0), 2) AS pendiente
      FROM recibos r JOIN documentos d ON d.id = r.documento_id LEFT JOIN clientes c ON c.id = d.cliente_id
      WHERE d.tipo = 'factura' AND d.numero IS NOT NULL AND d.rectifica_id IS NULL AND r.importe > 0
        AND NOT EXISTS (SELECT 1 FROM documentos rc WHERE rc.rectifica_id = d.id AND rc.numero IS NOT NULL)
        AND ROUND(r.importe - COALESCE((SELECT SUM(importe) FROM cobros WHERE recibo_id = r.id), 0), 2) > 0.005
      ORDER BY r.vencimiento`).all();
  }

  /** Fase que toca hoy a un recibo (o null). Tras un apagado solo se envía la fase más reciente que corresponda. */
  function faseDe(r, c, hoy) {
    const enviadas = new Set(db.prepare("SELECT fase FROM plugin_recordatorios_envios WHERE recibo_id = ? AND estado = 'enviado'").all(r.recibo_id).map((x) => x.fase));
    const v = r.vencimiento;
    if (hoy > v) {
      if (!c.despues.activo) return null;
      const dias = [...c.despues.dias].map(Number).filter((n) => n > 0).sort((a, b) => b - a);
      const n = dias.find((d) => sumar(v, d) <= hoy);
      if (n == null) return null;
      const fase = `despues-${n}`;
      // si ya se envió esta fase o una posterior, no hay nada que enviar
      if (dias.filter((d) => d >= n).some((d) => enviadas.has(`despues-${d}`))) return null;
      return fase;
    }
    if (hoy === v) return c.dia.activo && !enviadas.has('dia') ? 'dia' : null;
    if (c.antes.activo && Number(c.antes.dias) > 0 && sumar(v, -Number(c.antes.dias)) <= hoy && !enviadas.has('antes')) return 'antes';
    return null;
  }

  function motivoExclusion(r, c, hoy) {
    if (c.excluir_documentos.map(Number).includes(r.documento_id)) return 'Factura excluida';
    if (c.excluir_clientes.map(Number).includes(r.cliente_id)) return 'Cliente excluido';
    const p = c.pausas?.[r.cliente_id];
    if (p && p >= hoy) return `Avisos del cliente en pausa hasta el ${fechaEs(p)}`;
    const email = (r.email_ficha || r.email_snap || '').trim();
    if (!EMAIL.test(email)) return 'El cliente no tiene un correo válido';
    return null;
  }

  function componer(r, fase, c) {
    const emp = ctx.getAjuste('empresa', {}) || {};
    const tipo = fase.startsWith('despues') ? 'despues' : fase;
    const vars = {
      cliente: r.cliente_ficha || r.cliente_nombre || '', numero: r.codigo, fecha: fechaEs(r.fecha), vencimiento: fechaEs(r.vencimiento),
      pendiente: eur(r.pendiente), importe: eur(r.importe), empresa: emp.razon_social || '',
      recibo: r.num_recibos > 1 ? `${r.recibo_num} de ${r.num_recibos}` : '',
      contacto: [emp.telefono, emp.email].filter(Boolean).join(' · '),
      datos_pago: emp.iban ? `Puedes pagarla por transferencia a la cuenta ${emp.iban.replace(/(.{4})/g, '$1 ').trim()}, indicando la referencia ${r.codigo}.` : '',
    };
    const rel = (t) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '').replace(/\n{3,}/g, '\n\n').trim();
    return { asunto: rel(c.plantillas[tipo].asunto), texto: rel(c.plantillas[tipo].cuerpo), para: (r.email_ficha || r.email_snap || '').trim() };
  }

  /** Lo que se enviaría hoy (o en los próximos días) con la configuración actual. */
  function plan(dias = 0) {
    const c = config(), lista = [], h = hoyISO();
    const recibos = recibosPendientes();
    for (let i = 0; i <= dias; i++) {
      const dia = sumar(h, i);
      for (const r of recibos) {
        const fase = faseDe(r, c, dia);
        if (!fase) continue;
        if (i > 0 && lista.some((x) => x.recibo_id === r.recibo_id)) continue;
        const m = componer(r, fase, c);
        lista.push({ dia, recibo_id: r.recibo_id, documento_id: r.documento_id, codigo: r.codigo, cliente: r.cliente_ficha || r.cliente_nombre, vencimiento: r.vencimiento,
          pendiente: r.pendiente, fase, excluido: motivoExclusion(r, c, dia), ...m });
      }
    }
    return lista;
  }

  async function enviarUno(item, c, usuario = 'automático') {
    const r = recibosPendientes().find((x) => x.recibo_id === item.recibo_id);
    if (!r) return { estado: 'omitido', error: 'El recibo ya no tiene importe pendiente' };
    const yaPrimero = db.prepare("SELECT 1 FROM plugin_recordatorios_envios WHERE documento_id = ? AND estado = 'enviado' LIMIT 1").get(r.documento_id);
    const adjuntar = c.adjuntar === 'siempre' || (c.adjuntar === 'primero' && !yaPrimero);
    const m = componer(r, item.fase, c);
    const ins = db.prepare('INSERT INTO plugin_recordatorios_envios(recibo_id, documento_id, fase, para, asunto, pendiente, estado, error, usuario) VALUES (?,?,?,?,?,?,?,?,?)');
    try {
      if (!c.usuario_id) throw new Error('Elige qué cuenta de correo envía los recordatorios (pestaña Configuración).');
      const adjuntos = adjuntar ? [{ filename: `${r.codigo.replace(/[^\w.-]+/g, '-')}.pdf`, content: await ctx.app.pdfDocumento(r.documento_id), contentType: 'application/pdf' }] : [];
      await ctx.app.enviarCorreo(c.usuario_id, { para: [m.para], asunto: m.asunto, texto: m.texto, adjuntos, documentoId: r.documento_id });
      ins.run(r.recibo_id, r.documento_id, item.fase, m.para, m.asunto, r.pendiente, 'enviado', null, usuario);
      return { estado: 'enviado' };
    } catch (e) {
      ins.run(r.recibo_id, r.documento_id, item.fase, m.para, m.asunto, r.pendiente, 'error', String(e.message).slice(0, 300), usuario);
      return { estado: 'error', error: e.message };
    }
  }

  // ---- Tarea automática ----
  let ocupado = false;
  async function revisar() {
    const c = config();
    if (!c.envio_real || ocupado) return;
    const ahora = new Date(), h = ahora.getHours(), dsem = ahora.getDay();
    if (h < c.horario.desde || h >= c.horario.hasta || (c.horario.laborables && (dsem === 0 || dsem === 6))) return;
    ocupado = true;
    try {
      for (const item of plan(0).filter((x) => !x.excluido)) {
        // si ya falló hoy esta fase, no se insiste hasta mañana
        if (db.prepare("SELECT 1 FROM plugin_recordatorios_envios WHERE recibo_id = ? AND fase = ? AND estado = 'error' AND date(fecha) = date('now')").get(item.recibo_id, item.fase)) continue;
        await enviarUno(item, c);
      }
    } finally { ocupado = false; }
  }
  ctx.cada(15 * 60_000, revisar);
  setTimeout(() => revisar().catch((e) => console.error('[recordatorios]', e)), 60_000).unref();

  // ---- API ----
  router.get('/config', (_req, res) => {
    const usuarios = db.prepare(`SELECT u.id, u.nombre, u.usuario, c.email, c.proveedor FROM usuarios u LEFT JOIN cuentas_correo c ON c.usuario_id = u.id WHERE u.activo = 1 ORDER BY u.nombre`).all();
    res.json({ ...config(), usuarios, defecto: DEFECTO.plantillas });
  });
  router.put('/config', requiereAdmin, envolver(async (req, res) => {
    const b = req.body || {}, n = (v, d, max) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x) : d; };
    const c = {
      envio_real: !!b.envio_real, usuario_id: b.usuario_id ? Number(b.usuario_id) : null,
      antes: { activo: !!b.antes?.activo, dias: n(b.antes?.dias, 3, 60) || 3 }, dia: { activo: !!b.dia?.activo },
      despues: { activo: !!b.despues?.activo, dias: [...new Set((Array.isArray(b.despues?.dias) ? b.despues.dias : String(b.despues?.dias || '').split(/[,; ]+/)).map((x) => n(x, 0, 365)).filter((x) => x > 0))].sort((a, z) => a - z).slice(0, 6) },
      adjuntar: ['siempre', 'primero', 'nunca'].includes(b.adjuntar) ? b.adjuntar : 'primero',
      horario: { desde: n(b.horario?.desde, 9, 23), hasta: n(b.horario?.hasta, 19, 24), laborables: !!b.horario?.laborables },
      excluir_clientes: (b.excluir_clientes || []).map(Number).filter(Boolean), excluir_documentos: (b.excluir_documentos || []).map(Number).filter(Boolean),
      pausas: Object.fromEntries(Object.entries(b.pausas || {}).filter(([k, v]) => Number(k) && /^\d{4}-\d{2}-\d{2}$/.test(v))),
      plantillas: Object.fromEntries(['antes', 'dia', 'despues'].map((f) => [f, { asunto: String(b.plantillas?.[f]?.asunto || DEFECTO.plantillas[f].asunto).slice(0, 250), cuerpo: String(b.plantillas?.[f]?.cuerpo || DEFECTO.plantillas[f].cuerpo).slice(0, 5000) }])),
    };
    if (c.envio_real && !c.usuario_id) throw err('Elige la cuenta de correo que enviará los recordatorios antes de activar el envío.');
    if (c.horario.hasta <= c.horario.desde) throw err('El horario de envío no es válido.');
    const antes = config().envio_real;
    ctx.setAjuste(AJUSTE, c);
    auditar(req, 'recordatorios.config', c.envio_real !== antes ? `Envío automático ${c.envio_real ? 'ACTIVADO' : 'desactivado'}` : 'Configuración cambiada', c.envio_real !== antes ? 'aviso' : 'info');
    res.json({ ok: true });
  }));
  router.get('/plan', envolver(async (req, res) => res.json(plan(Math.min(30, Math.max(0, Number(req.query.dias) || 0))))));
  router.get('/registro', envolver(async (_req, res) => res.json(db.prepare(`SELECT e.*, d.codigo FROM plugin_recordatorios_envios e LEFT JOIN documentos d ON d.id = e.documento_id ORDER BY e.id DESC LIMIT 300`).all())));
  router.get('/clientes', envolver(async (_req, res) => res.json(db.prepare('SELECT id, nombre, nif, email FROM clientes ORDER BY nombre COLLATE NOCASE').all())));

  // Envío manual de un aviso concreto (desde «Pendientes de hoy»), con confirmación en la interfaz
  router.post('/enviar', requiereAdmin, envolver(async (req, res) => {
    const c = config();
    const item = plan(0).find((x) => x.recibo_id === Number(req.body?.recibo_id) && x.fase === req.body?.fase);
    if (!item) throw err('Ese aviso ya no corresponde (puede que se haya cobrado o enviado).', 409);
    if (item.excluido) throw err(item.excluido, 409);
    const r = await enviarUno(item, c, req.usuario.usuario);
    auditar(req, 'recordatorios.enviar', `${item.codigo} ${item.fase} → ${item.para}: ${r.estado}`);
    if (r.estado !== 'enviado') throw err(r.error || 'No se pudo enviar', 502);
    res.json(r);
  }));
  // Prueba: envía un ejemplo al correo del propio usuario (no al cliente)
  router.post('/prueba', envolver(async (req, res) => {
    const c = config();
    const r = recibosPendientes()[0];
    const ejemplo = r ? componer(r, req.body?.fase || 'antes', c) : { asunto: c.plantillas.antes.asunto, texto: c.plantillas.antes.cuerpo };
    const cuenta = db.prepare('SELECT email FROM cuentas_correo WHERE usuario_id = ?').get(req.usuario.id);
    if (!cuenta) throw err('Conecta tu cuenta de correo en Ajustes › Correo para recibir la prueba.', 409);
    await ctx.app.enviarCorreo(req.usuario.id, { para: [cuenta.email], asunto: `[PRUEBA] ${ejemplo.asunto}`, texto: `Esto es una prueba de los recordatorios de cobro. Así lo recibiría el cliente${r ? ` ${r.cliente_ficha || r.cliente_nombre} (${ejemplo.para})` : ''}:\n\n----------\n\n${ejemplo.texto}` });
    res.json({ ok: true, para: cuenta.email });
  }));
}
