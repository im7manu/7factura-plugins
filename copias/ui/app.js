(function () {
  var F = window.Facturador;
  var base = '/api/p/copias';
  var tamano = function (b) { return b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; };
  var fecha = function (iso) { return new Date(iso).toLocaleString('es-ES'); };

  async function cargar() {
    try {
      var e = await F.api(base + '/estado');
      var form = document.getElementById('form-ajustes');
      form.dia.value = e.ajustes.dia; form.hora.value = e.ajustes.hora; form.conservar.value = e.ajustes.conservar;
      document.getElementById('resumen').textContent = e.copias.length
        ? e.copias.length + ' copias · la última, ' + fecha(e.ultima.fecha)
        : 'Todavía no hay ninguna copia.';
      var aviso = document.getElementById('aviso');
      if (e.dias_desde_ultima == null || e.dias_desde_ultima > 7) {
        aviso.hidden = false; aviso.className = 'fx-card aviso';
        aviso.textContent = e.dias_desde_ultima == null ? 'No hay ninguna copia de seguridad. Haz una ahora.' : 'La última copia tiene ' + e.dias_desde_ultima + ' días.';
      } else { aviso.hidden = true; }
      document.getElementById('lista').innerHTML = e.copias.map(function (c) {
        var n = F.escapar(c.nombre);
        return '<tr><td>' + fecha(c.fecha) + '</td><td>' + (c.manual ? 'Manual' : 'Automática') + '</td><td>' + tamano(c.tamano) + '</td>' +
          '<td class="acciones"><a class="fx-btn" href="' + base + '/copias/' + n + '">Descargar ZIP</a>' +
          '<button class="fx-btn fx-btn-peligro" data-restaurar="' + n + '">Restaurar</button>' +
          '<button class="fx-btn" data-borrar="' + n + '">Borrar</button></td></tr>';
      }).join('') || '<tr><td colspan="4" class="fx-nota">Sin copias.</td></tr>';
    } catch (err) { F.aviso(err.message, 'error'); }
  }

  function esperarReinicio() {
    document.body.innerHTML = '<div class="fx-card"><h2>Restaurando la copia…</h2><p>La aplicación se está reiniciando. Esta página se recargará sola.</p></div>';
    var intentos = 0;
    var t = setInterval(async function () {
      intentos++;
      try { await fetch('/api/estado'); clearInterval(t); window.top.location.href = '/'; } catch (e) { if (intentos > 60) clearInterval(t); }
    }, 2000);
  }

  document.getElementById('crear').onclick = async function () {
    this.disabled = true;
    try { var r = await F.api(base + '/copias', { method: 'POST', body: {} }); F.aviso('Copia creada: ' + r.nombre); await cargar(); }
    catch (e) { F.aviso(e.message, 'error'); }
    this.disabled = false;
  };
  document.getElementById('form-ajustes').onsubmit = async function (ev) {
    ev.preventDefault();
    try { await F.api(base + '/ajustes', { method: 'PUT', body: { dia: this.dia.value, hora: this.hora.value, conservar: this.conservar.value } }); F.aviso('Guardado'); }
    catch (e) { F.aviso(e.message, 'error'); }
  };
  document.getElementById('lista').onclick = async function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.borrar && confirm('¿Borrar la copia ' + b.dataset.borrar + '?')) {
      try { await F.api(base + '/copias/' + b.dataset.borrar, { method: 'DELETE' }); await cargar(); } catch (e) { F.aviso(e.message, 'error'); }
    }
    if (b.dataset.restaurar && confirm('Se sustituirán TODOS los datos actuales por los de esta copia. ¿Continuar?')) {
      try { await F.api(base + '/restaurar/' + b.dataset.restaurar, { method: 'POST', body: {} }); esperarReinicio(); } catch (e) { F.aviso(e.message, 'error'); }
    }
  };
  document.getElementById('restaurar-archivo').onclick = async function () {
    var f = document.getElementById('archivo').files[0];
    if (!f) return F.aviso('Elige el ZIP de la copia', 'error');
    if (!confirm('Se sustituirán TODOS los datos actuales por los de «' + f.name + '». ¿Continuar?')) return;
    try { await F.api(base + '/restaurar', { method: 'POST', body: f, headers: { 'Content-Type': 'application/zip' } }); esperarReinicio(); }
    catch (e) { F.aviso(e.message, 'error'); }
  };
  cargar();
})();
