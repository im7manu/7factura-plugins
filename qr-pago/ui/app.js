  (function () {
    const { api, aviso, escapar: e } = window.Facturador;
    const fm = document.getElementById('cfg'), P = '/api/p/qr-pago';
    async function pintar() {
      const [yo, c] = await Promise.all([api('/api/estado').then((x) => x.usuario), api(`${P}/config`)]);
      fm.activo.checked = c.activo; fm.iban.value = c.iban; fm.beneficiario.value = c.beneficiario; fm.bic.value = c.bic; fm.referencia.value = c.referencia; fm.texto.checked = c.texto;
      fm.querySelectorAll('[data-tipo]').forEach((x) => { x.checked = c.tipos.includes(x.dataset.tipo); });
      fm.querySelectorAll('input, button').forEach((x) => { x.disabled = yo?.rol !== 'admin'; });
      document.getElementById('solo-admin').hidden = yo?.rol === 'admin';
      const pv = document.getElementById('previa');
      pv.innerHTML = c.iban_valido ? await fetch(`${P}/vista-previa.svg`).then((r) => r.text()) : '<p class="mal" style="color:#b00">Falta un IBAN válido (aquí o en los datos de la empresa).</p>';
      document.getElementById('datos').textContent = c.iban_valido ? `${c.beneficiario_efectivo} · ${c.iban_efectivo.replace(/(.{4})/g, '$1 ')} · 123,45 € de ejemplo` : '';
    }
    fm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api(`${P}/config`, { method: 'PUT', body: { activo: fm.activo.checked, iban: fm.iban.value, beneficiario: fm.beneficiario.value, bic: fm.bic.value, referencia: fm.referencia.value, texto: fm.texto.checked, tipos: [...fm.querySelectorAll('[data-tipo]:checked')].map((x) => x.dataset.tipo) } });
        aviso('Guardado'); pintar();
      } catch (x) { aviso(x.message, 'error'); }
    });
    pintar().catch((x) => aviso(x.message, 'error'));
  })();
