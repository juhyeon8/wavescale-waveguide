(function (global) {
  'use strict';
  function makeField(Nx, Ny) {
    return { re: new Float32Array(Nx * Ny), im: new Float32Array(Nx * Ny), Nx: Nx, Ny: Ny };
  }
  // 도선 하나의 복소 산란장 누적: E += c_j·H0(k r)
  function addWireSource(field, wire, cre_j, cim_j, table, xLeft) {
    var Nx = field.Nx, Ny = field.Ny, re = field.re, im = field.im;
    var sx = wire.x + xLeft, sy = wire.y, aw = wire.aw;
    var tre = table.re, tim = table.im, kdx = table.k / table.dx, maxn = table.n;
    for (var i = 0; i < Nx; i++) {
      var dx = i - sx, dx2 = dx * dx, base = i * Ny;
      for (var j = 0; j < Ny; j++) {
        var dy = j - sy;
        var r = Math.sqrt(dx2 + dy * dy);
        if (r < aw) r = aw;                 // 자기 표면 클램프 (H0 발산 방지)
        var f = r * kdx, n = f | 0; if (n >= maxn) n = maxn - 1;
        var t = f - n;
        var hre = tre[n] + (tre[n + 1] - tre[n]) * t;
        var him = tim[n] + (tim[n + 1] - tim[n]) * t;
        var idx = base + j;
        re[idx] += cre_j * hre - cim_j * him;
        im[idx] += cre_j * him + cim_j * hre;
      }
    }
    return field;
  }
  function computeScatteredGrid(field, wiresPix, cre, cim, table, xLeft) {
    for (var j = 0; j < wiresPix.length; j++)
      addWireSource(field, wiresPix[j], cre[j], cim[j], table, xLeft);
    return field;
  }
  // 입사장: 셀좌표(iPix−xLeft, jPix−y0 아님 — 입사함수는 셀 x,y를 받음)
  // incFnCell(xCell, yCell) → [re,im]
  function computeIncidentGrid(field, incFnCell, xLeft, y0) {
    var Nx = field.Nx, Ny = field.Ny, re = field.re, im = field.im;
    for (var i = 0; i < Nx; i++) {
      var xCell = i - xLeft, base = i * Ny;
      for (var j = 0; j < Ny; j++) {
        var yCell = j - y0;
        var e = incFnCell(xCell, yCell);
        var idx = base + j;
        re[idx] = e[0]; im[idx] = e[1];
      }
    }
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
  var API = { makeField: makeField, addWireSource: addWireSource,
              computeScatteredGrid: computeScatteredGrid,
              computeIncidentGrid: computeIncidentGrid,
              addComplex: addComplex, subtractComplex: subtractComplex };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { global.WG = global.WG || {}; Object.assign(global.WG, API); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
