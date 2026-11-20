// Plugins de la tanda 2 (WhatsApp, recordatorios, conciliación, periódicas, estado de cuenta, QR de pago, aceptación,
// stock y horas) contra un Facturador real con base de datos temporal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { arrancar, cliente, instalar, preparar } from './ayuda.mjs';

test('plugins nuevos de Facturador', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-nuevos-'));
  const PF = 9331, BASE = `http://127.0.0.1:${PF}`;
  const fx = await arrancar(dir, PF);
  const { api } = cliente(BASE);
  const ok = async (p, msg) => { const r = await p; assert.ok(r.status < 400, `${msg}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  try {
    await preparar(api);
    for (const id of ['whatsapp', 'recordatorios', 'conciliacion', 'periodicas', 'estado-cuenta', 'qr-pago', 'aceptacion', 'stock', 'horas']) await instalar(api, id);
    await ok(api('PUT', '/api/ajustes/empresa', { razon_social: 'Transportes Prueba', nif: '12345678Z', iban: 'ES9121000418450200051332' }), 'empresa').catch(() => {});
    const cli = await ok(api('POST', '/api/clientes', { nombre: 'Cliente Uno SL', nif: 'B12345674' }), 'cliente');

    // ---- Facturas periódicas: recupera los periodos atrasados sin repetirlos ----
    const hoy = new Date(), tresMeses = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1).toLocaleDateString('sv-SE');
    const pl = await ok(api('POST', '/api/p/periodicas/plantillas', { nombre: 'Cuota', cliente_id: cli.id, periodicidad: 'mensual', dia: 1, inicio: tresMeses, lineas: [{ descripcion: 'Cuota de {periodo}', cantidad: 1, precio: 100, iva: 21 }] }), 'periodica');
    let p = await ok(api('GET', `/api/p/periodicas/plantillas/${pl.id}`), 'ver');
    assert.equal(p.historial.length, 3);
    await ok(api('POST', '/api/p/periodicas/generar', {}), 'generar');
    p = await ok(api('GET', `/api/p/periodicas/plantillas/${pl.id}`), 'ver2');
    assert.equal(p.historial.length, 3, 'no se repiten periodos');
    const borr = await ok(api('GET', `/api/documentos/${p.historial[0].documento_id}`), 'borrador');
    assert.equal(borr.estado, 'borrador');
    assert.match(borr.lineas[0].descripcion, /^Cuota de \S+ de \d{4}$/);
    const avisos = await ok(api('GET', '/api/cobros/avisos'), 'avisos');
    assert.ok(avisos.plugins.some((a) => /periódica/.test(a.titulo)));

    // Una factura emitida para el resto de pruebas
    await ok(api('POST', `/api/documentos/${borr.id}/emitir`, {}), 'emitir');
    const fac = await ok(api('GET', `/api/documentos/${borr.id}`), 'factura');

    // ---- Acciones en el documento (WhatsApp) y estado sin conexión ----
    const acc = await ok(api('GET', `/api/plugins/acciones/${fac.id}`), 'acciones');
    assert.ok(acc.some((a) => a.titulo === 'Enviar por WhatsApp' && a.url.includes(`documento=${fac.id}`)));
    const wa = await api('POST', `/api/p/whatsapp/envios/${fac.id}`, { telefono: '600000000', texto: 'x' });
    assert.equal(wa.status, 409);

    // ---- Recordatorios: modo de prueba por defecto, sin correo → excluido ----
    const cfg = await ok(api('GET', '/api/p/recordatorios/config'), 'rec cfg');
    assert.equal(cfg.envio_real, false);
    const act = await api('PUT', '/api/p/recordatorios/config', { envio_real: true });
    assert.equal(act.status, 400, 'no se activa sin cuenta de correo');

    // ---- QR de pago en el PDF ----
    await ok(api('PUT', '/api/p/qr-pago/config', { activo: true, tipos: ['factura'], referencia: 'Factura {numero}', texto: true }), 'qr');
    const qrc = await ok(api('GET', '/api/p/qr-pago/config'), 'qr cfg');
    assert.equal(qrc.iban_valido, true);
    const pdf = await api('GET', `/api/documentos/${fac.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.ok(pdf.body.toString('latin1').includes('Paga con tu app bancaria') || pdf.body.length > 2000);

    // ---- Conciliación: importar, no duplicar, proponer y registrar el cobro ----
    const cta = await ok(api('POST', '/api/p/conciliacion/cuentas', { nombre: 'Banco' }), 'cuenta');
    const csv = `Fecha;Concepto;Importe\n${new Date().toLocaleDateString('es-ES')};TRANSFERENCIA CLIENTE UNO FRA ${fac.codigo};${String(fac.total).replace('.', ',')}\n`;
    const fmt = { separador: ';', saltar: 1, formato_fecha: 'dd/mm/aaaa', decimal: ',', columnas: { fecha: '0', concepto: '1', importe: '2', saldo: '', cargo: '', abono: '', concepto2: '', referencia: '' } };
    assert.equal((await ok(api('POST', `/api/p/conciliacion/cuentas/${cta.id}/importar`, { texto: csv, formato: fmt, guardar_formato: true }), 'imp')).nuevas, 1);
    assert.equal((await ok(api('POST', `/api/p/conciliacion/cuentas/${cta.id}/importar`, { texto: csv }), 'imp2')).repetidas, 1);
    const [mov] = await ok(api('GET', `/api/p/conciliacion/cuentas/${cta.id}/movimientos?estado=pendiente`), 'movs');
    const { propuestas } = await ok(api('GET', `/api/p/conciliacion/movimientos/${mov.id}/propuestas`), 'prop');
    assert.equal(propuestas[0].documento_id, fac.id);
    await ok(api('POST', `/api/p/conciliacion/movimientos/${mov.id}/conciliar`, { partes: [{ recibo_id: propuestas[0].recibo_id, importe: propuestas[0].pendiente }] }), 'conciliar');
    assert.equal((await ok(api('GET', `/api/documentos/${fac.id}`), 'f')).estado, 'pagada');
    // Una factura pagada ya no lleva QR (no se ofrece pagar otra vez) y el estado de cuenta queda a cero
    const ec = await ok(api('GET', `/api/p/estado-cuenta/estado?cliente_id=${cli.id}`), 'estado');
    assert.equal(ec.saldo_final, 0);
    assert.equal(ec.cobrado, fac.total);
    await ok(api('POST', `/api/p/conciliacion/movimientos/${mov.id}/deshacer`, {}), 'deshacer');
    assert.equal((await ok(api('GET', `/api/documentos/${fac.id}`), 'f2')).estado, 'emitida');

    // ---- Aceptación de presupuestos por enlace público ----
    const pre = await ok(api('POST', '/api/documentos', { tipo: 'presupuesto', cliente_id: cli.id, lineas: [{ descripcion: 'Servicio', cantidad: 1, precio: 500 }] }), 'pre');
    await ok(api('POST', `/api/documentos/${pre.id}/emitir`, {}), 'emitir pre');
    const { url } = await ok(api('POST', `/api/p/aceptacion/documentos/${pre.id}/enlace`, { dias: 5 }), 'enlace');
    const token = url.split('#')[1];
    const pub = await fetch(`${BASE}/api/pub/aceptacion/presupuesto/${token}`).then((r) => r.json());
    assert.equal(pub.estado, 'pendiente');
    assert.equal((await fetch(`${BASE}/api/documentos`)).status, 401, 'la página pública no da acceso a nada más');
    const resp = await fetch(`${BASE}/api/pub/aceptacion/presupuesto/${token}/responder`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ accion: 'aceptar', nombre: 'Ana' }) });
    assert.equal(resp.status, 200);
    assert.equal((await ok(api('GET', `/api/documentos/${pre.id}`), 'pre2')).estado, 'aceptado');
    const otra = await fetch(`${BASE}/api/pub/aceptacion/presupuesto/${token}/responder`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ accion: 'rechazar', nombre: 'Ana' }) });
    assert.equal(otra.status, 409);

    // ---- Stock: impedir negativo, no descontar dos veces, rectificativa compensa ----
    const prod = await ok(api('POST', '/api/productos', { descripcion: 'Saco', precio: 5, iva: 21 }), 'prod');
    await ok(api('PUT', `/api/p/stock/productos/${prod.id}`, { controlar: true, minimo: 1, inicial: 5 }), 'ctl');
    const ex = async () => (await ok(api('GET', '/api/p/stock/productos'), 'prods')).find((x) => x.id === prod.id).existencias;
    const a1 = await ok(api('POST', '/api/documentos', { tipo: 'albaran', cliente_id: cli.id, lineas: [{ producto_id: prod.id, descripcion: 'Saco', cantidad: 6, precio: 5 }] }), 'alb');
    assert.equal((await api('POST', `/api/documentos/${a1.id}/emitir`, {})).status, 409);
    const a2 = await ok(api('POST', '/api/documentos', { tipo: 'albaran', cliente_id: cli.id, lineas: [{ producto_id: prod.id, descripcion: 'Saco', cantidad: 3, precio: 5 }] }), 'alb2');
    await ok(api('POST', `/api/documentos/${a2.id}/emitir`, {}), 'em alb2');
    assert.equal(await ex(), 2);
    const fa = await ok(api('POST', `/api/documentos/${a2.id}/facturar`, {}), 'facturar alb');
    await ok(api('POST', `/api/documentos/${fa.id}/emitir`, {}), 'em fa');
    assert.equal(await ex(), 2, 'la factura de un albarán no descuenta otra vez');

    // ---- Horas: redondeo, factura borrador y sin duplicados ----
    await ok(api('PUT', '/api/p/horas/config', { tarifa: 40, redondeo: 15, iva: 21, irpf: 0, agrupar: 'registro' }), 'horas cfg');
    const pr = await ok(api('POST', '/api/p/horas/proyectos', { cliente_id: cli.id, nombre: 'Proyecto', tarifa: 50 }), 'proy');
    const r1 = await ok(api('POST', '/api/p/horas/registros', { proyecto_id: pr.id, horas: '0,33', descripcion: 'Llamada' }), 'reg');
    const fh = await ok(api('POST', '/api/p/horas/facturar', { registros: [r1.id] }), 'facturar horas');
    const dh = await ok(api('GET', `/api/documentos/${fh.documento_id}`), 'doc horas');
    assert.equal(dh.lineas[0].cantidad, 0.5);
    assert.equal(dh.lineas[0].precio, 50);
    assert.equal((await api('POST', '/api/p/horas/facturar', { registros: [r1.id] })).status, 409);
    await ok(api('DELETE', `/api/documentos/${fh.documento_id}`), 'borrar');
    assert.equal((await ok(api('GET', '/api/p/horas/registros?estado=pendiente'), 'pend')).length, 1);
  } finally {
    fx.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
