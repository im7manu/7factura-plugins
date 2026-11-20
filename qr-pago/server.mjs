// Plugin «QR de pago por transferencia»: dibuja en el PDF un QR SEPA (EPC069-12, versión 002) con el importe pendiente.
// El QR solo prepara una transferencia en la app bancaria del cliente: no realiza el pago ni cambia el estado de la factura.
import QRCode from 'qrcode';

const AJUSTE = 'plugin_qr_pago';
const DEFECTO = { activo: true, iban: '', beneficiario: '', bic: '', referencia: 'Factura {numero}', tipos: ['factura'], texto: true };
const r2 = (n) => Math.round(n * 100) / 100;

/** Comprueba un IBAN (longitud y dígitos de control). */
export function ibanValido(iban) {
  const s = String(iban || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const mover = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let resto = 0;
  for (const d of mover) resto = (resto * 10 + Number(d)) % 97;
  return resto === 1;
}
/** Texto del QR EPC. Los campos se recortan a las longitudes máximas del estándar. */
export function textoEpc({ bic = '', beneficiario, iban, importe, referencia }) {
  const limpio = (t, n) => String(t || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
  return ['BCD', '002', '1', 'SCT', limpio(bic, 11), limpio(beneficiario, 70), String(iban).replace(/\s/g, '').toUpperCase(),
    importe > 0 ? `EUR${r2(importe).toFixed(2)}` : '', '', '', limpio(referencia, 140), ''].join('\n');
}

export function register(ctx) {
  const { router, requiereAdmin, auditar } = ctx;
  const config = () => {
    const c = { ...DEFECTO, ...(ctx.getAjuste(AJUSTE, {}) || {}) };
    const emp = ctx.getAjuste('empresa', {}) || {};
    return { ...c, iban_efectivo: (c.iban || emp.iban || '').replace(/\s/g, '').toUpperCase(), beneficiario_efectivo: c.beneficiario || emp.razon_social || '' };
  };

  /** Importe pendiente real: lo pendiente de los recibos (con cobros parciales) o el total si el documento no tiene recibos. */
  function pendiente(doc) {
    if (Array.isArray(doc.recibos) && doc.recibos.length) return r2(doc.recibos.reduce((s, r) => s + (r.pendiente ?? r.importe), 0));
    if (doc.tipo === 'factura' && doc.numero != null) return r2((doc.total || 0) - (doc.cobrado || 0));
    return r2(doc.total || 0);
  }

  ctx.extender('pdf.dibujar', (pdf, params, lugar) => {
    const c = config(), doc = params.doc;
    if (!c.activo || params.sinValorar || !c.tipos.includes(doc.tipo) || doc.estado === 'borrador' || doc.rectifica_id) return;
    if (!ibanValido(c.iban_efectivo) || !c.beneficiario_efectivo) return;
    const imp = pendiente(doc);
    if (!(imp > 0.005)) return; // pagada: no se ofrece pagar otra vez
    const referencia = c.referencia.replace(/\{numero\}/g, doc.codigo || '').replace(/\{cliente\}/g, doc.cliente?.nombre || '');
    const qr = QRCode.create(textoEpc({ bic: c.bic, beneficiario: c.beneficiario_efectivo, iban: c.iban_efectivo, importe: imp, referencia }), { errorCorrectionLevel: 'M' });
    const lado = 92, alto = lado + 14;
    let y = lugar.reservar(alto + 10) + 8;
    const M = lugar.margen, x = M, n = qr.modules.size, celda = lado / n;
    // Marco y QR en vectores (nítido al imprimir)
    pdf.save().roundedRect(x, y, pdf.page.width - 2 * M, alto, 4).lineWidth(0.6).strokeColor('#C8C8C8').stroke().restore();
    pdf.save().fillColor('#000');
    for (let f = 0; f < n; f++) for (let k = 0; k < n; k++) if (qr.modules.get(k, f)) pdf.rect(x + 7 + k * celda, y + 7 + f * celda, celda + 0.05, celda + 0.05).fill();
    pdf.restore();
    const tx = x + lado + 22, ancho = pdf.page.width - M - tx - 8;
    const eur = imp.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
    pdf.fillColor('#000').fontSize(10).font('Helvetica-Bold').text('Paga con tu app bancaria', tx, y + 9, { width: ancho });
    pdf.font('Helvetica').fontSize(8).fillColor('#444').text('Escanea el código para preparar una transferencia SEPA con estos datos y revísala antes de confirmarla. Algunas apps bancarias no admiten este formato.', tx, pdf.y + 2, { width: ancho });
    if (c.texto) {
      pdf.moveDown(0.3).fontSize(8.5).fillColor('#000')
        .text(`Beneficiario: ${c.beneficiario_efectivo}`, tx, pdf.y, { width: ancho })
        .text(`IBAN: ${c.iban_efectivo.replace(/(.{4})/g, '$1 ').trim()}${c.bic ? `   BIC: ${c.bic}` : ''}`, { width: ancho })
        .text(`Importe: ${eur}   Concepto: ${referencia}`, { width: ancho });
    }
    return y + alto + 6;
  });

  router.get('/config', (_req, res) => { const c = config(); res.json({ ...c, iban_valido: ibanValido(c.iban_efectivo) }); });
  router.put('/config', requiereAdmin, (req, res) => {
    const b = req.body || {};
    const iban = String(b.iban || '').replace(/\s/g, '').toUpperCase();
    if (iban && !ibanValido(iban)) return res.status(400).json({ error: 'El IBAN no es válido.' });
    if (b.bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/i.test(String(b.bic).trim())) return res.status(400).json({ error: 'El BIC no es válido (8 u 11 caracteres).' });
    const tipos = (Array.isArray(b.tipos) ? b.tipos : []).filter((t) => ['factura', 'proforma', 'presupuesto', 'pedido', 'albaran'].includes(t));
    ctx.setAjuste(AJUSTE, { activo: !!b.activo, iban, beneficiario: String(b.beneficiario || '').trim().slice(0, 70), bic: String(b.bic || '').trim().toUpperCase(),
      referencia: String(b.referencia || DEFECTO.referencia).slice(0, 140), tipos: tipos.length ? tipos : ['factura'], texto: b.texto !== false });
    auditar(req, 'qr-pago.config', '');
    res.json({ ok: true });
  });
  // Vista previa del QR con un importe de ejemplo
  router.get('/vista-previa.svg', async (_req, res) => {
    const c = config();
    if (!ibanValido(c.iban_efectivo)) return res.status(400).send('IBAN no válido');
    res.type('image/svg+xml').send(await QRCode.toString(textoEpc({ bic: c.bic, beneficiario: c.beneficiario_efectivo, iban: c.iban_efectivo, importe: 123.45, referencia: c.referencia.replace('{numero}', 'EJEMPLO') }), { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }));
  });
}
