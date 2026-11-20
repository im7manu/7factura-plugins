// Plugin «Estado de cuenta de cliente»: facturas emitidas, rectificativas y cobros de un cliente en un periodo, con saldo.
// Solo cuenta facturas emitidas (nunca presupuestos, proformas ni borradores). Las rectificativas restan; los cobros se
// toman de los recibos, así que los parciales se reflejan con su fecha real.
import fs from 'node:fs';

const r2 = (n) => Math.round(n * 100) / 100;
const fechaOk = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
const fechaEs = (f) => (f ? new Date(`${f.slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : '');
const eur = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const hoy = () => new Date().toLocaleDateString('sv-SE');
const dias = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);

export function register(ctx) {
  const { router, db, auditar } = ctx;
  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { const st = e.status || 500; if (st === 500) console.error('[estado-cuenta]', e); res.status(st).json({ error: st === 500 ? 'Error interno' : e.message }); }
  };
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });

  function calcular(q) {
    const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(q.cliente_id));
    if (!cliente) throw err('Elige un cliente.');
    const desde = fechaOk(q.desde) ? q.desde : '2000-01-01', hasta = fechaOk(q.hasta) ? q.hasta : hoy();
    if (hasta < desde) throw err('El periodo no es válido.');
    const incluirPagadas = q.pagadas !== '0', detalle = q.detalle !== '0';
    const facturas = db.prepare(`SELECT d.id, d.codigo, d.fecha, d.total, d.estado, d.rectifica_id, (SELECT codigo FROM documentos o WHERE o.id = d.rectifica_id) AS rectifica
      FROM documentos d WHERE d.tipo = 'factura' AND d.numero IS NOT NULL AND d.cliente_id = ? ORDER BY d.fecha, d.numero`).all(cliente.id);
    const cobrosDe = db.prepare(`SELECT c.fecha, c.importe, c.forma_pago, c.notas, r.numero AS recibo FROM cobros c JOIN recibos r ON r.id = c.recibo_id WHERE r.documento_id = ? ORDER BY c.fecha, c.id`);
    const recibosDe = db.prepare(`SELECT r.*, ROUND(r.importe - COALESCE((SELECT SUM(importe) FROM cobros WHERE recibo_id = r.id), 0), 2) AS pendiente FROM recibos r WHERE r.documento_id = ? ORDER BY r.numero`);

    let saldoAnterior = 0;
    const movimientos = [], vencidos = [], h = hoy();
    let facturado = 0, cobrado = 0;
    for (const f of facturas) {
      const cobros = cobrosDe.all(f.id), recibos = recibosDe.all(f.id);
      const pendiente = r2(recibos.reduce((s, r) => s + r.pendiente, 0));
      const pagada = Math.abs(pendiente) < 0.005;
      // Lo anterior al periodo forma el saldo inicial
      if (f.fecha < desde) saldoAnterior += f.total;
      for (const c of cobros) if (c.fecha < desde) saldoAnterior -= c.importe;
      if (f.fecha > hasta && cobros.every((c) => c.fecha > hasta)) continue;
      if (!incluirPagadas && pagada) {
        // aunque no se listen, cuentan para el saldo del periodo
        if (f.fecha >= desde && f.fecha <= hasta) facturado += f.total;
        for (const c of cobros) if (c.fecha >= desde && c.fecha <= hasta) cobrado += c.importe;
        continue;
      }
      if (f.fecha >= desde && f.fecha <= hasta) {
        facturado += f.total;
        movimientos.push({ fecha: f.fecha, tipo: f.rectifica_id ? 'rectificativa' : 'factura', concepto: f.rectifica_id ? `Rectificativa ${f.codigo} (de ${f.rectifica || '—'})` : `Factura ${f.codigo}`, documento_id: f.id, cargo: f.total > 0 ? f.total : 0, abono: f.total < 0 ? -f.total : 0, vencimientos: recibos.map((r) => ({ vencimiento: r.vencimiento, importe: r.importe, pendiente: r.pendiente })) });
      }
      const enPeriodo = cobros.filter((c) => c.fecha >= desde && c.fecha <= hasta);
      cobrado += enPeriodo.reduce((s, c) => s + c.importe, 0);
      if (detalle) for (const c of enPeriodo) movimientos.push({ fecha: c.fecha, tipo: 'cobro', concepto: `Cobro de ${f.codigo}${recibos.length > 1 ? ` (vto. ${c.recibo})` : ''}${c.notas ? ` · ${c.notas}` : ''}`, documento_id: f.id, cargo: c.importe < 0 ? -c.importe : 0, abono: c.importe > 0 ? c.importe : 0 });
      else if (enPeriodo.length) movimientos.push({ fecha: enPeriodo[enPeriodo.length - 1].fecha, tipo: 'cobro', concepto: `Cobros de ${f.codigo}`, documento_id: f.id, cargo: 0, abono: r2(enPeriodo.reduce((s, c) => s + c.importe, 0)) });
      for (const r of recibos) if (r.pendiente > 0.005 && r.vencimiento <= hasta) vencidos.push({ codigo: f.codigo, documento_id: f.id, vencimiento: r.vencimiento, pendiente: r.pendiente, retraso: Math.max(0, dias(h, r.vencimiento)), vencido: r.vencimiento < h });
    }
    movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.tipo === 'cobro') - (b.tipo === 'cobro'));
    let saldo = r2(saldoAnterior);
    for (const m of movimientos) { saldo = r2(saldo + m.cargo - m.abono); m.saldo = saldo; }
    const saldoFinal = r2(saldoAnterior + facturado - cobrado);
    const pendienteTotal = r2(facturas.reduce((s, f) => s + recibosDe.all(f.id).reduce((a, r) => a + r.pendiente, 0), 0));
    return { cliente, desde, hasta, saldo_anterior: r2(saldoAnterior), facturado: r2(facturado), cobrado: r2(cobrado), saldo_final: saldoFinal,
      pendiente_total: pendienteTotal, vencidos: vencidos.filter((v) => v.vencido), por_vencer: vencidos.filter((v) => !v.vencido), movimientos, incluir_pagadas: incluirPagadas, generado: new Date().toISOString() };
  }

  router.get('/clientes', (_req, res) => res.json(db.prepare('SELECT id, nombre, nif, email FROM clientes ORDER BY nombre COLLATE NOCASE').all()));
  router.get('/estado', envolver(async (req, res) => res.json(calcular(req.query))));

  // ---- PDF ----
  function pdf(e, opciones = {}) {
    const PDFDocument = ctx.lib.PDFDocument;
    const emp = ctx.getAjuste('empresa', {}) || {};
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: `Estado de cuenta ${e.cliente.nombre}`, Author: emp.razon_social || '' } });
    const M = 42, W = doc.page.width, ancho = W - 2 * M, GRIS = '#666';
    let y = M;
    const logo = (() => { try { return ctx.extensionesDe('logo')[0]?.fn() || null; } catch { return null; } })();
    if (logo && fs.existsSync(logo)) { try { doc.image(logo, M, y, { fit: [130, 50] }); } catch { /* imagen no válida */ } }
    doc.fontSize(9).fillColor('#000').text(emp.razon_social || '', M + ancho / 2, y, { width: ancho / 2, align: 'right' })
      .fillColor(GRIS).text([emp.nif && `NIF ${emp.nif}`, emp.direccion, [emp.cp, emp.ciudad].filter(Boolean).join(' '), emp.telefono, emp.email].filter(Boolean).join('\n'), { width: ancho / 2, align: 'right' });
    y = Math.max(doc.y, y + 55) + 14;
    doc.fontSize(18).fillColor('#000').text('Estado de cuenta', M, y);
    doc.fontSize(10).fillColor(GRIS).text(`Periodo: del ${fechaEs(e.desde)} al ${fechaEs(e.hasta)}`, M, doc.y + 2);
    y = doc.y + 10;
    doc.fontSize(10).fillColor('#000').text(e.cliente.nombre, M, y).fillColor(GRIS).fontSize(9).text([e.cliente.nif && `NIF ${e.cliente.nif}`, e.cliente.direccion, [e.cliente.cp, e.cliente.ciudad].filter(Boolean).join(' ')].filter(Boolean).join(' · '));
    y = doc.y + 14;
    // Resumen
    const caja = (x, t, v, color = '#000') => { doc.roundedRect(x, y, ancho / 4 - 6, 44, 4).lineWidth(0.6).strokeColor('#ddd').stroke(); doc.fontSize(8).fillColor(GRIS).text(t, x + 8, y + 8, { width: ancho / 4 - 22 }); doc.fontSize(12).fillColor(color).text(v, x + 8, y + 22, { width: ancho / 4 - 22 }); };
    caja(M, 'Saldo anterior', eur(e.saldo_anterior)); caja(M + ancho / 4, 'Facturado en el periodo', eur(e.facturado)); caja(M + ancho / 2, 'Cobrado en el periodo', eur(e.cobrado)); caja(M + 3 * ancho / 4, 'Saldo pendiente', eur(e.saldo_final), e.saldo_final > 0.005 ? '#B00020' : '#107C10');
    y += 60;
    // Tabla
    const cols = [{ t: 'Fecha', w: 62 }, { t: 'Concepto', w: ancho - 62 - 3 * 78 }, { t: 'Cargo', w: 78, d: 1 }, { t: 'Abono', w: 78, d: 1 }, { t: 'Saldo', w: 78, d: 1 }];
    const fila = (vals, negrita = false) => {
      if (y > doc.page.height - 80) { doc.addPage(); y = M; }
      let x = M; doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#000');
      const alto = Math.max(...vals.map((v, i) => doc.heightOfString(String(v), { width: cols[i].w - 6 })));
      vals.forEach((v, i) => { doc.text(String(v), x + 3, y + 3, { width: cols[i].w - 6, align: cols[i].d ? 'right' : 'left' }); x += cols[i].w; });
      y += alto + 6; doc.moveTo(M, y).lineTo(M + ancho, y).lineWidth(0.3).strokeColor('#e5e5e5').stroke();
    };
    fila(cols.map((c) => c.t), true);
    fila([fechaEs(e.desde), 'Saldo anterior', '', '', eur(e.saldo_anterior)]);
    for (const m of e.movimientos) fila([fechaEs(m.fecha), m.concepto + (opciones.vencimientos && m.vencimientos?.length ? `\nVto.: ${m.vencimientos.map((v) => `${fechaEs(v.vencimiento)} ${eur(v.importe)}`).join(', ')}` : ''), m.cargo ? eur(m.cargo) : '', m.abono ? eur(m.abono) : '', eur(m.saldo)]);
    fila([fechaEs(e.hasta), 'Saldo final del periodo', eur(e.facturado), eur(e.cobrado), eur(e.saldo_final)], true);
    if (!e.incluir_pagadas) { doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text('No se listan las facturas ya pagadas; sí cuentan en los totales y en el saldo.', M, y + 4); y = doc.y; }
    if (opciones.vencimientos && e.vencidos.length) {
      y += 14; if (y > doc.page.height - 120) { doc.addPage(); y = M; }
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Recibos vencidos pendientes', M, y); y = doc.y + 4;
      for (const v of e.vencidos) { doc.font('Helvetica').fontSize(8.5).text(`${v.codigo} · venció el ${fechaEs(v.vencimiento)} (${v.retraso} días) · pendiente ${eur(v.pendiente)}`, M, y); y = doc.y + 2; }
    }
    if (opciones.banco && emp.iban) {
      y += 14; if (y > doc.page.height - 100) { doc.addPage(); y = M; }
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Cómo pagar', M, y);
      doc.font('Helvetica').fontSize(8.5).text(`Transferencia a ${emp.razon_social || ''}, IBAN ${emp.iban.replace(/(.{4})/g, '$1 ').trim()}, indicando el número de factura.${opciones.instrucciones ? `\n${opciones.instrucciones}` : ''}`, M, doc.y + 2, { width: ancho });
    }
    const rango = doc.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i); doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text(`Estado de cuenta de ${e.cliente.nombre} · del ${fechaEs(e.desde)} al ${fechaEs(e.hasta)} · generado el ${new Date(e.generado).toLocaleDateString('es-ES')}`, M, doc.page.height - 30, { width: ancho - 40 })
        .text(`${i + 1} / ${rango.count}`, M, doc.page.height - 30, { width: ancho, align: 'right' });
    }
    return new Promise((ok, ko) => { const t = []; doc.on('data', (c) => t.push(c)); doc.on('end', () => ok(Buffer.concat(t))); doc.on('error', ko); doc.end(); });
  }
  const nombreArchivo = (e, ext) => `estado-cuenta-${e.cliente.nombre.replace(/[^\w]+/g, '-').slice(0, 40)}-${e.desde}-${e.hasta}.${ext}`;
  const opcionesPdf = (q) => ({ vencimientos: q.vencimientos !== '0', banco: q.banco === '1', instrucciones: String(q.instrucciones || '').slice(0, 500) });

  router.get('/estado.pdf', envolver(async (req, res) => {
    const e = calcular(req.query);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.descargar ? 'attachment' : 'inline'}; filename="${nombreArchivo(e, 'pdf')}"`);
    res.send(await pdf(e, opcionesPdf(req.query)));
  }));
  router.get('/estado.csv', envolver(async (req, res) => {
    const e = calcular(req.query), q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`, n = (v) => (v ? String(r2(v)).replace('.', ',') : '');
    const filas = [['Fecha', 'Concepto', 'Cargo', 'Abono', 'Saldo'], [e.desde, 'Saldo anterior', '', '', n(e.saldo_anterior) || '0'],
      ...e.movimientos.map((m) => [m.fecha, m.concepto, n(m.cargo), n(m.abono), n(m.saldo) || '0']), [e.hasta, 'Saldo final', n(e.facturado), n(e.cobrado), n(e.saldo_final) || '0']];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(e, 'csv')}"`);
    res.send(`﻿${filas.map((f) => f.map(q).join(';')).join('\r\n')}`);
  }));
  // Enviar por correo al cliente con la cuenta conectada del usuario
  router.post('/enviar', envolver(async (req, res) => {
    const b = req.body || {};
    const e = calcular(b);
    const para = String(b.para || '').trim();
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(para)) throw err('Indica un correo válido.');
    const contenido = await pdf(e, opcionesPdf(b));
    await ctx.app.enviarCorreo(req.usuario.id, { para: [para], asunto: String(b.asunto || `Estado de cuenta del ${fechaEs(e.desde)} al ${fechaEs(e.hasta)}`).slice(0, 250), texto: String(b.texto || '').slice(0, 10000), adjuntos: [{ filename: nombreArchivo(e, 'pdf'), content: contenido, contentType: 'application/pdf' }] });
    auditar(req, 'estado-cuenta.enviar', `${e.cliente.nombre} → ${para}`);
    res.json({ ok: true });
  }));
}
