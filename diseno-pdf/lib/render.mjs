// Dibuja el PDF de un documento según un diseño configurable.
// Plantillas: moderna, clasica, minimal, lateral, compacta.
import fs from 'node:fs';

export const PLANTILLAS = {
  moderna: 'Moderna: banda de color arriba, cabecera de tabla en color y total destacado',
  clasica: 'Clásica: marco, rejilla completa y título centrado',
  minimal: 'Minimalista: sin rellenos, líneas finas y mucho aire',
  lateral: 'Banda lateral: columna de color con el logo y los datos de la empresa',
  compacta: 'Compacta: letra pequeña y filas juntas, para documentos con muchas líneas',
};

export const DISENO_DEFECTO = {
  id: 'estandar', nombre: 'Diseño estándar', plantilla: 'moderna',
  colores: { primario: '#0F6CBD', sobre_primario: '#FFFFFF', texto: '#000000', suave: '#F5F5F5', gris: '#616161' },
  fuente: 'Helvetica', fuente_archivo: null, fuente_negrita_archivo: null, tamano: 9,
  logo: { archivo: null, posicion: 'izquierda', ancho: 110 },
  mostrar_datos_empresa: true,
  columnas: { referencia: false, cantidad: true, precio: true, dto: 'auto', iva: true, importe: true },
  textos: { titulos: {}, cabecera: '', pie: '', condiciones: '' },
  marca_agua: { texto: '', opacidad: 0.08 },
  sello: { archivo: null, texto: '', ancho: 120, posicion: 'derecha' },
  firma_digital: false,
  aplicar: { tipos: [], series: [] },
};

const TITULOS = {
  factura: 'FACTURA', presupuesto: 'PRESUPUESTO', proforma: 'FACTURA PROFORMA', pedido: 'PEDIDO', albaran: 'ALBARÁN',
  pedido_compra: 'PEDIDO A PROVEEDOR', presupuesto_compra: 'SOLICITUD DE PRESUPUESTO', albaran_compra: 'ALBARÁN DE PROVEEDOR',
  factura_compra: 'FACTURA RECIBIDA', gasto: 'GASTO',
};

const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
const num = (n, d = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: d }).format(Number(n) || 0);
const fecha = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/**
 * @param {object} p  { doc, empresa, formaPago, rectificada, sinValorar, firma (receptor del albarán), vencimientos }
 * @param {object} d  diseño
 * @param {object} lib  { PDFDocument, baseLinea, OPERACIONES }
 * @param {object} extra { archivo(id) → ruta, referencias: Map(producto_id → referencia), certificado: { titular } | null }
 */
export function dibujar(p, d, lib, extra) {
  const { doc, empresa, formaPago, rectificada, sinValorar, vencimientos } = p;
  const { PDFDocument, baseLinea, OPERACIONES } = lib;
  const c = { ...DISENO_DEFECTO.colores, ...(d.colores || {}) };
  const plantilla = PLANTILLAS[d.plantilla] ? d.plantilla : 'moderna';
  const compacta = plantilla === 'compacta';
  const T = Math.max(7, Math.min(12, Number(d.tamano) || 9)) - (compacta ? 1 : 0);

  const pdf = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
    Title: `${TITULOS[doc.tipo] || 'DOCUMENTO'} ${doc.codigo || 'BORRADOR'}`, Author: empresa.razon_social || '', Creator: 'Facturador (plugin diseno-pdf)',
  } });

  // Tipografía: estándar del PDF o archivo TTF/OTF subido
  let normal = d.fuente === 'Times' ? 'Times-Roman' : d.fuente === 'Courier' ? 'Courier' : 'Helvetica';
  let negrita = d.fuente === 'Times' ? 'Times-Bold' : d.fuente === 'Courier' ? 'Courier-Bold' : 'Helvetica-Bold';
  const rutaFuente = d.fuente === 'personalizada' && d.fuente_archivo ? extra.archivo(d.fuente_archivo) : null;
  if (rutaFuente) {
    pdf.registerFont('Cuerpo', rutaFuente);
    normal = 'Cuerpo';
    const rutaNegrita = d.fuente_negrita_archivo ? extra.archivo(d.fuente_negrita_archivo) : null;
    if (rutaNegrita) { pdf.registerFont('CuerpoNegrita', rutaNegrita); negrita = 'CuerpoNegrita'; } else negrita = 'Cuerpo';
  }

  const W = pdf.page.width;
  const H = pdf.page.height;
  const banda = plantilla === 'lateral' ? 150 : 0;
  const M = 48;
  const X0 = M + banda;           // margen izquierdo del contenido
  const ancho = W - X0 - M;
  const lineaFina = (x1, y1, x2, y2, color = '#DDDDDD', g = 0.5) => pdf.moveTo(x1, y1).lineTo(x2, y2).lineWidth(g).strokeColor(color).stroke();
  const titulo = (d.textos?.titulos?.[doc.tipo] || '').trim() || (doc.rectifica_id && doc.tipo === 'factura' ? 'FACTURA RECTIFICATIVA' : TITULOS[doc.tipo] || 'DOCUMENTO');
  const logo = d.logo?.archivo ? extra.archivo(d.logo.archivo) : null;
  const anchoLogo = Math.max(30, Math.min(220, Number(d.logo?.ancho) || 110));

  // ---- Fondo de la banda lateral (en todas las páginas, se repite al pie) ----
  const pintarBanda = () => {
    if (!banda) return;
    pdf.save().rect(0, 0, banda, H).fill(c.primario).restore();
  };
  pintarBanda();
  pdf.on('pageAdded', pintarBanda);

  // ---- Cabecera ----
  let y = compacta ? 36 : 40;
  if (plantilla === 'moderna') pdf.rect(0, 0, W, 6).fill(c.primario);
  if (plantilla === 'clasica') pdf.rect(24, 24, W - 48, H - 48).lineWidth(0.8).strokeColor(c.primario).stroke();

  const datosEmpresa = [
    empresa.nif && `NIF: ${empresa.nif}`,
    empresa.direccion,
    [empresa.cp, empresa.ciudad, empresa.provincia && `(${empresa.provincia})`].filter(Boolean).join(' '),
    [empresa.telefono, empresa.email].filter(Boolean).join(' · '),
  ].filter(Boolean);

  if (plantilla === 'lateral') {
    // Logo y empresa en la banda
    let yb = 40;
    if (logo) { try { pdf.image(logo, 18, yb, { fit: [banda - 36, 80] }); yb += 90; } catch { /* imagen dañada */ } }
    pdf.font(negrita).fontSize(T + 2).fillColor(c.sobre_primario).text(empresa.razon_social || '', 18, yb, { width: banda - 36 });
    if (d.mostrar_datos_empresa !== false) pdf.font(normal).fontSize(T - 1).fillColor(c.sobre_primario).text(datosEmpresa.join('\n'), 18, pdf.y + 6, { width: banda - 36 });
    pdf.font(negrita).fontSize(T + 11).fillColor(c.primario).text(titulo, X0, 40, { width: ancho });
    y = pdf.y + 8;
  } else {
    const posLogo = d.logo?.posicion || 'izquierda';
    let xEmpresa = X0;
    let yEmpresa = y;
    if (logo) {
      const xl = posLogo === 'derecha' ? X0 + ancho - anchoLogo : posLogo === 'centro' ? X0 + (ancho - anchoLogo) / 2 : X0;
      try { pdf.image(logo, xl, y, { fit: [anchoLogo, 60] }); } catch { /* imagen dañada */ }
      if (posLogo !== 'derecha') yEmpresa = y + 66;
    }
    pdf.font(negrita).fontSize(T + 5).fillColor(c.texto).text(empresa.razon_social || 'Mi empresa', xEmpresa, yEmpresa, { width: ancho * 0.55 });
    if (d.mostrar_datos_empresa !== false) pdf.font(normal).fontSize(T).fillColor(c.gris).text(datosEmpresa.join('\n'), xEmpresa, pdf.y + 3, { width: ancho * 0.55 });
    const finEmpresa = pdf.y;
    if (plantilla === 'clasica') {
      y = Math.max(finEmpresa, logo && posLogo === 'derecha' ? y + 66 : 0) + 14;
      lineaFina(X0, y, X0 + ancho, y, c.primario, 1);
      pdf.font(negrita).fontSize(T + 9).fillColor(c.primario).text(titulo, X0, y + 6, { width: ancho, align: 'center', characterSpacing: 1.5 });
      y = pdf.y + 4;
      lineaFina(X0, y, X0 + ancho, y, c.primario, 1);
      y += 10;
    } else {
      const yTitulo = logo && posLogo === 'derecha' ? y + 66 : y - 2;
      pdf.font(negrita).fontSize(plantilla === 'minimal' ? T + 6 : T + 11).fillColor(plantilla === 'minimal' ? c.texto : c.primario)
        .text(titulo, X0 + ancho * 0.45, yTitulo, { width: ancho * 0.55, align: 'right', characterSpacing: plantilla === 'minimal' ? 2 : 0 });
      y = Math.max(finEmpresa + 6, pdf.y + 4);
    }
  }

  // Datos del documento (número, fechas…)
  const meta = [
    ['Número', doc.codigo || 'BORRADOR'],
    ['Fecha', fecha(doc.fecha)],
    doc.vencimiento && ['factura', 'factura_compra', 'gasto'].includes(doc.tipo) && !sinValorar ? ['Vencimiento', fecha(doc.vencimiento)] : null,
    ['presupuesto', 'proforma'].includes(doc.tipo) && doc.vencimiento ? ['Válido hasta', fecha(doc.vencimiento)] : null,
    doc.tipo === 'pedido' && doc.vencimiento ? ['Entrega prevista', fecha(doc.vencimiento)] : null,
    doc.numero_proveedor ? ['Nº proveedor', doc.numero_proveedor] : null,
    doc.referencia ? ['Su referencia', doc.referencia] : null,
  ].filter(Boolean);
  const xMeta = X0 + ancho * 0.55;
  let ym = y;
  pdf.fontSize(T);
  for (const [k, v] of meta) {
    pdf.font(normal).fillColor(c.gris).text(k, xMeta, ym, { width: ancho * 0.22, align: 'right' });
    pdf.font(negrita).fillColor(c.texto).text(String(v), xMeta + ancho * 0.23, ym, { width: ancho * 0.22, align: 'right' });
    ym += T + 4;
  }

  // Cliente o proveedor
  const t = doc.cliente || {};
  const lineasTercero = [
    t.nif && `NIF: ${t.nif}`, t.direccion, [t.cp, t.ciudad, t.provincia && `(${t.provincia})`].filter(Boolean).join(' '),
    t.pais && t.pais !== 'ES' ? t.pais : null,
  ].filter(Boolean);
  const etiquetaTercero = doc.proveedor_id ? 'PROVEEDOR' : 'CLIENTE';
  const anchoTercero = ancho * 0.52;
  pdf.font(normal).fontSize(T - 1).fillColor(c.gris).text(etiquetaTercero, X0 + (plantilla === 'moderna' ? 12 : 0), y + (plantilla === 'moderna' ? 8 : 0));
  pdf.font(negrita).fontSize(T + 2).fillColor(c.texto).text(t.nombre || '—', X0 + (plantilla === 'moderna' ? 12 : 0), pdf.y + 1, { width: anchoTercero - 16 });
  pdf.font(normal).fontSize(T).text(lineasTercero.join('\n'), X0 + (plantilla === 'moderna' ? 12 : 0), pdf.y + 1, { width: anchoTercero - 16 });
  const finTercero = pdf.y + (plantilla === 'moderna' ? 8 : 2);
  if (plantilla === 'moderna') {
    pdf.save().rect(X0, y, anchoTercero, finTercero - y).fillOpacity(0.06).fill(c.primario).restore();
    pdf.rect(X0, y, 3, finTercero - y).fill(c.primario);
  } else if (plantilla === 'clasica') {
    pdf.rect(X0 - 4, y - 4, anchoTercero, finTercero - y + 8).lineWidth(0.6).strokeColor('#999999').stroke();
  }
  y = Math.max(finTercero, ym) + (compacta ? 8 : 14);

  if (d.textos?.cabecera) {
    pdf.font(normal).fontSize(T).fillColor(c.texto).text(d.textos.cabecera, X0, y, { width: ancho });
    y = pdf.y + 8;
  }
  if (rectificada) {
    pdf.font(negrita).fontSize(T).fillColor(c.texto).text(`Rectifica a la factura ${rectificada.codigo} de fecha ${fecha(rectificada.fecha)}`, X0, y);
    if (doc.motivo) pdf.font(normal).text(`Motivo: ${doc.motivo}`, X0, pdf.y + 2, { width: ancho });
    y = pdf.y + 10;
  }

  // ---- Tabla de líneas ----
  const col = { ...DISENO_DEFECTO.columnas, ...(d.columnas || {}) };
  const hayDto = col.dto === true || (col.dto === 'auto' && doc.lineas.some((l) => Number(l.dto)));
  const hayIrpf = doc.lineas.some((l) => Number(l.irpf));
  const hayRecargo = doc.lineas.some((l) => Number(l.recargo));
  const hayRef = col.referencia && doc.lineas.some((l) => extra.referencias.get(l.producto_id));
  const anchoIva = doc.lineas.some((l) => l.suplido || (l.operacion && l.operacion !== 'S1')) ? 74 : 44;
  const cols = (sinValorar ? [
    hayRef && { k: 'ref', t: 'Ref.', w: 60, a: 'left' },
    { k: 'descripcion', t: 'Descripción', w: 0, a: 'left' },
    col.cantidad !== false && { k: 'cantidad', t: 'Cantidad', w: 70, a: 'right' },
  ] : [
    hayRef && { k: 'ref', t: 'Ref.', w: 56, a: 'left' },
    { k: 'descripcion', t: 'Descripción', w: 0, a: 'left' },
    col.cantidad !== false && { k: 'cantidad', t: 'Cant.', w: 44, a: 'right' },
    col.precio !== false && { k: 'precio', t: 'Precio', w: 64, a: 'right' },
    hayDto && { k: 'dto', t: 'Dto.', w: 36, a: 'right' },
    col.iva !== false && { k: 'iva', t: 'IVA', w: anchoIva, a: 'right' },
    hayRecargo && { k: 'recargo', t: 'R.E.', w: 34, a: 'right' },
    hayIrpf && { k: 'irpf', t: 'IRPF', w: 34, a: 'right' },
    col.importe !== false && { k: 'importe', t: 'Importe', w: 72, a: 'right' },
  ]).filter(Boolean);
  cols.find((x) => x.k === 'descripcion').w = ancho - cols.reduce((s, x) => s + (x.k === 'descripcion' ? 0 : x.w), 0);

  const altoCab = compacta ? 16 : 20;
  const cabecera = () => {
    let x = X0;
    if (plantilla === 'moderna' || plantilla === 'lateral' || plantilla === 'compacta') pdf.rect(X0, y, ancho, altoCab).fill(c.primario);
    if (plantilla === 'clasica') pdf.rect(X0, y, ancho, altoCab).fill(c.suave).rect(X0, y, ancho, altoCab).lineWidth(0.6).strokeColor('#999999').stroke();
    const colorCab = ['moderna', 'lateral', 'compacta'].includes(plantilla) ? c.sobre_primario : plantilla === 'minimal' ? c.gris : c.texto;
    pdf.font(negrita).fontSize(T - 0.5).fillColor(colorCab);
    for (const cc of cols) { pdf.text(cc.t, x + 5, y + (compacta ? 4 : 6), { width: cc.w - 10, align: cc.a }); x += cc.w; }
    y += altoCab;
    if (plantilla === 'minimal') lineaFina(X0, y, X0 + ancho, y, c.texto, 0.8);
    pdf.font(normal).fillColor(c.texto);
  };
  cabecera();

  const limite = H - 210;
  let fila = 0;
  for (const l of doc.lineas) {
    const op = OPERACIONES[l.operacion || 'S1'] || OPERACIONES.S1;
    const v = {
      ref: extra.referencias.get(l.producto_id) || '',
      descripcion: l.descripcion || '',
      cantidad: num(l.cantidad, 3),
      precio: eur(l.precio),
      dto: Number(l.dto) ? `${num(l.dto)} %` : '',
      iva: l.suplido ? 'Suplido' : op.conIva ? `${num(l.iva)} %` : op.corto,
      recargo: Number(l.recargo) ? `${num(l.recargo)} %` : '',
      irpf: Number(l.irpf) ? `${num(l.irpf)} %` : '',
      importe: eur(baseLinea(l)),
    };
    pdf.fontSize(T);
    const descW = cols.find((x) => x.k === 'descripcion').w - 10;
    const alto = Math.max(pdf.heightOfString(v.descripcion, { width: descW }), T + 2) + (compacta ? 6 : 10);
    if (y + alto > limite) { pdf.addPage(); y = M; cabecera(); }
    if (fila % 2 === 1 && (plantilla === 'moderna' || plantilla === 'compacta' || plantilla === 'lateral')) pdf.rect(X0, y, ancho, alto).fill(c.suave);
    let x = X0;
    for (const cc of cols) {
      pdf.fillColor(c.texto).text(v[cc.k], x + 5, y + (compacta ? 3 : 5), { width: cc.w - 10, align: cc.a });
      x += cc.w;
    }
    if (plantilla === 'clasica') {
      pdf.rect(X0, y, ancho, alto).lineWidth(0.5).strokeColor('#999999').stroke();
      let xs = X0;
      for (const cc of cols.slice(0, -1)) { xs += cc.w; lineaFina(xs, y, xs, y + alto, '#999999'); }
    } else if (plantilla !== 'compacta') {
      lineaFina(X0, y + alto, X0 + ancho, y + alto, plantilla === 'minimal' ? '#E5E5E5' : '#DDDDDD');
    }
    y += alto;
    fila++;
  }

  // ---- Totales y desglose ----
  const tot = doc.totales;
  if (sinValorar) {
    y += 12;
    pdf.font(normal).fontSize(T - 1).fillColor(c.gris).text('Documento sin valorar: no incluye precios ni importes.', X0, y, { width: ancho });
    y = pdf.y + 10;
  } else {
    if (y + 190 > H - M) { pdf.addPage(); y = M; }
    y += compacta ? 8 : 14;
    const xT = X0 + ancho - 220;
    // Si no caben uno al lado del otro (p. ej. plantilla con banda lateral), el desglose va debajo de los totales
    const nFilasTot = 2 + (tot.totalRecargo ? 1 : 0) + (tot.totalIrpf ? 1 : 0) + (tot.totalSuplidos ? 1 : 0);
    const apilar = X0 + 250 > xT;
    const yDesglose = apilar ? y + nFilasTot * (T + 6) + 44 : y;
    pdf.font(normal).fontSize(T - 1).fillColor(c.gris)
      .text('BASE', X0, yDesglose, { width: 90 }).text('TIPO', X0 + 90, yDesglose, { width: 80, align: 'right' }).text('CUOTA', X0 + 170, yDesglose, { width: 70, align: 'right' });
    let yd = yDesglose + T + 3;
    pdf.fontSize(T).fillColor(c.texto);
    for (const g of tot.desglose) {
      const etq = OPERACIONES[g.operacion].conIva ? `IVA ${num(g.tipo)} %` : OPERACIONES[g.operacion].corto;
      pdf.text(eur(g.base), X0, yd, { width: 90 }).text(etq, X0 + 90, yd, { width: 80, align: 'right' }).text(eur(g.cuota), X0 + 170, yd, { width: 70, align: 'right' });
      yd += T + 4;
      if (g.cuotaRecargo) {
        pdf.text(eur(g.base), X0, yd, { width: 90 }).text(`R.E. ${num(g.recargo)} %`, X0 + 90, yd, { width: 80, align: 'right' }).text(eur(g.cuotaRecargo), X0 + 170, yd, { width: 70, align: 'right' });
        yd += T + 4;
      }
    }
    for (const g of tot.desgloseIrpf) {
      pdf.text(eur(g.base), X0, yd, { width: 90 }).text(`IRPF ${num(g.tipo)} %`, X0 + 90, yd, { width: 80, align: 'right' }).text(`-${eur(g.cuota)}`, X0 + 170, yd, { width: 70, align: 'right' });
      yd += T + 4;
    }
    const filas = [
      ['Base imponible', eur(tot.neto)], ['IVA', eur(tot.totalIva)],
      tot.totalRecargo ? ['Recargo de equivalencia', eur(tot.totalRecargo)] : null,
      tot.totalIrpf ? ['Retención IRPF', `-${eur(tot.totalIrpf)}`] : null,
      tot.totalSuplidos ? ['Suplidos', eur(tot.totalSuplidos)] : null,
    ].filter(Boolean);
    let yt = y;
    for (const [k, v] of filas) {
      pdf.font(normal).fillColor(c.gris).text(k, xT, yt, { width: 120 });
      pdf.fillColor(c.texto).text(v, xT + 120, yt, { width: 100, align: 'right' });
      yt += T + 6;
    }
    if (plantilla === 'minimal') {
      lineaFina(xT, yt + 2, xT + 220, yt + 2, c.texto, 0.8);
      pdf.font(negrita).fontSize(T + 3).fillColor(c.texto).text('TOTAL', xT, yt + 8, { width: 100 });
      pdf.fillColor(c.primario).text(eur(tot.total), xT + 100, yt + 8, { width: 120, align: 'right' });
      lineaFina(xT + 130, yt + 26, xT + 220, yt + 26, c.primario, 1.5);
    } else if (plantilla === 'clasica') {
      pdf.rect(xT, yt + 2, 220, 26).lineWidth(1).strokeColor(c.primario).stroke();
      pdf.font(negrita).fontSize(T + 3).fillColor(c.primario).text('TOTAL', xT + 10, yt + 10, { width: 100 });
      pdf.text(eur(tot.total), xT + 100, yt + 10, { width: 110, align: 'right' });
    } else {
      pdf.rect(xT, yt + 2, 220, compacta ? 22 : 28).fill(c.primario);
      pdf.font(negrita).fontSize(T + 2).fillColor(c.sobre_primario).text('TOTAL', xT + 10, yt + (compacta ? 8 : 11), { width: 100 });
      pdf.text(eur(tot.total), xT + 100, yt + (compacta ? 8 : 11), { width: 110, align: 'right' });
    }
    pdf.font(normal);
    y = Math.max(yd, yt + 40) + (compacta ? 8 : 16);
    if (tot.leyendas.length) {
      pdf.fontSize(T - 1).fillColor(c.texto).text(tot.leyendas.join('\n'), X0, y, { width: ancho });
      y = pdf.y + 8;
    }
  }

  // ---- Pie del cuerpo: forma de pago, vencimientos, observaciones y condiciones ----
  if (doc.tipo === 'proforma') {
    pdf.fontSize(T - 1).fillColor(c.gris).text('Factura proforma: documento sin validez fiscal. No sustituye a la factura.', X0, y, { width: ancho });
    y = pdf.y + 8;
  }
  pdf.fontSize(T).fillColor(c.texto);
  if (formaPago && ['factura', 'proforma'].includes(doc.tipo) && !sinValorar) {
    let txt = `Forma de pago: ${formaPago.descripcion}`;
    if (formaPago.muestra_iban && empresa.iban) txt += `  ·  IBAN: ${empresa.iban.replace(/(.{4})/g, '$1 ').trim()}`;
    pdf.text(txt, X0, y, { width: ancho });
    y = pdf.y + 6;
  }
  if (vencimientos && !sinValorar) {
    pdf.fillColor(c.gris).fontSize(T - 1).text('VENCIMIENTOS', X0, y);
    y = pdf.y + 2;
    pdf.fillColor(c.texto).fontSize(T);
    for (const r of vencimientos) { pdf.text(fecha(r.vencimiento), X0, y, { width: 80 }).text(eur(r.importe), X0 + 80, y, { width: 90, align: 'right' }); y = pdf.y + 1; }
    y += 6;
  }
  if (doc.observaciones) {
    pdf.fillColor(c.gris).fontSize(T - 1).text('OBSERVACIONES', X0, y);
    pdf.fillColor(c.texto).fontSize(T).text(doc.observaciones, X0, pdf.y + 2, { width: ancho });
    y = pdf.y + 8;
  }
  if (d.textos?.condiciones) {
    pdf.fillColor(c.gris).fontSize(T - 1).text(d.textos.condiciones, X0, y, { width: ancho });
    y = pdf.y + 8;
  }

  // ---- Recibí del albarán (firma del receptor) ----
  const receptor = p.firma;
  if (receptor) {
    if (y + 110 > H - 100) { pdf.addPage(); y = M; }
    y += 6;
    const w2 = Math.min(240, ancho);
    const x2 = X0 + ancho - w2;
    pdf.rect(x2, y, w2, 92).lineWidth(0.7).strokeColor('#CCCCCC').stroke();
    pdf.fontSize(T - 1).fillColor(c.gris).text('RECIBÍ CONFORME', x2 + 10, y + 8);
    if (receptor.nombre) {
      if (receptor.imagen) { try { pdf.image(receptor.imagen, x2 + 10, y + 20, { fit: [w2 - 20, 42] }); } catch { /* imagen dañada */ } }
      pdf.fontSize(T - 0.5).fillColor(c.texto).text(`${receptor.nombre}${receptor.dni ? ` · DNI ${receptor.dni}` : ''}`, x2 + 10, y + 66, { width: w2 - 20 });
      pdf.fillColor(c.gris).text(receptor.fecha ? new Date(receptor.fecha).toLocaleString('es-ES', { timeZone: process.env.TZ || 'Europe/Madrid' }) : '', x2 + 10, y + 78, { width: w2 - 20 });
    } else {
      pdf.fontSize(T - 1).fillColor(c.gris).text('Nombre:', x2 + 10, y + 28).text('DNI:', x2 + 10, y + 46).text('Firma:', x2 + 10, y + 64);
    }
    y += 100;
  }

  // ---- Firma de la empresa: imagen de la firma manuscrita o sello, y/o firma digital ----
  const rutaSello = d.sello?.archivo ? extra.archivo(d.sello.archivo) : null;
  const firmaDigital = d.firma_digital && extra.certificado && doc.estado !== 'borrador';
  if (rutaSello || d.sello?.texto || firmaDigital) {
    const wS = Math.max(60, Math.min(220, Number(d.sello?.ancho) || 120));
    const altoBloque = (rutaSello ? 70 : 0) + 34;
    if (y + altoBloque > H - 70) { pdf.addPage(); y = M; }
    const xS = d.sello?.posicion === 'izquierda' ? X0 : X0 + ancho - Math.max(wS, 200);
    let yS = y + 6;
    if (rutaSello) { try { pdf.image(rutaSello, xS, yS, { fit: [wS, 64] }); yS += 68; } catch { /* imagen dañada */ } }
    if (d.sello?.texto) { pdf.fontSize(T - 1).fillColor(c.texto).text(d.sello.texto, xS, yS, { width: 200 }); yS = pdf.y + 2; }
    if (firmaDigital) {
      pdf.fontSize(T - 2).fillColor(c.gris).text(`Firmado digitalmente por ${extra.certificado.titular}${extra.certificado.emisor ? ` (${extra.certificado.emisor})` : ''}.`, xS, yS, { width: 200 });
    }
  }

  // ---- Marca de agua (texto del diseño o BORRADOR) ----
  const marca = doc.estado === 'borrador' ? 'BORRADOR' : (d.marca_agua?.texto || '').trim();
  const opacidad = doc.estado === 'borrador' ? 0.12 : Math.max(0.03, Math.min(0.4, Number(d.marca_agua?.opacidad) || 0.08));

  // ---- Pie de página en todas las páginas ----
  const rango = pdf.bufferedPageRange();
  const pie = (d.textos?.pie || '').trim() || empresa.pie_factura || '';
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    pdf.switchToPage(i);
    pdf.page.margins.bottom = 0;
    if (marca) {
      pdf.save().rotate(-30, { origin: [W / 2, H / 2] }).font(negrita).fontSize(marca.length > 12 ? 60 : 90)
        .fillColor(doc.estado === 'borrador' ? '#D13438' : c.primario).fillOpacity(opacidad)
        .text(marca, 0, H / 2 - 50, { width: W, align: 'center' }).restore();
      pdf.fillOpacity(1);
    }
    const yp = H - 40;
    if (pie) pdf.font(normal).fontSize(7).fillColor(banda ? c.gris : c.gris).text(pie, X0, yp - 26, { width: ancho, align: 'center', height: 24, ellipsis: true });
    pdf.font(normal).fontSize(8).fillColor(c.gris).text(`${i + 1} / ${rango.count}`, X0, yp, { width: ancho, align: 'right' });
  }
  return pdf;
}

/** Elige el diseño que corresponde a un documento: el primero cuya regla encaja (tipo y serie); si no, el predeterminado. */
export function elegirDiseno(disenos, doc) {
  const encaja = (d) => (!d.aplicar?.tipos?.length || d.aplicar.tipos.includes(doc.tipo))
    && (!d.aplicar?.series?.length || d.aplicar.series.includes(doc.serie));
  return disenos.find((d) => !d.por_defecto && (d.aplicar?.tipos?.length || d.aplicar?.series?.length) && encaja(d))
    || disenos.find((d) => d.por_defecto) || null;
}

export const existe = (ruta) => !!ruta && fs.existsSync(ruta);
