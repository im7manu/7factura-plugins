// Proveedores de mapas para los plugins «Rutas» (7DeCA y 7Factura comparten este archivo: si lo cambias,
// cópialo en los dos y pasa las pruebas de ambos repositorios).
//
//   - OpenRouteService (por defecto, gratis con registro): rutas en camión (driving-hgv) o coche y búsqueda de
//     direcciones (Pelias). Sin clave, las direcciones se buscan con Nominatim (OpenStreetMap).
//   - Google Maps Platform (opcional, con la clave del administrador): Routes API y Geocoding API. No tiene perfil
//     de camión: las rutas se calculan como turismo.
//
// Todo se llama desde el servidor: las claves nunca llegan al navegador (salvo la «clave de navegador» de Google,
// que es pública por diseño y debe restringirse por dominio en Google Cloud).

export const BASE_ORS = 'https://api.heigit.org/openrouteservice';
export const BASE_PELIAS = 'https://api.heigit.org/pelias/v1';
export const NOMINATIM = 'https://nominatim.openstreetmap.org';
// Búsqueda mientras se escribe sin clave: Photon (OpenStreetMap). Nominatim no permite usarse para autocompletar.
export const PHOTON = 'https://photon.komoot.io';
// Caja de España (con Canarias, Baleares, Ceuta y Melilla) para priorizar resultados
const CAJA_ES = '-18.5,27.5,4.6,44';

// Provincia a partir de los dos primeros dígitos del código postal
const PROVINCIAS = ['', 'Álava', 'Albacete', 'Alicante', 'Almería', 'Ávila', 'Badajoz', 'Islas Baleares', 'Barcelona', 'Burgos', 'Cáceres', 'Cádiz',
  'Castellón', 'Ciudad Real', 'Córdoba', 'A Coruña', 'Cuenca', 'Girona', 'Granada', 'Guadalajara', 'Gipuzkoa', 'Huelva', 'Huesca', 'Jaén', 'León',
  'Lleida', 'La Rioja', 'Lugo', 'Madrid', 'Málaga', 'Murcia', 'Navarra', 'Ourense', 'Asturias', 'Palencia', 'Las Palmas', 'Pontevedra', 'Salamanca',
  'Santa Cruz de Tenerife', 'Cantabria', 'Segovia', 'Sevilla', 'Soria', 'Tarragona', 'Teruel', 'Toledo', 'Valencia', 'Valladolid', 'Bizkaia', 'Zamora',
  'Zaragoza', 'Ceuta', 'Melilla'];
export function provinciaDeCP(cp) {
  const m = String(cp || '').trim().match(/^(\d{2})\d{3}$/);
  return m ? PROVINCIAS[Number(m[1])] || '' : '';
}
/** Normaliza los campos de una dirección encontrada. */
function direccion({ calle = '', numero = '', cp = '', ciudad = '', provincia = '', pais = '' }) {
  const c = String(cp || '').trim();
  pais = String(pais || '').toLowerCase();
  return {
    calle: [calle, numero].filter(Boolean).join(', ').trim(), cp: c, ciudad: String(ciudad || '').trim(),
    provincia: (pais === 'es' || !pais) && provinciaDeCP(c) ? provinciaDeCP(c) : String(provincia || '').trim(), pais: String(pais || '').toLowerCase(),
  };
}
const AGENTE = 'rutas-plugin/1.0 (autoalojado; https://github.com/im7manu)';

export const OPCIONES_DEFECTO = {
  perfil: 'camion', // camion | coche
  evitar_peajes: false,
  evitar_autopistas: false,
  evitar_ferris: true,
  camion: { peso_t: 40, altura_m: 4, ancho_m: 2.55, largo_m: 16.5, eje_t: 11.5 },
};

export function configLimpia(c = {}) {
  const o = c.opciones || {};
  const cam = o.camion || {};
  const num = (v, def, min, max) => { const x = Number(v); return Number.isFinite(x) && x >= min && x <= max ? x : def; };
  const url = (v, def) => (/^https?:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(String(v || '').trim()) ? String(v).trim().replace(/\/+$/, '') : def);
  return {
    proveedor: c.proveedor === 'google' ? 'google' : 'ors',
    ors: { clave: String(c.ors?.clave || ''), base_ruta: url(c.ors?.base_ruta, BASE_ORS), base_geo: url(c.ors?.base_geo, BASE_PELIAS) },
    google: { clave_servidor: String(c.google?.clave_servidor || ''), clave_navegador: String(c.google?.clave_navegador || '') },
    pais: /^[a-z]{2}$/i.test(c.pais || '') ? c.pais.toLowerCase() : 'es',
    opciones: {
      perfil: o.perfil === 'coche' ? 'coche' : 'camion',
      evitar_peajes: !!o.evitar_peajes,
      evitar_autopistas: !!o.evitar_autopistas,
      evitar_ferris: o.evitar_ferris === undefined ? true : !!o.evitar_ferris,
      camion: {
        peso_t: num(cam.peso_t, 40, 1, 100), altura_m: num(cam.altura_m, 4, 1, 6), ancho_m: num(cam.ancho_m, 2.55, 1, 4),
        largo_m: num(cam.largo_m, 16.5, 2, 30), eje_t: num(cam.eje_t, 11.5, 1, 30),
      },
    },
  };
}

export class ErrorMapa extends Error {
  constructor(msg, status = 502) { super(msg); this.status = status; }
}

const coordOk = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** Interpreta «40.4168, -3.7038» (o con espacios / punto y coma) como coordenadas. */
export function leerCoordenadas(texto) {
  const m = String(texto || '').trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const p = { lat: Number(m[1].replace(',', '.')), lon: Number(m[2].replace(',', '.')) };
  return coordOk(p) ? p : null;
}

/** Decodifica una polilínea codificada de Google en [[lat, lon], ...]. */
export function decodificarPolilinea(s) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < s.length) {
    for (const k of [0, 1]) {
      let b, sh = 0, r = 0;
      do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

/** Reduce una línea a como mucho n puntos (para guardarla o enviarla al navegador sin que pese demasiado). */
export function simplificar(coords, n = 400) {
  if (coords.length <= n) return coords;
  const paso = (coords.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => coords[Math.round(i * paso)]);
}

export function crearRutas(cfgEntrada, { fetch: f = globalThis.fetch } = {}) {
  const cfg = configLimpia(cfgEntrada);
  const cacheGeo = new Map();

  async function pedir(url, init = {}, nombre = 'el servicio de mapas') {
    let r;
    try { r = await f(url, { ...init, signal: AbortSignal.timeout(20_000) }); }
    catch (e) { throw new ErrorMapa(e.name === 'TimeoutError' ? `${nombre} no responde (tiempo agotado).` : `No se pudo conectar con ${nombre}.`); }
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = null; }
    if (!r.ok) {
      const msg = j?.error?.message || j?.error_message || (typeof j?.error === 'string' ? j.error : '') || j?.message || '';
      if (r.status === 401 || r.status === 403) throw new ErrorMapa(`${nombre} ha rechazado la clave${msg ? `: ${msg}` : ''}. Revísala en la configuración.`);
      if (r.status === 429) throw new ErrorMapa(`${nombre}: se ha superado el límite de peticiones. Espera un poco.`);
      throw new ErrorMapa(`${nombre} respondió ${r.status}${msg ? `: ${msg}` : ''}`);
    }
    return j;
  }

  // ---------------- Búsqueda de direcciones ----------------
  async function geocodificar(texto, { max = 5 } = {}) {
    const q = String(texto || '').trim().slice(0, 300);
    if (!q) return [];
    const c = leerCoordenadas(q);
    if (c) return [{ etiqueta: `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`, ...c, fuente: 'coordenadas' }];
    const k = `${cfg.proveedor}|${q.toLowerCase()}|${max}`;
    if (cacheGeo.has(k)) return cacheGeo.get(k);
    let res;
    if (cfg.proveedor === 'google') {
      if (!cfg.google.clave_servidor) throw new ErrorMapa('Falta la clave de servidor de Google Maps.', 400);
      const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      u.search = new URLSearchParams({ address: q, region: cfg.pais, language: 'es', key: cfg.google.clave_servidor });
      const j = await pedir(u, {}, 'Google Maps');
      if (j.status && !['OK', 'ZERO_RESULTS'].includes(j.status)) throw new ErrorMapa(`Google Maps: ${j.status}${j.error_message ? ` (${j.error_message})` : ''}`);
      res = (j.results || []).slice(0, max).map((x) => ({ etiqueta: x.formatted_address, lat: x.geometry.location.lat, lon: x.geometry.location.lng, fuente: 'google', ...dirGoogle(x) }));
    } else if (cfg.ors.clave) {
      const u = new URL(`${cfg.ors.base_geo}/search`);
      u.search = new URLSearchParams({ text: q, size: String(max), 'boundary.country': cfg.pais.toUpperCase(), lang: 'es' });
      const j = await pedir(u, { headers: { Authorization: cfg.ors.clave, Accept: 'application/json' } }, 'OpenRouteService');
      res = (j.features || []).map((x) => ({ etiqueta: x.properties?.label || q, lat: x.geometry.coordinates[1], lon: x.geometry.coordinates[0], fuente: 'openrouteservice', ...dirPelias(x.properties) }));
    } else {
      const u = new URL(`${NOMINATIM}/search`);
      u.search = new URLSearchParams({ q, format: 'jsonv2', limit: String(max), countrycodes: cfg.pais, 'accept-language': 'es', addressdetails: '1' });
      const j = await pedir(u, { headers: { 'User-Agent': AGENTE, Accept: 'application/json' } }, 'OpenStreetMap (Nominatim)');
      res = (j || []).map((x) => ({ etiqueta: x.display_name, lat: Number(x.lat), lon: Number(x.lon), fuente: 'openstreetmap', ...dirNominatim(x.address) }));
    }
    res = res.filter(coordOk);
    if (cacheGeo.size > 500) cacheGeo.clear();
    cacheGeo.set(k, res);
    return res;
  }

  // ---------------- Sugerencias mientras se escribe ----------------
  /** Direcciones que empiezan por el texto (para autocompletar). Cada una con calle, cp, ciudad, provincia y coordenadas. */
  async function sugerir(texto, { max = 6 } = {}) {
    const q = String(texto || '').trim().slice(0, 200);
    if (q.length < 3) return [];
    const c = leerCoordenadas(q);
    if (c) return [{ etiqueta: `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`, ...c, fuente: 'coordenadas', calle: '', cp: '', ciudad: '', provincia: '', pais: '' }];
    const k = `s|${cfg.proveedor}|${cfg.ors.clave ? 1 : 0}|${q.toLowerCase()}`;
    if (cacheGeo.has(k)) return cacheGeo.get(k);
    let res;
    if (cfg.proveedor === 'google') res = await geocodificar(q, { max });
    else if (cfg.ors.clave) {
      const u = new URL(`${cfg.ors.base_geo}/autocomplete`);
      u.search = new URLSearchParams({ text: q, 'boundary.country': cfg.pais.toUpperCase(), lang: 'es', size: String(max) });
      const j = await pedir(u, { headers: { Authorization: cfg.ors.clave, Accept: 'application/json' } }, 'OpenRouteService');
      res = (j.features || []).map((x) => ({ etiqueta: x.properties?.label || q, lat: x.geometry.coordinates[1], lon: x.geometry.coordinates[0], fuente: 'openrouteservice', ...dirPelias(x.properties) }));
    } else {
      const u = new URL(`${PHOTON}/api/`);
      u.search = new URLSearchParams({ q, limit: String(max * 2), ...(cfg.pais === 'es' ? { bbox: CAJA_ES } : {}) });
      const j = await pedir(u, { headers: { 'User-Agent': AGENTE, Accept: 'application/json' } }, 'OpenStreetMap (Photon)');
      res = (j.features || []).filter((x) => !x.properties?.countrycode || x.properties.countrycode.toLowerCase() === cfg.pais)
        .map((x) => { const p = x.properties || {}; const d = dirPhoton(p); return { etiqueta: etiquetaPhoton(p, d), lat: x.geometry.coordinates[1], lon: x.geometry.coordinates[0], fuente: 'openstreetmap', ...d }; });
    }
    // Sin repetidos (varios comercios en el mismo portal dan la misma dirección)
    const vistos = new Set();
    res = res.filter(coordOk).filter((x) => { const k = `${x.calle}|${x.cp}|${x.ciudad}`.toLowerCase(); if (x.calle && vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, max);
    if (cacheGeo.size > 500) cacheGeo.clear();
    cacheGeo.set(k, res);
    return res;
  }

  // ---------------- Rutas ----------------
  /**
   * Calcula la ruta que pasa por los puntos en orden. opciones sobrescribe las de la configuración.
   * Devuelve { km, minutos, linea: [[lat, lon]...], proveedor, perfil, opciones, avisos: [] }.
   */
  async function ruta(puntos, opciones = {}) {
    if (!Array.isArray(puntos) || puntos.length < 2) throw new ErrorMapa('Hacen falta al menos dos puntos para calcular la ruta.', 400);
    if (puntos.length > 25) throw new ErrorMapa('Demasiados puntos (máximo 25).', 400);
    if (!puntos.every(coordOk)) throw new ErrorMapa('Hay puntos sin coordenadas válidas.', 400);
    const o = configLimpia({ opciones: { ...cfg.opciones, ...opciones, camion: { ...cfg.opciones.camion, ...(opciones.camion || {}) } } }).opciones;
    const avisos = [];
    let km, minutos, linea;
    if (cfg.proveedor === 'google') {
      if (!cfg.google.clave_servidor) throw new ErrorMapa('Falta la clave de servidor de Google Maps.', 400);
      if (o.perfil === 'camion') avisos.push('Google Maps no calcula rutas para camiones: los km son los de un turismo y no tienen en cuenta restricciones de peso o altura.');
      const ll = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } });
      const j = await pedir('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cfg.google.clave_servidor, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline' },
        body: JSON.stringify({
          origin: ll(puntos[0]), destination: ll(puntos[puntos.length - 1]), intermediates: puntos.slice(1, -1).map(ll),
          travelMode: 'DRIVE', languageCode: 'es', units: 'METRIC', polylineQuality: 'OVERVIEW',
          routeModifiers: { avoidTolls: o.evitar_peajes, avoidHighways: o.evitar_autopistas, avoidFerries: o.evitar_ferris },
        }),
      }, 'Google Maps');
      const r = j.routes?.[0];
      if (!r) throw new ErrorMapa('Google Maps no ha encontrado ninguna ruta entre esos puntos.', 422);
      km = (r.distanceMeters || 0) / 1000;
      minutos = Math.round(parseFloat(String(r.duration || '0s')) / 60);
      linea = r.polyline?.encodedPolyline ? decodificarPolilinea(r.polyline.encodedPolyline) : puntos.map((p) => [p.lat, p.lon]);
    } else {
      if (!cfg.ors.clave) throw new ErrorMapa('Falta la clave de OpenRouteService (gratuita: créala en account.heigit.org).', 400);
      const camion = o.perfil === 'camion';
      const evitar = [o.evitar_autopistas && 'highways', o.evitar_peajes && 'tollways', o.evitar_ferris && 'ferries'].filter(Boolean);
      const opts = {};
      if (evitar.length) opts.avoid_features = evitar;
      if (camion) {
        opts.vehicle_type = 'hgv';
        const c = o.camion;
        opts.profile_params = { restrictions: { weight: c.peso_t, height: c.altura_m, width: c.ancho_m, length: c.largo_m, axleload: c.eje_t } };
      }
      const perfil = camion ? 'driving-hgv' : 'driving-car';
      const j = await pedir(`${cfg.ors.base_ruta}/v2/directions/${perfil}/geojson`, {
        method: 'POST',
        headers: { Authorization: cfg.ors.clave, 'Content-Type': 'application/json', Accept: 'application/geo+json, application/json' },
        body: JSON.stringify({ coordinates: puntos.map((p) => [p.lon, p.lat]), options: opts, language: 'es', instructions: false }),
      }, 'OpenRouteService');
      const ft = j.features?.[0];
      if (!ft) throw new ErrorMapa('OpenRouteService no ha encontrado ninguna ruta entre esos puntos.', 422);
      km = (ft.properties?.summary?.distance || 0) / 1000;
      minutos = Math.round((ft.properties?.summary?.duration || 0) / 60);
      linea = (ft.geometry?.coordinates || []).map(([lon, lat]) => [lat, lon]);
      if (o.evitar_peajes) avisos.push('OpenRouteService evita los peajes de forma fiable dentro de un país; en rutas internacionales revisa el recorrido.');
    }
    return { km: Math.round(km * 10) / 10, minutos, linea: simplificar(linea), proveedor: cfg.proveedor, perfil: o.perfil, opciones: o, avisos };
  }

  /** Comprueba que la clave funciona con una ruta corta (Madrid, Puerta del Sol → Atocha). */
  async function probar() {
    const r = await ruta([{ lat: 40.41694, lon: -3.70351 }, { lat: 40.40665, lon: -3.69060 }], { perfil: 'coche' });
    return { ok: true, km: r.km, proveedor: cfg.proveedor };
  }

  return { cfg, geocodificar, sugerir, ruta, probar };
}

/** Configuración que puede ver el navegador (nunca incluye claves de servidor). */
export function configPublica(c) {
  const x = configLimpia(c);
  return {
    proveedor: x.proveedor,
    clave_navegador: x.proveedor === 'google' ? (x.google.clave_navegador || '') : '',
    opciones: x.opciones,
    pais: x.pais,
    configurado: x.proveedor === 'google' ? !!x.google.clave_servidor : !!x.ors.clave,
  };
}

/** Fuentes externas que necesita el mapa (para la política de seguridad de contenidos). */
export const CSP_MAPAS = {
  img: ['https://tile.openstreetmap.org', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com'],
  script: ['https://maps.googleapis.com', 'https://maps.gstatic.com'],
  connect: ['https://maps.googleapis.com', 'https://*.googleapis.com'],
  style: ['https://fonts.googleapis.com'],
  font: ['https://fonts.gstatic.com'],
};

// ---------------- Campos de dirección de cada proveedor ----------------
function dirGoogle(x) {
  const comp = (t) => (x.address_components || []).find((c) => c.types.includes(t))?.long_name || '';
  return direccion({ calle: comp('route'), numero: comp('street_number'), cp: comp('postal_code'), ciudad: comp('locality') || comp('postal_town') || comp('administrative_area_level_3'),
    provincia: comp('administrative_area_level_2'), pais: (x.address_components || []).find((c) => c.types.includes('country'))?.short_name || '' });
}
function dirPelias(p = {}) {
  return direccion({ calle: p.street || (p.layer === 'venue' ? p.name : ''), numero: p.housenumber, cp: p.postalcode, ciudad: p.locality || p.localadmin || p.county, provincia: p.region || p.county, pais: (p.country_code || '').slice(0, 2) });
}
function dirNominatim(a = {}) {
  return direccion({ calle: a.road || a.pedestrian || a.industrial || '', numero: a.house_number, cp: a.postcode, ciudad: a.city || a.town || a.village || a.municipality || '', provincia: a.province || a.county || a.state || '', pais: a.country_code });
}
function dirPhoton(p = {}) {
  const lugar = !['city', 'county', 'state', 'country', 'district'].includes(p.type);
  return direccion({ calle: p.street || (lugar ? p.name : ''), numero: p.housenumber, cp: p.postcode, ciudad: p.city || p.town || p.village || p.county || '', provincia: p.county || p.state || '', pais: p.countrycode });
}
function etiquetaPhoton(p, d) {
  const nombre = p.name && p.name !== p.street && p.name !== d.calle ? p.name : '';
  return [nombre, d.calle, [d.cp, d.ciudad].filter(Boolean).join(' '), d.provincia && d.provincia !== d.ciudad ? d.provincia : ''].filter(Boolean).join(', ') || p.name || '';
}
