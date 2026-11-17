import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { arrancar, cliente, instalar, preparar } from './ayuda.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** Comprueba la firma CMS de un PDF con OpenSSL (como lo haría cualquier lector externo). */
function verificarFirma(pdf, dir) {
  const txt = pdf.toString('latin1');
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(txt);
  assert.ok(m, 'el PDF tiene ByteRange');
  const [a, b, c, d] = m.slice(1).map(Number);
  const contenido = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
  const hex = txt.slice(a + b + 1, c - 1).replace(/0+$/, '');
  const firma = Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
  fs.writeFileSync(path.join(dir, 'datos.bin'), contenido);
  fs.writeFileSync(path.join(dir, 'firma.der'), firma);
  return execFileSync('openssl', ['smime', '-verify', '-inform', 'DER', '-in', path.join(dir, 'firma.der'), '-content', path.join(dir, 'datos.bin'), '-binary', '-noverify', '-out', '/dev/null'],
    { stdio: ['ignore', 'pipe', 'pipe'] }).toString() + 'ok';
}

test('diseño de PDF: diseños por tipo, sello y firma digital verificable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-pdf-'));
  const PUERTO = 9303;
  const BASE = `http://127.0.0.1:${PUERTO}`;
  const srv = await arrancar(dir, PUERTO);
  const { api } = cliente(BASE);
  try {
    await preparar(api);
    const cli = (await api('POST', '/api/clientes', { nombre: 'Cliente SL', nif: 'B12345674' })).body;
    const f = (await api('POST', '/api/documentos', { tipo: 'factura', cliente_id: cli.id, lineas: [{ descripcion: 'Porte', precio: 500, iva: 21 }] })).body;
    await api('POST', `/api/documentos/${f.id}/emitir`);
    const pdfAntes = (await api('GET', `/api/documentos/${f.id}/pdf`)).body;
    assert.doesNotMatch(pdfAntes.toString('latin1'), /plugin diseno-pdf/); // diseño estándar del núcleo

    await instalar(api, 'diseno-pdf');
    // Archivos: logo y sello
    const logo = (await api('POST', '/api/p/diseno-pdf/archivos', Buffer.concat([PNG, Buffer.alloc(64)]), { 'Content-Type': 'image/png', 'X-Nombre-Archivo': 'logo.png' })).body;
    assert.match(logo.id, /^[a-f0-9]{24}\.png$/);
    assert.equal((await api('POST', '/api/p/diseno-pdf/archivos', Buffer.from('<script>alert(1)</script>'.repeat(4)))).status, 400);
    // Dos diseños: uno por defecto (clásico, con logo y sello) y otro solo para albaranes (minimalista)
    let r = await api('PUT', '/api/p/diseno-pdf/disenos', { disenos: [
      { id: 'general', nombre: 'General', plantilla: 'clasica', por_defecto: true, colores: { primario: '#AA2200' }, logo: { archivo: logo.id }, sello: { archivo: logo.id, texto: 'Fdo.: Gerencia' }, marca_agua: { texto: 'COPIA' } },
      { id: 'albaranes', nombre: 'Albaranes', plantilla: 'minimal', aplicar: { tipos: ['albaran'] } },
    ] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body[0].colores.primario, '#AA2200');
    const pdf = (await api('GET', `/api/documentos/${f.id}/pdf`)).body;
    assert.match(pdf.toString('latin1'), /plugin diseno-pdf/);
    assert.notEqual(pdf.length, pdfAntes.length);
    // Vista previa sin guardar
    r = await api('POST', '/api/p/diseno-pdf/vista-previa', { diseno: { plantilla: 'lateral' }, tipo: 'albaran' });
    assert.equal(r.status, 200);
    assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
    for (const plantilla of ['moderna', 'clasica', 'minimal', 'lateral', 'compacta']) {
      assert.equal((await api('POST', '/api/p/diseno-pdf/vista-previa', { diseno: { plantilla }, tipo: 'factura' })).status, 200, plantilla);
    }

    // Certificado de prueba (si hay OpenSSL)
    let hayOpenssl = true;
    try { execFileSync('openssl', ['version']); } catch { hayOpenssl = false; }
    if (hayOpenssl) {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '30',
        '-subj', '/C=ES/O=Transportes Prueba/serialNumber=IDCES-12345678Z/CN=NOMBRE PRUEBA - 12345678Z'], { stdio: 'ignore' });
      execFileSync('openssl', ['pkcs12', '-export', '-inkey', path.join(dir, 'k.pem'), '-in', path.join(dir, 'c.pem'), '-out', path.join(dir, 'c.p12'), '-passout', 'pass:Clave123'], { stdio: 'ignore' });
      const p12 = fs.readFileSync(path.join(dir, 'c.p12')).toString('base64');
      assert.match((await api('POST', '/api/p/diseno-pdf/certificado', { archivo: p12, clave: 'mala' })).body.error, /contraseña/);
      r = await api('POST', '/api/p/diseno-pdf/certificado', { archivo: p12, clave: 'Clave123' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.nif, '12345678Z');
      const estado = (await api('GET', '/api/p/diseno-pdf/estado')).body;
      assert.equal(JSON.stringify(estado).includes('Clave123'), false);
      assert.equal(estado.certificado.titular, 'NOMBRE PRUEBA - 12345678Z');
      // Activa la firma digital en el diseño general
      const disenos = estado.disenos;
      disenos[0].firma_digital = true;
      await api('PUT', '/api/p/diseno-pdf/disenos', { disenos });
      const firmado = (await api('GET', `/api/documentos/${f.id}/pdf`)).body;
      assert.match(firmado.toString('latin1'), /\/Type\s*\/Sig/);
      assert.match(verificarFirma(firmado, dir), /ok$/);
      // También el PDF adjunto al correo va firmado
      // Los borradores no se firman
      const b = (await api('POST', '/api/documentos', { tipo: 'factura', cliente_id: cli.id, lineas: [{ descripcion: 'x', precio: 1 }] })).body;
      assert.doesNotMatch((await api('GET', `/api/documentos/${b.id}/pdf`)).body.toString('latin1'), /\/Type\s*\/Sig/);
    }

    // El albarán usa su propio diseño (minimalista) y no se firma
    const alb = (await api('POST', '/api/documentos', { tipo: 'albaran', cliente_id: cli.id, lineas: [{ descripcion: 'x', precio: 1 }] })).body;
    await api('POST', `/api/documentos/${alb.id}/emitir`);
    const pdfAlb = (await api('GET', `/api/documentos/${alb.id}/pdf`)).body;
    assert.doesNotMatch(pdfAlb.toString('latin1'), /\/Type\s*\/Sig/);

    // Al desactivar el plugin vuelve el diseño estándar
    await api('POST', '/api/plugins/diseno-pdf/activo', { activo: false });
    assert.doesNotMatch((await api('GET', `/api/documentos/${f.id}/pdf`)).body.toString('latin1'), /plugin diseno-pdf/);
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
