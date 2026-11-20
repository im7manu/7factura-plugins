// Plugin «Gestor DeCA y eCMR» — interfaz.
// Crea las facturas y los clientes con la API normal de Facturador (mismas validaciones que la aplicación)
// y usa la API del plugin solo para hablar con Gestor DeCA y recordar qué envíos están facturados.
(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const $ = (id) => document.getElementById(id);
  const P = '/api/p/gestor-deca';
  let yo = null, cfg = null, envios = [], catalogo = null, diferencias = null, kmCfg = null;
  const kmCache = new Map(); // envío -> { km, detalle, fuente, aviso } o { error }

  const hoy = new Date();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $('desde').value = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  $('hasta').value = iso(hoy);

  const normNif = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normMat = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const kg = (n) => `${Number(n || 0).toLocaleString('es-ES')} kg`;
  const eur = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const fecha = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('es-ES') : '—');

  // Abre una ruta de la aplicación (fuera del iframe) sin recargar
  function abrir(ruta) {
    try { window.parent.history.pushState({}, '', ruta); window.parent.dispatchEvent(new PopStateEvent('popstate')); }
    catch { window.top.location.href = ruta; }
  }

  // ---------- Pestañas ----------
  document.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['facturar', 'km', 'sincronizar', 'conexion'].forEach((p) => { $(`p-${p}`).hidden = p !== b.dataset.p; });
  }));

  // ---------- Conexión ----------
  function pintarConexion() {
    const admin = yo?.rol === 'admin';
    $('url').value = cfg.url || '';
    $('url').disabled = $('token').disabled = $('guardar').disabled = !admin;
    $('solo-admin').hidden = admin;
    $('desconectar').hidden = !admin || !cfg.configurado;
    $('token').placeholder = cfg.configurado ? 'Guardado (déjalo vacío para mantenerlo)' : 'deca_…';
    $('estado-conexion').innerHTML = cfg.configurado
      ? `Conectado${cfg.empresa?.nombre ? ` con <strong>${e(cfg.empresa.nombre)}</strong>` : ''}. Comprobado el ${new Date(cfg.comprobado).toLocaleString('es-ES')}.`
      : 'Sin conectar.';
    $('sin-conexion').hidden = !!cfg.configurado;
    $('sub').textContent = cfg.empresa?.nombre ? `Conectado con el Gestor DeCA de ${cfg.empresa.nombre}.` : 'Factura los envíos de Gestor DeCA y copia sus clientes, vehículos y conductores.';
  }
  $('guardar').addEventListener('click', async () => {
    $('guardar').disabled = true;
    try {
      const r = await api(`${P}/config`, { method: 'PUT', body: { url: $('url').value, token: $('token').value } });
      $('token').value = '';
      cfg = await api(`${P}/config`);
      pintarConexion();
      aviso(`Conectado con Gestor DeCA ${r.version || ''}`);
      buscar();
    } catch (x) { aviso(x.message, 'error'); } finally { $('guardar').disabled = yo?.rol !== 'admin'; }
  });
  $('desconectar').addEventListener('click', async () => {
    if (!confirm('¿Desconectar de Gestor DeCA? Los envíos ya facturados se seguirán recordando.')) return;
    await api(`${P}/config`, { method: 'DELETE' });
    cfg = await api(`${P}/config`); pintarConexion(); $('grupos').innerHTML = '';
  });

  // ---------- Facturar envíos ----------
  async function buscar() {
    if (!cfg?.configurado) return;
    $('buscar').disabled = true;
    try {
      const q = new URLSearchParams({ desde: $('desde').value, hasta: $('hasta').value, tipo: $('tipo').value });
      envios = (await api(`${P}/envios?${q}`)).envios;
      pintarEnvios();
    } catch (x) { aviso(x.message, 'error'); } finally { $('buscar').disabled = false; }
  }
  $('buscar').addEventListener('click', buscar);
  $('pendientes').addEventListener('change', pintarEnvios);

  function grupos() {
    const lista = $('pendientes').checked ? envios.filter((x) => !x.factura) : envios;
    const m = new Map();
    for (const x of lista) {
      const k = normNif(x.contraparte.nif) || x.contraparte.nombre || '(sin cliente)';
      if (!m.has(k)) m.set(k, { clave: k, contraparte: x.contraparte, envios: [] });
      m.get(k).envios.push(x);
    }
    return [...m.values()].sort((a, b) => a.contraparte.nombre.localeCompare(b.contraparte.nombre, 'es'));
  }

  function pintarEnvios() {
    const gs = grupos();
    $('vacio').hidden = gs.length > 0;
    $('grupos').innerHTML = gs.map((g, gi) => `
      <div class="fx-card grupo" data-g="${gi}">
        <div class="grupo-cab">
          <div><h2>${e(g.contraparte.nombre || 'Sin cliente')}</h2><div class="nif">${e(g.contraparte.nif || 'Sin NIF')} · ${g.envios.length} envío(s) · ${kg(g.envios.reduce((s, x) => s + x.peso_kg, 0))}</div></div>
          <label class="casilla"><input type="checkbox" data-todos checked /> Todos</label>
        </div>
        <table class="fx-tabla" style="margin-top:10px">
          <thead><tr><th></th><th>Documento</th><th>Fecha</th><th class="ocultar-movil">Ruta</th><th class="ocultar-movil">Mercancía</th><th class="num">Peso</th><th class="num" data-colkm hidden>Km</th><th class="ocultar-movil">Matrícula</th><th>Factura</th></tr></thead>
          <tbody>${g.envios.map((x) => `
            <tr>
              <td><input type="checkbox" data-envio="${x.id}" ${x.factura ? '' : 'checked'} /></td>
              <td><a class="mono" href="${e(x.pdf)}" target="_blank" rel="noreferrer">${e(x.numero)}</a>${x.estado === 'cerrado' ? '' : ` <span class="chip">${e(x.estado)}</span>`}</td>
              <td>${fecha(x.fecha)}</td>
              <td class="ocultar-movil ruta">${e(x.origen)} → ${e(x.destinos.join(' / '))}</td>
              <td class="ocultar-movil">${e(x.mercancia)}</td>
              <td class="num">${kg(x.peso_kg)}</td>
              <td class="num" data-colkm hidden><input class="fx-input km" type="number" step="0.1" min="0" data-km="${x.id}" aria-label="Km de ${e(x.numero)}" /><div class="kmnota" data-kmnota="${x.id}"></div></td>
              <td class="ocultar-movil mono">${e(x.matricula)}</td>
              <td>${x.factura ? `<a href="#" data-abrir="${x.factura.id}" class="chip ok">${e(x.factura.codigo || 'Borrador')}</a>` : '<span class="chip">Sin facturar</span>'}</td>
            </tr>`).join('')}</tbody>
        </table>
        <div class="precio">
          <label class="fx-campo"><span class="fx-etiqueta">Cobrar</span>
            <select class="fx-select" data-modo><option value="viaje">Por viaje</option><option value="tonelada">Por tonelada</option><option value="km">Por kilómetro</option></select></label>
          <label class="fx-campo"><span class="fx-etiqueta" data-etq>Precio por viaje (€)</span><input class="fx-input" type="number" step="0.01" min="0" data-precio placeholder="0,00" /></label>
          <label class="fx-campo"><span class="fx-etiqueta">IVA</span>
            <select class="fx-select" data-iva><option value="21">21 %</option><option value="10">10 %</option><option value="4">4 %</option><option value="0">0 %</option></select></label>
          <button class="fx-btn" data-recalc-km hidden title="Volver a calcular los km de los envíos">Recalcular km</button>
          <span class="total" data-total></span>
          <button class="fx-btn fx-btn-primario" data-crear>Crear factura en borrador</button>
        </div>
      </div>`).join('');

    document.querySelectorAll('.grupo').forEach((el) => {
      const g = gs[Number(el.dataset.g)];
      const marcados = () => g.envios.filter((x) => el.querySelector(`[data-envio="${x.id}"]`).checked);
      const recalcular = () => {
        const modo = el.querySelector('[data-modo]').value, precio = Number(el.querySelector('[data-precio]').value) || 0;
        el.querySelector('[data-etq]').textContent = modo === 'tonelada' ? 'Precio por tonelada (€)' : modo === 'km' ? 'Precio por km (€)' : 'Precio por viaje (€)';
        el.querySelectorAll('[data-colkm]').forEach((c) => { c.hidden = modo !== 'km'; });
        el.querySelector('[data-recalc-km]').hidden = modo !== 'km';
        const base = marcados().reduce((s, x) => s + importe(modo, x, precio, el), 0);
        const sinKm = modo === 'km' ? marcados().filter((x) => !(Number(el.querySelector(`[data-km="${x.id}"]`).value) > 0)).length : 0;
        el.querySelector('[data-total]').textContent = marcados().length ? `${marcados().length} envío(s) · base ${eur(base)}${sinKm ? ` · ${sinKm} sin km` : ''}` : '';
      };
      el.addEventListener('input', recalcular);
      el.addEventListener('change', (ev) => {
        if (ev.target.matches('[data-todos]')) el.querySelectorAll('[data-envio]').forEach((c) => { c.checked = ev.target.checked; });
        if (ev.target.matches('[data-modo]')) {
          localStorage.setItem('gestor-deca-modo', ev.target.value);
          if (ev.target.value === 'km') prepararKm(g, el).then(recalcular);
        }
        recalcular();
      });
      el.querySelector('[data-recalc-km]').addEventListener('click', () => prepararKm(g, el, true).then(recalcular));
      const ultimo = localStorage.getItem('gestor-deca-modo');
      if (ultimo) { el.querySelector('[data-modo]').value = ultimo; if (ultimo === 'km') prepararKm(g, el).then(recalcular); }
      el.querySelector('[data-crear]').addEventListener('click', () => crearFactura(g, marcados(), el));
      recalcular();
    });
    document.querySelectorAll('[data-abrir]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); abrir(`/facturas/${a.dataset.abrir}`); }));
  }

  // Importe de un envío según el modo (en km se aplica el mínimo por viaje)
  function importe(modo, x, precio, el) {
    if (modo === 'tonelada') return (x.peso_kg / 1000) * precio;
    if (modo !== 'km') return precio;
    const k = Number(el.querySelector(`[data-km="${x.id}"]`)?.value) || 0;
    return k > 0 ? Math.max(k * precio, kmCfg?.minimo || 0) : 0;
  }
  const precioCliente = (nif) => { const p = (kmCfg?.precios_cliente || []).find((c) => c.nif === normNif(nif)); return p ? p.precio_km : kmCfg?.precio_km || 0; };

  // Rellena los km de cada envío (sin pisar los que el usuario ya ha corregido) y el precio por km del cliente
  async function prepararKm(g, el, recalcular = false) {
    if (!kmCfg) kmCfg = await api(`${P}/km/config`);
    const precio = el.querySelector('[data-precio]');
    if (!precio.value && precioCliente(g.contraparte.nif)) precio.value = precioCliente(g.contraparte.nif);
    const faltan = g.envios.filter((x) => recalcular || !kmCache.has(x.id));
    if (faltan.length) {
      el.querySelectorAll('[data-kmnota]').forEach((n) => { if (faltan.some((x) => String(x.id) === n.dataset.kmnota)) n.textContent = 'Calculando…'; });
      try {
        const { resultados } = await api(`${P}/km`, { method: 'POST', body: { recalcular, envios: faltan.map((x) => ({ id: x.id, origen: x.origen, destinos: x.destinos, ruta: x.ruta || null, puntos: x.puntos || null })) } });
        for (const [id, r] of Object.entries(resultados)) kmCache.set(Number(id), r);
      } catch (x) { aviso(x.message, 'error'); }
    }
    for (const x of g.envios) {
      const r = kmCache.get(x.id) || {}, inp = el.querySelector(`[data-km="${x.id}"]`), nota = el.querySelector(`[data-kmnota="${x.id}"]`);
      if (r.km != null && (recalcular || !inp.dataset.editado)) { inp.value = r.km; delete inp.dataset.editado; }
      inp.dataset.calculado = r.km ?? '';
      nota.className = `kmnota${r.error ? ' error' : ''}`;
      nota.textContent = r.error || [r.detalle, r.fuente === 'deca' ? 'de Gestor DeCA' : r.fuente === 'facturador' ? 'calculado en Facturador' : '', r.aviso].filter(Boolean).join(' · ');
      inp.oninput = () => { inp.dataset.editado = '1'; nota.textContent = inp.dataset.calculado ? `Corregido a mano (calculado: ${inp.dataset.calculado} km)` : 'Puesto a mano'; nota.className = 'kmnota'; };
    }
  }

  async function clienteFacturador(c) {
    const nif = normNif(c.nif);
    if (nif) {
      const lista = await api(`/api/clientes?q=${encodeURIComponent(nif)}`);
      const hallado = lista.find((x) => normNif(x.nif) === nif);
      if (hallado) return hallado;
    } else {
      const lista = await api(`/api/clientes?q=${encodeURIComponent(c.nombre)}`);
      const hallado = lista.find((x) => x.nombre.trim().toLowerCase() === c.nombre.trim().toLowerCase());
      if (hallado) return hallado;
    }
    const nuevo = await crearTercero('/api/clientes', { nombre: c.nombre || 'Cliente', nif, direccion: c.direccion || '' });
    aviso(`Cliente «${nuevo.nombre}» añadido a Facturador`);
    return nuevo;
  }

  // Gestor DeCA no valida los NIF y Facturador sí: si el NIF no es válido, se crea sin él, se guarda en las
  // notas y se avisa para corregirlo (una factura completa necesita el NIF correcto del cliente).
  async function crearTercero(ruta, datos) {
    try { return await api(ruta, { method: 'POST', body: datos }); }
    catch (x) {
      if (!datos.nif || !/NIF/i.test(x.message)) throw x;
      const r = await api(ruta, { method: 'POST', body: { ...datos, nif: '', notas: `NIF en Gestor DeCA: ${datos.nif} (no es válido; revísalo).` } });
      aviso(`El NIF ${datos.nif} de «${datos.nombre}» no es válido: se ha añadido sin NIF. Corrígelo en la ficha del cliente.`, 'error');
      return r;
    }
  }

  async function crearFactura(g, sel, el) {
    if (!sel.length) return aviso('Marca al menos un envío.', 'error');
    sel = [...sel].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id); // de más antiguo a más reciente
    const ya = sel.filter((x) => x.factura);
    if (ya.length && !confirm(`${ya.length} envío(s) ya están en otra factura. ¿Incluirlos también en esta?`)) return;
    const modo = el.querySelector('[data-modo]').value, precio = Number(el.querySelector('[data-precio]').value) || 0, iva = Number(el.querySelector('[data-iva]').value);
    if (!precio && !confirm('No has puesto precio. ¿Crear la factura con importe 0 para completarla después?')) return;
    const kmDe = (x) => Number(el.querySelector(`[data-km="${x.id}"]`)?.value) || 0;
    if (modo === 'km') {
      const sin = sel.filter((x) => !(kmDe(x) > 0));
      if (sin.length && !confirm(`${sin.length} envío(s) no tienen km (${sin.map((x) => x.numero).join(', ')}). ¿Crear la factura con 0 km en esas líneas para completarlas después?`)) return;
    }
    const boton = el.querySelector('[data-crear]'); boton.disabled = true;
    try {
      const cliente = await clienteFacturador(g.contraparte);
      const vehiculos = await api('/api/vehiculos').catch(() => []);
      const porMatricula = new Map(vehiculos.map((v) => [normMat(v.matricula), v.id]));
      const lineas = sel.map((x) => {
        const base = [`Transporte ${x.numero} del ${fecha(x.fecha)}`, `${x.origen} → ${x.destinos.join(' / ')}`, [x.mercancia, x.peso_kg ? kg(x.peso_kg) : '', x.matricula].filter(Boolean).join(' · '), x.albaran ? `Albarán ${x.albaran}` : ''];
        let cantidad = modo === 'tonelada' ? Math.round(x.peso_kg) / 1000 : 1, p = precio;
        if (modo === 'km') {
          const k = kmDe(x), det = kmCache.get(x.id)?.detalle;
          const kmTxt = `${k.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km${det && det !== 'ida' ? ` (${det})` : ''}`;
          if (k > 0 && kmCfg?.minimo && k * precio < kmCfg.minimo) { base.push(`${kmTxt} · importe mínimo por viaje`); p = kmCfg.minimo; }
          else { base.push(`${kmTxt} × ${precio.toLocaleString('es-ES', { maximumFractionDigits: 3 })} €/km`); cantidad = k; }
        }
        return { descripcion: base.filter(Boolean).join('\n'), cantidad, precio: p, iva, vehiculo_id: porMatricula.get(normMat(x.matricula)) || null };
      });
      const doc = await api('/api/documentos', { method: 'POST', body: {
        tipo: 'factura', cliente_id: cliente.id, lineas, referencia: sel.length === 1 ? sel[0].numero : (sel[0].fecha === sel[sel.length - 1].fecha ? `Envíos del ${fecha(sel[0].fecha)}` : `Envíos ${fecha(sel[0].fecha)} – ${fecha(sel[sel.length - 1].fecha)}`).slice(0, 100),
        observaciones: `Documentos de control del transporte:\n${sel.map((x) => `${x.numero}: ${x.pdf}`).join('\n')}`,
      } });
      await api(`${P}/vinculos`, { method: 'POST', body: { documento_id: doc.id, envios: sel.map((x) => ({ id: x.id, numero: x.numero })) } });
      aviso('Factura creada en borrador');
      abrir(`/facturas/${doc.id}`);
    } catch (x) { aviso(x.message, 'error'); boton.disabled = false; }
  }

  // ---------- Cobro por km ----------
  async function pintarKm() {
    kmCfg = await api(`${P}/km/config`);
    const f = $('km-form'), admin = yo?.rol === 'admin';
    f.querySelector(`[name=cuenta][value=${kmCfg.cuenta}]`).checked = true;
    f.base.value = kmCfg.base; f.precio_km.value = kmCfg.precio_km || ''; f.minimo.value = kmCfg.minimo || ''; f.redondeo.value = kmCfg.redondeo;
    f.preferir_deca.checked = kmCfg.preferir_deca;
    const r = kmCfg.rutas;
    $('km-rutas').innerHTML = r.configurado ? '✔ Plugin «Rutas y mapas» de Facturador configurado: se pueden calcular los km que falten, la vuelta y los km desde la base.'
      : r.instalado ? '⚠ El plugin «Rutas y mapas» está instalado pero sin configurar: <a href="#" data-ir="/p/rutas">configúralo</a> para calcular km en Facturador.'
      : 'ℹ Sin el plugin «Rutas y mapas» en Facturador solo se usan los km calculados en Gestor DeCA (la vuelta se estima igual que la ida). Puedes instalarlo desde Plugins.';
    $('km-rutas').querySelector('[data-ir]')?.addEventListener('click', (ev) => { ev.preventDefault(); abrir(ev.target.dataset.ir); });
    let precios = [...kmCfg.precios_cliente];
    const filas = () => {
      $('km-clientes').innerHTML = precios.map((p, i) => `<tr><td>${e(p.nombre)}</td><td class="mono">${e(p.nif)}</td><td class="num"><input class="fx-input km" type="number" step="0.001" min="0" data-pc="${i}" value="${p.precio_km}" ${admin ? '' : 'disabled'}></td><td>${admin ? `<button class="fx-btn fx-btn-peligro" type="button" data-qc="${i}">Quitar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="fx-nota">Ningún cliente con precio propio.</td></tr>';
      $('km-clientes').querySelectorAll('[data-pc]').forEach((i) => { i.oninput = () => { precios[Number(i.dataset.pc)].precio_km = Number(i.value) || 0; }; });
      $('km-clientes').querySelectorAll('[data-qc]').forEach((b) => { b.onclick = () => { precios.splice(Number(b.dataset.qc), 1); filas(); }; });
    };
    filas();
    const clientes = await api('/api/clientes').catch(() => []);
    $('km-cliente-nuevo').innerHTML = '<option value="">Añadir un cliente…</option>' + clientes.filter((c) => normNif(c.nif)).map((c) => `<option value="${c.id}">${e(c.nombre)} (${e(c.nif)})</option>`).join('');
    $('km-cliente-nuevo').onchange = (ev) => {
      const c = clientes.find((x) => String(x.id) === ev.target.value); ev.target.value = '';
      if (!c || precios.some((p) => p.nif === normNif(c.nif))) return;
      precios.push({ nif: normNif(c.nif), nombre: c.nombre, precio_km: Number(f.precio_km.value) || 0 }); filas();
    };
    const vis = () => { $('km-base-campo').hidden = f.querySelector('[name=cuenta]:checked').value !== 'base'; };
    f.onchange = vis; vis();
    f.querySelectorAll('input, select, button').forEach((x) => { x.disabled = !admin; });
    $('km-cliente-nuevo').disabled = !admin;
    $('km-solo-admin').hidden = admin;
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api(`${P}/km/config`, { method: 'PUT', body: { cuenta: f.querySelector('[name=cuenta]:checked').value, base: f.base.value, precio_km: Number(f.precio_km.value) || 0, minimo: Number(f.minimo.value) || 0, redondeo: f.redondeo.value, preferir_deca: f.preferir_deca.checked, precios_cliente: precios } });
        kmCache.clear(); await pintarKm(); pintarEnvios(); aviso('Cobro por km guardado');
      } catch (x) { aviso(x.message, 'error'); }
    };
  }

  // ---------- Sincronizar ----------
  $('comparar').addEventListener('click', async () => {
    $('comparar').disabled = true;
    try {
      catalogo = await api(`${P}/catalogo`);
      const [cli, prov, veh, con] = await Promise.all(['/api/clientes', '/api/proveedores', '/api/vehiculos', '/api/conductores'].map((r) => api(r).catch(() => [])));
      const nifs = new Set([...cli, ...prov].map((x) => normNif(x.nif)).filter(Boolean));
      const mats = new Set(veh.map((x) => normMat(x.matricula)));
      const dnis = new Set(con.map((x) => normNif(x.dni)));
      diferencias = {
        clientes: catalogo.empresas.filter((x) => x.tipo !== 'Transportista' && normNif(x.nif) && !nifs.has(normNif(x.nif))),
        proveedores: catalogo.empresas.filter((x) => x.tipo === 'Transportista' && normNif(x.nif) && !nifs.has(normNif(x.nif))),
        vehiculos: catalogo.vehiculos.filter((x) => !mats.has(normMat(x.matricula))),
        conductores: catalogo.conductores.filter((x) => normNif(x.dni) && !dnis.has(normNif(x.dni))),
      };
      const n = Object.values(diferencias).reduce((s, l) => s + l.length, 0);
      const fila = (t, l, f) => `<li><strong>${t}</strong>: ${l.length ? l.map(f).map(e).join(', ') : 'ninguno'}</li>`;
      $('resumen-sinc').innerHTML = `<p>${n ? `Faltan <strong>${n}</strong> registros en Facturador:` : 'Facturador ya tiene todos los datos de Gestor DeCA.'}</p><ul>
        ${fila('Clientes', diferencias.clientes, (x) => x.nombre)}${fila('Proveedores (transportistas)', diferencias.proveedores, (x) => x.nombre)}
        ${fila('Vehículos', diferencias.vehiculos, (x) => x.matricula)}${fila('Conductores', diferencias.conductores, (x) => x.nombre)}</ul>`;
      $('sincronizar').disabled = !n;
    } catch (x) { aviso(x.message, 'error'); } finally { $('comparar').disabled = false; }
  });

  $('sincronizar').addEventListener('click', async () => {
    if (!diferencias) return;
    $('sincronizar').disabled = true;
    const errores = []; let ok = 0;
    const crear = async (ruta, cuerpo, nombre) => { try { await (cuerpo.nif !== undefined ? crearTercero(ruta, cuerpo) : api(ruta, { method: 'POST', body: cuerpo })); ok++; } catch (x) { errores.push(`${nombre}: ${x.message}`); } };
    const tercero = (x) => ({ nombre: x.nombre, nif: normNif(x.nif), direccion: x.direccion || '', cp: x.cp || '', ciudad: x.ciudad || '', email: x.email || '', telefono: x.tel || '' });
    for (const x of diferencias.clientes) await crear('/api/clientes', tercero(x), x.nombre);
    for (const x of diferencias.proveedores) await crear('/api/proveedores', tercero(x), x.nombre);
    for (const x of diferencias.vehiculos) await crear('/api/vehiculos', { matricula: x.matricula, tipo: x.tipo || '', modelo: x.modelo || '', estado: x.estado || 'Disponible', itv: x.itv || '' }, x.matricula);
    for (const x of diferencias.conductores) await crear('/api/conductores', { nombre: x.nombre, dni: x.dni, telefono: x.telefono || '', email: x.email || '', activo: x.activo !== false }, x.nombre);
    $('resumen-sinc').innerHTML = `<p>Añadidos <strong>${ok}</strong> registros.</p>${errores.length ? `<p class="fx-nota">No se pudieron añadir:</p><ul>${errores.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : ''}`;
    diferencias = null;
    aviso(`Sincronización terminada: ${ok} añadidos${errores.length ? `, ${errores.length} con errores` : ''}`, errores.length ? 'error' : 'ok');
  });

  // ---------- Inicio ----------
  (async () => {
    try {
      [yo, cfg] = await Promise.all([api('/api/estado').then((x) => x.usuario), api(`${P}/config`)]);
      pintarConexion();
      pintarKm().catch(() => {});
      if (!cfg.configurado && yo?.rol === 'admin') document.querySelector('[data-p="conexion"]').click();
      else buscar();
    } catch (x) { aviso(x.message, 'error'); }
  })();
})();
