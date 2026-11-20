// Plugin «Rutas y mapas» para Facturador.
//
// - Configura el proveedor de mapas: OpenRouteService por defecto (clave gratuita) o Google Maps con la clave del
//   administrador. Las claves se guardan cifradas y nunca llegan al navegador (salvo la clave de navegador de Google).
// - Calculadora de rutas con vista previa en el mapa (camión o coche, evitando peajes, autopistas o ferris).
// - Ofrece el punto de extensión 'rutas' para otros plugins (p. ej. «Gestor DeCA» para facturar por kilómetro):
//     calcular(textos, opciones) → { km, minutos, linea, puntos, avisos, ... }
//     configurado() → boolean
import { crearRutas, configLimpia, configPublica, ErrorMapa, leerCoordenadas } from './lib/proveedores.mjs';

const AJUSTE = 'plugin_rutas';

export function register(ctx) {
  const { router, requiereAdmin, auditar } = ctx;

  const leer = () => ctx.getAjuste(AJUSTE, {}) || {};
  const des = (v) => { try { return v ? ctx.descifrar(v) : ''; } catch { return ''; } };
  function config() {
    const c = leer();
    return configLimpia({ ...c, ors: { ...c.ors, clave: des(c.ors?.clave) }, google: { ...c.google, clave_servidor: des(c.google?.clave_servidor) } });
  }
  let motor = null, firma = '';
  function rutas() {
    const c = config(), f = JSON.stringify(c);
    if (!motor || f !== firma) { motor = crearRutas(c); firma = f; }
    return motor;
  }
  const configurado = () => configPublica(config()).configurado;

  async function resolver(texto) {
    const t = String(texto || '').trim();
    const c = leerCoordenadas(t);
    if (c) return { texto: t, ...c, etiqueta: t, fuente: 'coordenadas' };
    const r = (await rutas().geocodificar(t, { max: 1 }))[0];
    return r ? { texto: t, lat: r.lat, lon: r.lon, etiqueta: r.etiqueta, fuente: r.fuente } : { texto: t, error: 'No se ha encontrado' };
  }
  async function calcular(textos, opciones = {}) {
    const lista = (Array.isArray(textos) ? textos : []).map((x) => String(x || '').trim().slice(0, 300)).filter(Boolean).slice(0, 25);
    if (lista.length < 2) throw new ErrorMapa('Indica al menos un origen y un destino.', 400);
    const puntos = [];
    for (const t of lista) puntos.push(await resolver(t));
    const sin = puntos.filter((p) => p.error);
    if (sin.length) {
      const e = new ErrorMapa(`No se ha encontrado: ${sin.map((p) => `«${p.texto}»`).join(', ')}. Escribe una dirección más completa o pon coordenadas (p. ej. 40.4168, -3.7038).`, 422);
      e.puntos = puntos; throw e;
    }
    return { ...(await rutas().ruta(puntos, opciones)), puntos };
  }
  ctx.extender('rutas', { calcular, configurado, opciones: () => config().opciones });

  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      const st = e.status || 500;
      if (st === 500) console.error('[rutas]', e);
      res.status(st).json({ error: st === 500 ? 'Error interno' : e.message, puntos: e.puntos });
    }
  };

  router.get('/config', (req, res) => {
    const c = leer(), pub = configPublica(config());
    if (req.usuario?.rol === 'admin') {
      Object.assign(pub, {
        ors: { tiene_clave: !!c.ors?.clave, base_ruta: config().ors.base_ruta, base_geo: config().ors.base_geo },
        google: { tiene_clave_servidor: !!c.google?.clave_servidor, clave_navegador: config().google.clave_navegador },
      });
    }
    res.json(pub);
  });

  router.put('/config', requiereAdmin, envolver(async (req, res) => {
    const b = req.body || {}, ant = leer();
    const nueva = configLimpia({
      proveedor: b.proveedor, pais: b.pais, opciones: b.opciones,
      ors: { base_ruta: b.ors?.base_ruta, base_geo: b.ors?.base_geo },
      google: { clave_navegador: String(b.google?.clave_navegador || '').trim().slice(0, 200) },
    });
    const claveOrs = String(b.ors?.clave || '').trim(), claveGoogle = String(b.google?.clave_servidor || '').trim();
    if (claveOrs.length > 2000 || claveGoogle.length > 200) throw new ErrorMapa('La clave es demasiado larga.', 400);
    ctx.setAjuste(AJUSTE, {
      ...nueva,
      ors: { ...nueva.ors, clave: claveOrs ? ctx.cifrar(claveOrs) : ant.ors?.clave || '' },
      google: { ...nueva.google, clave_servidor: claveGoogle ? ctx.cifrar(claveGoogle) : ant.google?.clave_servidor || '' },
    });
    auditar(req, 'rutas.config', `Proveedor: ${nueva.proveedor === 'google' ? 'Google Maps' : 'OpenRouteService'}${claveOrs || claveGoogle ? ' (clave cambiada)' : ''}`, 'aviso');
    res.json({ ok: true });
  }));

  router.post('/probar', requiereAdmin, envolver(async (_req, res) => res.json(await rutas().probar())));

  router.get('/geocodificar', envolver(async (req, res) => {
    const q = String(req.query.q || '').trim();
    res.json({ resultados: q.length < 3 ? [] : await rutas().geocodificar(q) });
  }));

  router.post('/ruta', envolver(async (req, res) => res.json(await calcular(req.body?.textos, req.body?.opciones || {}))));
}
