// Conexión de WhatsApp Web para enviar documentos (compartido por los plugins «WhatsApp» de Gestor DeCA y Facturador:
// si lo cambias, cópialo en los dos repositorios).
//
// - Usa Baileys (protocolo de WhatsApp Web, sin navegador). No es la API oficial de Meta: puede dejar de funcionar si
//   WhatsApp cambia su web, y la sesión puede caducar y pedir volver a vincular el teléfono.
// - Sesión propia guardada en <carpeta>/sesion (credenciales de dispositivo vinculado; nunca la contraseña de WhatsApp).
//   Es independiente de cualquier otro WhatsApp de la aplicación (p. ej. el puente de recuperación de contraseñas).
// - Solo envía mensajes individuales iniciados por un usuario. No hay envíos masivos.
import fs from 'node:fs';
import path from 'node:path';

/** Normaliza un teléfono a solo dígitos con prefijo de país (España por defecto). Devuelve '' si no es válido. */
export function normalizarTelefono(t, prefijo = '34') {
  let d = String(t || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^[6789]\d{8}$/.test(d)) d = prefijo + d; // móvil o fijo español sin prefijo
  return /^\d{8,15}$/.test(d) ? d : '';
}

export function crearWhatsApp({ carpeta, nombreDispositivo = 'Documentos', alCambiar = () => {} }) {
  const dirSesion = path.join(carpeta, 'sesion');
  let sock = null, baileys = null;
  let st = { estado: 'desconectado', qr: null, numero: null, nombre: null, error: null, desde: null };
  const recibos = new Map(); // id de mensaje -> callback(estado) para confirmar entrega
  let intentos = 0, parando = false, temporizador = null;

  const poner = (cambios) => { st = { ...st, ...cambios }; try { alCambiar(st); } catch { /* sin efecto */ } };
  const hayCredenciales = () => fs.existsSync(path.join(dirSesion, 'creds.json'));

  async function cargar() {
    if (baileys) return baileys;
    try { baileys = await import('baileys'); } catch (e) { throw new Error(`No se pudo cargar la librería de WhatsApp Web (${e.message}). Reinstala el plugin.`); }
    return baileys;
  }

  async function conectar() {
    if (sock && ['conectando', 'esperando_qr', 'conectado'].includes(st.estado)) return st;
    parando = false;
    clearTimeout(temporizador);
    const B = await cargar();
    const makeWASocket = B.default?.default || B.default || B.makeWASocket;
    fs.mkdirSync(dirSesion, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await B.useMultiFileAuthState(dirSesion);
    let version;
    try { version = (await B.fetchLatestBaileysVersion()).version; } catch { /* usa la versión incluida */ }
    const silencio = { level: 'silent', child() { return this; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
    poner({ estado: 'conectando', qr: null, error: null });
    sock = makeWASocket({
      auth: state, version, logger: silencio, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false,
      browser: B.Browsers?.appropriate ? B.Browsers.appropriate(nombreDispositivo) : [nombreDispositivo, 'Chrome', '1.0'],
      shouldSyncHistoryMessage: () => false, generateHighQualityLinkPreview: false,
    });
    const actual = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
      if (actual !== sock) return;
      if (u.qr) poner({ estado: 'esperando_qr', qr: u.qr });
      if (u.connection === 'open') {
        intentos = 0;
        const id = sock.user?.id || '';
        poner({ estado: 'conectado', qr: null, numero: id.split(':')[0].split('@')[0] || null, nombre: sock.user?.name || null, error: null, desde: new Date().toISOString() });
      }
      if (u.connection === 'close') {
        const codigo = u.lastDisconnect?.error?.output?.statusCode;
        const cerrada = codigo === B.DisconnectReason.loggedOut;
        sock = null;
        if (cerrada) {
          fs.rmSync(dirSesion, { recursive: true, force: true });
          poner({ estado: 'desconectado', qr: null, numero: null, nombre: null, error: parando ? null : 'La sesión se cerró desde el teléfono o caducó. Vuelve a vincular WhatsApp.' });
          return;
        }
        if (parando) { poner({ estado: 'desconectado', qr: null }); return; }
        // Mientras se espera el QR sin credenciales no se insiste indefinidamente
        if (!hayCredenciales() && st.estado === 'esperando_qr' && codigo === 408) { poner({ estado: 'desconectado', qr: null, error: 'El código QR caducó sin escanearse. Pulsa «Vincular» para generar otro.' }); return; }
        intentos++;
        const espera = Math.min(60_000, 2000 * 2 ** Math.min(intentos, 5));
        poner({ estado: 'reconectando', qr: null, error: `Conexión perdida (código ${codigo ?? '?'}). Reintentando…` });
        temporizador = setTimeout(() => conectar().catch((e) => poner({ estado: 'desconectado', error: e.message })), espera);
        temporizador.unref?.();
      }
    });
    // Confirmaciones de entrega (solo si WhatsApp las envía: nunca se da por entregado sin ellas)
    sock.ev.on('messages.update', (lista) => {
      for (const { key, update } of lista) {
        const cb = recibos.get(key.id);
        if (cb && update.status >= 3) { cb('entregado'); recibos.delete(key.id); }
      }
    });
    return st;
  }

  async function desconectar() {
    parando = true;
    clearTimeout(temporizador);
    try { if (sock) await sock.logout(); } catch { /* ya estaba cerrada */ }
    try { sock?.end?.(); } catch { /* sin efecto */ }
    sock = null;
    fs.rmSync(dirSesion, { recursive: true, force: true });
    poner({ estado: 'desconectado', qr: null, numero: null, nombre: null, error: null });
  }

  /** Comprueba que el número tiene WhatsApp. Devuelve el JID o lanza un error. */
  async function comprobar(telefono) {
    if (!sock || st.estado !== 'conectado') throw Object.assign(new Error('WhatsApp no está conectado. Un administrador debe vincularlo en la configuración del plugin.'), { status: 409 });
    const n = normalizarTelefono(telefono);
    if (!n) throw Object.assign(new Error('El teléfono no es válido. Escríbelo con el prefijo del país si no es español (p. ej. +351…).'), { status: 400 });
    const [r] = await sock.onWhatsApp(`${n}@s.whatsapp.net`).catch(() => []);
    if (!r?.exists) throw Object.assign(new Error(`El número +${n} no tiene WhatsApp.`), { status: 400 });
    return r.jid;
  }

  /**
   * Envía un PDF con un texto. Devuelve { id, estado: 'enviado' } cuando WhatsApp acepta el mensaje.
   * alEntregar(estado) se llama si más tarde llega la confirmación de entrega.
   */
  async function enviarDocumento(telefono, { buffer, nombre, texto = '', mimetype = 'application/pdf' }, alEntregar) {
    const jid = await comprobar(telefono);
    const m = await sock.sendMessage(jid, { document: buffer, fileName: nombre, mimetype, caption: texto.slice(0, 3000) });
    if (alEntregar && m?.key?.id) {
      recibos.set(m.key.id, alEntregar);
      setTimeout(() => recibos.delete(m.key.id), 24 * 3600e3).unref?.();
    }
    return { id: m?.key?.id || null, estado: 'enviado', jid };
  }

  // Si ya había sesión vinculada, se reconecta al arrancar
  function arrancar() { if (hayCredenciales()) conectar().catch((e) => poner({ estado: 'desconectado', error: e.message })); }
  function parar() { parando = true; clearTimeout(temporizador); try { sock?.end?.(); } catch { /* sin efecto */ } sock = null; }

  return { estado: () => ({ ...st }), conectar, desconectar, enviarDocumento, comprobar, arrancar, parar };
}

/** Rellena una plantilla con {variables}; las que no existan se quitan. */
export function rellenar(plantilla, vars) {
  return String(plantilla || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k]))).replace(/[ \t]+\n/g, '\n').trim();
}
