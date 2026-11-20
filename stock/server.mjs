// Plugin «Control de stock» (almacén único).
// - Solo los productos con el control activado; los servicios nunca se activan.
// - Salidas: al EMITIR un albarán de venta, o una factura que no venga de un albarán ya descontado (nunca en borradores).
//   Las rectificativas (cantidades negativas) devuelven las unidades: es el movimiento compensatorio.
// - Entradas: el usuario confirma la mercancía recibida de las compras (emitir una factura de proveedor no implica que haya llegado).
// - Cada movimiento automático tiene una clave única (documento + línea): reintentos o repeticiones no duplican nada.
const AJUSTE = 'plugin_stock';
const r3 = (n) => Math.round(n * 1000) / 1000;

export function register(ctx) {
  const { router, db, requiereAdmin, auditar } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS plugin_stock_productos(
      producto_id INTEGER PRIMARY KEY, controlar INTEGER NOT NULL DEFAULT 1, minimo REAL NOT NULL DEFAULT 0, permitir_negativo INTEGER NOT NULL DEFAULT 0, actualizado TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plugin_stock_movimientos(
      id INTEGER PRIMARY KEY, producto_id INTEGER NOT NULL, fecha TEXT NOT NULL, cantidad REAL NOT NULL, tipo TEXT NOT NULL,
      documento_id INTEGER, linea_id INTEGER, motivo TEXT DEFAULT '', usuario TEXT, creado TEXT DEFAULT (datetime('now')), clave TEXT UNIQUE
    ); CREATE INDEX IF NOT EXISTS idx_stock_prod ON plugin_stock_movimientos(producto_id, fecha);`);

  const config = () => ({ salida: 'albaran', ...(ctx.getAjuste(AJUSTE, {}) || {}) }); // salida: albaran (albarán o factura sin albarán) | factura
  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { const st = e.status || 500; if (st === 500) console.error('[stock]', e); res.status(st).json({ error: st === 500 ? 'Error interno' : e.message }); }
  };
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const controlado = (pid) => db.prepare('SELECT * FROM plugin_stock_productos WHERE producto_id = ? AND controlar = 1').get(pid);
  const existencias = (pid) => r3(db.prepare('SELECT COALESCE(SUM(cantidad), 0) AS s FROM plugin_stock_movimientos WHERE producto_id = ?').get(pid).s);
  const insertar = db.prepare(`INSERT OR IGNORE INTO plugin_stock_movimientos(producto_id, fecha, cantidad, tipo, documento_id, linea_id, motivo, usuario, clave) VALUES (?,?,?,?,?,?,?,?,?)`);

  /** ¿Este documento de venta mueve stock al emitirse? */
  function mueveStock(doc) {
    const c = config();
    if (doc.tipo === 'albaran') return c.salida === 'albaran';
    if (doc.tipo !== 'factura') return false;
    // una rectificativa compensa solo si la factura original movió stock
    if (doc.rectifica_id) return !!db.prepare('SELECT 1 FROM plugin_stock_movimientos WHERE documento_id = ? LIMIT 1').get(doc.rectifica_id);
    if (c.salida === 'factura') return true;
    // si la factura viene de albaranes, ya se descontó al emitirlos
    const deAlbaran = db.prepare("SELECT 1 FROM documentos_origen x JOIN documentos o ON o.id = x.origen_id WHERE x.documento_id = ? AND o.tipo = 'albaran' AND o.numero IS NOT NULL").get(doc.id);
    if (deAlbaran) return false;
    return true;
  }
  const lineasControladas = (doc) => (doc.lineas || []).filter((l) => l.producto_id && controlado(l.producto_id));

  // Antes de emitir: impedir stock negativo en los productos que no lo permiten
  ctx.extender('documento.validarEmision', (doc) => {
    if (!mueveStock(doc)) return null;
    const falta = [];
    const porProducto = new Map();
    for (const l of lineasControladas(doc)) porProducto.set(l.producto_id, (porProducto.get(l.producto_id) || 0) + Number(l.cantidad));
    for (const [pid, cant] of porProducto) {
      const p = controlado(pid);
      if (cant > 0 && !p.permitir_negativo && existencias(pid) - cant < -0.0005) {
        const nombre = db.prepare('SELECT descripcion FROM productos WHERE id = ?').get(pid)?.descripcion || `producto ${pid}`;
        falta.push(`${nombre} (hay ${existencias(pid)}, se necesitan ${r3(cant)})`);
      }
    }
    return falta.length ? `No hay existencias suficientes: ${falta.join('; ')}. Registra la entrada de mercancía o permite stock negativo en ese producto.` : null;
  });

  ctx.hooks.on('documento.emitido', (doc) => {
    try {
      if (!mueveStock(doc)) return;
      for (const l of lineasControladas(doc)) {
        const cant = -Number(l.cantidad);
        if (!cant) continue;
        insertar.run(l.producto_id, doc.fecha, cant, cant < 0 ? 'venta' : 'devolucion', doc.id, l.id, `${doc.tipo === 'albaran' ? 'Albarán' : doc.rectifica_id ? 'Rectificativa' : 'Factura'} ${doc.codigo}`, 'automático', `doc:${doc.id}:linea:${l.id}`);
      }
    } catch (e) { console.error('[stock] al emitir:', e.message); }
  });

  // Aviso de productos bajo mínimo
  ctx.extender('avisos', () => {
    const bajos = resumen().filter((p) => p.controlar && p.existencias <= p.minimo && (p.minimo > 0 || p.existencias <= 0));
    return bajos.length ? [{ titulo: `${bajos.length} producto${bajos.length > 1 ? 's' : ''} con poco stock`, detalle: bajos.slice(0, 3).map((p) => `${p.descripcion}: ${p.existencias}`).join(' · '), enlace: '/p/stock' }] : [];
  });

  function resumen() {
    return db.prepare(`SELECT p.id, p.referencia, p.descripcion, p.precio, p.activo, s.controlar, COALESCE(s.minimo, 0) AS minimo, COALESCE(s.permitir_negativo, 0) AS permitir_negativo,
        COALESCE((SELECT SUM(cantidad) FROM plugin_stock_movimientos m WHERE m.producto_id = p.id), 0) AS existencias,
        (SELECT MAX(fecha) FROM plugin_stock_movimientos m WHERE m.producto_id = p.id) AS ultimo
      FROM productos p LEFT JOIN plugin_stock_productos s ON s.producto_id = p.id ORDER BY p.descripcion COLLATE NOCASE`).all()
      .map((p) => ({ ...p, controlar: !!p.controlar, permitir_negativo: !!p.permitir_negativo, existencias: r3(p.existencias) }));
  }

  // ---- API ----
  router.get('/config', (_req, res) => res.json(config()));
  router.put('/config', requiereAdmin, (req, res) => { ctx.setAjuste(AJUSTE, { salida: req.body?.salida === 'factura' ? 'factura' : 'albaran' }); auditar(req, 'stock.config', ''); res.json({ ok: true }); });
  router.get('/productos', (_req, res) => res.json(resumen()));
  router.put('/productos/:id', envolver(async (req, res) => {
    const p = db.prepare('SELECT * FROM productos WHERE id = ?').get(Number(req.params.id));
    if (!p) throw err('Producto no encontrado', 404);
    const b = req.body || {};
    const antes = db.prepare('SELECT * FROM plugin_stock_productos WHERE producto_id = ?').get(p.id);
    db.prepare(`INSERT INTO plugin_stock_productos(producto_id, controlar, minimo, permitir_negativo) VALUES (?,?,?,?)
      ON CONFLICT(producto_id) DO UPDATE SET controlar = excluded.controlar, minimo = excluded.minimo, permitir_negativo = excluded.permitir_negativo, actualizado = datetime('now')`)
      .run(p.id, b.controlar ? 1 : 0, Math.max(0, Number(b.minimo) || 0), b.permitir_negativo ? 1 : 0);
    // Cantidad inicial: solo al activar el control por primera vez
    if (b.controlar && !antes && Number(b.inicial)) insertar.run(p.id, new Date().toLocaleDateString('sv-SE'), r3(Number(b.inicial)), 'inicial', null, null, 'Existencias iniciales', req.usuario.usuario, `inicial:${p.id}`);
    auditar(req, 'stock.producto', `${p.descripcion}: control ${b.controlar ? 'sí' : 'no'}, mínimo ${b.minimo || 0}`);
    res.json({ ok: true });
  }));
  router.post('/productos/:id/ajuste', envolver(async (req, res) => {
    const pid = Number(req.params.id);
    if (!controlado(pid)) throw err('Activa primero el control de stock del producto.');
    const b = req.body || {};
    const motivo = String(b.motivo || '').trim().slice(0, 200);
    if (!motivo) throw err('Indica el motivo del ajuste (rotura, inventario, regalo…).');
    let cant = Number(b.cantidad);
    if (b.modo === 'recuento') cant = r3(Number(b.cantidad) - existencias(pid));
    if (!Number.isFinite(cant) || cant === 0) throw err(b.modo === 'recuento' ? 'El recuento coincide con las existencias: no hay nada que ajustar.' : 'Indica la cantidad (positiva para sumar, negativa para restar).');
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha) ? b.fecha : new Date().toLocaleDateString('sv-SE');
    db.prepare('INSERT INTO plugin_stock_movimientos(producto_id, fecha, cantidad, tipo, motivo, usuario) VALUES (?,?,?,?,?,?)').run(pid, fecha, r3(cant), 'ajuste', `${motivo}${b.observaciones ? ` · ${String(b.observaciones).slice(0, 300)}` : ''}`, req.usuario.usuario);
    auditar(req, 'stock.ajuste', `producto ${pid}: ${cant > 0 ? '+' : ''}${r3(cant)} (${motivo})`);
    res.json({ existencias: existencias(pid) });
  }));
  router.get('/productos/:id/movimientos', envolver(async (req, res) => {
    const pid = Number(req.params.id), w = ['m.producto_id = ?'], p = [pid];
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '')) { w.push('m.fecha >= ?'); p.push(req.query.desde); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '')) { w.push('m.fecha <= ?'); p.push(req.query.hasta); }
    const l = db.prepare(`SELECT m.*, d.tipo AS doc_tipo FROM plugin_stock_movimientos m LEFT JOIN documentos d ON d.id = m.documento_id WHERE ${w.join(' AND ')} ORDER BY m.fecha, m.id`).all(...p);
    let saldo = r3(db.prepare(`SELECT COALESCE(SUM(cantidad), 0) AS s FROM plugin_stock_movimientos WHERE producto_id = ? ${req.query.desde ? 'AND fecha < ?' : 'AND 0'}`).get(...[pid, req.query.desde].filter(Boolean)).s);
    const inicial = saldo;
    res.json({ inicial, movimientos: l.map((m) => ({ ...m, saldo: (saldo = r3(saldo + m.cantidad)) })) });
  }));

  // ---- Recepción de compras: líneas de albaranes/facturas de proveedor con unidades aún sin recibir ----
  function porRecibir() {
    return db.prepare(`SELECT l.id AS linea_id, l.producto_id, l.descripcion, l.cantidad, d.id AS documento_id, d.tipo, d.codigo, d.numero_proveedor, d.fecha,
        json_extract(d.cliente, '$.nombre') AS proveedor,
        COALESCE((SELECT SUM(cantidad) FROM plugin_stock_movimientos m WHERE m.linea_id = l.id AND m.tipo = 'compra'), 0) AS recibido
      FROM lineas l JOIN documentos d ON d.id = l.documento_id JOIN plugin_stock_productos s ON s.producto_id = l.producto_id AND s.controlar = 1
      WHERE d.tipo IN ('albaran_compra', 'factura_compra', 'pedido_compra') AND d.numero IS NOT NULL AND l.cantidad > 0
        AND NOT (d.tipo = 'factura_compra' AND EXISTS (SELECT 1 FROM documentos_origen x JOIN documentos o ON o.id = x.origen_id WHERE x.documento_id = d.id AND o.tipo = 'albaran_compra'))
      ORDER BY d.fecha, d.id`).all().filter((l) => l.recibido < l.cantidad - 0.0005).map((l) => ({ ...l, pendiente: r3(l.cantidad - l.recibido) }));
  }
  router.get('/recepciones', (_req, res) => res.json(porRecibir()));
  router.post('/recepciones', envolver(async (req, res) => {
    const pend = new Map(porRecibir().map((l) => [l.linea_id, l]));
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.fecha) ? req.body.fecha : new Date().toLocaleDateString('sv-SE');
    let n = 0;
    for (const x of Array.isArray(req.body?.lineas) ? req.body.lineas : []) {
      const l = pend.get(Number(x.linea_id)), cant = r3(Number(x.cantidad));
      if (!l || !(cant > 0)) continue;
      if (cant > l.pendiente + 0.0005) throw err(`En «${l.descripcion}» quedan ${l.pendiente} unidades por recibir.`);
      db.prepare('INSERT INTO plugin_stock_movimientos(producto_id, fecha, cantidad, tipo, documento_id, linea_id, motivo, usuario) VALUES (?,?,?,?,?,?,?,?)')
        .run(l.producto_id, fecha, cant, 'compra', l.documento_id, l.linea_id, `Recibido: ${l.codigo}${l.numero_proveedor ? ` (${l.numero_proveedor})` : ''}`, req.usuario.usuario);
      n++;
    }
    if (!n) throw err('Indica las unidades recibidas.');
    auditar(req, 'stock.recepcion', `${n} línea(s)`);
    res.json({ ok: true, lineas: n });
  }));
}
