// Plugin «Diseño de PDF»: diseños configurables por tipo de documento y serie (plantilla, colores, fuente, logo,
// columnas, textos, marca de agua), firma manuscrita o sello en imagen, y firma digital con certificado (FNMT…).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dibujar, elegirDiseno, DISENO_DEFECTO, PLANTILLAS } from './lib/render.mjs';
import { leerCertificado, firmarPdf } from './lib/firma.mjs';

const HEX = /^#[0-9a-f]{6}$/i;
const TIPOS_DOC = ['factura', 'presupuesto', 'proforma', 'pedido', 'albaran', 'pedido_compra', 'presupuesto_compra', 'albaran_compra', 'factura_compra', 'gasto'];
const ARCHIVO = /^[a-f0-9]{24}\.(png|jpg|ttf|otf)$/;

export function register(ctx) {
  const { router, requiereAdmin, auditar, express, db } = ctx;
  const dirArchivos = path.join(ctx.dataDir, 'archivos');
  fs.mkdirSync(dirArchivos, { recursive: true });
  const rutaDisenos = path.join(ctx.dataDir, 'disenos.json');
  const rutaCert = path.join(ctx.dataDir, 'certificado.json');

  const leerDisenos = () => {
    try { return JSON.parse(fs.readFileSync(rutaDisenos, 'utf8')); } catch { return [{ ...DISENO_DEFECTO, por_defecto: true }]; }
  };
  const archivo = (id) => (ARCHIVO.test(String(id || '')) && fs.existsSync(path.join(dirArchivos, id)) ? path.join(dirArchivos, id) : null);

  /** Certificado guardado (cifrado). Devuelve { p12, clave, info } o null. */
  const certificado = () => {
    try {
      const c = JSON.parse(fs.readFileSync(rutaCert, 'utf8'));
      return { p12: Buffer.from(ctx.descifrar(c.p12) || '', 'base64'), clave: ctx.descifrar(c.clave) || '', info: c.info };
    } catch { return null; }
  };

  /** Valida y normaliza un diseño enviado desde la pantalla del plugin. */
  function limpiar(d, i) {
    const txt = (v, max) => String(v ?? '').slice(0, max);
    const color = (v, def) => (HEX.test(v || '') ? v.toUpperCase() : def);
    const c = d.colores || {};
    const id = /^[a-z0-9-]{1,40}$/.test(d.id || '') ? d.id : `diseno-${i + 1}`;
    return {
      id, nombre: txt(d.nombre, 60) || `Diseño ${i + 1}`,
      plantilla: PLANTILLAS[d.plantilla] ? d.plantilla : 'moderna',
      colores: {
        primario: color(c.primario, '#0F6CBD'), sobre_primario: color(c.sobre_primario, '#FFFFFF'), texto: color(c.texto, '#000000'),
        suave: color(c.suave, '#F5F5F5'), gris: color(c.gris, '#616161'),
      },
      fuente: ['Helvetica', 'Times', 'Courier', 'personalizada'].includes(d.fuente) ? d.fuente : 'Helvetica',
      fuente_archivo: ARCHIVO.test(d.fuente_archivo || '') ? d.fuente_archivo : null,
      fuente_negrita_archivo: ARCHIVO.test(d.fuente_negrita_archivo || '') ? d.fuente_negrita_archivo : null,
      tamano: Math.max(7, Math.min(12, Number(d.tamano) || 9)),
      logo: { archivo: ARCHIVO.test(d.logo?.archivo || '') ? d.logo.archivo : null, posicion: ['izquierda', 'centro', 'derecha'].includes(d.logo?.posicion) ? d.logo.posicion : 'izquierda', ancho: Math.max(30, Math.min(220, Number(d.logo?.ancho) || 110)) },
      mostrar_datos_empresa: d.mostrar_datos_empresa !== false,
      columnas: {
        referencia: !!d.columnas?.referencia, cantidad: d.columnas?.cantidad !== false, precio: d.columnas?.precio !== false,
        dto: d.columnas?.dto === true ? true : d.columnas?.dto === false ? false : 'auto', iva: d.columnas?.iva !== false, importe: d.columnas?.importe !== false,
      },
      textos: {
        titulos: Object.fromEntries(Object.entries(d.textos?.titulos || {}).filter(([k, v]) => TIPOS_DOC.includes(k) && v).map(([k, v]) => [k, txt(v, 40)])),
        cabecera: txt(d.textos?.cabecera, 1000), pie: txt(d.textos?.pie, 1500), condiciones: txt(d.textos?.condiciones, 3000),
      },
      marca_agua: { texto: txt(d.marca_agua?.texto, 30), opacidad: Math.max(0.03, Math.min(0.4, Number(d.marca_agua?.opacidad) || 0.08)) },
      sello: { archivo: ARCHIVO.test(d.sello?.archivo || '') ? d.sello.archivo : null, texto: txt(d.sello?.texto, 200), ancho: Math.max(60, Math.min(220, Number(d.sello?.ancho) || 120)), posicion: d.sello?.posicion === 'izquierda' ? 'izquierda' : 'derecha' },
      firma_digital: !!d.firma_digital,
      aplicar: { tipos: (d.aplicar?.tipos || []).filter((t) => TIPOS_DOC.includes(t)), series: (d.aplicar?.series || []).map((s) => txt(s, 10)).filter(Boolean) },
      por_defecto: !!d.por_defecto,
    };
  }

  /** Referencias de producto de las líneas (para la columna «Ref.»). */
  const referencias = (lineas) => {
    const ids = [...new Set(lineas.map((l) => l.producto_id).filter(Boolean))];
    if (!ids.length) return new Map();
    return new Map(db.prepare(`SELECT id, referencia FROM productos WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => [r.id, r.referencia]));
  };

  const generar = (params, diseno) => dibujar(params, diseno, ctx.lib, {
    archivo, referencias: referencias(params.doc.lineas), certificado: certificado()?.info || null,
  });

  // ---- Puntos de extensión del núcleo ----
  // Logotipo del diseño por defecto, para otros plugins (p. ej. el estado de cuenta)
  ctx.extender('logo', () => { const l = leerDisenos(); const d = l.find((x) => x.por_defecto) || l[0]; return archivo(d?.logo?.archivo); });
  ctx.extender('pdf.generar', (params) => {
    const d = elegirDiseno(leerDisenos(), params.doc);
    return d ? generar(params, d) : null;
  });
  ctx.extender('pdf.postprocesar', async (buffer, doc) => {
    if (doc.estado === 'borrador') return buffer; // los borradores no se firman
    const d = elegirDiseno(leerDisenos(), doc);
    const cert = certificado();
    if (!d?.firma_digital || !cert) return buffer;
    const empresa = ctx.getAjuste('empresa', {});
    return firmarPdf(buffer, cert.p12, cert.clave, {
      razon: `${doc.tipo === 'factura' ? 'Factura' : 'Documento'} ${doc.codigo} emitido por ${empresa.razon_social || ''}`.trim(),
      lugar: empresa.ciudad || '', contacto: empresa.email || '', nombre: cert.info.titular,
    });
  });

  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  };

  router.use(requiereAdmin);
  router.get('/estado', envolver((_req, res) => {
    const series = db.prepare('SELECT codigo, descripcion FROM series ORDER BY codigo').all();
    const archivos = fs.readdirSync(dirArchivos).filter((f) => ARCHIVO.test(f)).map((f) => {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(dirArchivos, `${f}.json`), 'utf8')); } catch { /* sin datos */ }
      return { id: f, ...meta };
    });
    const cert = certificado();
    res.json({ disenos: leerDisenos(), plantillas: PLANTILLAS, series, archivos, certificado: cert ? cert.info : null });
  }));
  router.put('/disenos', envolver((req, res) => {
    const lista = (Array.isArray(req.body.disenos) ? req.body.disenos : []).slice(0, 30).map(limpiar);
    if (!lista.length) throw new Error('Debe haber al menos un diseño');
    if (!lista.some((d) => d.por_defecto)) lista[0].por_defecto = true;
    if (new Set(lista.map((d) => d.id)).size !== lista.length) throw new Error('Hay diseños con el mismo id');
    fs.writeFileSync(rutaDisenos, JSON.stringify(lista, null, 2));
    auditar(req, 'pdf.disenos', `${lista.length} diseños`);
    res.json(lista);
  }));
  // Archivos: logo, firma/sello (PNG/JPG) y fuentes (TTF/OTF)
  router.post('/archivos', express.raw({ type: () => true, limit: 5 * 1024 * 1024 }), envolver((req, res) => {
    const b = req.body;
    if (!Buffer.isBuffer(b) || b.length < 32) throw new Error('Archivo vacío');
    const ext = b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.subarray(1, 4).toString() === 'PNG' ? 'png'
      : b.readUInt32BE(0) === 0x00010000 || b.subarray(0, 4).toString() === 'true' ? 'ttf' : b.subarray(0, 4).toString() === 'OTTO' ? 'otf' : null;
    if (!ext) throw new Error('Formato no admitido: imágenes PNG o JPG, fuentes TTF u OTF');
    const id = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dirArchivos, id), b);
    let nombre = '';
    try { nombre = decodeURIComponent(String(req.headers['x-nombre-archivo'] || '')).replace(/[^\w .()-]/g, '').slice(0, 80); } catch { /* sin nombre */ }
    fs.writeFileSync(path.join(dirArchivos, `${id}.json`), JSON.stringify({ nombre, tipo: ext }));
    res.status(201).json({ id, nombre, tipo: ext });
  }));
  router.get('/archivos/:id', envolver((req, res) => {
    const ruta = archivo(req.params.id);
    if (!ruta || !/\.(png|jpg)$/.test(ruta)) throw Object.assign(new Error('No encontrado'), { status: 404 });
    res.setHeader('Content-Type', ruta.endsWith('.png') ? 'image/png' : 'image/jpeg');
    fs.createReadStream(ruta).pipe(res);
  }));
  router.delete('/archivos/:id', envolver((req, res) => {
    const ruta = archivo(req.params.id);
    if (ruta) { fs.rmSync(ruta, { force: true }); fs.rmSync(`${ruta}.json`, { force: true }); }
    res.json({ ok: true });
  }));
  // Certificado digital (.p12/.pfx) para firmar los PDF. Se guarda cifrado; nunca se devuelve.
  router.post('/certificado', envolver((req, res) => {
    const p12 = Buffer.from(String(req.body.archivo || ''), 'base64');
    const clave = String(req.body.clave || '');
    if (p12.length < 100 || p12.length > 200_000) throw new Error('Sube el archivo .p12 o .pfx del certificado');
    const info = leerCertificado(p12, clave);
    if (new Date(info.valido_hasta) < new Date()) throw new Error(`El certificado caducó el ${info.valido_hasta.slice(0, 10)}`);
    fs.writeFileSync(rutaCert, JSON.stringify({ p12: ctx.cifrar(p12.toString('base64')), clave: ctx.cifrar(clave), info }), { mode: 0o600 });
    auditar(req, 'pdf.certificado', `${info.titular} (${info.emisor}) hasta ${info.valido_hasta.slice(0, 10)}`, 'alerta');
    res.json(info);
  }));
  router.delete('/certificado', envolver((req, res) => {
    fs.rmSync(rutaCert, { force: true });
    auditar(req, 'pdf.certificado_quitar', '', 'aviso');
    res.json({ ok: true });
  }));
  // Vista previa de un diseño (sin guardar) con el último documento del tipo elegido o uno de ejemplo
  router.post('/vista-previa', envolver(async (req, res) => {
    const d = limpiar(req.body.diseno || {}, 0);
    const tipo = TIPOS_DOC.includes(req.body.tipo) ? req.body.tipo : 'factura';
    const fila = db.prepare('SELECT id FROM documentos WHERE tipo = ? ORDER BY (numero IS NULL), id DESC LIMIT 1').get(tipo);
    const params = fila ? await ctx.parametrosPdf(fila.id) : null;
    const doc = params?.doc || ejemplo(tipo, ctx);
    const empresa = ctx.getAjuste('empresa', {});
    const pdf = generar(params || { doc, empresa, formaPago: null, sinValorar: false, firma: tipo === 'albaran' ? {} : null, vencimientos: null }, d);
    const trozos = [];
    pdf.on('data', (t) => trozos.push(t));
    await new Promise((ok) => { pdf.on('end', ok); pdf.end(); });
    res.setHeader('Content-Type', 'application/pdf');
    res.end(Buffer.concat(trozos));
  }));
}

/** Documento de ejemplo para la vista previa cuando aún no hay ninguno de ese tipo. */
function ejemplo(tipo, ctx) {
  const lineas = [
    { descripcion: 'Porte Madrid - Valencia (ida)', cantidad: 2, precio: 450, dto: 0, iva: 21, irpf: 0, recargo: 0, operacion: 'S1' },
    { descripcion: 'Hora de espera en carga', cantidad: 3, precio: 35, dto: 0, iva: 21, irpf: 0, recargo: 0, operacion: 'S1' },
    { descripcion: 'Transporte para exportación (Algeciras)', cantidad: 1, precio: 900, dto: 5, iva: 0, irpf: 0, recargo: 0, operacion: 'E2' },
  ];
  return {
    id: 0, tipo, codigo: 'EJEMPLO/2026', fecha: new Date().toISOString().slice(0, 10), vencimiento: null, estado: 'emitida', referencia: 'PED-0042',
    cliente: { nombre: 'Cliente de ejemplo SL', nif: 'B12345674', direccion: 'Polígono Industrial Norte, nave 4', cp: '28001', ciudad: 'Madrid', provincia: 'Madrid' },
    lineas, totales: ctx.lib.calcularTotales(lineas), observaciones: '',
  };
}
