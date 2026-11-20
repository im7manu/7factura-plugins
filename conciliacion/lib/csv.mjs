// Lectura de extractos bancarios en CSV (sin dependencias).
export function separadorProbable(texto) {
  const l = texto.split(/\r?\n/).slice(0, 10).join('\n');
  const c = { ';': (l.match(/;/g) || []).length, ',': (l.match(/,/g) || []).length, '\t': (l.match(/\t/g) || []).length };
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}
export function leerCsv(texto, sep = ';') {
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += ch;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.map((f) => f.map((x) => x.trim())).filter((f) => f.some((x) => x !== ''));
}
/** Convierte un importe con el separador decimal indicado (',' o '.'). Admite signo, € y miles. */
export function importe(v, decimal = ',') {
  let s = String(v || '').replace(/[€\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
/** Fecha según el formato: 'dd/mm/aaaa', 'aaaa-mm-dd', 'mm/dd/aaaa' (acepta - . / y años de 2 cifras). */
export function fecha(v, formato = 'dd/mm/aaaa') {
  const s = String(v || '').trim();
  const p = s.split(/[/.\-\s]/).filter(Boolean);
  if (p.length < 3) return null;
  let d, m, a;
  if (formato === 'aaaa-mm-dd') [a, m, d] = p; else if (formato === 'mm/dd/aaaa') [m, d, a] = p; else [d, m, a] = p;
  if (String(a).length === 2) a = `20${a}`;
  const iso = `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) ? iso : null;
}
