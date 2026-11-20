(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const $ = (id) => document.getElementById(id);
  const P = '/api/p/estado-cuenta';
  let clientes = [];
  const eur = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const f = (s) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : '');
  const abrir = (ruta) => { try { window.parent.history.pushState({}, '', ruta); window.parent.dispatchEvent(new PopStateEvent('popstate')); } catch { window.top.location.href = ruta; } };
  const hoy = new Date();
  $('desde').value = `${hoy.getFullYear()}-01-01`; $('hasta').value = hoy.toLocaleDateString('sv-SE');
  $('banco').onchange = () => { $('campo-instr').hidden = !$('banco').checked; };
  const params = () => new URLSearchParams({ cliente_id: $('cliente').value, desde: $('desde').value, hasta: $('hasta').value, pagadas: $('pagadas').checked ? '1' : '0', detalle: $('detalle').checked ? '1' : '0', vencimientos: $('vencimientos').checked ? '1' : '0', banco: $('banco').checked ? '1' : '0', instrucciones: $('instrucciones').value });

  async function ver() {
    if (!$('cliente').value) return aviso('Elige un cliente', 'error');
    let x;
    try { x = await api(`${P}/estado?${params()}`); } catch (er) { return aviso(er.message, 'error'); }
    const cli = clientes.find((c) => c.id === Number($('cliente').value));
    $('resultado').innerHTML = `
      <div class="fx-card"><div class="fx-grid">
        <div><div class="fx-nota">Saldo anterior al ${f(x.desde)}</div><h2>${eur(x.saldo_anterior)}</h2></div>
        <div><div class="fx-nota">Facturado en el periodo</div><h2>${eur(x.facturado)}</h2></div>
        <div><div class="fx-nota">Cobrado en el periodo</div><h2>${eur(x.cobrado)}</h2></div>
        <div><div class="fx-nota">Saldo pendiente al ${f(x.hasta)}</div><h2 class="${x.saldo_final > 0.005 ? 'mal' : 'ok'}">${eur(x.saldo_final)}</h2></div>
      </div>${Math.abs(x.pendiente_total - x.saldo_final) > 0.01 ? `<p class="fx-nota">Pendiente total a día de hoy (todas las fechas): ${eur(x.pendiente_total)}.</p>` : ''}</div>
      <div class="fx-card"><table class="fx-tabla"><thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Cargo</th><th class="num">Abono</th><th class="num">Saldo</th></tr></thead><tbody>
        <tr><td>${f(x.desde)}</td><td><em>Saldo anterior</em></td><td></td><td></td><td class="num">${eur(x.saldo_anterior)}</td></tr>
        ${x.movimientos.map((m) => `<tr><td>${f(m.fecha)}</td><td><a href="#" data-doc="${m.documento_id}">${e(m.concepto)}</a>${$('vencimientos').checked && m.vencimientos?.length ? `<div class="fx-nota">Vto.: ${m.vencimientos.map((v) => `${f(v.vencimiento)} ${eur(v.importe)}${v.pendiente > 0.005 ? ` (pendiente ${eur(v.pendiente)})` : ''}`).join(', ')}</div>` : ''}</td><td class="num">${m.cargo ? eur(m.cargo) : ''}</td><td class="num">${m.abono ? eur(m.abono) : ''}</td><td class="num">${eur(m.saldo)}</td></tr>`).join('')}
        <tr><td>${f(x.hasta)}</td><td><strong>Saldo final</strong></td><td class="num"><strong>${eur(x.facturado)}</strong></td><td class="num"><strong>${eur(x.cobrado)}</strong></td><td class="num"><strong>${eur(x.saldo_final)}</strong></td></tr>
      </tbody></table></div>
      ${$('vencimientos').checked && x.vencidos.length ? `<div class="fx-card aviso"><h2>Recibos vencidos</h2>${x.vencidos.map((v) => `<div>${e(v.codigo)} · venció el ${f(v.vencimiento)} · <strong>${v.retraso} días</strong> de retraso · pendiente ${eur(v.pendiente)}</div>`).join('')}</div>` : ''}
      <div class="fx-card"><div class="fx-fila"><button class="fx-btn" id="pdf">Ver PDF</button><button class="fx-btn" id="pdf-d">Descargar PDF</button><button class="fx-btn" id="csv">Descargar CSV</button></div>
        <h3>Enviar por correo</h3><div class="fx-grid"><label class="fx-campo"><span>Para</span><input class="fx-input" id="para" value="${e(cli?.email || '')}" /></label><label class="fx-campo"><span>Asunto</span><input class="fx-input" id="asunto" value="Estado de cuenta del ${f(x.desde)} al ${f(x.hasta)}" /></label></div>
        <label class="fx-campo" style="margin-top:8px"><span>Mensaje</span><textarea class="fx-textarea" id="texto" rows="4">Hola ${e(x.cliente.nombre)}:\n\nTe adjuntamos el estado de cuenta del ${f(x.desde)} al ${f(x.hasta)}. Saldo pendiente: ${eur(x.saldo_final)}.\n\nUn saludo.</textarea></label>
        <div class="fx-fila" style="margin-top:8px"><button class="fx-btn fx-btn-primario" id="enviar">Enviar con mi cuenta de correo</button></div></div>`;
    document.querySelectorAll('[data-doc]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); abrir(`/facturas/${a.dataset.doc}`); });
    $('pdf').onclick = () => window.open(`${P}/estado.pdf?${params()}`);
    $('pdf-d').onclick = () => window.open(`${P}/estado.pdf?${params()}&descargar=1`);
    $('csv').onclick = () => window.open(`${P}/estado.csv?${params()}`);
    $('enviar').onclick = async (ev) => {
      if (!confirm(`¿Enviar el estado de cuenta a ${$('para').value}?`)) return;
      ev.target.disabled = true;
      try { await api(`${P}/enviar`, { method: 'POST', body: { ...Object.fromEntries(params()), para: $('para').value, asunto: $('asunto').value, texto: $('texto').value } }); aviso('Estado de cuenta enviado'); }
      catch (er) { aviso(er.message, 'error'); } finally { ev.target.disabled = false; }
    };
  }
  $('ver').onclick = ver;
  (async () => {
    try {
      clientes = await api(`${P}/clientes`);
      $('cliente').innerHTML = '<option value="">Elige…</option>' + clientes.map((c) => `<option value="${c.id}">${e(c.nombre)}${c.nif ? ` (${e(c.nif)})` : ''}</option>`).join('');
      const pre = Facturador.parametro('cliente'); if (pre) { $('cliente').value = pre; ver(); }
    } catch (er) { aviso(er.message, 'error'); }
  })();
})();
