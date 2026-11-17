(function () {
  var F = window.Facturador;
  var base = '/api/p/temas';
  var estado = null;

  function miniatura(t) {
    var c = t.claro, m = t.mosaicos || {};
    var r = Math.min(t.radio || 0, 10) + 'px';
    var fondo = t.fondo_app ? t.fondo_app + ',' : '';
    var alfa = t.cristal ? 'cc' : '';
    var menu = t.menu === 'superior'
      ? '<div class="menu-arriba" style="background:' + c.surface + '"><i style="background:' + c.fg + '"></i><i style="background:' + c.fg + '"></i><i style="background:' + c.fg + '"></i></div>'
      : '<div class="lateral" style="background:' + c.surface + alfa + ';border-right:1px solid ' + (c.stroke || '#ddd') + '"><i style="background:' + c['brand-fg'] + ';opacity:1"></i><i style="background:' + c.fg + '"></i><i style="background:' + c.fg + '"></i><i style="background:' + c.fg + '"></i></div>';
    var tiles = ['blue', 'teal', 'purple'].map(function (k) { return '<b style="background:' + (m[k] || c.brand) + ';border-radius:' + r + '"></b>'; }).join('');
    return '<div class="mini' + (t.menu === 'superior' ? ' arriba' : '') + '" style="background:' + fondo + c.canvas + ';font-family:' + F.escapar(t.fuente || 'inherit') + '">' +
      '<div class="barra" style="background:' + c.suite + ';color:' + (c['suite-fg'] || '#fff') + '">Facturador</div>' +
      '<div class="cuerpo">' + menu + '<div class="zona">' + tiles +
      '<span class="tarjeta" style="background:' + c.surface + alfa + ';border-radius:' + r + ';box-shadow:' + (t.sombra === 'ninguna' ? 'none' : '0 1px 3px rgba(0,0,0,.18)') + (t.relieve ? ';border:2px outset #fff' : '') + '"></span>' +
      '</div></div></div>';
  }

  function pintar() {
    document.getElementById('galeria').innerHTML = estado.temas.map(function (t) {
      var activo = t.id === estado.activo;
      return '<div class="tema' + (activo ? ' activo' : '') + '">' + miniatura(t) +
        '<div class="info"><strong>' + F.escapar(t.nombre) + (activo ? ' <span class="fx-etiqueta">En uso</span>' : '') + (t.propio ? ' <span class="fx-etiqueta">Propio</span>' : '') + '</strong>' +
        '<p>' + F.escapar(t.descripcion || '') + '</p></div>' +
        '<div class="acciones">' + (activo ? '' : '<button class="fx-btn fx-btn-primario" data-aplicar="' + t.id + '">Aplicar</button>') +
        '<button class="fx-btn" data-exportar="' + t.id + '">Exportar</button>' +
        (t.propio ? '<button class="fx-btn fx-btn-peligro" data-borrar="' + t.id + '">Borrar</button>' : '') + '</div></div>';
    }).join('');
    document.getElementById('fondos').innerHTML = estado.fondos.map(function (u) {
      return '<div class="fondo"><img src="' + u + '" alt="Foto de inicio de sesión" /><button class="fx-btn fx-btn-peligro" data-quitar="' + u.split('/').pop() + '">Quitar</button></div>';
    }).join('') || '<p class="fx-nota">Sin fotos: se muestra el diseño por defecto.</p>';
    var f = document.getElementById('form-login');
    f.intervalo.value = estado.intervalo; f.texto_login.value = estado.texto_login || '';
  }

  async function cargar() {
    try { estado = await F.api(base + '/temas'); pintar(); } catch (e) { F.aviso(e.message, 'error'); }
  }

  document.getElementById('galeria').onclick = async function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.aplicar) {
        await F.api(base + '/activo', { method: 'PUT', body: { id: b.dataset.aplicar } });
        window.top.location.reload(); // la app vuelve a cargar con el tema nuevo
      }
      if (b.dataset.exportar) {
        var t = estado.temas.find(function (x) { return x.id === b.dataset.exportar; });
        var copia = Object.assign({}, t); delete copia.propio;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(copia, null, 2)], { type: 'application/json' }));
        a.download = 'tema-' + t.id + '.json'; a.click();
      }
      if (b.dataset.borrar && confirm('¿Borrar el tema «' + b.dataset.borrar + '»?')) {
        await F.api(base + '/propios/' + b.dataset.borrar, { method: 'DELETE' }); await cargar();
      }
    } catch (e) { F.aviso(e.message, 'error'); }
  };
  document.getElementById('importar').onchange = async function () {
    var f = this.files[0]; if (!f) return;
    try {
      var t = JSON.parse(await f.text());
      await F.api(base + '/importar', { method: 'POST', body: t });
      F.aviso('Tema «' + (t.nombre || t.id) + '» importado'); await cargar();
    } catch (e) { F.aviso(e instanceof SyntaxError ? 'El archivo no es un JSON válido' : e.message, 'error'); }
    this.value = '';
  };
  document.getElementById('subir-fondo').onchange = async function () {
    for (var i = 0; i < this.files.length; i++) {
      var f = this.files[i];
      try { await F.api(base + '/fondos', { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } }); }
      catch (e) { F.aviso(f.name + ': ' + e.message, 'error'); }
    }
    this.value = ''; await cargar();
  };
  document.getElementById('fondos').onclick = async function (ev) {
    var b = ev.target.closest('button[data-quitar]'); if (!b) return;
    try { await F.api(base + '/fondos/' + b.dataset.quitar, { method: 'DELETE' }); await cargar(); } catch (e) { F.aviso(e.message, 'error'); }
  };
  document.getElementById('form-login').onsubmit = async function (ev) {
    ev.preventDefault();
    try { await F.api(base + '/login', { method: 'PUT', body: { intervalo: this.intervalo.value, texto_login: this.texto_login.value } }); F.aviso('Guardado'); }
    catch (e) { F.aviso(e.message, 'error'); }
  };
  cargar();
})();
