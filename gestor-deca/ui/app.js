// Plugin «Gestor DeCA y eCMR» — interfaz.
// Crea las facturas y los clientes con la API normal de Facturador (mismas validaciones que la aplicación)
// y usa la API del plugin solo para hablar con Gestor DeCA y recordar qué envíos están facturados.
(function () {
  const { api, aviso, escapar: e } = window.Facturador;
  const $ = (id) => document.getElementById(id);
  const P = '/api/p/gestor-deca';
  let yo = null, cfg = null, envios = [], catalogo = null, diferencias = null;

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
    ['facturar', 'sincronizar', 'conexion'].forEach((p) => { $(`p-${p}`).hidden = p !== b.dataset.p; });
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
          <thead><tr><th></th><th>Documento</th><th>Fecha</th><th class="ocultar-movil">Ruta</th><th class="ocultar-movil">Mercancía</th><th class="num">Peso</th><th class="ocultar-movil">Matrícula</th><th>Factura</th></tr></thead>
          <tbody>${g.envios.map((x) => `
            <tr>
              <td><input type="checkbox" data-envio="${x.id}" ${x.factura ? '' : 'checked'} /></td>
              <td><a class="mono" href="${e(x.pdf)}" target="_blank" rel="noreferrer">${e(x.numero)}</a>${x.estado === 'cerrado' ? '' : ` <span class="chip">${e(x.estado)}</span>`}</td>
              <td>${fecha(x.fecha)}</td>
              <td class="ocultar-movil ruta">${e(x.origen)} → ${e(x.destinos.join(' / '))}</td>
              <td class="ocultar-movil">${e(x.mercancia)}</td>
              <td class="num">${kg(x.peso_kg)}</td>
              <td class="ocultar-movil mono">${e(x.matricula)}</td>
              <td>${x.factura ? `<a href="#" data-abrir="${x.factura.id}" class="chip ok">${e(x.factura.codigo || 'Borrador')}</a>` : '<span class="chip">Sin facturar</span>'}</td>
            </tr>`).join('')}</tbody>
        </table>
        <div class="precio">
          <label class="fx-campo"><span class="fx-etiqueta">Cobrar</span>
            <select class="fx-select" data-modo><option value="viaje">Por viaje</option><option value="tonelada">Por tonelada</option></select></label>
          <label class="fx-campo"><span class="fx-etiqueta" data-etq>Precio por viaje (€)</span><input class="fx-input" type="number" step="0.01" min="0" data-precio placeholder="0,00" /></label>
          <label class="fx-campo"><span class="fx-etiqueta">IVA</span>
            <select class="fx-select" data-iva><option value="21">21 %</option><option value="10">10 %</option><option value="4">4 %</option><option value="0">0 %</option></select></label>
          <span class="total" data-total></span>
          <button class="fx-btn fx-btn-primario" data-crear>Crear factura en borrador</button>
        </div>
      </div>`).join('');

    document.querySelectorAll('.grupo').forEach((el) => {
      const g = gs[Number(el.dataset.g)];
      const marcados = () => g.envios.filter((x) => el.querySelector(`[data-envio="${x.id}"]`).checked);
      const recalcular = () => {
        const modo = el.querySelector('[data-modo]').value, precio = Number(el.querySelector('[data-precio]').value) || 0;
        el.querySelector('[data-etq]').textContent = modo === 'tonelada' ? 'Precio por tonelada (€)' : 'Precio por viaje (€)';
        const base = marcados().reduce((s, x) => s + (modo === 'tonelada' ? x.peso_kg / 1000 : 1) * precio, 0);
        el.querySelector('[data-total]').textContent = marcados().length ? `${marcados().length} envío(s) · base ${eur(base)}` : '';
      };
      el.addEventListener('input', recalcular);
      el.addEventListener('change', (ev) => { if (ev.target.matches('[data-todos]')) el.querySelectorAll('[data-envio]').forEach((c) => { c.checked = ev.target.checked; }); recalcular(); });
      el.querySelector('[data-crear]').addEventListener('click', () => crearFactura(g, marcados(), el));
      recalcular();
    });
    document.querySelectorAll('[data-abrir]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); abrir(`/facturas/${a.dataset.abrir}`); }));
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
    const boton = el.querySelector('[data-crear]'); boton.disabled = true;
    try {
      const cliente = await clienteFacturador(g.contraparte);
      const vehiculos = await api('/api/vehiculos').catch(() => []);
      const porMatricula = new Map(vehiculos.map((v) => [normMat(v.matricula), v.id]));
      const lineas = sel.map((x) => ({
        descripcion: [`Transporte ${x.numero} del ${fecha(x.fecha)}`, `${x.origen} → ${x.destinos.join(' / ')}`, [x.mercancia, x.peso_kg ? kg(x.peso_kg) : '', x.matricula].filter(Boolean).join(' · '), x.albaran ? `Albarán ${x.albaran}` : ''].filter(Boolean).join('\n'),
        cantidad: modo === 'tonelada' ? Math.round(x.peso_kg) / 1000 : 1,
        precio, iva, vehiculo_id: porMatricula.get(normMat(x.matricula)) || null,
      }));
      const doc = await api('/api/documentos', { method: 'POST', body: {
        tipo: 'factura', cliente_id: cliente.id, lineas, referencia: sel.length === 1 ? sel[0].numero : (sel[0].fecha === sel[sel.length - 1].fecha ? `Envíos del ${fecha(sel[0].fecha)}` : `Envíos ${fecha(sel[0].fecha)} – ${fecha(sel[sel.length - 1].fecha)}`).slice(0, 100),
        observaciones: `Documentos de control del transporte:\n${sel.map((x) => `${x.numero}: ${x.pdf}`).join('\n')}`,
      } });
      await api(`${P}/vinculos`, { method: 'POST', body: { documento_id: doc.id, envios: sel.map((x) => ({ id: x.id, numero: x.numero })) } });
      aviso('Factura creada en borrador');
      abrir(`/facturas/${doc.id}`);
    } catch (x) { aviso(x.message, 'error'); boton.disabled = false; }
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
      if (!cfg.configurado && yo?.rol === 'admin') document.querySelector('[data-p="conexion"]').click();
      else buscar();
    } catch (x) { aviso(x.message, 'error'); }
  })();
})();
