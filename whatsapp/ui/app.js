(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const $ = (id) => document.getElementById(id);
  const P = '/api/p/whatsapp';
  let yo = null, cfg = null, t = null;
  document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['conexion', 'mensajes', 'historial'].forEach((p) => { $(`p-${p}`).hidden = p !== b.dataset.p; });
    if (b.dataset.p === 'historial') historial();
  }));

  async function conexion() {
    const s = await api(`${P}/estado`), admin = yo?.rol === 'admin';
    $('conexion').innerHTML = `<div class="fx-nota">Estado</div><div class="estado e-${e(s.estado)}">${e(WA.ESTADOS[s.estado] || s.estado)}</div>
      ${s.numero ? `<div>Número vinculado: <strong>+${e(s.numero)}</strong>${s.nombre ? ` (${e(s.nombre)})` : ''}</div>` : ''}
      ${s.error ? `<div class="error">${e(s.error)}</div>` : ''}
      ${admin ? `<div class="fx-fila" style="margin-top:12px">${['conectado', 'reconectando'].includes(s.estado) ? '<button class="fx-btn fx-btn-peligro" id="desc">Desconectar</button>' : '<button class="fx-btn fx-btn-primario" id="vinc">Vincular WhatsApp</button>'}</div>` : '<p class="fx-nota">Solo un administrador puede vincular o desconectar WhatsApp.</p>'}
      ${s.qr ? `<div class="qr"><div class="qr-img">${s.qr}</div><ol><li>Abre WhatsApp en el teléfono de la empresa.</li><li>Ve a <strong>Ajustes › Dispositivos vinculados › Vincular un dispositivo</strong>.</li><li>Escanea este código (se renueva solo).</li></ol></div>` : ''}`;
    $('vinc')?.addEventListener('click', async (ev) => { ev.target.disabled = true; try { await api(`${P}/vincular`, { method: 'POST', body: {} }); } catch (x) { aviso(x.message, 'error'); } conexion(); });
    $('desc')?.addEventListener('click', async () => { if (!confirm('¿Desconectar WhatsApp? Habrá que volver a vincularlo con el código QR.')) return; await api(`${P}/desconectar`, { method: 'POST', body: {} }); conexion(); });
    clearTimeout(t);
    if (['conectando', 'esperando_qr', 'reconectando'].includes(s.estado)) t = setTimeout(conexion, 2500);
  }

  function mensajes() {
    const admin = yo?.rol === 'admin';
    $('proponer').checked = cfg.proponer_al_emitir;
    const tipos = ['factura', 'rectificativa', 'presupuesto', 'proforma', 'pedido', 'albaran', 'pedido_compra', 'presupuesto_compra'];
    const nombre = (k) => (k === 'rectificativa' ? 'Factura rectificativa' : (cfg.nombres[k] || k).replace(/^./, (c) => c.toUpperCase()) + (k.endsWith('_compra') ? ' (compras)' : ''));
    $('plantillas').innerHTML = tipos.map((k) => `<label class="fx-campo"><span>${e(nombre(k))}</span><textarea class="fx-textarea" data-k="${k}" rows="3" placeholder="${e(cfg.defecto)}">${e(cfg.plantillas[k] || '')}</textarea></label>`).join('');
    document.querySelectorAll('#p-mensajes textarea, #p-mensajes input, #guardar').forEach((x) => { x.disabled = !admin; });
    $('solo-admin').hidden = admin;
  }
  $('guardar').addEventListener('click', async () => {
    const plantillas = {};
    document.querySelectorAll('[data-k]').forEach((x) => { if (x.value.trim()) plantillas[x.dataset.k] = x.value; });
    try { await api(`${P}/config`, { method: 'PUT', body: { proponer_al_emitir: $('proponer').checked, plantillas } }); cfg = await api(`${P}/config`); mensajes(); aviso('Mensajes guardados'); } catch (x) { aviso(x.message, 'error'); }
  });

  async function historial() {
    const l = await api(`${P}/historial`);
    $('historial').innerHTML = l.map((h) => `<tr><td>${e(WA.fecha(h.fecha))}</td><td>${e(h.codigo || '')}</td><td>${e(h.destinatario)} +${e(h.telefono)}</td><td>${e(h.usuario)}</td><td><span class="${['enviado', 'entregado'].includes(h.estado) ? 'ok' : h.estado === 'pendiente' ? '' : 'mal'}">${e(WA.ENVIO[h.estado] || h.estado)}</span>${h.error ? `<div class="fx-nota">${e(h.error)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="fx-nota">Aún no se ha enviado nada.</td></tr>';
  }

  (async () => {
    try { [yo, cfg] = await Promise.all([api('/api/estado').then((x) => x.usuario), api(`${P}/config`)]); conexion(); mensajes(); }
    catch (x) { aviso(x.message, 'error'); }
  })();
})();
