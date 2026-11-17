// Firma digital de PDF (PAdES básica, firma CMS separada) con un certificado .p12/.pfx, por ejemplo el de la FNMT.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const forge = require('node-forge');
const signpdfMod = require('@signpdf/signpdf');
const signpdf = signpdfMod.default || new signpdfMod.SignPdf();
const { P12Signer } = require('@signpdf/signer-p12');
const { plainAddPlaceholder } = require('@signpdf/placeholder-plain');

/** Lee un certificado .p12 y devuelve sus datos. Lanza un error claro si la contraseña no es correcta. */
export function leerCertificado(p12, clave) {
  let p;
  try {
    p = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12.toString('binary')), false, clave);
  } catch (e) {
    throw new Error(/MAC|password|Invalid/i.test(e.message) ? 'La contraseña del certificado no es correcta' : 'El archivo no es un certificado .p12/.pfx válido');
  }
  const certs = (p.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b) => b.cert).filter(Boolean);
  const claves = [
    ...(p.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  if (!certs.length || !claves.length) throw new Error('El certificado no contiene la clave privada');
  // El certificado del titular es el que corresponde a la clave privada
  const clavePub = forge.pki.setRsaPublicKey(claves[0].key.n, claves[0].key.e);
  const propio = certs.find((c) => c.publicKey.n?.equals?.(clavePub.n)) || certs[0];
  const attr = (nombre, origen = propio.subject) => origen.getField(nombre)?.value || '';
  return {
    titular: attr('CN') || attr('O'),
    // El NIF va en el atributo serialNumber (OID 2.5.4.5), con prefijo IDCES- (personas) o VATES- (empresas)
    nif: String(propio.subject.getField({ type: '2.5.4.5' })?.value || '').replace(/^(IDC|VAT)ES-/, ''),
    organizacion: attr('O'),
    emisor: attr('CN', propio.issuer) || attr('O', propio.issuer),
    valido_desde: propio.validity.notBefore.toISOString(),
    valido_hasta: propio.validity.notAfter.toISOString(),
  };
}

/** Firma un PDF. Devuelve el PDF firmado. */
export async function firmarPdf(pdf, p12, clave, { razon = 'Documento emitido', lugar = '', contacto = '', nombre = '' } = {}) {
  const conHueco = plainAddPlaceholder({ pdfBuffer: pdf, reason: razon, location: lugar, contactInfo: contacto, name: nombre, signatureLength: 16384 });
  const firmante = new P12Signer(p12, { passphrase: clave });
  return Buffer.from(await signpdf.sign(conHueco, firmante));
}
