(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const $ = (id) => document.getElementById(id);
  const P = '/api/p/recordatorios';
  let yo = null, cfg = null, clientes = [], plan = [];
  const eur = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const f = (s) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : '');
  const fase = (x) => (x === 'antes' ? 'Antes de vencer' : x === 'dia' ? 'Vence hoy' : `Vencida (${x.split('-')[1]} días)`);
  const abrir = (ruta) => { try { window.parent.history.pushState({}, '', ruta); window.parent.dispatchEvent(new PopStateEvent('popstate')); } catch { window.top.location.href = ruta; } };

  document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['plan', 'config', 'registro'].forEach((p) => { $(`p-${p}`).hidden = p !== b.dataset.p; });
    if (b.dataset.p === 'registro') registro();
  }));

  function modo() {
    $('modo').innerHTML = cfg.envio_real
      ? `<strong class="ok">Envío automático activado.</strong> Los avisos se envían solos ${cfg.horario.laborables ? 'de lunes a viernes ' : ''}entre las ${cfg.horario.desde}:00 y las ${cfg.horario.hasta}:00 desde ${e(cfg.usuarios.find((u) => u.id === cfg.usuario_id)?.email || 'la cuenta elegida')}.`
      : '<strong class="atencion">Modo de prueba.</strong> No se envía nada a los clientes: revisa aquí qué se enviaría y, cuando lo tengas claro, actívalo en <em>Configuración</em>.';
  }

  async function cargarPlan() {
    plan = await api(`${P}/plan?dias=${$('dias').value}`);
    const admin = yo?.rol === 'admin';
    $('plan').innerHTML = plan.map((x, i) => `<tr><td>${x.dia === new Date().toLocaleDateString('sv-SE') ? '<strong>Hoy</strong>' : f(x.dia)}</td>
      <td><a href="#" data-doc="${x.documento_id}">${e(x.codigo)}</a></td><td>${e(x.cliente)}</td><td class="ocultar-movil">${f(x.vencimiento)}</td><td class="num">${eur(x.pendiente)}</td>
      <td>${e(fase(x.fase))}${x.excluido ? `<div class="fx-nota mal">${e(x.excluido)}</div>` : ''}</td>
      <td><button class="fx-btn" data-ver="${i}">Ver</button>${admin && !x.excluido && x.dia === new Date().toLocaleDateString('sv-SE') ? ` <button class="fx-btn" data-enviar="${i}">Enviar ahora</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">No hay avisos que enviar en ese periodo.</td></tr>';
    document.querySelectorAll('[data-doc]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); abrir(`/facturas/${a.dataset.doc}`); }));
    document.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => {
      const x = plan[Number(b.dataset.ver)];
      $('vista').hidden = false; $('vista-asunto').textContent = x.asunto; $('vista-para').textContent = `Para: ${x.para || '(sin correo)'}`; $('vista-texto').textContent = x.texto;
      $('vista').scrollIntoView({ behavior: 'smooth' });
      $('excluir').hidden = yo?.rol !== 'admin';
      $('excluir').onclick = async () => {
        if (!confirm(`¿Dejar de enviar recordatorios de la factura ${x.codigo}?`)) return;
        cfg.excluir_documentos = [...new Set([...cfg.excluir_documentos, x.documento_id])];
        try { await api(`${P}/config`, { method: 'PUT', body: { ...cfg, despues: { ...cfg.despues } } }); cfg = await api(`${P}/config`); pintarConfig(); cargarPlan(); $('vista').hidden = true; aviso('Factura excluida'); } catch (er) { aviso(er.message, 'error'); }
      };
    }));
    document.querySelectorAll('[data-enviar]').forEach((b) => b.addEventListener('click', async () => {
      const x = plan[Number(b.dataset.enviar)];
      if (!confirm(`¿Enviar ahora el recordatorio de la factura ${x.codigo} a ${x.para}?`)) return;
      b.disabled = true;
      try { await api(`${P}/enviar`, { method: 'POST', body: { recibo_id: x.recibo_id, fase: x.fase } }); aviso('Recordatorio enviado'); cargarPlan(); } catch (er) { aviso(er.message, 'error'); b.disabled = false; }
    }));
  }
  $('dias').addEventListener('change', cargarPlan);
  $('prueba').addEventListener('click', async () => { try { const r = await api(`${P}/prueba`, { method: 'POST', body: {} }); aviso(`Prueba enviada a ${r.para}`); } catch (er) { aviso(er.message, 'error'); } });

  // ---------- Configuración ----------
  function pintarConfig() {
    const fm = $('cfg'), admin = yo?.rol === 'admin';
    fm.envio_real.checked = cfg.envio_real;
    fm.usuario_id.innerHTML = '<option value="">Elige…</option>' + cfg.usuarios.map((u) => `<option value="${u.id}" ${u.id === cfg.usuario_id ? 'selected' : ''} ${u.email ? '' : 'disabled'}>${e(u.nombre)} — ${u.email ? e(u.email) : 'sin cuenta de correo conectada'}</option>`).join('');
    fm.desde.value = cfg.horario.desde; fm.hasta.value = cfg.horario.hasta; fm.laborables.checked = cfg.horario.laborables;
    fm.antes_activo.checked = cfg.antes.activo; fm.antes_dias.value = cfg.antes.dias; fm.dia_activo.checked = cfg.dia.activo;
    fm.despues_activo.checked = cfg.despues.activo; fm.despues_dias.value = cfg.despues.dias.join(', ');
    fm.querySelector(`[name=adjuntar][value=${cfg.adjuntar}]`).checked = true;
    const nombres = { antes: 'Antes del vencimiento', dia: 'El día del vencimiento', despues: 'Después de vencer' };
    $('plantillas').innerHTML = ['antes', 'dia', 'despues'].map((k) => `<h3>${nombres[k]}</h3><label class="fx-campo"><span>Asunto</span><input class="fx-input" data-a="${k}" value="${e(cfg.plantillas[k].asunto)}" /></label><label class="fx-campo" style="margin-top:6px"><span>Mensaje</span><textarea class="fx-textarea" rows="8" data-c="${k}">${e(cfg.plantillas[k].cuerpo)}</textarea></label>`).join('');
    const nombreCli = (id) => clientes.find((c) => c.id === Number(id))?.nombre || `Cliente ${id}`;
    $('excl-cli').innerHTML = cfg.excluir_clientes.map((id) => `<div class="fx-fila">${e(nombreCli(id))} <button type="button" class="fx-btn" data-quitar-cli="${id}">Quitar</button></div>`).join('') || '<p class="fx-nota">Ninguno.</p>';
    $('pausas').innerHTML = Object.entries(cfg.pausas).map(([id, h]) => `<div class="fx-fila">${e(nombreCli(id))} hasta el ${f(h)} <button type="button" class="fx-btn" data-quitar-pausa="${id}">Quitar</button></div>`).join('') || '<p class="fx-nota">Ninguna.</p>';
    $('excl-doc').innerHTML = cfg.excluir_documentos.length ? cfg.excluir_documentos.map((id) => `<span class="chip">Factura ${id} <a href="#" data-quitar-doc="${id}">✕</a></span>`).join(' ') : 'Ninguna. Para excluir una factura, búscala en «Próximos avisos» y pulsa «Ver».';
    const opts = '<option value="">Añadir cliente…</option>' + clientes.map((c) => `<option value="${c.id}">${e(c.nombre)}${c.email ? '' : ' (sin correo)'}</option>`).join('');
    $('add-excl-cli').innerHTML = opts; $('add-pausa-cli').innerHTML = opts.replace('Añadir cliente…', 'Cliente…');
    document.querySelectorAll('[data-quitar-cli]').forEach((b) => b.onclick = () => { cfg.excluir_clientes = cfg.excluir_clientes.filter((x) => String(x) !== b.dataset.quitarCli); pintarConfig(); });
    document.querySelectorAll('[data-quitar-pausa]').forEach((b) => b.onclick = () => { delete cfg.pausas[b.dataset.quitarPausa]; pintarConfig(); });
    document.querySelectorAll('[data-quitar-doc]').forEach((b) => b.onclick = (ev) => { ev.preventDefault(); cfg.excluir_documentos = cfg.excluir_documentos.filter((x) => String(x) !== b.dataset.quitarDoc); pintarConfig(); });
    fm.querySelectorAll('input, select, textarea, button').forEach((x) => { x.disabled = !admin; });
    $('solo-admin').hidden = admin;
    modo();
  }
  $('add-excl-cli').onchange = (ev) => { const v = Number(ev.target.value); if (v && !cfg.excluir_clientes.includes(v)) cfg.excluir_clientes.push(v); pintarConfig(); };
  $('add-pausa').onclick = () => { const c = $('add-pausa-cli').value, h = $('add-pausa-fecha').value; if (!c || !h) return aviso('Elige el cliente y la fecha', 'error'); cfg.pausas[c] = h; pintarConfig(); };
  $('cfg').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fm = $('cfg');
    const body = {
      envio_real: fm.envio_real.checked, usuario_id: fm.usuario_id.value || null,
      horario: { desde: fm.desde.value, hasta: fm.hasta.value, laborables: fm.laborables.checked },
      antes: { activo: fm.antes_activo.checked, dias: fm.antes_dias.value }, dia: { activo: fm.dia_activo.checked },
      despues: { activo: fm.despues_activo.checked, dias: fm.despues_dias.value }, adjuntar: fm.querySelector('[name=adjuntar]:checked').value,
      excluir_clientes: cfg.excluir_clientes, excluir_documentos: cfg.excluir_documentos, pausas: cfg.pausas,
      plantillas: Object.fromEntries(['antes', 'dia', 'despues'].map((k) => [k, { asunto: document.querySelector(`[data-a=${k}]`).value, cuerpo: document.querySelector(`[data-c=${k}]`).value }])),
    };
    if (body.envio_real && !cfg.envio_real && !confirm('Vas a activar el envío automático: los clientes empezarán a recibir los recordatorios según esta configuración. ¿Continuar?')) return;
    try { await api(`${P}/config`, { method: 'PUT', body }); cfg = await api(`${P}/config`); pintarConfig(); cargarPlan(); aviso('Configuración guardada'); } catch (er) { aviso(er.message, 'error'); }
  });

  async function registro() {
    const l = await api(`${P}/registro`);
    $('registro').innerHTML = l.map((x) => `<tr><td>${e(new Date(`${x.fecha.replace(' ', 'T')}Z`).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }))}</td><td>${e(x.codigo || '')}</td><td>${e(x.para || '')}</td><td>${e(fase(x.fase))}</td><td class="num">${eur(x.pendiente)}</td>
      <td><span class="chip ${x.estado === 'enviado' ? 'ok' : 'mal'}">${x.estado === 'enviado' ? 'Enviado' : 'Error'}</span>${x.error ? `<div class="fx-nota">${e(x.error)}</div>` : ''}<div class="fx-nota">${e(x.usuario || '')}</div></td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Aún no se ha enviado ningún recordatorio.</td></tr>';
  }

  (async () => {
    try {
      [yo, cfg, clientes] = await Promise.all([api('/api/estado').then((x) => x.usuario), api(`${P}/config`), api(`${P}/clientes`)]);
      pintarConfig(); cargarPlan();
    } catch (er) { aviso(er.message, 'error'); }
  })();
})();
