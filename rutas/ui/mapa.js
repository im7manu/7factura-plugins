// Mapa de los plugins «Rutas» (compartido por 7DeCA y 7Factura: si lo cambias, cópialo en los dos).
// window.RutasMapa.crear(elemento, { proveedor, clave_navegador }) → { puntos(lista), linea(coords), alClic(fn), ajustar(), destruir() }
//   - OpenRouteService: Leaflet con teselas de OpenStreetMap (incluido en el plugin, sin CDN).
//   - Google: Google Maps JavaScript API con la clave de navegador (las rutas de Google deben verse sobre un mapa de Google).
(function () {
  if (window.RutasMapa) return;
  let cargaGoogle = null, fallo = '';
  // Error de autenticación de Google (clave no válida, API no activada, dominio no autorizado…): lo llama Google.
  window.gm_authFailure = () => {
    fallo = 'Google ha rechazado la clave de navegador. Revisa en Google Cloud que la clave es correcta, que tiene activada «Maps JavaScript API» y la facturación, y que este dominio está permitido.';
    document.querySelectorAll('[data-rutas-google]').forEach((el) => aviso(el, fallo));
  };
  function cargarGoogle(clave) {
    if (window.google?.maps?.Map) return Promise.resolve();
    if (cargaGoogle) return cargaGoogle;
    cargaGoogle = new Promise((ok, mal) => {
      const cb = `__rutasGoogle${Date.now()}`;
      let bloqueado = false;
      const csp = (ev) => { if (String(ev.blockedURI).includes('maps.googleapis.com')) bloqueado = true; };
      document.addEventListener('securitypolicyviolation', csp);
      const fin = (error) => { clearTimeout(t); document.removeEventListener('securitypolicyviolation', csp); delete window[cb]; if (error) { cargaGoogle = null; s.remove(); mal(new Error(error)); } else ok(); };
      const sinCargar = () => (bloqueado
        ? 'El navegador ha bloqueado Google Maps porque esta página se abrió antes de activar el mapa de Google. Recarga la página (Cmd+R o F5).'
        : 'No se pudo cargar Google Maps. Comprueba la conexión y la clave de navegador.');
      const t = setTimeout(() => fin(sinCargar()), 15000);
      window[cb] = () => fin();
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(clave)}&v=weekly&language=es&region=ES&loading=async&callback=${cb}`;
      s.async = true;
      s.onerror = () => setTimeout(() => fin(sinCargar()), 0);
      document.head.appendChild(s);
    });
    return cargaGoogle;
  }
  function aviso(el, texto) {
    let a = el.parentElement?.querySelector(':scope > .rutas-aviso-mapa');
    if (!a) { a = document.createElement('div'); a.className = 'rutas-aviso-mapa'; a.setAttribute('role', 'alert'); a.style.cssText = 'margin:0 0 8px;padding:8px 12px;border-radius:8px;background:#fef3c7;color:#78350f;font-size:13px;line-height:1.4'; el.before(a); }
    a.textContent = texto;
  }

  const COLOR = '#2563eb';

  function leaflet(el) {
    const L = window.L;
    const mapa = L.map(el, { zoomControl: true, attributionControl: true }).setView([40.2, -3.7], 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(mapa);
    const capa = L.layerGroup().addTo(mapa);
    let linea = null, limites = [];
    setTimeout(() => mapa.invalidateSize(), 50);
    return {
      puntos(lista) {
        capa.clearLayers(); limites = [];
        lista.forEach((p, i) => {
          const m = L.circleMarker([p.lat, p.lon], { radius: 9, color: '#fff', weight: 2, fillColor: i === 0 && lista.length > 1 ? '#16a34a' : COLOR, fillOpacity: 1 }).addTo(capa);
          m.bindTooltip(`${lista.length > 1 ? `${i + 1}. ` : ''}${p.etiqueta || ''}`, { direction: 'top' });
          limites.push([p.lat, p.lon]);
        });
        this.ajustar();
      },
      linea(coords) {
        if (linea) { linea.remove(); linea = null; }
        if (coords?.length) { linea = L.polyline(coords, { color: COLOR, weight: 5, opacity: 0.8 }).addTo(mapa); limites = limites.concat(coords); }
        this.ajustar();
      },
      alClic(fn) { mapa.on('click', (e) => fn(e.latlng.lat, e.latlng.lng)); },
      ajustar() {
        mapa.invalidateSize();
        if (limites.length === 1) mapa.setView(limites[0], 15);
        else if (limites.length > 1) mapa.fitBounds(limites, { padding: [24, 24] });
      },
      destruir() { mapa.remove(); },
    };
  }

  function googleMapa(el) {
    const g = window.google.maps;
    const mapa = new g.Map(el, { center: { lat: 40.2, lng: -3.7 }, zoom: 5, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
    let marcas = [], linea = null, limites = [];
    return {
      puntos(lista) {
        marcas.forEach((m) => m.setMap(null)); marcas = []; limites = [];
        lista.forEach((p, i) => {
          marcas.push(new g.Marker({ map: mapa, position: { lat: p.lat, lng: p.lon }, title: p.etiqueta || '', label: lista.length > 1 ? String(i + 1) : undefined }));
          limites.push({ lat: p.lat, lng: p.lon });
        });
        this.ajustar();
      },
      linea(coords) {
        if (linea) { linea.setMap(null); linea = null; }
        if (coords?.length) {
          const path = coords.map(([lat, lng]) => ({ lat, lng }));
          linea = new g.Polyline({ map: mapa, path, strokeColor: COLOR, strokeWeight: 5, strokeOpacity: 0.8 });
          limites = limites.concat(path);
        }
        this.ajustar();
      },
      alClic(fn) { mapa.addListener('click', (e) => fn(e.latLng.lat(), e.latLng.lng())); },
      ajustar() {
        if (limites.length === 1) { mapa.setCenter(limites[0]); mapa.setZoom(15); }
        else if (limites.length > 1) { const b = new g.LatLngBounds(); limites.forEach((p) => b.extend(p)); mapa.fitBounds(b, 24); }
      },
      destruir() { el.innerHTML = ''; },
    };
  }

  window.RutasMapa = {
    async crear(el, cfg = {}) {
      if (cfg.proveedor === 'google') {
        if (!cfg.clave_navegador) {
          el.innerHTML = '<div class="rutas-sin-mapa">Para ver el mapa de Google, el administrador debe añadir una <strong>clave de navegador</strong> en Mapas y rutas.</div>';
          return { puntos() {}, linea() {}, alClic() {}, ajustar() {}, destruir() { el.innerHTML = ''; } };
        }
        try {
          await cargarGoogle(cfg.clave_navegador);
          if (fallo) throw new Error(fallo);
          el.dataset.rutasGoogle = '1';
          return googleMapa(el);
        } catch (x) {
          // Sin mapa de Google: se avisa del motivo y se muestra el de OpenStreetMap para poder seguir trabajando.
          aviso(el, `${x.message} Mientras tanto se muestra el mapa de OpenStreetMap.`);
          el.innerHTML = '';
          return leaflet(el);
        }
      }
      return leaflet(el);
    },
  };
})();
