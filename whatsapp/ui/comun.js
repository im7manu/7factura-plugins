window.WA = {
  ESTADOS: { desconectado: 'Desconectado', conectando: 'Conectando…', esperando_qr: 'Esperando a que escanees el código', reconectando: 'Reconectando…', conectado: 'Conectado' },
  ENVIO: { pendiente: 'Enviando…', enviado: 'Enviado (aceptado por WhatsApp)', entregado: 'Entregado en el teléfono', error: 'Error', sesion_desconectada: 'No enviado: WhatsApp desconectado' },
  fecha: (s) => new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }),
};
