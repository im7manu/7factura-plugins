(function () {
  const { api, aviso, escapar: e, parametro, cerrar, actualizar } = window.Facturador;
  const id = Number(parametro('documento'));
  const P = '/api/p/whatsapp';
  const c = document.getElementById('contenido');
  (async () => {
    let i;
    try { i = await api(`${P}/envios/${id}`); } catch (x) { c.innerHTML = `<div class="error">${e(x.message)}</div>`; return; }
    c.className = '';
    c.innerHTML = `
      ${i.conexion !== 'conectado' ? '<div class="error">WhatsApp no está conectado. Un administrador debe vincularlo en el menú <strong>WhatsApp</strong>.</div>' : ''}
      ${i.borrador ? '<div class="error">Emite el documento antes de enviarlo.</div>' : ''}
      <label class="fx-campo"><span>Teléfono de ${e(i.destinatario.nombre || 'destinatario')}</span><input class="fx-input" id="tel" value="${e(i.destinatario.telefono)}" placeholder="600 000 000 o +351…" inputmode="tel" /></label>
      ${i.destinatario.telefono ? '' : '<p class="fx-nota">La ficha no tiene teléfono: escríbelo (puedes guardarlo después en la ficha).</p>'}
      <label class="fx-campo" style="margin-top:10px"><span>Mensaje</span><textarea class="fx-textarea" id="texto" rows="5">${e(i.texto)}</textarea></label>
      <div class="adjunto">📄 <a href="/api/documentos/${id}/pdf" target="_blank" rel="noreferrer">${e(i.archivo)}</a> <span class="fx-nota">(PDF del documento)</span></div>
      <p class="fx-nota">Se envía desde el WhatsApp vinculado de la empresa. «Enviado» significa que WhatsApp ha aceptado el mensaje; «Entregado», que el teléfono del destinatario lo ha confirmado.</p>
      <div id="err"></div>
      <div class="fx-fila" style="margin-top:10px"><button class="fx-btn" id="cancelar">Cancelar</button><button class="fx-btn fx-btn-primario" id="enviar" ${i.borrador ? 'disabled' : ''}>${i.historial.length ? 'Enviar de nuevo' : 'Enviar'}</button></div>
      ${i.historial.length ? `<div class="hist"><strong>Envíos anteriores</strong>${i.historial.map((h) => `<div><span class="${['enviado', 'entregado'].includes(h.estado) ? 'ok' : 'mal'}">${e(WA.ENVIO[h.estado] || h.estado)}</span> · +${e(h.telefono)} · ${e(WA.fecha(h.fecha))} · ${e(h.usuario)}${h.error ? ` · ${e(h.error)}` : ''}</div>`).join('')}</div>` : ''}`;
    document.getElementById('cancelar').onclick = () => cerrar();
    document.getElementById('enviar').onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Enviando…'; document.getElementById('err').innerHTML = '';
      try {
        await api(`${P}/envios/${id}`, { method: 'POST', body: { telefono: document.getElementById('tel').value, texto: document.getElementById('texto').value, destinatario: i.destinatario.nombre } });
        aviso('Enviado: WhatsApp ha aceptado el mensaje'); actualizar(); setTimeout(cerrar, 900);
      } catch (x) { document.getElementById('err').innerHTML = `<div class="error">${e(x.message)}</div>`; b.disabled = false; b.textContent = 'Reintentar'; }
    };
  })();
})();
