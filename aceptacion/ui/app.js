(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const fm = document.getElementById('cfg'), P = '/api/p/aceptacion';
  const f = (s) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const abrir = (ruta) => { try { window.parent.history.pushState({}, '', ruta); window.parent.dispatchEvent(new PopStateEvent('popstate')); } catch { window.top.location.href = ruta; } };
  const NOM = { pendiente: 'Pendiente', aceptado: 'Aceptado', rechazado: 'Rechazado', revocado: 'Revocado', caducado: 'Caducado' };
  async function pintar() {
    const [yo, c, h] = await Promise.all([api('/api/estado').then((x) => x.usuario), api(`${P}/config`), api(`${P}/historial`)]);
    for (const k of ['caducidad_dias', 'url_publica']) fm[k].value = c[k];
    for (const k of ['comentarios', 'pedir_nombre', 'pedir_email', 'avisar_correo']) fm[k].checked = c[k];
    fm.querySelectorAll('input, button').forEach((x) => { x.disabled = yo?.rol !== 'admin'; });
    document.getElementById('hist').innerHTML = h.map((x) => `<tr><td><a href="#" data-doc="${x.documento_id}">${e(x.codigo)}</a></td><td>${e(x.cliente || '')}</td><td>${f(x.creado)}</td><td><span class="chip ${x.estado === 'aceptado' ? 'ok' : x.estado === 'rechazado' ? 'mal' : x.estado === 'pendiente' ? 'atencion' : ''}">${NOM[x.estado] || e(x.estado)}</span>${x.respondido ? ` <span class="fx-nota">${f(x.respondido)}${x.respuesta_nombre ? ` · ${e(x.respuesta_nombre)}` : ''}</span>` : ''}${x.comentario ? `<div class="fx-nota">«${e(x.comentario)}»</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Aún no se ha creado ningún enlace.</td></tr>';
    document.querySelectorAll('[data-doc]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); abrir(`/presupuestos/${a.dataset.doc}`); });
  }
  fm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api(`${P}/config`, { method: 'PUT', body: { caducidad_dias: fm.caducidad_dias.value, url_publica: fm.url_publica.value, comentarios: fm.comentarios.checked, pedir_nombre: fm.pedir_nombre.checked, pedir_email: fm.pedir_email.checked, avisar_correo: fm.avisar_correo.checked } }); aviso('Guardado'); }
    catch (x) { aviso(x.message, 'error'); }
  });
  pintar().catch((x) => aviso(x.message, 'error'));
})();
