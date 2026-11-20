(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const $ = (id) => document.getElementById(id);
  const P = '/api/p/horas';
  let yo = null, cfg = null, clientes = [], proyectos = [], registros = [], fact = [], tic = null;
  const eur = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const h = (min) => (min == null ? '—' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`);
  const f = (s) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : '');
  const abrir = (ruta) => { try { window.parent.history.pushState({}, '', ruta); window.parent.dispatchEvent(new PopStateEvent('popstate')); } catch { window.top.location.href = ruta; } };
  document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['registro', 'facturar', 'proyectos', 'informe', 'config'].forEach((p) => { $(`p-${p}`).hidden = p !== b.dataset.p; });
    ({ facturar: cargarFacturar, informe: informe, proyectos: pintarProyectos })[b.dataset.p]?.();
  }));
  const optsProyectos = (sel) => '<option value="">Elige…</option>' + proyectos.filter((p) => p.estado === 'activo' || String(p.id) === String(sel)).map((p) => `<option value="${p.id}" ${String(p.id) === String(sel) ? 'selected' : ''}>${e(p.cliente)} · ${e(p.nombre)}</option>`).join('');

  // ---------- Cronómetro ----------
  async function crono() {
    const c = await api(`${P}/cronometro`);
    clearInterval(tic);
    if (c) {
      $('crono').innerHTML = `<div class="crono"><span class="reloj" id="reloj"></span><div><strong>${e(c.cliente)} · ${e(c.proyecto)}</strong><div class="fx-nota">Desde las ${new Date(c.inicio).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div></div>
        <input class="fx-input" id="cr-desc" value="${e(c.descripcion)}" placeholder="¿En qué estás trabajando?" style="flex:1;min-width:200px" /><button class="fx-btn fx-btn-primario" id="cr-parar">Parar y guardar</button><button class="fx-btn" id="cr-desc-x">Descartar</button></div>`;
      const pinta = () => { const s = Math.floor((Date.now() - new Date(c.inicio)) / 1000); $('reloj').textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
      pinta(); tic = setInterval(pinta, 1000);
      $('cr-parar').onclick = async () => { const r = await api(`${P}/cronometro/parar`, { method: 'POST', body: { descripcion: $('cr-desc').value } }); aviso(`Guardado: ${h(r.minutos)}`); crono(); cargarRegistros(); };
      $('cr-desc-x').onclick = async () => { if (!confirm('¿Descartar el tiempo del cronómetro?')) return; await api(`${P}/cronometro/descartar`, { method: 'POST', body: {} }); crono(); };
    } else {
      $('crono').innerHTML = `<div class="crono"><span class="reloj">0:00:00</span><select class="fx-select" id="cr-proy" style="max-width:320px">${optsProyectos()}</select><input class="fx-input" id="cr-desc" placeholder="¿En qué vas a trabajar?" style="flex:1;min-width:200px" /><button class="fx-btn fx-btn-primario" id="cr-ini">▶ Iniciar</button></div>${proyectos.length ? '' : '<p class="fx-nota">Crea primero un proyecto en la pestaña «Proyectos».</p>'}`;
      $('cr-ini').onclick = async () => { if (!$('cr-proy').value) return aviso('Elige el proyecto', 'error'); try { await api(`${P}/cronometro/iniciar`, { method: 'POST', body: { proyecto_id: $('cr-proy').value, descripcion: $('cr-desc').value } }); crono(); } catch (x) { aviso(x.message, 'error'); } };
    }
  }

  // ---------- Registros ----------
  async function cargarRegistros() {
    registros = await api(`${P}/registros?mios=${$('mios').checked ? 1 : 0}&estado=${$('r-estado').value}`);
    $('registros').innerHTML = registros.filter((r) => r.minutos != null).map((r) => `<tr><td>${f(r.fecha)}</td><td>${e(r.cliente)} · ${e(r.proyecto)}</td><td>${e(r.descripcion)}${!r.facturable ? ' <span class="chip">Interno</span>' : ''}</td><td class="num">${h(r.minutos)}</td><td class="num ocultar-movil">${r.facturable ? eur(r.importe) : ''}</td>
      <td>${r.documento_id ? `<a href="#" data-doc="${r.documento_id}">${e(r.codigo || 'Borrador')}</a>` : r.facturable ? '<span class="chip atencion">Pendiente</span>' : ''}</td><td>${r.documento_id ? '' : `<button class="fx-btn" data-ed="${r.id}">Editar</button> <button class="fx-btn" data-bo="${r.id}">✕</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Sin registros.</td></tr>';
    document.querySelectorAll('#registros [data-doc]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); abrir(`/facturas/${a.dataset.doc}`); });
    document.querySelectorAll('[data-bo]').forEach((b) => b.onclick = async () => { if (!confirm('¿Borrar el registro?')) return; await api(`${P}/registros/${b.dataset.bo}`, { method: 'DELETE' }); cargarRegistros(); });
    document.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => {
      const r = registros.find((x) => x.id === Number(b.dataset.ed)), fm = $('f-reg');
      fm.proyecto_id.innerHTML = optsProyectos(r.proyecto_id); fm.fecha.value = r.fecha; fm.horas.value = String(Math.round((r.minutos / 60) * 100) / 100).replace('.', ',');
      fm.inicio_h.value = ''; fm.fin_h.value = ''; fm.tarifa.value = r.tarifa ?? ''; fm.descripcion.value = r.descripcion; fm.facturable.checked = r.facturable; fm.id.value = r.id;
      $('reg-titulo').textContent = 'Editar registro'; $('reg-cancelar').hidden = false; fm.scrollIntoView({ behavior: 'smooth' });
    });
  }
  $('mios').onchange = cargarRegistros; $('r-estado').onchange = cargarRegistros;
  const limpiarReg = () => { const fm = $('f-reg'); fm.reset(); fm.id.value = ''; fm.fecha.value = new Date().toLocaleDateString('sv-SE'); fm.proyecto_id.innerHTML = optsProyectos(); $('reg-titulo').textContent = 'Añadir horas a mano'; $('reg-cancelar').hidden = true; };
  $('reg-cancelar').onclick = limpiarReg;
  $('f-reg').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fm = ev.target, body = { proyecto_id: fm.proyecto_id.value, fecha: fm.fecha.value, horas: fm.horas.value, inicio_h: fm.inicio_h.value, fin_h: fm.fin_h.value, tarifa: fm.tarifa.value, descripcion: fm.descripcion.value, facturable: fm.facturable.checked };
    try { if (fm.id.value) await api(`${P}/registros/${fm.id.value}`, { method: 'PUT', body }); else await api(`${P}/registros`, { method: 'POST', body }); aviso('Guardado'); limpiarReg(); cargarRegistros(); } catch (x) { aviso(x.message, 'error'); }
  });

  // ---------- Facturar ----------
  async function cargarFacturar() {
    const todos = await api(`${P}/registros?estado=pendiente`);
    const cl = [...new Map(todos.map((r) => [r.cliente_id, r.cliente])).entries()];
    const sel = $('fa-cliente').value;
    $('fa-cliente').innerHTML = cl.length ? cl.map(([id, n]) => `<option value="${id}">${e(n)} (${todos.filter((r) => r.cliente_id === id).length})</option>`).join('') : '<option value="">No hay horas pendientes</option>';
    if (sel && cl.some(([id]) => String(id) === sel)) $('fa-cliente').value = sel;
    const hasta = $('fa-hasta').value;
    fact = todos.filter((r) => String(r.cliente_id) === $('fa-cliente').value && (!hasta || r.fecha <= hasta)).sort((a, b) => a.fecha.localeCompare(b.fecha));
    $('fa-lista').innerHTML = fact.map((r, i) => `<tr><td><input type="checkbox" data-fa="${i}" checked /></td><td>${f(r.fecha)}</td><td>${e(r.proyecto)}</td><td>${e(r.descripcion)}</td><td class="num">${h(r.minutos)}</td><td class="num">${eur(r.tarifa_aplicada)}</td><td class="num">${eur(r.importe)}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">No hay horas pendientes de facturar.</td></tr>';
    const total = () => { const s = fact.filter((_, i) => document.querySelector(`[data-fa="${i}"]`)?.checked); $('fa-total').textContent = s.length ? `${s.length} registro(s) · base ${eur(s.reduce((a, r) => a + r.importe, 0))} (con el redondeo)` : ''; };
    document.querySelectorAll('[data-fa]').forEach((c) => c.onchange = total); total();
    $('fa-todos').onchange = () => { document.querySelectorAll('[data-fa]').forEach((c) => { c.checked = $('fa-todos').checked; }); total(); };
    // registros de facturas rectificadas que se pueden recuperar
    const fact2 = await api(`${P}/registros?estado=facturado`);
    const rec = [...new Map(fact2.filter((r) => r.rectificada).map((r) => [r.documento_id, r])).values()];
    $('recuperables').hidden = !rec.length || yo?.rol !== 'admin';
    $('recuperables').innerHTML = `<h2>Horas de facturas rectificadas</h2><p class="fx-nota">Estas facturas se anularon con una rectificativa. Puedes devolver sus horas a «pendientes» para volver a facturarlas.</p>${rec.map((r) => `<div class="fx-fila">${e(r.codigo)} · ${e(r.cliente)} <button class="fx-btn" data-rec="${r.documento_id}">Recuperar sus horas</button></div>`).join('')}`;
    document.querySelectorAll('[data-rec]').forEach((b) => b.onclick = async () => { if (!confirm('¿Devolver estas horas a pendientes? Quedará anotado en la auditoría.')) return; const r = await api(`${P}/recuperar`, { method: 'POST', body: { documento_id: b.dataset.rec } }); aviso(`${r.recuperados} registro(s) recuperados`); cargarFacturar(); });
  }
  $('fa-cliente').onchange = cargarFacturar; $('fa-hasta').onchange = cargarFacturar;
  $('fa-crear').onclick = async (ev) => {
    const ids = fact.filter((_, i) => document.querySelector(`[data-fa="${i}"]`)?.checked).map((r) => r.id);
    if (!ids.length) return aviso('Elige los registros', 'error');
    ev.target.disabled = true;
    try { const r = await api(`${P}/facturar`, { method: 'POST', body: { registros: ids } }); aviso('Factura creada en borrador'); abrir(`/facturas/${r.documento_id}`); }
    catch (x) { aviso(x.message, 'error'); } finally { ev.target.disabled = false; }
  };

  // ---------- Proyectos ----------
  async function cargarProyectos() { proyectos = await api(`${P}/proyectos`); }
  function pintarProyectos() {
    const fm = $('f-proy'); if (!fm.id.value) fm.cliente_id.innerHTML = '<option value="">Elige…</option>' + clientes.map((c) => `<option value="${c.id}">${e(c.nombre)}</option>`).join('');
    $('proyectos').innerHTML = proyectos.map((p) => `<tr><td>${e(p.nombre)}</td><td>${e(p.cliente)}</td><td class="num">${p.tarifa != null ? eur(p.tarifa) : '—'}</td><td class="num">${h(p.pendiente_min)}</td><td>${p.estado === 'activo' ? '<span class="chip ok">Activo</span>' : '<span class="chip">Archivado</span>'}</td><td><button class="fx-btn" data-ep="${p.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Aún no hay proyectos.</td></tr>';
    document.querySelectorAll('[data-ep]').forEach((b) => b.onclick = () => { const p = proyectos.find((x) => x.id === Number(b.dataset.ep)); fm.cliente_id.innerHTML = clientes.map((c) => `<option value="${c.id}" ${c.id === p.cliente_id ? 'selected' : ''}>${e(c.nombre)}</option>`).join(''); fm.nombre.value = p.nombre; fm.tarifa.value = p.tarifa ?? ''; fm.concepto.value = p.concepto; fm.archivado.checked = p.estado === 'archivado'; fm.id.value = p.id; $('proy-titulo').textContent = 'Editar proyecto'; $('proy-nuevo').hidden = false; });
  }
  $('proy-nuevo').onclick = () => { $('f-proy').reset(); $('f-proy').id.value = ''; $('proy-titulo').textContent = 'Nuevo proyecto'; $('proy-nuevo').hidden = true; pintarProyectos(); };
  $('f-proy').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const fm = ev.target;
    try { await api(`${P}/proyectos`, { method: 'POST', body: { id: fm.id.value || null, cliente_id: fm.cliente_id.value, nombre: fm.nombre.value, tarifa: fm.tarifa.value, concepto: fm.concepto.value, estado: fm.archivado.checked ? 'archivado' : 'activo' } }); aviso('Proyecto guardado'); $('proy-nuevo').click(); await cargarProyectos(); pintarProyectos(); crono(); limpiarReg(); }
    catch (x) { aviso(x.message, 'error'); }
  });

  // ---------- Informe ----------
  async function informe() {
    const l = await api(`${P}/informe?desde=${$('in-desde').value}&hasta=${$('in-hasta').value}`);
    $('informe').innerHTML = l.map((g) => `<tr><td>${e(g.cliente)}</td><td>${e(g.proyecto)}</td><td class="num">${h(g.total)}</td><td class="num">${h(g.facturable)}</td><td class="num">${h(g.interno)}</td><td class="num">${h(g.facturado)}</td><td class="num">${h(g.pendiente)}</td><td class="num">${eur(g.importe_pendiente)}</td></tr>`).join('') || '<tr><td colspan="8" class="vacio">Sin horas en ese periodo.</td></tr>';
  }
  $('in-ver').onclick = informe;

  // ---------- Tarifas ----------
  function pintarConfig() {
    const fm = $('cfg');
    for (const k of ['tarifa', 'redondeo', 'iva', 'irpf', 'agrupar']) fm[k].value = cfg[k];
    $('tc').innerHTML = Object.entries(cfg.tarifas_cliente).map(([id, t]) => `<div class="fx-fila">${e(clientes.find((c) => c.id === Number(id))?.nombre || id)} <input class="fx-input" type="number" step="0.01" data-tc="${id}" value="${t}" style="width:110px" /> €/h <button type="button" class="fx-btn" data-tcx="${id}">✕</button></div>`).join('') || '<p class="fx-nota">Ninguna.</p>';
    $('tc-add').innerHTML = '<option value="">Añadir cliente…</option>' + clientes.map((c) => `<option value="${c.id}">${e(c.nombre)}</option>`).join('');
    document.querySelectorAll('[data-tc]').forEach((i) => i.oninput = () => { cfg.tarifas_cliente[i.dataset.tc] = i.value; });
    document.querySelectorAll('[data-tcx]').forEach((b) => b.onclick = () => { delete cfg.tarifas_cliente[b.dataset.tcx]; pintarConfig(); });
    fm.querySelectorAll('input, select, button').forEach((x) => { x.disabled = yo?.rol !== 'admin'; });
  }
  $('tc-add').onchange = (ev) => { if (ev.target.value) cfg.tarifas_cliente[ev.target.value] = cfg.tarifa; pintarConfig(); };
  $('cfg').addEventListener('submit', async (ev) => { ev.preventDefault(); const fm = ev.target; try { await api(`${P}/config`, { method: 'PUT', body: { tarifa: fm.tarifa.value, redondeo: fm.redondeo.value, iva: fm.iva.value, irpf: fm.irpf.value, agrupar: fm.agrupar.value, tarifas_cliente: cfg.tarifas_cliente } }); cfg = await api(`${P}/config`); pintarConfig(); aviso('Guardado'); } catch (x) { aviso(x.message, 'error'); } });

  (async () => {
    try {
      [yo, cfg, clientes] = await Promise.all([api('/api/estado').then((x) => x.usuario), api(`${P}/config`), api('/api/clientes')]);
      await cargarProyectos(); limpiarReg(); crono(); cargarRegistros(); pintarConfig();
      if (!proyectos.length) document.querySelector('[data-p="proyectos"]').click();
    } catch (x) { aviso(x.message, 'error'); }
  })();
})();
