(function (global) {
  'use strict';
  // 진행축 z를 core.js의 위치 첫 인자(x)에 그대로 전달한다 (좌표 어댑터).

  /* 도선 간격 자동 규칙.
   *   d_auto = min( 0.055λ,  C/κ_max )   → 하한·상한으로 클램프
   * 둘째 항이 새로 붙었다. 도선 열이 연속 도체 벽을 대신하려면 벽을 따라가는 차단 모드의
   * 한 칸당 변화 e^{−κd} 가 충분히 작아야 하고, 그 무차원량 κ·d 에 상한 C 가 있다.
   * 근거와 값은 unified/geometry.js:KAPPA_D_MAX 주석 참조 (측정으로 정했다).
   * opts 를 주지 않으면 종전 규칙 그대로다 — line-wire/higher-order 앱은 영향받지 않는다.
   *
   * opts = { kappaMax, C, minD }
   *   kappaMax : 차단이면서 결합계수가 수치적 0이 아닌 모드의 최대 κ (없으면 둘째 항 미적용)
   *   C        : κ·d 상한
   *   minD     : 하한. 기본은 종전대로 L/Nmax (도선 예산). unified 는 격자 1셀도 함께 건다. */
  function dAutoDetail(lambda, L, Nmax, opts) {
    opts = opts || {};
    var target = 0.055 * lambda, cap = 0.1 * lambda;
    var lo = (opts.minD === undefined) ? (L / Nmax) : opts.minD;
    var d = target, why = '0.055λ';
    if (opts.kappaMax && isFinite(opts.kappaMax) && opts.kappaMax > 0 && opts.C > 0) {
      var dk = opts.C / opts.kappaMax;
      if (dk < d) { d = dk; why = 'C/κ_max'; }
    }
    var clampedLo = false, clampedCap = false;
    if (d < lo)  { d = lo;  clampedLo  = true; why = '하한 ' + lo.toFixed(3); }
    if (d > cap) { d = cap; clampedCap = true; why = '상한 0.1λ'; }
    return { d: d, why: why, clampedLo: clampedLo, clampedCap: clampedCap,
             target: target, cap: cap, minD: lo,
             kappaMax: opts.kappaMax || null, C: opts.C || null };
  }
  function dAuto(lambda, L, Nmax, opts) { return dAutoDetail(lambda, L, Nmax, opts).d; }

  function modeCoefGridN(field, y0, a, n) {
    var Nx = field.Nx, Ny = field.Ny, re = field.re, im = field.im;
    var jBot = Math.round(y0 - a / 2), jTop = Math.round(y0 + a / 2), span = jTop - jBot;
    var out = new Float32Array(Nx);
    if (span < 1) return out;
    for (var i = 0; i < Nx; i++) {
      var sr = 0, si = 0;
      for (var j = jBot; j <= jTop; j++) {
        var w = Math.sin(n * Math.PI * (j - jBot) / span), idx = i * Ny + j;
        sr += re[idx] * w; si += im[idx] * w;
      }
      out[i] = Math.sqrt(sr * sr + si * si) / span;
    }
    return out;
  }
  function modeCoefComplexAtN(field, y0, a, iPix, n) {
    var Ny = field.Ny, re = field.re, im = field.im;
    var jBot = Math.round(y0 - a / 2), jTop = Math.round(y0 + a / 2), span = jTop - jBot;
    var sr = 0, si = 0;
    for (var j = jBot; j <= jTop; j++) {
      var w = Math.sin(n * Math.PI * (j - jBot) / span), idx = iPix * Ny + j;
      sr += re[idx] * w; si += im[idx] * w;
    }
    return [sr / span, si / span];
  }

  function _kc(n, a) { return n * Math.PI / a; }
  function theoryKappa(n, a, k) { var kc = _kc(n, a); return (k < kc) ? Math.sqrt(kc * kc - k * k) : null; }
  function theoryKz(n, a, k) { var kc = _kc(n, a); return (k > kc) ? Math.sqrt(k * k - kc * kc) : null; }
  function theoryPropAmp(n, y0spec, a, k) {
    var kz = theoryKz(n, a, k); if (kz === null || kz < 1e-12) return null;
    return Math.abs(Math.sin(n * Math.PI * y0spec / a)) / kz;
  }

  function fitWindowZ(z0, L, kappaMin) {
    var lo = 0.2 * L, cap = 0.5 * L, zStart;
    if (kappaMin && isFinite(kappaMin) && kappaMin > 0) {
      zStart = z0 + 2 / kappaMin;
      if (zStart < lo) zStart = lo;
      if (zStart > cap) zStart = cap;
    } else {
      zStart = lo; // ⚠ 차단 모드 없음 → 여유 항 미사용 (NaN 방지)
    }
    var zEnd = 0.7 * L;
    return { zStart: zStart, zEnd: zEnd, valid: zEnd > zStart };
  }

  // κ 측정 전용 per-mode 창. core.js의 kappaFitWindow를 그대로 미러하되 resolvable 조건 추가.
  // 물리 근거: 차단 모드는 e^{−κz}. 감쇠길이 1/κ이 도선 간격 d보다 짧으면 인접 도선 사이에서
  // 장이 거의 다 사라져 벽 도선 배열이 감쇠 프로파일을 표현하지 못함 → κ 측정 불가(기울기 비물리).
  function kappaWindowN(L, kappaThy, d) {
    var zStart = 0.15 * L;
    var zEnd = Math.min(0.7 * L, zStart + 2.5 / kappaThy);
    var valid = (zEnd - zStart) > 0 && kappaThy > 0 && isFinite(kappaThy);
    var resolvable = valid && (1 / kappaThy >= d);
    return { zStart: zStart, zEnd: zEnd, valid: valid, resolvable: resolvable };
  }
  function _fitLogSlope(xs, amps) {
    var sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (var i = 0; i < xs.length; i++) {
      if (amps[i] < 1e-14) continue;
      var lv = Math.log(amps[i]); sx += xs[i]; sy += lv; sxx += xs[i] * xs[i]; sxy += xs[i] * lv; n++;
    }
    if (n < 2) return null;
    return (n * sxy - sx * sy) / (n * sxx - sx * sx);
  }
  function measureKappaN(ampArr, xLeft, win) {
    if (!win.valid || !win.resolvable) return null;
    var xs = [], amps = [];
    for (var xc = win.zStart; xc <= win.zEnd; xc += 1) {
      var ip = Math.round(xc) + xLeft; if (ip < 0 || ip >= ampArr.length) continue;
      xs.push(xc); amps.push(ampArr[ip]);
    }
    if (xs.length === 0) return null;
    // 바닥/평탄 가드: 끝 샘플 <= 0 또는 시작/끝 진폭비 < 1.5 (거의 감쇠 안 함)
    var endAmp = amps[amps.length - 1];
    if (endAmp <= 0) return null;
    var startAmp = amps[0];
    if (startAmp > 0 && startAmp / endAmp < 1.5) return null;
    var s = _fitLogSlope(xs, amps);
    if (s === null) return null;
    // 기울기 s >= 0 (비물리: 성장 또는 평탄) → 측정 불가
    if (s >= 0) return null;
    return -s;
  }
  function measureKzN(field, y0, a, n, xLeft, win) {
    if (!win.valid) return null;
    var xs = [], phis = [];
    for (var xc = win.zStart; xc <= win.zEnd; xc += 1) {
      var c = modeCoefComplexAtN(field, y0, a, Math.round(xc) + xLeft, n);
      xs.push(xc); phis.push(Math.atan2(c[1], c[0]));
    }
    if (xs.length < 2) return null;
    for (var i = 1; i < phis.length; i++) {
      while (phis[i] - phis[i - 1] > Math.PI) phis[i] -= 2 * Math.PI;
      while (phis[i] - phis[i - 1] < -Math.PI) phis[i] += 2 * Math.PI;
    }
    var sx = 0, sy = 0, sxx = 0, sxy = 0, m = xs.length;
    for (var j = 0; j < m; j++) { sx += xs[j]; sy += phis[j]; sxx += xs[j] * xs[j]; sxy += xs[j] * phis[j]; }
    return Math.abs((m * sxy - sx * sy) / (m * sxx - sx * sx));
  }

  function wallTransmittanceT(core, a, L, d, aw, k) {
    var wires = [], nW = Math.round(L / d) + 1;
    for (var i = 0; i < nW; i++) wires.push({ x: i * d, y: 0, aw: aw });
    var inc = function (x, y) { return [Math.cos(k * y), Math.sin(k * y)]; }; // +y 진행, 벽에 수직
    var sol = core.solveMoM(wires, k, inc), cre = sol[0], cim = sol[1];
    var yProbe = Math.max(5, Math.round(d));
    var z0 = 0.25 * L, z1 = 0.75 * L, s = 0, cnt = 0;
    for (var z = z0; z <= z1; z += 1) {
      var e = core.totalField(wires, cre, cim, k, inc, z, yProbe);
      s += Math.sqrt(e[0] * e[0] + e[1] * e[1]); cnt++;
    }
    return cnt ? s / cnt : 0;
  }

  function computeScene(core, WG, p) {
    var k = 2 * Math.PI / p.lambda, Nx = p.xLeft + p.L + p.xRight;
    var y0cell = p.y0spec - p.a / 2;
    var incFn = function (x, y) { return core.incLine(k, p.z0, y0cell, x, y); };
    var wires = core.buildWires(p.a, p.L, p.d, p.aw);
    var wiresPix = wires.map(function (w) { return { x: w.x, y: p.y0pix + w.y, aw: w.aw }; });
    var wiresPixDraw = wiresPix.map(function (w) { return { x: w.x + p.xLeft, y: w.y }; });
    var sol = core.solveMoM(wires, k, incFn);
    var table = WG.buildHankelTable(k, Nx + p.Ny + 20);
    var inc = WG.computeIncidentGrid(WG.makeField(Nx, p.Ny), incFn, p.xLeft, p.y0pix);
    var scat = WG.computeScatteredGrid(WG.makeField(Nx, p.Ny), wiresPix, sol[0], sol[1], table, p.xLeft);
    var tot = WG.addComplex(WG.makeField(Nx, p.Ny), inc, scat);
    return {
      Nx: Nx, Ny: p.Ny, k: k, d: p.d, wiresPix: wiresPix, wiresPixDraw: wiresPixDraw,
      cre: sol[0], cim: sol[1], inc: inc, scat: scat, tot: tot,
      info: core.cutoffInfo(p.lambda, p.a), dOverLambda: p.d / p.lambda,
      wallT: wallTransmittanceT(core, p.a, p.L, p.d, p.aw, k)
    };
  }

  var API = { dAuto: dAuto, dAutoDetail: dAutoDetail, modeCoefGridN: modeCoefGridN, modeCoefComplexAtN: modeCoefComplexAtN, theoryKappa: theoryKappa, theoryKz: theoryKz, theoryPropAmp: theoryPropAmp, fitWindowZ: fitWindowZ, kappaWindowN: kappaWindowN, measureKappaN: measureKappaN, measureKzN: measureKzN, wallTransmittanceT: wallTransmittanceT, computeScene: computeScene };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { global.WGM = global.WGM || {}; Object.assign(global.WGM, API); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
