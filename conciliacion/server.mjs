// Plugin «Conciliación bancaria»: importa extractos CSV y relaciona cada movimiento con recibos de 7Factura.
// - No se conecta al banco ni pide claves: el usuario descarga el CSV de su banca online.
// - Detecta importaciones repetidas (huella de cada movimiento) y conserva el movimiento original.
// - Nunca registra cobros o pagos sin que el usuario confirme la coincidencia; permite parciales y repartos.
import crypto from 'node:crypto';
import { leerCsv, importe as leerImporte, fecha as leerFecha, separadorProbable } from './lib/csv.mjs';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const r2 = (n) => Math.round(n * 100) / 100;
const diasEntre = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);

export function register(ctx) {
  const { router, db, requiereAdmin, auditar } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS plugin_banco_cuentas(
      id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, iban TEXT DEFAULT '', formato TEXT NOT NULL DEFAULT '{}', margen_dias INTEGER DEFAULT 10, creada TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plugin_banco_importaciones(
      id INTEGER PRIMARY KEY, cuenta_id INTEGER NOT NULL, archivo TEXT, fecha TEXT DEFAULT (datetime('now')), filas INTEGER, nuevas INTEGER, repetidas INTEGER, usuario TEXT
    );
    CREATE TABLE IF NOT EXISTS plugin_banco_movimientos(
      id INTEGER PRIMARY KEY, cuenta_id INTEGER NOT NULL, importacion_id INTEGER, fecha TEXT NOT NULL, concepto TEXT DEFAULT '', importe REAL NOT NULL,
      saldo REAL, referencia TEXT DEFAULT '', original TEXT, huella TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente', notas TEXT DEFAULT '',
      UNIQUE(cuenta_id, huella)
    );
    CREATE TABLE IF NOT EXISTS plugin_banco_conciliaciones(
      id INTEGER PRIMARY KEY, movimiento_id INTEGER NOT NULL, recibo_id INTEGER, documento_id INTEGER, cobro_id INTEGER, importe REAL NOT NULL,
      fecha TEXT DEFAULT (datetime('now')), usuario TEXT, deshecha INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS plugin_banco_reglas(
      id INTEGER PRIMARY KEY, texto TEXT NOT NULL, accion TEXT NOT NULL, tercero_tipo TEXT, tercero_id INTEGER
    );`);

  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { const st = e.status || 500; if (st === 500) console.error('[conciliacion]', e); res.status(st).json({ error: st === 500 ? 'Error interno' : e.message }); }
  };
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const cuenta = (id) => { const c = db.prepare('SELECT * FROM plugin_banco_cuentas WHERE id = ?').get(Number(id)); if (!c) throw err('Cuenta no encontrada', 404); return { ...c, formato: JSON.parse(c.formato || '{}') }; };

  // ---- Cuentas ----
  router.get('/cuentas', (_req, res) => res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM plugin_banco_movimientos m WHERE m.cuenta_id = c.id AND m.estado = 'pendiente') AS pendientes,
      (SELECT MAX(fecha) FROM plugin_banco_movimientos m WHERE m.cuenta_id = c.id) AS ultimo FROM plugin_banco_cuentas c ORDER BY c.nombre`).all().map((c) => ({ ...c, formato: JSON.parse(c.formato || '{}') }))));
  router.post('/cuentas', requiereAdmin, envolver(async (req, res) => {
    const b = req.body || {};
    const nombre = String(b.nombre || '').trim().slice(0, 80);
    if (!nombre) throw err('Pon un nombre a la cuenta (p. ej. «Banco Santander principal»).');
    const datos = [nombre, String(b.iban || '').replace(/\s/g, '').toUpperCase().slice(0, 34), JSON.stringify(b.formato || {}), Math.min(60, Math.max(0, Number(b.margen_dias) || 10))];
    if (b.id) db.prepare('UPDATE plugin_banco_cuentas SET nombre = ?, iban = ?, formato = ?, margen_dias = ? WHERE id = ?').run(...datos, Number(b.id));
    else b.id = Number(db.prepare('INSERT INTO plugin_banco_cuentas(nombre, iban, formato, margen_dias) VALUES (?,?,?,?)').run(...datos).lastInsertRowid);
    auditar(req, 'banco.cuenta', nombre);
    res.json(cuenta(b.id));
  }));
  router.delete('/cuentas/:id', requiereAdmin, envolver(async (req, res) => {
    const c = cuenta(req.params.id);
    if (db.prepare("SELECT 1 FROM plugin_banco_conciliaciones x JOIN plugin_banco_movimientos m ON m.id = x.movimiento_id WHERE m.cuenta_id = ? AND x.deshecha = 0 LIMIT 1").get(c.id)) throw err('La cuenta tiene movimientos conciliados: deshaz las conciliaciones antes de borrarla.', 409);
    db.prepare('DELETE FROM plugin_banco_movimientos WHERE cuenta_id = ?').run(c.id);
    db.prepare('DELETE FROM plugin_banco_cuentas WHERE id = ?').run(c.id);
    auditar(req, 'banco.cuenta.borrar', c.nombre, 'aviso');
    res.json({ ok: true });
  }));

  // ---- Importación ----
  /** Vista previa: filas leídas y detección del separador, para configurar las columnas. */
  router.post('/vista-previa', envolver(async (req, res) => {
    const texto = String(req.body?.texto || '');
    if (texto.length > 5_000_000) throw err('El archivo es demasiado grande (máximo 5 MB).');
    const sep = req.body?.separador || separadorProbable(texto);
    res.json({ separador: sep, filas: leerCsv(texto, sep).slice(0, 15) });
  }));

  function interpretar(texto, f) {
    const filas = leerCsv(texto, f.separador || separadorProbable(texto)).slice(Number(f.saltar) || 0);
    const col = (fila, k) => (f.columnas?.[k] === '' || f.columnas?.[k] == null ? '' : fila[Number(f.columnas[k])] ?? '');
    const out = [], malas = [];
    const vistos = new Map();
    filas.forEach((fila, i) => {
      const fecha = leerFecha(col(fila, 'fecha'), f.formato_fecha);
      let imp = col(fila, 'importe') !== '' ? leerImporte(col(fila, 'importe'), f.decimal) : null;
      if (imp == null && (f.columnas?.cargo !== '' || f.columnas?.abono !== '')) {
        const c = leerImporte(col(fila, 'cargo'), f.decimal) || 0, a = leerImporte(col(fila, 'abono'), f.decimal) || 0;
        imp = r2(a - Math.abs(c));
      }
      if (!fecha || imp == null || imp === 0) { malas.push(i + 1 + (Number(f.saltar) || 0)); return; }
      if (f.invertir) imp = -imp;
      const saldo = col(fila, 'saldo') !== '' ? leerImporte(col(fila, 'saldo'), f.decimal) : null;
      const concepto = [col(fila, 'concepto'), col(fila, 'concepto2')].filter(Boolean).join(' · ').slice(0, 500);
      const base = `${fecha}|${imp}|${norm(concepto)}|${saldo ?? ''}`;
      const n = (vistos.get(base) || 0) + 1; vistos.set(base, n); // movimientos idénticos el mismo día se distinguen por orden
      out.push({ fecha, importe: imp, saldo, concepto, referencia: String(col(fila, 'referencia')).slice(0, 120), original: JSON.stringify(fila), huella: crypto.createHash('sha256').update(`${base}|${n}`).digest('hex') });
    });
    return { movimientos: out, malas };
  }

  router.post('/cuentas/:id/importar', envolver(async (req, res) => {
    const c = cuenta(req.params.id);
    const texto = String(req.body?.texto || '');
    if (!texto || texto.length > 5_000_000) throw err('Sube un archivo CSV (máximo 5 MB).');
    const f = { ...c.formato, ...(req.body?.formato || {}) };
    if (f.columnas?.fecha == null || f.columnas.fecha === '' || (f.columnas?.importe === '' && f.columnas?.cargo === '' && f.columnas?.abono === '')) throw err('Indica qué columna es la fecha y cuál el importe (o cargo y abono).');
    const { movimientos, malas } = interpretar(texto, f);
    if (!movimientos.length) throw err(`No se ha leído ningún movimiento. Revisa las columnas, el formato de fecha y el separador decimal.${malas.length ? ` (${malas.length} filas no válidas)` : ''}`);
    if (req.body?.guardar_formato) db.prepare('UPDATE plugin_banco_cuentas SET formato = ? WHERE id = ?').run(JSON.stringify(f), c.id);
    const imp = Number(db.prepare('INSERT INTO plugin_banco_importaciones(cuenta_id, archivo, filas, nuevas, repetidas, usuario) VALUES (?,?,?,?,?,?)').run(c.id, String(req.body?.archivo || '').slice(0, 200), movimientos.length, 0, 0, req.usuario.usuario).lastInsertRowid);
    const ins = db.prepare(`INSERT OR IGNORE INTO plugin_banco_movimientos(cuenta_id, importacion_id, fecha, concepto, importe, saldo, referencia, original, huella) VALUES (?,?,?,?,?,?,?,?,?)`);
    let nuevas = 0;
    db.exec('BEGIN');
    try { for (const m of movimientos) nuevas += ins.run(c.id, imp, m.fecha, m.concepto, m.importe, m.saldo, m.referencia, m.original, m.huella).changes; db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    db.prepare('UPDATE plugin_banco_importaciones SET nuevas = ?, repetidas = ? WHERE id = ?').run(nuevas, movimientos.length - nuevas, imp);
    // Reglas de «ignorar» (p. ej. comisiones o traspasos internos)
    for (const r of db.prepare("SELECT * FROM plugin_banco_reglas WHERE accion = 'descartar'").all()) {
      db.prepare(`UPDATE plugin_banco_movimientos SET estado = 'descartado', notas = ? WHERE importacion_id = ? AND estado = 'pendiente' AND upper(concepto) LIKE ?`).run(`Regla: ${r.texto}`, imp, `%${r.texto.toUpperCase()}%`);
    }
    auditar(req, 'banco.importar', `${c.nombre}: ${nuevas} nuevos, ${movimientos.length - nuevas} repetidos`);
    res.json({ leidos: movimientos.length, nuevas, repetidas: movimientos.length - nuevas, filas_no_validas: malas });
  }));

  // ---- Movimientos y propuestas ----
  router.get('/cuentas/:id/movimientos', envolver(async (req, res) => {
    const c = cuenta(req.params.id);
    const estado = ['pendiente', 'conciliado', 'descartado'].includes(req.query.estado) ? req.query.estado : null;
    const filas = db.prepare(`SELECT * FROM plugin_banco_movimientos WHERE cuenta_id = ? ${estado ? 'AND estado = ?' : ''} ORDER BY fecha DESC, id DESC LIMIT 1000`).all(...[c.id, estado].filter((x) => x != null));
    const conc = db.prepare(`SELECT x.*, d.codigo, json_extract(d.cliente, '$.nombre') AS tercero FROM plugin_banco_conciliaciones x LEFT JOIN documentos d ON d.id = x.documento_id WHERE x.movimiento_id = ? AND x.deshecha = 0`);
    res.json(filas.map((m) => ({ ...m, original: undefined, conciliaciones: m.estado === 'conciliado' ? conc.all(m.id) : [] })));
  }));

  function recibosAbiertos(compra) {
    return db.prepare(`SELECT r.id AS recibo_id, r.numero, r.importe, r.vencimiento, d.id AS documento_id, d.tipo, d.codigo, d.numero_proveedor, d.fecha,
        json_extract(d.cliente, '$.nombre') AS tercero, json_extract(d.cliente, '$.nif') AS nif, d.cliente_id, d.proveedor_id,
        ROUND(r.importe - COALESCE((SELECT SUM(importe) FROM cobros WHERE recibo_id = r.id), 0), 2) AS pendiente
      FROM recibos r JOIN documentos d ON d.id = r.documento_id
      WHERE d.numero IS NOT NULL AND ${compra ? "d.tipo IN ('factura_compra', 'gasto')" : "d.tipo = 'factura'"}
        AND ABS(ROUND(r.importe - COALESCE((SELECT SUM(importe) FROM cobros WHERE recibo_id = r.id), 0), 2)) >= 0.005`).all();
  }

  /** Propuestas para un movimiento, ordenadas por puntuación (importe, referencia, nombre, fecha y reglas). */
  function propuestas(m, margen) {
    const compra = m.importe < 0, abs = Math.abs(m.importe), txt = norm(`${m.concepto} ${m.referencia}`);
    const reglas = db.prepare("SELECT * FROM plugin_banco_reglas WHERE accion = 'tercero'").all().filter((r) => txt.includes(norm(r.texto)));
    return recibosAbiertos(compra).map((r) => {
      let p = 0; const motivos = [];
      const pend = Math.abs(r.pendiente);
      if (Math.abs(pend - abs) < 0.006) { p += 50; motivos.push('mismo importe'); }
      else if (abs < pend) { p += 10; motivos.push('cobro parcial posible'); }
      const codigos = [r.codigo, r.numero_proveedor].filter(Boolean).map(norm);
      if (codigos.some((c) => c && (txt.includes(c) || txt.includes(c.replace(/ /g, ''))))) { p += 40; motivos.push('referencia de la factura'); }
      const nombre = norm(r.tercero), nif = norm(r.nif).replace(/ /g, '');
      const palabras = nombre.split(' ').filter((w) => w.length > 3 && !['SOCIEDAD', 'LIMITADA', 'ANONIMA'].includes(w));
      if (nif && txt.replace(/ /g, '').includes(nif)) { p += 30; motivos.push('NIF'); }
      else if (palabras.length && palabras.filter((w) => txt.includes(w)).length >= Math.min(2, palabras.length)) { p += 25; motivos.push('nombre'); }
      if (reglas.some((g) => (g.tercero_tipo === 'proveedor' ? r.proveedor_id : r.cliente_id) === g.tercero_id)) { p += 30; motivos.push('regla'); }
      const d = Math.abs(diasEntre(m.fecha, r.vencimiento));
      if (d <= margen) { p += 10 - Math.round((d / Math.max(margen, 1)) * 10); motivos.push(`${d} días del vencimiento`); }
      return { ...r, puntos: p, motivos };
    }).filter((r) => r.puntos >= 20).sort((a, b) => b.puntos - a.puntos).slice(0, 8);
  }

  router.get('/movimientos/:id/propuestas', envolver(async (req, res) => {
    const m = db.prepare('SELECT * FROM plugin_banco_movimientos WHERE id = ?').get(Number(req.params.id));
    if (!m) throw err('Movimiento no encontrado', 404);
    const c = cuenta(m.cuenta_id);
    res.json({ movimiento: { ...m, original: JSON.parse(m.original || '[]') }, propuestas: propuestas(m, c.margen_dias) });
  }));

  // Búsqueda manual de recibos abiertos (por factura, cliente o importe)
  router.get('/recibos', envolver(async (req, res) => {
    const q = norm(req.query.q), compra = req.query.tipo === 'pago';
    res.json(recibosAbiertos(compra).filter((r) => !q || norm(`${r.codigo} ${r.numero_proveedor} ${r.tercero} ${r.nif} ${r.pendiente}`).includes(q)).slice(0, 50));
  }));

  // Confirmar: registra los cobros/pagos repartiendo el importe del movimiento entre los recibos elegidos
  router.post('/movimientos/:id/conciliar', envolver(async (req, res) => {
    const m = db.prepare('SELECT * FROM plugin_banco_movimientos WHERE id = ?').get(Number(req.params.id));
    if (!m) throw err('Movimiento no encontrado', 404);
    if (m.estado !== 'pendiente') throw err('El movimiento ya está conciliado o descartado.', 409);
    const partes = (Array.isArray(req.body?.partes) ? req.body.partes : []).map((p) => ({ recibo_id: Number(p.recibo_id), importe: r2(Math.abs(Number(p.importe))) })).filter((p) => p.recibo_id && p.importe > 0);
    if (!partes.length) throw err('Elige al menos una factura y el importe.');
    const total = r2(partes.reduce((s, p) => s + p.importe, 0));
    if (total - Math.abs(m.importe) > 0.005) throw err(`El reparto (${total}) supera el importe del movimiento (${Math.abs(m.importe)}).`);
    const hechos = [];
    try {
      for (const p of partes) {
        const doc = db.prepare('SELECT d.tipo FROM recibos r JOIN documentos d ON d.id = r.documento_id WHERE r.id = ?').get(p.recibo_id);
        if (!doc) throw err('Recibo no encontrado', 404);
        const esCompra = ['factura_compra', 'gasto'].includes(doc.tipo);
        if (esCompra !== m.importe < 0) throw err('Un ingreso solo se puede conciliar con facturas de venta y un cargo con facturas de proveedor o gastos.');
        const signoRecibo = Math.sign(db.prepare('SELECT importe FROM recibos WHERE id = ?').get(p.recibo_id).importe);
        const c = await ctx.app.registrarCobro(p.recibo_id, { fecha: m.fecha, importe: p.importe * signoRecibo, notas: `Banco: ${m.concepto}`.slice(0, 300) }, req.usuario.id);
        hechos.push({ ...p, cobro_id: c.id, documento_id: c.documento_id });
      }
    } catch (e) {
      for (const h of hechos) await ctx.app.borrarCobro(h.cobro_id).catch(() => {}); // se deshace lo registrado si una parte falla
      throw e;
    }
    const ins = db.prepare('INSERT INTO plugin_banco_conciliaciones(movimiento_id, recibo_id, documento_id, cobro_id, importe, usuario) VALUES (?,?,?,?,?,?)');
    for (const h of hechos) ins.run(m.id, h.recibo_id, h.documento_id, h.cobro_id, h.importe, req.usuario.usuario);
    const resto = r2(Math.abs(m.importe) - total);
    db.prepare("UPDATE plugin_banco_movimientos SET estado = 'conciliado', notas = ? WHERE id = ?").run(resto > 0.005 ? `Sin asignar: ${resto.toFixed(2)} €. ${String(req.body?.notas || '')}`.trim() : String(req.body?.notas || '').slice(0, 300), m.id);
    if (req.body?.regla && hechos[0]) {
      const d = db.prepare('SELECT cliente_id, proveedor_id FROM documentos WHERE id = ?').get(hechos[0].documento_id);
      const texto = String(req.body.regla).trim().slice(0, 80);
      if (texto) db.prepare('INSERT INTO plugin_banco_reglas(texto, accion, tercero_tipo, tercero_id) VALUES (?,?,?,?)').run(texto, 'tercero', d.proveedor_id ? 'proveedor' : 'cliente', d.proveedor_id || d.cliente_id);
    }
    auditar(req, 'banco.conciliar', `movimiento ${m.id} (${m.importe}) → ${hechos.map((h) => `recibo ${h.recibo_id}: ${h.importe}`).join(', ')}`);
    ctx.hooks.emit('banco.conciliado', { movimiento: m, partes: hechos });
    res.json({ ok: true, sin_asignar: resto });
  }));

  // Deshacer una conciliación: anula los cobros que se registraron y deja el movimiento pendiente
  router.post('/movimientos/:id/deshacer', envolver(async (req, res) => {
    const m = db.prepare('SELECT * FROM plugin_banco_movimientos WHERE id = ?').get(Number(req.params.id));
    if (!m || m.estado !== 'conciliado') throw err('El movimiento no está conciliado.', 409);
    for (const x of db.prepare('SELECT * FROM plugin_banco_conciliaciones WHERE movimiento_id = ? AND deshecha = 0').all(m.id)) {
      if (x.cobro_id) await ctx.app.borrarCobro(x.cobro_id).catch(() => {});
      db.prepare('UPDATE plugin_banco_conciliaciones SET deshecha = 1 WHERE id = ?').run(x.id);
    }
    db.prepare("UPDATE plugin_banco_movimientos SET estado = 'pendiente', notas = '' WHERE id = ?").run(m.id);
    auditar(req, 'banco.deshacer', `movimiento ${m.id}`, 'aviso');
    res.json({ ok: true });
  }));

  router.post('/movimientos/:id/estado', envolver(async (req, res) => {
    const m = db.prepare('SELECT * FROM plugin_banco_movimientos WHERE id = ?').get(Number(req.params.id));
    if (!m || m.estado === 'conciliado') throw err('Solo se pueden descartar o recuperar movimientos sin conciliar.', 409);
    const estado = req.body?.estado === 'descartado' ? 'descartado' : 'pendiente';
    db.prepare('UPDATE plugin_banco_movimientos SET estado = ?, notas = ? WHERE id = ?').run(estado, String(req.body?.notas || '').slice(0, 300), m.id);
    if (estado === 'descartado' && req.body?.regla) db.prepare("INSERT INTO plugin_banco_reglas(texto, accion) VALUES (?, 'descartar')").run(String(req.body.regla).trim().slice(0, 80));
    res.json({ ok: true });
  }));

  // ---- Reglas ----
  router.get('/reglas', (_req, res) => res.json(db.prepare(`SELECT g.*, COALESCE(c.nombre, p.nombre) AS tercero FROM plugin_banco_reglas g
    LEFT JOIN clientes c ON g.tercero_tipo = 'cliente' AND c.id = g.tercero_id LEFT JOIN proveedores p ON g.tercero_tipo = 'proveedor' AND p.id = g.tercero_id ORDER BY g.id DESC`).all()));
  router.delete('/reglas/:id', envolver(async (req, res) => { db.prepare('DELETE FROM plugin_banco_reglas WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); }));

  // ---- Exportar el resultado (CSV) ----
  router.get('/cuentas/:id/exportar', envolver(async (req, res) => {
    const c = cuenta(req.params.id);
    const filas = db.prepare(`SELECT m.fecha, m.concepto, m.importe, m.saldo, m.estado, m.notas,
        (SELECT group_concat(d.codigo || ' (' || printf('%.2f', x.importe) || ')', ' + ') FROM plugin_banco_conciliaciones x JOIN documentos d ON d.id = x.documento_id WHERE x.movimiento_id = m.id AND x.deshecha = 0) AS documentos
      FROM plugin_banco_movimientos m WHERE m.cuenta_id = ? ORDER BY m.fecha, m.id`).all(c.id);
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['Fecha;Concepto;Importe;Saldo;Estado;Documentos;Notas', ...filas.map((f) => [f.fecha, f.concepto, String(f.importe).replace('.', ','), f.saldo == null ? '' : String(f.saldo).replace('.', ','), f.estado, f.documentos || '', f.notas].map(q).join(';'))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="conciliacion-${c.nombre.replace(/[^\w-]+/g, '-')}.csv"`);
    res.send(`﻿${csv}`);
  }));
}
