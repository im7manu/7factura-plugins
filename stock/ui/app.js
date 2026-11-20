(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const $ = (id) => document.getElementById(id);
  const P = '/api/p/stock';
  let productos = [], recep = [], yo = null;
  const n = (x) => Number(x || 0).toLocaleString('es-ES', { maximumFractionDigits: 3 });
  const f = (s) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : '');
  const abrir = (ruta) => { try { window.parent.history.pushState({}, '', ruta); window.parent.dispatchEvent(new PopStateEvent('popstate')); } catch { window.top.location.href = ruta; } };
  const TIPO = { inicial: 'Inicial', venta: 'Venta', devolucion: 'Devolución', compra: 'Entrada de compra', ajuste: 'Ajuste' };
  const RUTA = { albaran: '/albaranes', factura: '/facturas', albaran_compra: '/compras/albaranes', factura_compra: '/compras/facturas', pedido_compra: '/compras/pedidos' };
  document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['inventario', 'recepciones', 'config'].forEach((p) => { $(`p-${p}`).hidden = p !== b.dataset.p; });
    if (b.dataset.p === 'recepciones') recepciones();
  }));
  const estado = (p) => (!p.controlar ? '<span class="chip">Sin control</span>' : p.existencias <= 0 ? '<span class="chip mal">Agotado</span>' : p.existencias <= p.minimo ? '<span class="chip atencion">Reponer</span>' : '<span class="chip ok">Correcto</span>');

  async function cargar() {
    productos = await api(`${P}/productos`);
    const q = $('buscar').value.toLowerCase(), solo = $('solo-control').checked;
    const l = productos.filter((p) => (!solo || p.controlar) && (!q || `${p.descripcion} ${p.referencia}`.toLowerCase().includes(q)));
    $('productos').innerHTML = l.map((p) => `<tr class="clic" data-p2="${p.id}"><td>${e(p.descripcion)}${p.referencia ? ` <span class="fx-nota">${e(p.referencia)}</span>` : ''}</td><td class="num">${p.controlar ? `<strong>${n(p.existencias)}</strong>` : '—'}</td><td class="num ocultar-movil">${p.controlar ? n(p.minimo) : ''}</td><td>${estado(p)}</td><td><button class="fx-btn" data-ver="${p.id}">${p.controlar ? 'Ver' : 'Activar'}</button></td></tr>`).join('')
      || `<tr><td colspan="5" class="vacio">${solo ? 'Ningún producto tiene el control de stock activado. Desmarca «Solo con control de stock» y activa los que quieras controlar.' : 'No hay productos.'}</td></tr>`;
    document.querySelectorAll('[data-ver]').forEach((b) => b.onclick = () => ficha(Number(b.dataset.ver)));
  }
  $('buscar').oninput = cargar; $('solo-control').onchange = cargar;

  async function ficha(id) {
    const p = productos.find((x) => x.id === id), d = $('ficha'), admin = yo?.rol === 'admin';
    d.hidden = false;
    const movs = p.controlar ? await api(`${P}/productos/${id}/movimientos`) : { movimientos: [] };
    d.innerHTML = `<h2>${e(p.descripcion)}</h2>
      <form id="f-prod" class="fx-fila"><label class="casilla"><input type="checkbox" name="controlar" ${p.controlar ? 'checked' : ''} /> Controlar stock</label>
        ${!p.controlar && !p.ultimo ? '<label class="fx-campo"><span>Existencias iniciales</span><input class="fx-input" type="number" step="any" name="inicial" style="width:120px" /></label>' : ''}
        <label class="fx-campo"><span>Stock mínimo</span><input class="fx-input" type="number" step="any" min="0" name="minimo" value="${p.minimo}" style="width:110px" /></label>
        <label class="casilla"><input type="checkbox" name="permitir_negativo" ${p.permitir_negativo ? 'checked' : ''} /> Permitir stock negativo</label>
        <button class="fx-btn fx-btn-primario">Guardar</button></form>
      <p class="fx-nota">No actives el control en productos que sean servicios. ${p.permitir_negativo ? '' : 'Sin stock negativo, no se podrá emitir un albarán o factura si faltan unidades.'}</p>
      ${p.controlar ? `<h3>Ajuste manual</h3><form id="f-aj" class="fx-fila">
        <label class="fx-campo"><span>Tipo</span><select class="fx-select" name="modo"><option value="cantidad">Sumar o restar</option><option value="recuento">Recuento (fijar existencias)</option></select></label>
        <label class="fx-campo"><span>Cantidad</span><input class="fx-input" type="number" step="any" name="cantidad" required style="width:110px" /></label>
        <label class="fx-campo"><span>Motivo *</span><select class="fx-select" name="motivo"><option>Inventario</option><option>Rotura o pérdida</option><option>Consumo interno</option><option>Regalo o muestra</option><option>Corrección</option><option>Otro</option></select></label>
        <label class="fx-campo" style="flex:1"><span>Observaciones</span><input class="fx-input" name="observaciones" /></label><button class="fx-btn">Registrar ajuste</button></form>
      <h3>Movimientos</h3><div class="fx-fila"><input class="fx-input" type="date" id="m-desde" /><input class="fx-input" type="date" id="m-hasta" /><button class="fx-btn" id="m-filtrar">Filtrar</button></div>
      <table class="fx-tabla"><thead><tr><th>Fecha</th><th>Movimiento</th><th class="num">Cantidad</th><th class="num">Existencias</th></tr></thead><tbody id="movs"></tbody></table>` : ''}`;
    const pintarMovs = (r) => { $('movs').innerHTML = `${r.inicial ? `<tr><td></td><td><em>Saldo anterior</em></td><td></td><td class="num">${n(r.inicial)}</td></tr>` : ''}${r.movimientos.map((m) => `<tr><td>${f(m.fecha)}</td><td>${TIPO[m.tipo] || e(m.tipo)} · ${m.documento_id && RUTA[m.doc_tipo] ? `<a href="#" data-doc="${RUTA[m.doc_tipo]}/${m.documento_id}">${e(m.motivo)}</a>` : e(m.motivo)} <span class="fx-nota">${e(m.usuario || '')}</span></td><td class="num ${m.cantidad < 0 ? 'mal' : 'ok'}">${m.cantidad > 0 ? '+' : ''}${n(m.cantidad)}</td><td class="num">${n(m.saldo)}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin movimientos.</td></tr>'}`; document.querySelectorAll('[data-doc]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); abrir(a.dataset.doc); }); };
    if (p.controlar) pintarMovs(movs);
    $('m-filtrar')?.addEventListener('click', async () => pintarMovs(await api(`${P}/productos/${id}/movimientos?desde=${$('m-desde').value}&hasta=${$('m-hasta').value}`)));
    $('f-prod').onsubmit = async (ev) => { ev.preventDefault(); const fm = ev.target; try { await api(`${P}/productos/${id}`, { method: 'PUT', body: { controlar: fm.controlar.checked, minimo: fm.minimo.value, permitir_negativo: fm.permitir_negativo.checked, inicial: fm.inicial?.value } }); aviso('Guardado'); await cargar(); ficha(id); } catch (x) { aviso(x.message, 'error'); } };
    $('f-aj')?.addEventListener('submit', async (ev) => { ev.preventDefault(); const fm = ev.target; try { const r = await api(`${P}/productos/${id}/ajuste`, { method: 'POST', body: { modo: fm.modo.value, cantidad: fm.cantidad.value, motivo: fm.motivo.value, observaciones: fm.observaciones.value } }); aviso(`Ajuste registrado. Existencias: ${n(r.existencias)}`); await cargar(); ficha(id); } catch (x) { aviso(x.message, 'error'); } });
    if (!admin) d.querySelectorAll('#f-prod input, #f-prod button').forEach((x) => { x.disabled = true; });
    d.scrollIntoView({ behavior: 'smooth' });
  }

  async function recepciones() {
    recep = await api(`${P}/recepciones`);
    $('recep-fecha').value = new Date().toLocaleDateString('sv-SE');
    $('recep').innerHTML = recep.map((l, i) => `<tr><td><a href="#" data-doc="${RUTA[l.tipo]}/${l.documento_id}">${e(l.codigo)}</a>${l.numero_proveedor ? ` <span class="fx-nota">(${e(l.numero_proveedor)})</span>` : ''}<div class="fx-nota">${f(l.fecha)}</div></td><td>${e(l.proveedor || '')}</td><td>${e(l.descripcion)}</td><td class="num">${n(l.pendiente)}</td><td class="num"><input class="fx-input importe" type="number" step="any" min="0" max="${l.pendiente}" data-r="${i}" value="" placeholder="0" style="width:90px" /></td></tr>`).join('') || '<tr><td colspan="5" class="vacio">No hay mercancía pendiente de recibir.</td></tr>';
    document.querySelectorAll('#recep [data-doc]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); abrir(a.dataset.doc); });
  }
  $('recep-ok').onclick = async () => {
    const lineas = [...document.querySelectorAll('[data-r]')].filter((i) => Number(i.value) > 0).map((i) => ({ linea_id: recep[Number(i.dataset.r)].linea_id, cantidad: i.value }));
    if (!lineas.length) return aviso('Escribe las unidades recibidas', 'error');
    try { await api(`${P}/recepciones`, { method: 'POST', body: { fecha: $('recep-fecha').value, lineas } }); aviso('Entrada registrada'); recepciones(); cargar(); } catch (x) { aviso(x.message, 'error'); }
  };
  $('cfg').addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api(`${P}/config`, { method: 'PUT', body: { salida: ev.target.querySelector('[name=salida]:checked').value } }); aviso('Guardado'); } catch (x) { aviso(x.message, 'error'); } });
  (async () => {
    try { [yo] = [(await api('/api/estado')).usuario]; const c = await api(`${P}/config`); $('cfg').querySelector(`[name=salida][value=${c.salida}]`).checked = true; if (yo?.rol !== 'admin') $('cfg').querySelectorAll('input, button').forEach((x) => { x.disabled = true; }); await cargar(); if (!productos.some((p) => p.controlar)) { $('solo-control').checked = false; cargar(); } }
    catch (x) { aviso(x.message, 'error'); }
  })();
})();
