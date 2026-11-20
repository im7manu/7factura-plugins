(function () {
  const { api, aviso, escapar: e, parametro, actualizar } = window.Facturador;
  const id = Number(parametro('documento')), P = '/api/p/aceptacion', c = document.getElementById('c');
  const f = (s) => (s ? new Date(s).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const ESTADO = { pendiente: '<span class="chip atencion">Pendiente de respuesta</span>', aceptado: '<span class="chip ok">Aceptado</span>', rechazado: '<span class="chip mal">Rechazado</span>', revocado: '<span class="chip">Revocado</span>', caducado: '<span class="chip">Caducado</span>', modificado: '<span class="chip mal">Invalidado: el presupuesto cambió</span>', no_disponible: '<span class="chip">El presupuesto ya no admite respuestas</span>' };
  async function pintar() {
    let i;
    try { i = await api(`${P}/documentos/${id}`); } catch (x) { c.innerHTML = `<div class="error">${e(x.message)}</div>`; return; }
    const activo = i.enlaces.find((x) => x.estado === 'pendiente');
    c.className = '';
    c.innerHTML = `<p>El cliente abre el enlace, ve el presupuesto <strong>${e(i.codigo)}</strong>, descarga el PDF y lo acepta o rechaza${i.config.comentarios ? ' con un comentario' : ''}. Aceptar no emite ninguna factura.</p>
      ${activo ? `<div class="fx-card"><label class="fx-campo"><span>Enlace (caduca el ${f(activo.caduca)})</span><input class="fx-input" id="url" readonly value="${e(activo.url)}" /></label>
        <div class="fx-fila" style="margin-top:8px"><button class="fx-btn" id="copiar">Copiar enlace</button><button class="fx-btn fx-btn-peligro" id="revocar">Revocar</button></div>
        <h3>Enviar por correo</h3><div class="fx-grid"><label class="fx-campo"><span>Para</span><input class="fx-input" id="para" value="${e(i.email)}" /></label><label class="fx-campo"><span>Asunto</span><input class="fx-input" id="asunto" value="Presupuesto ${e(i.codigo)}" /></label></div>
        <label class="fx-campo" style="margin-top:6px"><span>Mensaje ({enlace} se sustituye por el enlace)</span><textarea class="fx-textarea" id="texto" rows="5">Hola ${e(i.cliente)}:\n\nPuedes consultar el presupuesto ${e(i.codigo)}, descargarlo y aceptarlo o rechazarlo aquí:\n{enlace}\n\nUn saludo.</textarea></label>
        <div class="fx-fila" style="margin-top:6px"><button class="fx-btn fx-btn-primario" id="enviar">Enviar con mi cuenta de correo</button></div>
        <p class="fx-nota">También puedes copiarlo y mandarlo por WhatsApp u otro medio.</p></div>`
      : i.estado === 'emitido' ? `<div class="fx-fila"><label class="fx-campo"><span>Caduca a los (días)</span><input class="fx-input" type="number" min="1" max="365" id="dias" value="${i.config.caducidad_dias}" style="width:100px" /></label><button class="fx-btn fx-btn-primario" id="crear">Crear enlace</button></div>`
      : `<div class="error">El presupuesto está «${e(i.estado)}» y ya no admite respuestas por enlace.</div>`}
      ${i.enlaces.length ? `<h3>Historial</h3><table class="fx-tabla"><tbody>${i.enlaces.map((x) => `<tr><td>${f(x.creado)}</td><td>${ESTADO[x.estado] || e(x.estado)}${x.respondido ? `<div class="fx-nota">${f(x.respondido)}${x.respuesta_nombre ? ` · ${e(x.respuesta_nombre)}` : ''}${x.respuesta_email ? ` (${e(x.respuesta_email)})` : ''}</div>${x.comentario ? `<div class="previa">${e(x.comentario)}</div>` : ''}<a href="${P}/respuestas/${x.id}.pdf" target="_blank" class="fx-nota">PDF respondido</a>` : x.abierto ? `<div class="fx-nota">Abierto por el cliente el ${f(x.abierto)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}`;
    document.getElementById('crear')?.addEventListener('click', async () => { try { await api(`${P}/documentos/${id}/enlace`, { method: 'POST', body: { dias: document.getElementById('dias').value } }); pintar(); } catch (x) { aviso(x.message, 'error'); } });
    document.getElementById('copiar')?.addEventListener('click', () => { const u = document.getElementById('url'); u.select(); navigator.clipboard?.writeText(u.value).then(() => aviso('Enlace copiado')).catch(() => document.execCommand('copy')); });
    document.getElementById('revocar')?.addEventListener('click', async () => { if (!confirm('¿Revocar el enlace? El cliente ya no podrá usarlo.')) return; await api(`${P}/enlaces/${activo.id}/revocar`, { method: 'POST', body: {} }); pintar(); });
    document.getElementById('enviar')?.addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try { await api(`${P}/enlaces/${activo.id}/enviar`, { method: 'POST', body: { para: document.getElementById('para').value, asunto: document.getElementById('asunto').value, texto: document.getElementById('texto').value } }); aviso('Enviado'); actualizar(); }
      catch (x) { aviso(x.message, 'error'); } finally { ev.target.disabled = false; }
    });
  }
  pintar();
})();
