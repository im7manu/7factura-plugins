(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const $ = (id) => document.getElementById(id);
  const P = '/api/p/conciliacion';
  let cuentas = [], movs = [], texto = '', archivo = '', yo = null;
  const eur = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const f = (s) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : '');
  const abrir = (ruta) => { try { window.parent.history.pushState({}, '', ruta); window.parent.dispatchEvent(new PopStateEvent('popstate')); } catch { window.top.location.href = ruta; } };
  const ESTADO = { pendiente: '<span class="chip atencion">Pendiente</span>', conciliado: '<span class="chip ok">Conciliado</span>', descartado: '<span class="chip">Descartado</span>' };

  document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['movimientos', 'importar', 'cuentas', 'reglas'].forEach((p) => { $(`p-${p}`).hidden = p !== b.dataset.p; });
    if (b.dataset.p === 'reglas') reglas();
  }));

  async function cargarCuentas() {
    cuentas = await api(`${P}/cuentas`);
    const opts = cuentas.map((c) => `<option value="${c.id}">${e(c.nombre)}${c.pendientes ? ` (${c.pendientes} pendientes)` : ''}</option>`).join('');
    const sel = $('cuenta').value;
    $('cuenta').innerHTML = opts; $('imp-cuenta').innerHTML = opts;
    if (sel) $('cuenta').value = sel;
    $('sin-cuentas').hidden = cuentas.length > 0;
    $('cuentas').innerHTML = cuentas.map((c) => `<tr><td>${e(c.nombre)}</td><td class="mono">${e(c.iban)}</td><td class="num">${c.pendientes}</td><td>${f(c.ultimo)}</td><td><button class="fx-btn" data-editar="${c.id}">Editar</button> <button class="fx-btn fx-btn-peligro" data-borrar="${c.id}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Aún no hay cuentas.</td></tr>';
    document.querySelectorAll('[data-editar]').forEach((b) => b.onclick = () => { const c = cuentas.find((x) => x.id === Number(b.dataset.editar)); const fm = $('form-cuenta'); fm.nombre.value = c.nombre; fm.iban.value = c.iban; fm.margen_dias.value = c.margen_dias; fm.id.value = c.id; $('fc-titulo').textContent = 'Editar cuenta'; $('fc-nueva').hidden = false; });
    document.querySelectorAll('[data-borrar]').forEach((b) => b.onclick = async () => { if (!confirm('¿Borrar la cuenta y sus movimientos importados? Los cobros registrados en las facturas no se tocan.')) return; try { await api(`${P}/cuentas/${b.dataset.borrar}`, { method: 'DELETE' }); cargarCuentas(); } catch (x) { aviso(x.message, 'error'); } });
    if (cuentas.length) cargarMovs();
  }
  $('fc-nueva').onclick = () => { $('form-cuenta').reset(); $('form-cuenta').id.value = ''; $('fc-titulo').textContent = 'Nueva cuenta'; $('fc-nueva').hidden = true; };
  $('form-cuenta').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fm = ev.target, c = cuentas.find((x) => x.id === Number(fm.id.value));
    try { await api(`${P}/cuentas`, { method: 'POST', body: { id: fm.id.value || null, nombre: fm.nombre.value, iban: fm.iban.value, margen_dias: fm.margen_dias.value, formato: c?.formato || {} } }); aviso('Cuenta guardada'); $('fc-nueva').click(); cargarCuentas(); }
    catch (x) { aviso(x.message, 'error'); }
  });

  // ---------- Movimientos ----------
  async function cargarMovs() {
    if (!$('cuenta').value) return;
    movs = await api(`${P}/cuentas/${$('cuenta').value}/movimientos?estado=${$('filtro').value}`);
    $('movs').innerHTML = movs.map((m) => `<tr class="clic" data-m="${m.id}"><td>${f(m.fecha)}</td><td>${e(m.concepto)}${m.conciliaciones.length ? `<div class="fx-nota">→ ${m.conciliaciones.map((c) => `${e(c.codigo)} (${eur(c.importe)})`).join(' + ')}</div>` : ''}${m.notas ? `<div class="fx-nota">${e(m.notas)}</div>` : ''}</td>
      <td class="num ${m.importe > 0 ? 'ingreso' : 'cargo'}">${eur(m.importe)}</td><td>${ESTADO[m.estado]}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">No hay movimientos.</td></tr>';
    document.querySelectorAll('[data-m]').forEach((tr) => tr.addEventListener('click', () => detalle(Number(tr.dataset.m))));
  }
  $('cuenta').onchange = cargarMovs; $('filtro').onchange = cargarMovs;
  $('exportar').onclick = () => { if ($('cuenta').value) window.open(`${P}/cuentas/${$('cuenta').value}/exportar`); };

  async function detalle(id) {
    document.querySelectorAll('[data-m]').forEach((tr) => tr.classList.toggle('sel', Number(tr.dataset.m) === id));
    const m0 = movs.find((x) => x.id === id);
    const d = $('detalle'); d.hidden = false;
    if (m0.estado === 'conciliado') {
      d.innerHTML = `<h2>${eur(m0.importe)} · ${f(m0.fecha)}</h2><p>${e(m0.concepto)}</p><ul>${m0.conciliaciones.map((c) => `<li><a href="#" data-doc="${c.documento_id}">${e(c.codigo)}</a> ${e(c.tercero || '')}: ${eur(c.importe)} <span class="fx-nota">(${e(c.usuario)})</span></li>`).join('')}</ul>
        <button class="fx-btn fx-btn-peligro" id="deshacer">Deshacer conciliación</button><p class="fx-nota">Anula los cobros o pagos registrados desde aquí y deja el movimiento pendiente.</p>`;
      d.querySelectorAll('[data-doc]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); abrir(`/facturas/${a.dataset.doc}`); });
      $('deshacer').onclick = async () => { if (!confirm('¿Deshacer? Se anularán los cobros/pagos registrados al conciliar este movimiento.')) return; await api(`${P}/movimientos/${id}/deshacer`, { method: 'POST', body: {} }); aviso('Conciliación deshecha'); cargarMovs(); d.hidden = true; };
      return;
    }
    if (m0.estado === 'descartado') {
      d.innerHTML = `<h2>${eur(m0.importe)} · ${f(m0.fecha)}</h2><p>${e(m0.concepto)}</p><button class="fx-btn" id="recuperar">Volver a pendiente</button>`;
      $('recuperar').onclick = async () => { await api(`${P}/movimientos/${id}/estado`, { method: 'POST', body: { estado: 'pendiente' } }); cargarMovs(); d.hidden = true; };
      return;
    }
    d.innerHTML = '<p class="fx-nota">Buscando coincidencias…</p>';
    const { movimiento: m, propuestas } = await api(`${P}/movimientos/${id}/propuestas`);
    const tipo = m.importe > 0 ? 'cobro' : 'pago';
    const elegidos = new Map(); // recibo_id -> { recibo, importe }
    const pintarElegidos = () => {
      const total = [...elegidos.values()].reduce((s, x) => s + (Number(x.importe) || 0), 0), resto = Math.abs(m.importe) - total;
      $('reparto').innerHTML = elegidos.size ? `<table class="fx-tabla"><thead><tr><th>Factura</th><th>${tipo === 'cobro' ? 'Cliente' : 'Proveedor'}</th><th class="num">Pendiente</th><th class="num">Importe a aplicar</th><th></th></tr></thead><tbody>${[...elegidos.values()].map(({ recibo: r, importe }) => `<tr><td>${e(r.codigo)}${r.numero_proveedor ? ` (${e(r.numero_proveedor)})` : ''}</td><td>${e(r.tercero)}</td><td class="num">${eur(r.pendiente)}</td><td class="num"><input class="fx-input importe" type="number" step="0.01" min="0" data-imp="${r.recibo_id}" value="${importe}" /></td><td><button class="fx-btn" data-quitar="${r.recibo_id}">✕</button></td></tr>`).join('')}</tbody></table>
        <p class="${Math.abs(resto) < 0.005 ? 'ok' : resto > 0 ? 'atencion' : 'mal'}">${Math.abs(resto) < 0.005 ? 'El reparto cuadra con el movimiento.' : resto > 0 ? `Quedan ${eur(resto)} sin asignar (se anotarán en el movimiento).` : `El reparto supera el movimiento en ${eur(-resto)}.`}</p>` : '<p class="fx-nota">Elige una o varias facturas de la lista.</p>';
      document.querySelectorAll('[data-imp]').forEach((i) => i.oninput = () => { elegidos.get(Number(i.dataset.imp)).importe = i.value; pintarElegidos(); });
      document.querySelectorAll('[data-quitar]').forEach((b) => b.onclick = () => { elegidos.delete(Number(b.dataset.quitar)); pintarElegidos(); });
      $('confirmar').disabled = !elegidos.size || resto < -0.005;
    };
    const filaRecibo = (r, i, lista) => `<tr class="clic" data-r="${lista}${i}"><td>${e(r.codigo)}${r.numero_proveedor ? ` (${e(r.numero_proveedor)})` : ''}</td><td>${e(r.tercero)}</td><td>${f(r.vencimiento)}</td><td class="num">${eur(r.pendiente)}</td><td class="fx-nota">${e((r.motivos || []).join(', '))}</td></tr>`;
    d.innerHTML = `<h2 class="${m.importe > 0 ? 'ingreso' : 'cargo'}">${eur(m.importe)} · ${f(m.fecha)}</h2><p>${e(m.concepto)}${m.referencia ? ` · Ref. ${e(m.referencia)}` : ''}</p>
      <h3>Propuestas</h3>${propuestas.length ? `<table class="fx-tabla"><thead><tr><th>Factura</th><th>Tercero</th><th>Vence</th><th class="num">Pendiente</th><th>Por qué</th></tr></thead><tbody>${propuestas.map((r, i) => filaRecibo(r, i, 'p')).join('')}</tbody></table>` : '<p class="fx-nota">No hay coincidencias claras.</p>'}
      <h3>Buscar otra factura</h3><input class="fx-input" id="buscar" placeholder="Número, ${tipo === 'cobro' ? 'cliente' : 'proveedor'}, NIF o importe" /><table class="fx-tabla"><tbody id="busqueda"></tbody></table>
      <div class="panel"><h3 style="margin-top:0">Registrar ${tipo === 'cobro' ? 'el cobro' : 'el pago'}</h3><div id="reparto"></div>
        <label class="casilla"><input type="checkbox" id="crear-regla" /> Recordar: cuando el concepto contenga</label> <input class="fx-input" id="regla" style="max-width:260px" value="${e((m.concepto || '').split(/[·,]/)[0].trim().slice(0, 40))}" />
        <div class="fx-fila" style="margin-top:10px"><button class="fx-btn fx-btn-primario" id="confirmar" disabled>Confirmar y registrar</button><button class="fx-btn" id="descartar">Descartar movimiento</button></div>
        <p class="fx-nota">Al confirmar se registra ${tipo === 'cobro' ? 'un cobro' : 'un pago'} con fecha ${f(m.fecha)} en cada factura elegida. Se puede deshacer.</p></div>`;
    let busq = [];
    const elegir = (r) => { if (!elegidos.has(r.recibo_id)) { const ya = [...elegidos.values()].reduce((s, x) => s + (Number(x.importe) || 0), 0); elegidos.set(r.recibo_id, { recibo: r, importe: Math.max(0, Math.min(Math.abs(r.pendiente), Math.abs(m.importe) - ya)).toFixed(2) }); } pintarElegidos(); };
    d.querySelectorAll('[data-r^="p"]').forEach((tr) => tr.onclick = () => elegir(propuestas[Number(tr.dataset.r.slice(1))]));
    let t = null;
    $('buscar').oninput = () => { clearTimeout(t); t = setTimeout(async () => { busq = await api(`${P}/recibos?tipo=${tipo}&q=${encodeURIComponent($('buscar').value)}`); $('busqueda').innerHTML = busq.map((r, i) => filaRecibo(r, i, 'b')).join('') || '<tr><td class="vacio">Sin resultados</td></tr>'; $('busqueda').querySelectorAll('[data-r]').forEach((tr) => tr.onclick = () => elegir(busq[Number(tr.dataset.r.slice(1))])); }, 300); };
    if (propuestas[0] && propuestas[0].puntos >= 80) elegir(propuestas[0]);
    pintarElegidos();
    $('confirmar').onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await api(`${P}/movimientos/${id}/conciliar`, { method: 'POST', body: { partes: [...elegidos.values()].map((x) => ({ recibo_id: x.recibo.recibo_id, importe: x.importe })), regla: $('crear-regla').checked ? $('regla').value : '' } });
        aviso(r.sin_asignar > 0.005 ? `Conciliado. Quedan ${eur(r.sin_asignar)} sin asignar.` : 'Conciliado y registrado'); d.hidden = true; cargarCuentas();
      } catch (x) { aviso(x.message, 'error'); ev.target.disabled = false; }
    };
    $('descartar').onclick = async () => {
      const notas = prompt('Motivo (opcional), p. ej. «comisión» o «traspaso entre cuentas»:', '');
      if (notas === null) return;
      await api(`${P}/movimientos/${id}/estado`, { method: 'POST', body: { estado: 'descartado', notas, regla: $('crear-regla').checked ? $('regla').value : '' } });
      d.hidden = true; cargarCuentas();
    };
  }

  // ---------- Importar ----------
  const COLS = [['fecha', 'Fecha *'], ['concepto', 'Concepto'], ['concepto2', 'Concepto (2.ª columna)'], ['importe', 'Importe (con signo)'], ['cargo', 'Cargo (si van separados)'], ['abono', 'Abono (si van separados)'], ['saldo', 'Saldo'], ['referencia', 'Referencia']];
  async function leerArchivo() {
    const fl = $('imp-archivo').files[0];
    if (!fl) return;
    archivo = fl.name;
    texto = new TextDecoder($('imp-cod').value).decode(await fl.arrayBuffer());
    const c = cuentas.find((x) => x.id === Number($('imp-cuenta').value)), fmt = c?.formato || {};
    const pv = await api(`${P}/vista-previa`, { method: 'POST', body: { texto, separador: fmt.separador } });
    $('imp-sep').value = pv.separador;
    const n = Math.max(...pv.filas.map((x) => x.length));
    $('imp-previa').innerHTML = `<thead><tr>${Array.from({ length: n }, (_, i) => `<th>Col. ${i + 1}</th>`).join('')}</tr></thead><tbody>${pv.filas.map((r) => `<tr>${Array.from({ length: n }, (_, i) => `<td>${e(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>`;
    const cab = (pv.filas[0] || []).map((x) => x.toLowerCase());
    const adivina = (k) => { const pista = { fecha: /fecha|date|f\. ?valor|f\. ?oper/, concepto: /concepto|descrip|movim|detalle/, importe: /importe|amount|cantidad/, saldo: /saldo|balance/, referencia: /refer/, cargo: /cargo|debe|debit/, abono: /abono|haber|credit/ }[k]; const i = pista ? cab.findIndex((x) => pista.test(x)) : -1; return i >= 0 ? String(i) : ''; };
    $('imp-cols').innerHTML = COLS.map(([k, l]) => `<label class="fx-campo"><span>${l}</span><select class="fx-select" data-col="${k}"><option value="">—</option>${Array.from({ length: n }, (_, i) => `<option value="${i}">Col. ${i + 1}${pv.filas[0]?.[i] ? `: ${e(pv.filas[0][i].slice(0, 18))}` : ''}</option>`).join('')}</select></label>`).join('');
    document.querySelectorAll('[data-col]').forEach((s) => { s.value = fmt.columnas?.[s.dataset.col] ?? adivina(s.dataset.col); });
    if (fmt.saltar != null) $('imp-saltar').value = fmt.saltar;
    if (fmt.formato_fecha) $('imp-ffecha').value = fmt.formato_fecha;
    if (fmt.decimal) $('imp-dec').value = fmt.decimal;
    $('imp-invertir').checked = !!fmt.invertir;
    $('imp-config').hidden = false; $('imp-res').textContent = '';
  }
  $('imp-archivo').onchange = leerArchivo; $('imp-cod').onchange = leerArchivo; $('imp-cuenta').onchange = leerArchivo;
  $('imp-boton').onclick = async () => {
    if (!$('imp-cuenta').value) return aviso('Crea primero una cuenta', 'error');
    const formato = { separador: $('imp-sep').value, saltar: Number($('imp-saltar').value) || 0, formato_fecha: $('imp-ffecha').value, decimal: $('imp-dec').value, invertir: $('imp-invertir').checked,
      columnas: Object.fromEntries([...document.querySelectorAll('[data-col]')].map((s) => [s.dataset.col, s.value])) };
    $('imp-boton').disabled = true;
    try {
      const r = await api(`${P}/cuentas/${$('imp-cuenta').value}/importar`, { method: 'POST', body: { texto, archivo, formato, guardar_formato: $('imp-guardar').checked } });
      $('imp-res').innerHTML = `<span class="ok">${r.nuevas} movimientos nuevos</span>${r.repetidas ? `, ${r.repetidas} ya importados antes (no se duplican)` : ''}${r.filas_no_validas.length ? `, ${r.filas_no_validas.length} filas sin fecha o importe válidos` : ''}.`;
      $('cuenta').value = $('imp-cuenta').value; cargarCuentas();
    } catch (x) { aviso(x.message, 'error'); } finally { $('imp-boton').disabled = false; }
  };

  async function reglas() {
    const l = await api(`${P}/reglas`);
    $('reglas').innerHTML = l.map((g) => `<tr><td>«${e(g.texto)}»</td><td>${g.accion === 'descartar' ? 'Descartar el movimiento' : `Es de ${e(g.tercero || '—')}`}</td><td><button class="fx-btn" data-br="${g.id}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="3" class="vacio">No hay reglas.</td></tr>';
    document.querySelectorAll('[data-br]').forEach((b) => b.onclick = async () => { await api(`${P}/reglas/${b.dataset.br}`, { method: 'DELETE' }); reglas(); });
  }

  (async () => { try { yo = (await api('/api/estado')).usuario; await cargarCuentas(); if (!cuentas.length) document.querySelector('[data-p="cuentas"]').click(); } catch (x) { aviso(x.message, 'error'); } })();
})();
