(function (global) {
  'use strict';

  function makeField(Nx, Ny) {
    return { re: new Float32Array(Nx * Ny), im: new Float32Array(Nx * Ny),
             Nx: Nx, Ny: Ny };
  }

  function addOneSource(field, src, table) {
    var Nx = field.Nx, Ny = field.Ny, re = field.re, im = field.im;
    var sx = src.x, sy = src.y, sg = src.sign;
    var tre = table.re, tim = table.im, kdx = table.k / table.dx, maxn = table.n;
    for (var i = 0; i < Nx; i++) {
      var dx = i - sx, dx2 = dx * dx, base = i * Ny;
      for (var j = 0; j < Ny; j++) {
        var dy = j - sy;
        var r = Math.sqrt(dx2 + dy * dy);
        var f = r * kdx;                 // = k·r/dx (테이블 인덱스)
        var n = f | 0; if (n >= maxn) n = maxn - 1;
        var t = f - n;
        var idx = base + j;
        re[idx] += sg * (tre[n] + (tre[n + 1] - tre[n]) * t);
        im[idx] += sg * (tim[n] + (tim[n + 1] - tim[n]) * t);
      }
    }
    return field;
  }

  function computeField(field, sources, table) {
    for (var s = 0; s < sources.length; s++) addOneSource(field, sources[s], table);
    return field;
  }

  function addComplex(dst, a, b) {
    var re = dst.re, im = dst.im, are = a.re, aim = a.im, bre = b.re, bim = b.im;
    for (var i = 0; i < re.length; i++) { re[i] = are[i] + bre[i]; im[i] = aim[i] + bim[i]; }
    return dst;
  }

  function subtractComplex(dst, a, b) {
    var re = dst.re, im = dst.im, are = a.re, aim = a.im, bre = b.re, bim = b.im;
    for (var i = 0; i < re.length; i++) { re[i] = are[i] - bre[i]; im[i] = aim[i] - bim[i]; }
    return dst;
  }

  var API = { makeField: makeField, addOneSource: addOneSource,
              computeField: computeField, addComplex: addComplex,
              subtractComplex: subtractComplex };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { global.WG = global.WG || {}; Object.assign(global.WG, API); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
