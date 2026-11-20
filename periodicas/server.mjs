// Plugin «Facturación periódica»: plantillas que preparan facturas en BORRADOR en cada periodo.
// - Nunca emite: el usuario revisa y emite el borrador como cualquier otro.
// - Un periodo por plantilla (índice único): no se repiten facturas aunque la tarea se ejecute varias veces.
// - Si la aplicación estuvo apagada, al arrancar prepara los borradores de los periodos pendientes.
// - Las facturas se crean con la API del núcleo (mismas validaciones y cálculos fiscales); cambiar la plantilla no toca
//   las facturas ya creadas.
const PERIODOS = { semanal: { dias: 7 }, mensual: { meses: 1 }, trimestral: { meses: 3 }, semestral: { meses: 6 }, anual: { meses: 12 } };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const iso = (d) => d.toLocaleDateString('sv-SE');
const hoy = () => iso(new Date());

/** Fecha del periodo siguiente. En los mensuales se respeta el día elegido (o el último del mes si no existe). */
export function siguiente(fecha, periodicidad, dia) {
  const p = PERIODOS[periodicidad];
  const d = new Date(`${fecha}T12:00:00`);
  if (p.dias) { d.setDate(d.getDate() + p.dias); return iso(d); }
  const objetivo = Number(dia) || d.getDate();
  const n = new Date(d.getFullYear(), d.getMonth() + p.meses, 1, 12);
  const ultimo = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
  n.setDate(Math.min(objetivo, ultimo));
  return iso(n);
}
/** Texto del periodo para sustituir {periodo}, {mes}, {año}, {trimestre} en las líneas. */
function etiquetas(fecha, periodicidad) {
  const d = new Date(`${fecha}T12:00:00`), m = d.getMonth(), a = d.getFullYear();
  const t = Math.floor(m / 3) + 1, s = m < 6 ? 1 : 2;
  const periodo = { semanal: `semana del ${d.toLocaleDateString('es-ES')}`, mensual: `${MESES[m]} de ${a}`, trimestral: `${t}.º trimestre de ${a}`, semestral: `${s}.º semestre de ${a}`, anual: `${a}` }[periodicidad];
  return { periodo, mes: MESES[m], año: String(a), trimestre: `${t}.º trimestre`, fecha: d.toLocaleDateString('es-ES') };
}

export function register(ctx) {
  const { router, db, requiereAdmin, auditar } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS plugin_periodicas(
      id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, cliente_id INTEGER NOT NULL, serie TEXT, forma_pago TEXT, dias_vencimiento INTEGER,
      periodicidad TEXT NOT NULL, dia INTEGER, inicio TEXT NOT NULL, fin TEXT, proxima TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'activa',
      lineas TEXT NOT NULL, observaciones TEXT DEFAULT '', referencia TEXT DEFAULT '', notas TEXT DEFAULT '', usuario_id INTEGER,
      creado TEXT DEFAULT (datetime('now')), actualizado TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS plugin_periodicas_generadas(
      id INTEGER PRIMARY KEY, plantilla_id INTEGER NOT NULL, periodo TEXT NOT NULL, documento_id INTEGER, fecha TEXT DEFAULT (datetime('now')), error TEXT,
      UNIQUE(plantilla_id, periodo)
    );`);

  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { const st = e.status || 500; if (st === 500) console.error('[periodicas]', e); res.status(st).json({ error: st === 500 ? 'Error interno' : e.message }); }
  };
  const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
  const fechaOk = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
  const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };
  const leer = (p) => ({ ...p, lineas: JSON.parse(p.lineas || '[]') });

  // ---- Generación de borradores ----
  let ocupado = false;
  async function generar() {
    if (ocupado) return [];
    ocupado = true;
    const creadas = [];
    try {
      const h = hoy();
      for (const p of db.prepare("SELECT * FROM plugin_periodicas WHERE estado = 'activa' AND proxima <= ?").all(h).map(leer)) {
        let fecha = p.proxima, vueltas = 0;
        while (fecha <= h && (!p.fin || fecha <= p.fin) && vueltas++ < 60) {
          const ya = db.prepare('SELECT 1 FROM plugin_periodicas_generadas WHERE plantilla_id = ? AND periodo = ? AND documento_id IS NOT NULL').get(p.id, fecha);
          if (!ya) {
            const et = etiquetas(fecha, p.periodicidad);
            const sust = (t) => String(t || '').replace(/\{(periodo|mes|año|trimestre|fecha)\}/g, (_, k) => et[k]);
            try {
              const id = await ctx.app.crearBorrador({
                tipo: 'factura', serie: p.serie || undefined, fecha, cliente_id: p.cliente_id, forma_pago: p.forma_pago || null,
                vencimiento: p.dias_vencimiento != null && p.dias_vencimiento !== '' ? sumarDias(fecha, Number(p.dias_vencimiento)) : null,
                referencia: sust(p.referencia).slice(0, 100), observaciones: sust(p.observaciones),
                lineas: p.lineas.map((l) => ({ ...l, descripcion: sust(l.descripcion) })),
              }, p.usuario_id);
              db.prepare('INSERT INTO plugin_periodicas_generadas(plantilla_id, periodo, documento_id) VALUES (?,?,?) ON CONFLICT(plantilla_id, periodo) DO UPDATE SET documento_id = excluded.documento_id, error = NULL, fecha = datetime(\'now\')').run(p.id, fecha, id);
              creadas.push({ plantilla: p.nombre, periodo: fecha, documento_id: id });
            } catch (e) {
              // se anota el error y se reintenta en la próxima pasada (sin avanzar la plantilla)
              db.prepare('INSERT INTO plugin_periodicas_generadas(plantilla_id, periodo, error) VALUES (?,?,?) ON CONFLICT(plantilla_id, periodo) DO UPDATE SET error = excluded.error').run(p.id, fecha, String(e.message).slice(0, 300));
              console.error(`[periodicas] ${p.nombre} ${fecha}:`, e.message);
              break;
            }
          }
          fecha = siguiente(fecha, p.periodicidad, p.dia);
        }
        const fin = p.fin && fecha > p.fin;
        // si un periodo falló, «fecha» se queda en él y se reintenta en la próxima pasada
        db.prepare("UPDATE plugin_periodicas SET proxima = ?, estado = CASE WHEN ? THEN 'finalizada' ELSE estado END, actualizado = datetime('now') WHERE id = ?").run(fecha, fin ? 1 : 0, p.id);
      }
    } finally { ocupado = false; }
    if (creadas.length) console.log(`[periodicas] ${creadas.length} borrador(es) preparados`);
    return creadas;
  }
  setTimeout(() => generar().catch((e) => console.error('[periodicas]', e)), 5000).unref(); // al arrancar (recupera periodos pendientes)
  ctx.cada(60 * 60_000, generar);

  // Aviso en la campana: borradores periódicos por revisar
  const pendientes = () => db.prepare(`SELECT g.*, p.nombre, d.codigo, d.estado, json_extract(d.cliente, '$.nombre') AS cliente FROM plugin_periodicas_generadas g
    JOIN plugin_periodicas p ON p.id = g.plantilla_id LEFT JOIN documentos d ON d.id = g.documento_id
    WHERE (g.documento_id IS NOT NULL AND d.estado = 'borrador') OR g.error IS NOT NULL ORDER BY g.periodo`).all();
  ctx.extender('avisos', () => {
    const l = pendientes();
    const borr = l.filter((x) => x.documento_id), errs = l.filter((x) => x.error);
    return [
      ...(borr.length ? [{ titulo: `${borr.length} factura${borr.length > 1 ? 's' : ''} periódica${borr.length > 1 ? 's' : ''} por revisar`, detalle: 'Borradores preparados: revísalos y emítelos.', enlace: '/p/periodicas' }] : []),
      ...(errs.length ? [{ titulo: `${errs.length} factura${errs.length > 1 ? 's' : ''} periódica${errs.length > 1 ? 's' : ''} con error`, detalle: errs[0].error, enlace: '/p/periodicas' }] : []),
    ];
  });

  // ---- API ----
  function validar(b) {
    const nombre = String(b.nombre || '').trim().slice(0, 100);
    if (!nombre) throw err('Pon un nombre a la plantilla (p. ej. «Mantenimiento mensual»).');
    const cliente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(Number(b.cliente_id));
    if (!cliente) throw err('Elige el cliente.');
    if (!PERIODOS[b.periodicidad]) throw err('Periodicidad no válida.');
    if (!fechaOk(b.inicio)) throw err('Indica la fecha de inicio.');
    if (b.fin && (!fechaOk(b.fin) || b.fin < b.inicio)) throw err('La fecha de fin no es válida.');
    const lineas = (Array.isArray(b.lineas) ? b.lineas : []).filter((l) => String(l.descripcion || '').trim() || Number(l.precio)).slice(0, 100)
      .map((l) => ({ producto_id: l.producto_id ? Number(l.producto_id) : null, descripcion: String(l.descripcion || '').slice(0, 2000), cantidad: Number(l.cantidad ?? 1), precio: Number(l.precio || 0), dto: Number(l.dto || 0), iva: Number(l.iva ?? 21), irpf: Number(l.irpf || 0), operacion: l.operacion || 'S1' }));
    if (!lineas.length) throw err('Añade al menos una línea.');
    if (b.serie && !db.prepare("SELECT 1 FROM series WHERE codigo = ?").get(b.serie)) throw err('La serie no existe.');
    return {
      nombre, cliente_id: cliente.id, serie: b.serie || null, forma_pago: b.forma_pago || null,
      dias_vencimiento: b.dias_vencimiento === '' || b.dias_vencimiento == null ? null : Math.max(0, Math.min(365, Number(b.dias_vencimiento) || 0)),
      periodicidad: b.periodicidad, dia: b.periodicidad === 'semanal' ? null : Math.max(1, Math.min(31, Number(b.dia) || Number(b.inicio.slice(8)))),
      inicio: b.inicio, fin: b.fin || null, lineas: JSON.stringify(lineas), observaciones: String(b.observaciones || '').slice(0, 2000),
      referencia: String(b.referencia || '').slice(0, 100), notas: String(b.notas || '').slice(0, 2000),
    };
  }

  router.get('/plantillas', (_req, res) => res.json(db.prepare(`SELECT p.*, c.nombre AS cliente, (SELECT COUNT(*) FROM plugin_periodicas_generadas g WHERE g.plantilla_id = p.id AND g.documento_id IS NOT NULL) AS generadas
    FROM plugin_periodicas p LEFT JOIN clientes c ON c.id = p.cliente_id ORDER BY p.estado = 'activa' DESC, p.proxima`).all().map(leer)));
  router.get('/plantillas/:id', envolver(async (req, res) => {
    const p = db.prepare('SELECT * FROM plugin_periodicas WHERE id = ?').get(Number(req.params.id));
    if (!p) throw err('No encontrada', 404);
    const historial = db.prepare(`SELECT g.*, d.codigo, d.estado, d.total FROM plugin_periodicas_generadas g LEFT JOIN documentos d ON d.id = g.documento_id WHERE g.plantilla_id = ? ORDER BY g.periodo DESC LIMIT 60`).all(p.id);
    res.json({ ...leer(p), historial });
  }));
  router.post('/plantillas', envolver(async (req, res) => {
    const v = validar(req.body || {});
    const proxima = req.body.proxima && fechaOk(req.body.proxima) && req.body.proxima >= v.inicio ? req.body.proxima : v.inicio;
    const id = Number(db.prepare(`INSERT INTO plugin_periodicas(nombre, cliente_id, serie, forma_pago, dias_vencimiento, periodicidad, dia, inicio, fin, proxima, lineas, observaciones, referencia, notas, usuario_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.nombre, v.cliente_id, v.serie, v.forma_pago, v.dias_vencimiento, v.periodicidad, v.dia, v.inicio, v.fin, proxima, v.lineas, v.observaciones, v.referencia, v.notas, req.usuario.id).lastInsertRowid);
    auditar(req, 'periodicas.crear', v.nombre);
    await generar();
    res.status(201).json({ id });
  }));
  router.put('/plantillas/:id', envolver(async (req, res) => {
    const p = db.prepare('SELECT * FROM plugin_periodicas WHERE id = ?').get(Number(req.params.id));
    if (!p) throw err('No encontrada', 404);
    const v = validar(req.body || {});
    const proxima = req.body.proxima && fechaOk(req.body.proxima) ? req.body.proxima : p.proxima;
    db.prepare(`UPDATE plugin_periodicas SET nombre=?, cliente_id=?, serie=?, forma_pago=?, dias_vencimiento=?, periodicidad=?, dia=?, inicio=?, fin=?, proxima=?, lineas=?, observaciones=?, referencia=?, notas=?,
      estado = CASE WHEN estado = 'finalizada' AND (? IS NULL OR ? >= ?) THEN 'activa' ELSE estado END, actualizado = datetime('now') WHERE id = ?`)
      .run(v.nombre, v.cliente_id, v.serie, v.forma_pago, v.dias_vencimiento, v.periodicidad, v.dia, v.inicio, v.fin, proxima, v.lineas, v.observaciones, v.referencia, v.notas, v.fin, v.fin, proxima, p.id);
    auditar(req, 'periodicas.editar', v.nombre);
    await generar();
    res.json({ ok: true });
  }));
  router.post('/plantillas/:id/estado', envolver(async (req, res) => {
    const p = db.prepare('SELECT * FROM plugin_periodicas WHERE id = ?').get(Number(req.params.id));
    if (!p) throw err('No encontrada', 404);
    const estado = req.body?.estado;
    if (!['activa', 'pausada', 'cancelada'].includes(estado)) throw err('Estado no válido');
    if (p.estado === 'cancelada' && estado !== 'cancelada') throw err('Una plantilla cancelada no se puede reanudar: duplícala.', 409);
    let proxima = p.proxima;
    // Al reanudar, los periodos que pasaron en pausa no se facturan: se salta a la próxima fecha a partir de hoy
    if (estado === 'activa' && p.estado === 'pausada' && !req.body?.recuperar) while (proxima < hoy()) proxima = siguiente(proxima, p.periodicidad, p.dia);
    db.prepare("UPDATE plugin_periodicas SET estado = ?, proxima = ?, actualizado = datetime('now') WHERE id = ?").run(estado, proxima, p.id);
    auditar(req, `periodicas.${estado}`, p.nombre, estado === 'cancelada' ? 'aviso' : 'info');
    if (estado === 'activa') await generar();
    res.json({ ok: true });
  }));
  router.post('/plantillas/:id/duplicar', envolver(async (req, res) => {
    const p = db.prepare('SELECT * FROM plugin_periodicas WHERE id = ?').get(Number(req.params.id));
    if (!p) throw err('No encontrada', 404);
    const ini = hoy() > p.proxima ? hoy() : p.proxima;
    const id = Number(db.prepare(`INSERT INTO plugin_periodicas(nombre, cliente_id, serie, forma_pago, dias_vencimiento, periodicidad, dia, inicio, fin, proxima, estado, lineas, observaciones, referencia, notas, usuario_id)
      SELECT nombre || ' (copia)', cliente_id, serie, forma_pago, dias_vencimiento, periodicidad, dia, ?, NULL, ?, 'pausada', lineas, observaciones, referencia, notas, ? FROM plugin_periodicas WHERE id = ?`).run(ini, ini, req.usuario.id, p.id).lastInsertRowid);
    res.status(201).json({ id });
  }));
  router.delete('/plantillas/:id', requiereAdmin, envolver(async (req, res) => {
    const p = db.prepare('SELECT * FROM plugin_periodicas WHERE id = ?').get(Number(req.params.id));
    if (!p) throw err('No encontrada', 404);
    db.prepare('DELETE FROM plugin_periodicas_generadas WHERE plantilla_id = ? AND documento_id IS NULL').run(p.id);
    db.prepare('DELETE FROM plugin_periodicas WHERE id = ?').run(p.id);
    auditar(req, 'periodicas.borrar', p.nombre, 'aviso');
    res.json({ ok: true });
  }));
  router.get('/pendientes', (_req, res) => res.json(pendientes()));
  router.post('/generar', envolver(async (_req, res) => res.json({ creadas: await generar() })));
}
