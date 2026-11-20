(function () {
  const token = location.hash.slice(1);
  const c = document.getElementById('c');
  const API = `/api/pub/aceptacion/presupuesto/${encodeURIComponent(token)}`;
  const e = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const eur = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const f = (s) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('es-ES') : '');
  const MENSAJES = { revocado: 'Este enlace ha sido anulado por la empresa.', caducado: 'Este enlace ha caducado. Pide uno nuevo a la empresa.', modificado: 'El presupuesto ha cambiado desde que se envió este enlace. Pide el enlace actualizado a la empresa.', no_disponible: 'Este presupuesto ya no admite respuestas.' };
  async function pintar() {
    if (!token) { c.innerHTML = '<div class="tarjeta"><h1>Enlace no válido</h1></div>'; return; }
    const r = await fetch(API); const d = await r.json().catch(() => ({}));
    if (!r.ok) { c.innerHTML = `<div class="tarjeta"><h1>Enlace no válido</h1><p>${e(d.error || '')}</p></div>`; return; }
    if (MENSAJES[d.estado]) { c.innerHTML = `<div class="tarjeta"><h1>${e(d.empresa)}</h1><p>${MENSAJES[d.estado]}</p></div>`; return; }
    const p = d.presupuesto;
    const respondido = d.estado === 'aceptado' || d.estado === 'rechazado';
    c.innerHTML = `<div class="tarjeta"><div class="nota">${e(d.empresa)}</div><h1>Presupuesto ${e(p.codigo)}</h1><div class="nota">Para ${e(p.cliente)} · ${f(p.fecha)}${!respondido ? ` · puedes responder hasta el ${f(d.caduca)}` : ''}</div></div>
      <div class="tarjeta"><table><thead><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">IVA</th></tr></thead><tbody>${p.lineas.map((l) => `<tr><td>${e(l.descripcion).replace(/\n/g, '<br>')}</td><td class="n">${l.cantidad}</td><td class="n">${eur(l.precio)}${l.dto ? ` (−${l.dto} %)` : ''}</td><td class="n">${l.iva} %</td></tr>`).join('')}</tbody></table>
        <div class="total">Total: ${eur(p.total)}</div>${p.observaciones ? `<p class="nota">${e(p.observaciones)}</p>` : ''}
        <div class="botones"><a class="boton" href="${API}/pdf" target="_blank" rel="noreferrer">Ver o descargar el PDF</a></div></div>
      ${respondido ? `<div class="tarjeta"><h1 class="${d.estado === 'aceptado' ? 'ok' : 'mal'}">Presupuesto ${d.estado}</h1><p>Respuesta registrada el ${new Date(d.respondido).toLocaleString('es-ES')}${d.respuesta_nombre ? ` por ${e(d.respuesta_nombre)}` : ''}.</p>${d.comentario ? `<p class="nota">«${e(d.comentario)}»</p>` : ''}</div>`
      : `<div class="tarjeta"><h1>Tu respuesta</h1>
        ${d.pide.nombre ? '<label for="nombre">Tu nombre *</label><input id="nombre" autocomplete="name" />' : ''}
        ${d.pide.email ? '<label for="email">Tu correo *</label><input id="email" type="email" autocomplete="email" />' : ''}
        ${d.pide.comentarios ? '<label for="comentario">Comentario (opcional)</label><textarea id="comentario" rows="3"></textarea>' : ''}
        <div class="botones"><button class="aceptar" data-a="aceptar">Aceptar el presupuesto</button><button class="rechazar" data-a="rechazar">Rechazarlo</button></div>
        <p class="nota">Tu respuesta quedará registrada con la fecha y la hora junto a este presupuesto. Aceptarlo no genera ningún cargo ni factura automáticamente.</p><div id="err"></div></div>`}`;
    c.querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
      const a = b.dataset.a;
      if (!confirm(a === 'aceptar' ? `¿Aceptar el presupuesto ${p.codigo} por ${eur(p.total)}?` : `¿Rechazar el presupuesto ${p.codigo}?`)) return;
      c.querySelectorAll('[data-a]').forEach((x) => { x.disabled = true; });
      const v = (id) => document.getElementById(id)?.value || '';
      const r2 = await fetch(`${API}/responder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: a, nombre: v('nombre'), email: v('email'), comentario: v('comentario') }) });
      const j = await r2.json().catch(() => ({}));
      if (!r2.ok) { document.getElementById('err').innerHTML = `<div class="error">${e(j.error || 'No se pudo guardar la respuesta')}</div>`; c.querySelectorAll('[data-a]').forEach((x) => { x.disabled = false; }); return; }
      pintar();
    });
  }
  pintar().catch(() => { c.innerHTML = '<div class="tarjeta"><h1>No se pudo cargar el presupuesto</h1><p class="nota">Inténtalo de nuevo en unos minutos.</p></div>'; });
})();
