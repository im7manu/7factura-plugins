// Plugin «7Ruta» — página dentro de 7Factura.
(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const $ = (id) => document.getElementById(id);
  const P = '/api/p/rutas';
  let yo = null, cfg = null, mapa = null;
  const km = (n) => `${Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;
  const dur = (m) => (m == null ? '' : m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`);
  const nombreProv = (p) => (p === 'google' ? 'Google Maps' : 'OpenRouteService');
  const textoOpc = (o = {}) => [o.perfil === 'coche' ? 'turismo' : 'camión', o.evitar_peajes && 'sin peajes', o.evitar_autopistas && 'sin autopistas', o.evitar_ferris && 'sin ferris'].filter(Boolean).join(', ');

  document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['calcular', 'config'].forEach((p) => { $(`p-${p}`).hidden = p !== b.dataset.p; });
  }));

  const opcionesHtml = (o, p) => `
    <label class="fx-campo"><span>Vehículo</span><select class="fx-select" data-${p}="perfil"><option value="camion" ${o.perfil !== 'coche' ? 'selected' : ''}>Camión (restricciones de peso y altura)</option><option value="coche" ${o.perfil === 'coche' ? 'selected' : ''}>Turismo / furgoneta</option></select></label>
    <label class="casilla"><input type="checkbox" data-${p}="evitar_peajes" ${o.evitar_peajes ? 'checked' : ''}> Evitar peajes</label>
    <label class="casilla"><input type="checkbox" data-${p}="evitar_autopistas" ${o.evitar_autopistas ? 'checked' : ''}> Evitar autopistas y autovías</label>
    <label class="casilla"><input type="checkbox" data-${p}="evitar_ferris" ${o.evitar_ferris ? 'checked' : ''}> Evitar ferris</label>`;
  const leerOpc = (raiz, p) => {
    const v = (k) => raiz.querySelector(`[data-${p}="${k}"]`);
    return { perfil: v('perfil').value, evitar_peajes: v('evitar_peajes').checked, evitar_autopistas: v('evitar_autopistas').checked, evitar_ferris: v('evitar_ferris').checked };
  };

  // ---------- Calcular ----------
  function lugar(valor = '', i = 0) {
    const d = document.createElement('div');
    d.className = 'lugar';
    d.innerHTML = `<label class="fx-campo"><span>${i === 0 ? 'Origen' : 'Destino'}</span><input class="fx-input" data-lugar placeholder="Dirección, población o coordenadas (40.4168, -3.7038)" value="${e(valor)}"></label>${i > 1 ? '<button class="fx-btn" type="button" data-quitar title="Quitar">✕</button>' : ''}`;
    d.querySelector('[data-quitar]')?.addEventListener('click', () => { d.remove(); etiquetas(); });
    return d;
  }
  function etiquetas() { $('lugares').querySelectorAll('.lugar').forEach((l, i) => { l.querySelector('span').textContent = i === 0 ? 'Origen' : `Destino${$('lugares').children.length > 2 ? ` ${i}` : ''}`; }); }
  $('lugares').append(lugar('', 0), lugar('', 1));
  $('anadir').addEventListener('click', () => { $('lugares').append(lugar('', $('lugares').children.length)); etiquetas(); });

  $('calcular').addEventListener('click', async () => {
    const textos = [...document.querySelectorAll('[data-lugar]')].map((i) => i.value.trim()).filter(Boolean);
    if (textos.length < 2) return aviso('Indica el origen y al menos un destino.', 'error');
    $('calcular').disabled = true; $('msg').textContent = 'Calculando…';
    try {
      const r = await api(`${P}/ruta`, { method: 'POST', body: { textos, opciones: leerOpc($('opc-calc'), 'c') } });
      $('resultado').hidden = false;
      $('resumen').innerHTML = `<h2>${km(r.km)} · ${dur(r.minutos)}</h2><div class="fx-nota">${nombreProv(r.proveedor)} · ${textoOpc(r.opciones)}</div>${r.avisos?.length ? `<div class="avisos">${r.avisos.map(e).join('<br>')}</div>` : ''}`;
      $('puntos').innerHTML = r.puntos.map((p, i) => `${i + 1}. ${e(p.etiqueta)}`).join(' → ');
      if (!mapa) mapa = await window.RutasMapa.crear($('mapa'), cfg);
      mapa.puntos(r.puntos); mapa.linea(r.linea);
      $('msg').textContent = '';
    } catch (x) { $('msg').textContent = x.message; } finally { $('calcular').disabled = !cfg?.configurado; }
  });

  // ---------- Configuración ----------
  function pintarConfig() {
    const f = $('cfg'), admin = yo?.rol === 'admin', o = cfg.opciones, c = o.camion;
    f.querySelector(`[name=proveedor][value=${cfg.proveedor}]`).checked = true;
    f.ors_clave.placeholder = cfg.ors?.tiene_clave ? 'Guardada (déjalo vacío para mantenerla)' : 'Pega aquí tu clave';
    f.ors_base_ruta.value = cfg.ors?.base_ruta || ''; f.ors_base_geo.value = cfg.ors?.base_geo || '';
    f.google_clave_servidor.placeholder = cfg.google?.tiene_clave_servidor ? 'Guardada (déjalo vacío para mantenerla)' : 'AIza…';
    f.google_clave_navegador.value = cfg.google?.clave_navegador || '';
    $('opc-cfg').innerHTML = opcionesHtml(o, 'f');
    for (const k of ['peso_t', 'altura_m', 'ancho_m', 'largo_m', 'eje_t']) f[k].value = c[k];
    f.querySelectorAll('input, select, button').forEach((x) => { x.disabled = !admin; });
    $('solo-admin').hidden = admin;
    const vis = () => {
      const p = f.querySelector('[name=proveedor]:checked').value;
      f.querySelectorAll('[data-prov]').forEach((b) => { b.hidden = b.dataset.prov !== p; });
      f.querySelector('.camion').hidden = f.querySelector('[data-f=perfil]').value !== 'camion';
    };
    f.onchange = vis; vis();
    $('opc-calc').innerHTML = opcionesHtml(o, 'c');
    $('sin-config').hidden = cfg.configurado;
    $('sin-config').innerHTML = `Falta configurar el proveedor de mapas${admin ? ': ve a la pestaña <strong>Configuración</strong>.' : '. Avisa a un administrador.'}`;
    $('calcular').disabled = !cfg.configurado;
  }
  async function guardar() {
    const f = $('cfg');
    await api(`${P}/config`, { method: 'PUT', body: {
      proveedor: f.querySelector('[name=proveedor]:checked').value,
      ors: { clave: f.ors_clave.value, base_ruta: f.ors_base_ruta.value, base_geo: f.ors_base_geo.value },
      google: { clave_servidor: f.google_clave_servidor.value, clave_navegador: f.google_clave_navegador.value },
      opciones: { ...leerOpc($('opc-cfg'), 'f'), camion: { peso_t: f.peso_t.value, altura_m: f.altura_m.value, ancho_m: f.ancho_m.value, largo_m: f.largo_m.value, eje_t: f.eje_t.value } },
    } });
    f.ors_clave.value = ''; f.google_clave_servidor.value = '';
    const proveedorAntes = cfg.proveedor;
    cfg = await api(`${P}/config`);
    if (proveedorAntes !== cfg.proveedor && mapa) { mapa.destruir(); mapa = null; $('mapa').innerHTML = ''; $('resultado').hidden = true; }
    pintarConfig();
  }
  $('cfg').addEventListener('submit', async (ev) => { ev.preventDefault(); try { await guardar(); aviso('Configuración guardada'); } catch (x) { aviso(x.message, 'error'); } });
  $('probar').addEventListener('click', async () => {
    $('estado').textContent = 'Probando…';
    try { await guardar(); const r = await api(`${P}/probar`, { method: 'POST', body: {} }); $('estado').textContent = `Funciona: ruta de prueba de ${km(r.km)} con ${nombreProv(r.proveedor)}.`; }
    catch (x) { $('estado').textContent = x.message; }
  });

  (async () => {
    try {
      [yo, cfg] = await Promise.all([api('/api/estado').then((x) => x.usuario), api(`${P}/config`)]);
      pintarConfig();
      if (!cfg.configurado && yo?.rol === 'admin') document.querySelector('[data-p="config"]').click();
    } catch (x) { aviso(x.message, 'error'); }
  })();
})();
