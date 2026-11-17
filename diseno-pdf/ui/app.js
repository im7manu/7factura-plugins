(function () {
  var F = window.Facturador;
  var base = '/api/p/diseno-pdf';
  var TIPOS = { factura: 'Facturas', presupuesto: 'Presupuestos', proforma: 'Proformas', pedido: 'Pedidos', albaran: 'Albaranes',
    pedido_compra: 'Pedidos a proveedor', presupuesto_compra: 'Presupuestos de proveedor', albaran_compra: 'Albaranes de proveedor', factura_compra: 'Facturas recibidas', gasto: 'Gastos' };
  var estado = null, disenos = [], sel = 0, cambios = false, temporizador = null, urlPrevia = null;
  var E = F.escapar;

  function marcar() { cambios = true; document.getElementById('estado-guardado').textContent = 'Cambios sin guardar'; previaDiferida(); }
  function previaDiferida() { clearTimeout(temporizador); temporizador = setTimeout(previa, 600); }

  async function previa() {
    try {
      var r = await fetch(base + '/vista-previa', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diseno: disenos[sel], tipo: document.getElementById('tipo-previa').value }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Error en la vista previa');
      if (urlPrevia) URL.revokeObjectURL(urlPrevia);
      urlPrevia = URL.createObjectURL(await r.blob());
      document.getElementById('visor').src = urlPrevia + '#toolbar=0&view=FitH';
    } catch (e) { F.aviso(e.message, 'error'); }
  }

  function campo(etiqueta, html) { return '<label class="fx-campo"><span>' + etiqueta + '</span>' + html + '</label>'; }
  function opciones(lista, valor) { return lista.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(valor) ? ' selected' : '') + '>' + E(o[1]) + '</option>'; }).join(''); }
  function imagenes(tipo) { return estado.archivos.filter(function (a) { return tipo === 'fuente' ? /ttf|otf/.test(a.tipo) : /png|jpg/.test(a.tipo); }); }
  function selectorArchivo(ruta, valor, tipo) {
    var lista = imagenes(tipo);
    var vista = valor && tipo !== 'fuente' ? '<img src="' + base + '/archivos/' + valor + '" alt="" />' : '';
    return '<div class="imagen">' + vista + '<select class="fx-select" data-ruta="' + ruta + '"><option value="">— Ninguno —</option>' +
      opciones(lista.map(function (a) { return [a.id, a.nombre || a.id]; }), valor) + '</select>' +
      '<label class="fx-btn">Subir<input type="file" hidden data-subir="' + ruta + '" accept="' + (tipo === 'fuente' ? '.ttf,.otf' : 'image/png,image/jpeg') + '" /></label></div>';
  }

  function pintarLista() {
    document.getElementById('lista').innerHTML = disenos.map(function (d, i) {
      return '<li data-i="' + i + '" class="' + (i === sel ? 'activo' : '') + '"><span>' + E(d.nombre) + '</span>' + (d.por_defecto ? '<span class="fx-etiqueta">Defecto</span>' : '') + '</li>';
    }).join('');
  }

  function pintarEditor() {
    var d = disenos[sel], c = d.colores, col = d.columnas;
    var tiposChips = Object.keys(TIPOS).map(function (t) { return '<label><input type="checkbox" data-lista="aplicar.tipos" value="' + t + '"' + (d.aplicar.tipos.indexOf(t) >= 0 ? ' checked' : '') + ' />' + TIPOS[t] + '</label>'; }).join('');
    var seriesChips = estado.series.map(function (s) { return '<label><input type="checkbox" data-lista="aplicar.series" value="' + E(s.codigo) + '"' + (d.aplicar.series.indexOf(s.codigo) >= 0 ? ' checked' : '') + ' />' + E(s.codigo) + '</label>'; }).join('');
    var plantillas = Object.keys(estado.plantillas).map(function (k) {
      return '<label class="' + (d.plantilla === k ? 'sel' : '') + '"><input type="radio" name="plantilla" data-ruta="plantilla" value="' + k + '"' + (d.plantilla === k ? ' checked' : '') + ' /><span>' + E(estado.plantillas[k]) + '</span></label>';
    }).join('');
    var titulos = Object.keys(TIPOS).map(function (t) { return campo(TIPOS[t], '<input class="fx-input" data-ruta="textos.titulos.' + t + '" value="' + E(d.textos.titulos[t] || '') + '" placeholder="Por defecto" />'); }).join('');
    var cert = estado.certificado;
    document.getElementById('editor').innerHTML =
      seccion('General', true,
        campo('Nombre del diseño', '<input class="fx-input" data-ruta="nombre" value="' + E(d.nombre) + '" />') +
        '<label><input type="checkbox" data-ruta="por_defecto"' + (d.por_defecto ? ' checked' : '') + ' /> Diseño por defecto (para los documentos que no encajan en ningún otro)</label>' +
        '<div><span class="fx-campo"><span>Se aplica a estos documentos (vacío = todos)</span></span><div class="chips">' + tiposChips + '</div></div>' +
        '<div><span class="fx-campo"><span>…y a estas series de factura (vacío = todas)</span></span><div class="chips">' + seriesChips + '</div></div>') +
      seccion('Plantilla', true, '<div class="plantillas">' + plantillas + '</div>') +
      seccion('Colores', false, '<div class="colores">' +
        [['primario', 'Principal'], ['sobre_primario', 'Texto sobre el principal'], ['texto', 'Texto'], ['suave', 'Filas alternas'], ['gris', 'Texto secundario']].map(function (x) {
          return campo(x[1], '<input type="color" data-ruta="colores.' + x[0] + '" value="' + c[x[0]] + '" />');
        }).join('') + '</div>') +
      seccion('Tipografía', false, '<div class="dos">' +
        campo('Fuente', '<select class="fx-select" data-ruta="fuente">' + opciones([['Helvetica', 'Helvetica (sin serifa)'], ['Times', 'Times (con serifa)'], ['Courier', 'Courier (monoespaciada)'], ['personalizada', 'Fuente propia (TTF/OTF)']], d.fuente) + '</select>') +
        campo('Tamaño del texto', '<input class="fx-input" type="number" min="7" max="12" step="0.5" data-ruta="tamano" value="' + d.tamano + '" />') + '</div>' +
        (d.fuente === 'personalizada' ? campo('Fuente normal', selectorArchivo('fuente_archivo', d.fuente_archivo, 'fuente')) + campo('Fuente en negrita (opcional)', selectorArchivo('fuente_negrita_archivo', d.fuente_negrita_archivo, 'fuente')) : '')) +
      seccion('Logo y datos de la empresa', false,
        campo('Logo', selectorArchivo('logo.archivo', d.logo.archivo, 'imagen')) +
        '<div class="dos">' + campo('Posición', '<select class="fx-select" data-ruta="logo.posicion">' + opciones([['izquierda', 'Izquierda'], ['centro', 'Centro'], ['derecha', 'Derecha']], d.logo.posicion) + '</select>') +
        campo('Ancho (px)', '<input class="fx-input" type="number" min="30" max="220" data-ruta="logo.ancho" value="' + d.logo.ancho + '" />') + '</div>' +
        '<label><input type="checkbox" data-ruta="mostrar_datos_empresa"' + (d.mostrar_datos_empresa ? ' checked' : '') + ' /> Mostrar NIF, dirección y contacto de la empresa</label>') +
      seccion('Columnas de las líneas', false, '<div class="chips">' +
        [['referencia', 'Referencia del producto'], ['cantidad', 'Cantidad'], ['precio', 'Precio'], ['iva', 'IVA'], ['importe', 'Importe']].map(function (x) {
          return '<label><input type="checkbox" data-ruta="columnas.' + x[0] + '"' + (col[x[0]] ? ' checked' : '') + ' />' + x[1] + '</label>';
        }).join('') + '</div>' +
        campo('Descuento', '<select class="fx-select" data-ruta="columnas.dto">' + opciones([['auto', 'Solo si alguna línea tiene descuento'], ['true', 'Siempre'], ['false', 'Nunca']], String(col.dto)) + '</select>')) +
      seccion('Textos', false,
        '<div class="dos">' + titulos + '</div>' +
        campo('Texto bajo la cabecera', '<textarea class="fx-textarea" rows="2" data-ruta="textos.cabecera">' + E(d.textos.cabecera) + '</textarea>') +
        campo('Condiciones (al final)', '<textarea class="fx-textarea" rows="3" data-ruta="textos.condiciones">' + E(d.textos.condiciones) + '</textarea>') +
        campo('Pie de página (vacío = el de Ajustes → Mi empresa)', '<textarea class="fx-textarea" rows="2" data-ruta="textos.pie">' + E(d.textos.pie) + '</textarea>')) +
      seccion('Marca de agua', false, '<div class="dos">' +
        campo('Texto (p. ej. COPIA, PAGADO)', '<input class="fx-input" maxlength="30" data-ruta="marca_agua.texto" value="' + E(d.marca_agua.texto) + '" />') +
        campo('Intensidad', '<input type="range" min="0.03" max="0.4" step="0.01" data-ruta="marca_agua.opacidad" value="' + d.marca_agua.opacidad + '" />') + '</div>' +
        '<p class="fx-nota">Los borradores llevan siempre la marca «BORRADOR».</p>') +
      seccion('Firma y sello', false,
        campo('Imagen de la firma manuscrita o del sello (PNG con fondo transparente)', selectorArchivo('sello.archivo', d.sello.archivo, 'imagen')) +
        '<div class="dos">' + campo('Texto bajo la firma', '<input class="fx-input" data-ruta="sello.texto" value="' + E(d.sello.texto) + '" placeholder="Fdo.: Nombre Apellidos" />') +
        campo('Posición', '<select class="fx-select" data-ruta="sello.posicion">' + opciones([['derecha', 'Derecha'], ['izquierda', 'Izquierda']], d.sello.posicion) + '</select>') + '</div>' +
        campo('Ancho de la imagen (px)', '<input class="fx-input" type="number" min="60" max="220" data-ruta="sello.ancho" value="' + d.sello.ancho + '" />') +
        '<label><input type="checkbox" data-ruta="firma_digital"' + (d.firma_digital ? ' checked' : '') + (cert ? '' : ' disabled') + ' /> Firmar digitalmente los PDF con el certificado ' +
        (cert ? '(' + E(cert.titular) + ')' : '(sube primero un certificado, a la izquierda)') + '</label>');
  }

  function seccion(titulo, abierta, html) { return '<details class="seccion"' + (abierta ? ' open' : '') + '><summary>' + titulo + '</summary><div>' + html + '</div></details>'; }

  function pintarCertificado() {
    var c = estado.certificado;
    document.getElementById('cert').innerHTML = '<h2>Certificado digital</h2>' + (c
      ? '<p><strong>' + E(c.titular) + '</strong><br><span class="fx-nota">' + E(c.emisor) + '<br>Válido hasta ' + new Date(c.valido_hasta).toLocaleDateString('es-ES') + '</span></p><button class="fx-btn fx-btn-peligro" id="quitar-cert">Quitar</button>'
      : '<p class="fx-nota">Sube el certificado (.p12 o .pfx) de la FNMT u otro prestador para firmar los PDF. Se guarda cifrado en el servidor.</p>' +
        '<input type="file" id="p12" accept=".p12,.pfx" /><input class="fx-input" type="password" id="clave-p12" placeholder="Contraseña del certificado" autocomplete="off" style="margin:8px 0" />' +
        '<button class="fx-btn fx-btn-primario" id="subir-cert">Subir certificado</button>');
  }

  function poner(obj, ruta, valor) {
    var partes = ruta.split('.'), o = obj;
    for (var i = 0; i < partes.length - 1; i++) { o[partes[i]] = o[partes[i]] || {}; o = o[partes[i]]; }
    o[partes[partes.length - 1]] = valor;
  }

  document.getElementById('editor').addEventListener('input', function (ev) {
    var el = ev.target, d = disenos[sel];
    if (el.dataset.lista) {
      var lista = el.dataset.lista.split('.').reduce(function (o, k) { return o[k]; }, d);
      var i = lista.indexOf(el.value);
      if (el.checked && i < 0) lista.push(el.value); else if (!el.checked && i >= 0) lista.splice(i, 1);
    } else if (el.dataset.ruta) {
      var v = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
      if (el.dataset.ruta === 'columnas.dto') v = el.value === 'auto' ? 'auto' : el.value === 'true';
      if (el.dataset.ruta === 'por_defecto' && v) disenos.forEach(function (x) { x.por_defecto = false; });
      poner(d, el.dataset.ruta, v);
      if (el.dataset.ruta === 'nombre' || el.dataset.ruta === 'por_defecto') pintarLista();
      if (el.dataset.ruta === 'fuente' || el.dataset.ruta === 'plantilla' || el.dataset.ruta.endsWith('archivo')) pintarEditor();
    }
    marcar();
  });
  document.getElementById('editor').addEventListener('change', async function (ev) {
    var el = ev.target;
    if (!el.dataset.subir || !el.files[0]) return;
    var f = el.files[0];
    try {
      var r = await F.api(base + '/archivos', { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nombre-Archivo': encodeURIComponent(f.name) } });
      estado.archivos.push(r);
      poner(disenos[sel], el.dataset.subir, r.id);
      pintarEditor(); marcar();
    } catch (e) { F.aviso(e.message, 'error'); }
  });
  document.getElementById('lista').onclick = function (ev) { var li = ev.target.closest('li'); if (!li) return; sel = Number(li.dataset.i); pintarLista(); pintarEditor(); previa(); };
  document.getElementById('nuevo').onclick = function () {
    var d = JSON.parse(JSON.stringify(disenos[0])); d.id = 'diseno-' + Date.now().toString(36); d.nombre = 'Nuevo diseño'; d.por_defecto = false; d.aplicar = { tipos: [], series: [] };
    disenos.push(d); sel = disenos.length - 1; pintarLista(); pintarEditor(); marcar();
  };
  document.getElementById('duplicar').onclick = function () {
    var d = JSON.parse(JSON.stringify(disenos[sel])); d.id = 'diseno-' + Date.now().toString(36); d.nombre += ' (copia)'; d.por_defecto = false;
    disenos.push(d); sel = disenos.length - 1; pintarLista(); pintarEditor(); marcar();
  };
  document.getElementById('borrar').onclick = function () {
    if (disenos.length < 2) return F.aviso('Tiene que quedar al menos un diseño', 'error');
    if (!confirm('¿Borrar el diseño «' + disenos[sel].nombre + '»?')) return;
    disenos.splice(sel, 1); sel = 0; if (!disenos.some(function (d) { return d.por_defecto; })) disenos[0].por_defecto = true;
    pintarLista(); pintarEditor(); marcar();
  };
  document.getElementById('guardar').onclick = async function () {
    try {
      disenos = await F.api(base + '/disenos', { method: 'PUT', body: { disenos: disenos } });
      cambios = false; document.getElementById('estado-guardado').textContent = 'Guardado';
      pintarLista(); pintarEditor(); F.aviso('Diseños guardados');
    } catch (e) { F.aviso(e.message, 'error'); }
  };
  document.getElementById('cert').onclick = async function (ev) {
    if (ev.target.id === 'subir-cert') {
      var f = document.getElementById('p12').files[0];
      if (!f) return F.aviso('Elige el archivo del certificado', 'error');
      var bytes = new Uint8Array(await f.arrayBuffer()), bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      try {
        estado.certificado = await F.api(base + '/certificado', { method: 'POST', body: { archivo: btoa(bin), clave: document.getElementById('clave-p12').value } });
        F.aviso('Certificado de ' + estado.certificado.titular + ' guardado'); pintarCertificado(); pintarEditor();
      } catch (e) { F.aviso(e.message, 'error'); }
    }
    if (ev.target.id === 'quitar-cert' && confirm('¿Quitar el certificado? Los PDF dejarán de firmarse digitalmente.')) {
      await F.api(base + '/certificado', { method: 'DELETE' }); estado.certificado = null; pintarCertificado(); pintarEditor();
    }
  };
  document.getElementById('tipo-previa').innerHTML = Object.keys(TIPOS).map(function (t) { return '<option value="' + t + '">' + TIPOS[t] + '</option>'; }).join('');
  document.getElementById('tipo-previa').onchange = previa;
  document.getElementById('refrescar').onclick = previa;
  window.addEventListener('beforeunload', function (ev) { if (cambios) { ev.preventDefault(); ev.returnValue = ''; } });

  (async function () {
    try {
      estado = await F.api(base + '/estado');
      disenos = estado.disenos;
      pintarLista(); pintarEditor(); pintarCertificado(); previa();
    } catch (e) { F.aviso(e.message, 'error'); }
  })();
})();
