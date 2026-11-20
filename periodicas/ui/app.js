(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const $ = (id) => document.getElementById(id);
  const P = '/api/p/periodicas';
  let plantillas = [], clientes = [], productos = [], ajustes = {}, editando = null, lineas = [], yo = null;
  const eur = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const f = (s) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : '—');
  const CADA = { semanal: 'Semana', mensual: 'Mes', trimestral: 'Trimestre', semestral: 'Semestre', anual: 'Año' };
  const ESTADO = { activa: '<span class="chip ok">Activa</span>', pausada: '<span class="chip atencion">En pausa</span>', cancelada: '<span class="chip mal">Cancelada</span>', finalizada: '<span class="chip">Finalizada</span>' };
  const abrir = (ruta) => { try { window.parent.history.pushState({}, '', ruta); window.parent.dispatchEvent(new PopStateEvent('popstate')); } catch { window.top.location.href = ruta; } };
  const base = (l) => l.reduce((s, x) => s + (Number(x.cantidad) || 0) * (Number(x.precio) || 0) * (1 - (Number(x.dto) || 0) / 100), 0);

  async function cargar() {
    [plantillas] = await Promise.all([api(`${P}/plantillas`)]);
    $('lista').innerHTML = plantillas.map((p) => `<tr><td><strong>${e(p.nombre)}</strong>${p.generadas ? `<div class="fx-nota">${p.generadas} factura(s) preparadas</div>` : ''}</td><td>${e(p.cliente || '')}</td><td>${CADA[p.periodicidad]}</td><td>${['activa', 'pausada'].includes(p.estado) ? f(p.proxima) : '—'}</td><td class="num ocultar-movil">${eur(base(p.lineas))} + imp.</td><td>${ESTADO[p.estado]}</td>
      <td style="white-space:nowrap"><button class="fx-btn" data-ed="${p.id}">Editar</button> ${p.estado === 'activa' ? `<button class="fx-btn" data-est="${p.id}" data-v="pausada">Pausar</button>` : p.estado === 'pausada' ? `<button class="fx-btn" data-est="${p.id}" data-v="activa">Reanudar</button>` : ''} <button class="fx-btn" data-dup="${p.id}">Duplicar</button> ${['activa', 'pausada'].includes(p.estado) ? `<button class="fx-btn fx-btn-peligro" data-est="${p.id}" data-v="cancelada">Cancelar</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="7" class="vacio">Aún no hay plantillas. Crea la primera con «Nueva plantilla».</td></tr>';
    document.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => editar(Number(b.dataset.ed)));
    document.querySelectorAll('[data-dup]').forEach((b) => b.onclick = async () => { const r = await api(`${P}/plantillas/${b.dataset.dup}/duplicar`, { method: 'POST', body: {} }); aviso('Copia creada en pausa: revísala y reanúdala'); await cargar(); editar(r.id); });
    document.querySelectorAll('[data-est]').forEach((b) => b.onclick = async () => {
      const v = b.dataset.v, p = plantillas.find((x) => x.id === Number(b.dataset.est));
      if (v === 'cancelada' && !confirm(`¿Cancelar «${p.nombre}»? No se prepararán más facturas. Las ya creadas no cambian.`)) return;
      let recuperar = false;
      if (v === 'activa' && p.proxima < new Date().toLocaleDateString('sv-SE')) recuperar = confirm('Mientras estuvo en pausa pasaron periodos sin facturar. ¿Preparar también sus borradores? (Cancelar = continuar desde el próximo periodo)');
      try { await api(`${P}/plantillas/${p.id}/estado`, { method: 'POST', body: { estado: v, recuperar } }); cargar(); pend(); } catch (x) { aviso(x.message, 'error'); }
    });
  }

  async function pend() {
    const l = await api(`${P}/pendientes`);
    $('pendientes').innerHTML = l.length ? `<div class="fx-card aviso"><h2>Por revisar</h2><table class="fx-tabla"><tbody>${l.map((x) => `<tr><td>${e(x.nombre)}</td><td>${f(x.periodo)}</td><td>${e(x.cliente || '')}</td><td>${x.documento_id ? `<a href="#" data-doc="${x.documento_id}">Abrir el borrador</a>` : `<span class="mal">No se pudo preparar: ${e(x.error)}</span>`}</td></tr>`).join('')}</tbody></table></div>` : '';
    document.querySelectorAll('[data-doc]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); abrir(`/facturas/${a.dataset.doc}`); });
  }

  // ---------- Editor ----------
  function pintarLineas() {
    $('lineas').innerHTML = lineas.map((l, i) => `<tr><td><input class="fx-input" data-l="${i}" data-k="descripcion" value="${e(l.descripcion)}" /></td>
      <td><input class="fx-input num" type="number" step="0.01" data-l="${i}" data-k="cantidad" value="${l.cantidad}" /></td><td><input class="fx-input num" type="number" step="0.01" data-l="${i}" data-k="precio" value="${l.precio}" /></td>
      <td><input class="fx-input num" type="number" step="0.01" data-l="${i}" data-k="dto" value="${l.dto || 0}" /></td><td><input class="fx-input num" type="number" step="0.01" data-l="${i}" data-k="iva" value="${l.iva ?? 21}" /></td>
      <td><input class="fx-input num" type="number" step="0.01" data-l="${i}" data-k="irpf" value="${l.irpf || 0}" /></td><td><button type="button" class="fx-btn" data-ql="${i}">✕</button></td></tr>`).join('');
    document.querySelectorAll('[data-l]').forEach((x) => x.oninput = () => { lineas[Number(x.dataset.l)][x.dataset.k] = x.dataset.k === 'descripcion' ? x.value : Number(x.value); total(); });
    document.querySelectorAll('[data-ql]').forEach((b) => b.onclick = () => { lineas.splice(Number(b.dataset.ql), 1); pintarLineas(); });
    total();
  }
  const total = () => { $('total').textContent = `Base: ${eur(base(lineas))}`; };
  $('add-linea').onclick = () => { lineas.push({ descripcion: '', cantidad: 1, precio: 0, dto: 0, iva: 21, irpf: 0 }); pintarLineas(); };
  $('add-producto').onchange = (ev) => { const p = productos.find((x) => x.id === Number(ev.target.value)); ev.target.value = ''; if (!p) return; lineas.push({ producto_id: p.id, descripcion: p.descripcion, cantidad: 1, precio: p.precio, dto: 0, iva: p.iva, irpf: 0 }); pintarLineas(); };
  const fm = $('editor');
  fm.periodicidad.onchange = () => { $('campo-dia').hidden = fm.periodicidad.value === 'semanal'; };

  async function editar(id) {
    editando = id;
    fm.reset(); $('historial').innerHTML = '';
    fm.cliente_id.innerHTML = '<option value="">Elige…</option>' + clientes.map((c) => `<option value="${c.id}">${e(c.nombre)}</option>`).join('');
    fm.serie.innerHTML = '<option value="">Serie por defecto</option>' + (ajustes.series || []).filter((s) => s.tipo !== 'rectificativa').map((s) => `<option value="${e(s.codigo)}">${e(s.codigo)} · ${e(s.descripcion)}</option>`).join('');
    fm.forma_pago.innerHTML = '<option value="">La del cliente</option>' + (ajustes.formas_pago || []).map((x) => `<option value="${e(x.codigo)}">${e(x.descripcion)}</option>`).join('');
    $('campo-proxima').hidden = !id;
    if (id) {
      const p = await api(`${P}/plantillas/${id}`);
      for (const k of ['nombre', 'cliente_id', 'periodicidad', 'dia', 'inicio', 'fin', 'proxima', 'serie', 'forma_pago', 'dias_vencimiento', 'referencia', 'observaciones', 'notas']) if (fm[k]) fm[k].value = p[k] ?? '';
      lineas = p.lineas; $('ed-titulo').textContent = `Editar «${p.nombre}»`;
      $('historial').innerHTML = p.historial.length ? `<h3>Facturas preparadas</h3><table class="fx-tabla"><tbody>${p.historial.map((h) => `<tr><td>${f(h.periodo)}</td><td>${h.documento_id ? `<a href="#" data-doc="${h.documento_id}">${e(h.codigo || 'Borrador')}</a>` : `<span class="mal">${e(h.error)}</span>`}</td><td>${e(h.estado || '')}</td><td class="num">${h.total != null ? eur(h.total) : ''}</td></tr>`).join('')}</tbody></table><p class="fx-nota">Cambiar la plantilla no modifica las facturas ya preparadas.</p>` : '';
      document.querySelectorAll('#historial [data-doc]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); abrir(`/facturas/${a.dataset.doc}`); });
    } else {
      lineas = [{ descripcion: 'Servicio de {periodo}', cantidad: 1, precio: 0, dto: 0, iva: 21, irpf: 0 }];
      fm.inicio.value = new Date().toLocaleDateString('sv-SE'); $('ed-titulo').textContent = 'Nueva plantilla';
    }
    fm.periodicidad.onchange();
    pintarLineas();
    fm.hidden = false; fm.scrollIntoView({ behavior: 'smooth' });
  }
  $('nueva').onclick = () => editar(null);
  $('cancelar').onclick = () => { fm.hidden = true; };
  fm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(['nombre', 'cliente_id', 'periodicidad', 'dia', 'inicio', 'fin', 'proxima', 'serie', 'forma_pago', 'dias_vencimiento', 'referencia', 'observaciones', 'notas'].map((k) => [k, fm[k]?.value ?? '']));
    body.lineas = lineas;
    try {
      if (editando) await api(`${P}/plantillas/${editando}`, { method: 'PUT', body }); else await api(`${P}/plantillas`, { method: 'POST', body });
      aviso('Plantilla guardada'); fm.hidden = true; cargar(); pend();
    } catch (x) { aviso(x.message, 'error'); }
  });

  (async () => {
    try { [yo, clientes, productos, ajustes] = await Promise.all([api('/api/estado').then((x) => x.usuario), api('/api/clientes'), api('/api/productos').catch(() => []), api('/api/ajustes')]); productos = productos.filter((p) => p.activo !== 0);
      $('add-producto').innerHTML = '<option value="">+ Desde un producto…</option>' + productos.map((p) => `<option value="${p.id}">${e(p.descripcion)} (${eur(p.precio)})</option>`).join('');
      cargar(); pend(); }
    catch (x) { aviso(x.message, 'error'); }
  })();
})();
