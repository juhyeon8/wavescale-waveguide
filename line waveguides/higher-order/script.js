(function () {
  'use strict';
  var core = WireWG;
  var CFG = { a: 60, L: 300, xLeft: 110, xRight: 110, Ny: 220, y0pix: 110, aw: 0.8, Nmax: 420, z0: 36 };
  var state = { lambda: 90, y0spec: 30, dManual: 5, dAutoOn: true, phase: 0, dPhi: 0.15, paused: false };
  var el = function (id) { return document.getElementById(id); };
  var cvInc = el('cvInc'), cvTot = el('cvTot'), cvScat = el('cvScat');

  function currentD() {
    return state.dAutoOn ? WGM.dAuto(state.lambda, CFG.L, CFG.Nmax) : state.dManual;
  }
  function geom(s) { return { Nx: s.Nx, Ny: s.Ny, y0: CFG.y0pix, a: CFG.a, xLeft: CFG.xLeft, L: CFG.L }; }
  function rebuild() {
    var p = { lambda: state.lambda, a: CFG.a, L: CFG.L, d: currentD(), y0spec: state.y0spec,
      aw: CFG.aw, xLeft: CFG.xLeft, xRight: CFG.xRight, Ny: CFG.Ny, y0pix: CFG.y0pix, z0: CFG.z0 };
    var s = WGM.computeScene(core, WG, p);
    [cvInc, cvTot, cvScat].forEach(function (cv) { cv.width = s.Nx; cv.height = s.Ny; });
    WG.updateOverlays({ inc: cvInc.parentNode, scat: cvScat.parentNode, tot: cvTot.parentNode }, geom(s));
    window.__scene = s;
    if (window.__afterRebuild) window.__afterRebuild(s);
  }

  // 표시는 모두 cm (1칸=1mm → cm = 셀/10). λ/a는 자동 계산.
  function syncReadouts() {
    var lam = state.lambda, y0 = state.y0spec, d = currentD(), a = CFG.a;
    el('aVal').textContent = (a / 10).toFixed(1) + ' cm';
    el('lambdaVal').textContent = (lam / 10).toFixed(1) + ' cm (λ/a=' + (lam / a).toFixed(2) + ')';
    el('y0Val').textContent = (y0 / 10).toFixed(1) + ' cm (y₀/a=' + (y0 / a).toFixed(2) + ')';
    el('dVal').textContent = (d / 10).toFixed(2) + ' cm (d/λ=' + (d / lam).toFixed(3) + ')';
    el('dWire').disabled = state.dAutoOn;
    if (state.dAutoOn) el('dWire').value = Math.round(d); // 자동일 땐 슬라이더 손잡이도 자동값 반영
  }
  var timer = null;
  function scheduleRebuild() { if (timer) clearTimeout(timer);
    timer = setTimeout(function () { rebuild(); timer = null; }, 150); }
  function rebuildNow() { if (timer) { clearTimeout(timer); timer = null; } rebuild(); }
  el('aWidth').addEventListener('input', function (e) {
    CFG.a = (+e.target.value) * 10;                 // cm → 셀
    state.y0spec = (+el('y0').value) * CFG.a;        // y₀는 a에 대한 비율 유지
    syncReadouts(); scheduleRebuild(); });
  el('lambda').addEventListener('input', function (e) {
    state.lambda = (+e.target.value) * 10; syncReadouts(); scheduleRebuild(); });
  el('y0').addEventListener('input', function (e) {
    state.y0spec = (+e.target.value) * CFG.a; syncReadouts(); scheduleRebuild(); });
  el('centerBtn').addEventListener('click', function () {
    state.y0spec = CFG.a / 2; el('y0').value = 0.5; syncReadouts(); rebuildNow(); });
  el('dWire').addEventListener('input', function (e) {
    state.dManual = +e.target.value; syncReadouts(); scheduleRebuild(); });
  el('dAuto').addEventListener('change', function (e) {
    if (!e.target.checked) state.dManual = Math.round(currentD()); // 자동→수동: 현재 자동값 이어받아 급변 방지
    state.dAutoOn = e.target.checked; syncReadouts(); rebuildNow(); });
  el('pauseBtn').addEventListener('click', function () {
    state.paused = !state.paused; el('pauseBtn').textContent = state.paused ? '▶ 재개' : '⏸ 일시정지'; });
  el('speed').addEventListener('input', function (e) { state.dPhi = +e.target.value; });

  function applyPreset(id) {
    var m = { '1': [2.4, null], '2': [1.5, null], '3': [0.8, 0.25], '4': [0.55, 1 / 6] };
    var v = m[id];
    state.lambda = v[0] * CFG.a;                      // 현재 a 유지, λ=비율×a
    el('lambda').value = (state.lambda / 10).toFixed(1);
    if (v[1] !== null) { state.y0spec = v[1] * CFG.a; el('y0').value = v[1]; }
    else { state.y0spec = (+el('y0').value) * CFG.a; }
    syncReadouts(); rebuildNow();
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
    b.addEventListener('click', function () { applyPreset(b.getAttribute('data-preset')); });
  });
  state.lambda = 1.5 * CFG.a; state.y0spec = 0.5 * CFG.a; syncReadouts();

  function autoScale(field) {
    var Ny = field.Ny, re = field.re, im = field.im, mx = 1e-6;
    var i0 = CFG.xLeft, i1 = CFG.xLeft + Math.round(0.4 * CFG.L);
    for (var i = i0; i < i1; i++) for (var j = 0; j < Ny; j++) {
      var idx = i * Ny + j, v = Math.sqrt(re[idx] * re[idx] + im[idx] * im[idx]);
      if (v > mx) mx = v;
    }
    return mx;
  }
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame() {
    var s = window.__scene;
    if (s) {
      if (!state.paused && !reduce) state.phase += state.dPhi;
      var g = geom(s), sc = autoScale(s.tot); // §2 공통 스케일 = tot 기준, 세 패널 동일
      WG.drawField(cvInc.getContext('2d'), s.inc, sc, state.phase);
      WG.drawField(cvTot.getContext('2d'), s.tot, sc, state.phase);
      WG.drawField(cvScat.getContext('2d'), s.scat, sc, state.phase);
      var gi = cvInc.getContext('2d'), gt = cvTot.getContext('2d'), gs = cvScat.getContext('2d');
      WG.drawPlatesWire(gi, g); WG.drawPlatesWire(gt, g); WG.drawPlatesWire(gs, g);
      WG.drawWireDots(gt, s.wiresPixDraw, s.cre, s.cim, state.phase, sc, s.Ny);
      WG.drawWireDots(gs, s.wiresPixDraw, s.cre, s.cim, state.phase, sc, s.Ny);
    }
    requestAnimationFrame(frame);
  }

  function renderReadouts(s) {
    var a = CFG.a, k = s.k, y0spec = state.y0spec, xLeft = CFG.xLeft, y0pix = CFG.y0pix, L = CFG.L;
    var html = '<div class="rd"><b>벽 무결성</b>: 누설 |T|=' + s.wallT.toFixed(3) +
      ' , d/λ=' + s.dOverLambda.toFixed(3) +
      (s.dOverLambda > 0.1 || s.wallT > 0.35 ? ' <span class="warn">⚠ 벽 근사 무너짐</span>' : '') +
      ' — 차단 κ 정확도는 |T|보다 엄격(모드 분해 신뢰 d/λ≲0.06)' + '</div>';
    html += '<div class="tcap">└ T = 도선 벽이 새는 정도. 0에 가까울수록 연속 도체판에 가까움(모드 분해 신뢰). 클수록 도선 틈으로 장이 샘.</div>';
    [1, 2, 3].forEach(function (n) {
      var coup = Math.abs(Math.sin(n * Math.PI * y0spec / a));
      var line = '<div class="rd mode' + n + '"><b>mode ' + n +
        '</b> · 결합 ' + coup.toFixed(3);
      if (coup < 0.02) { line += ' — <b>여기되지 않음(마디 위치)</b>'; }
      else {
        var kz = WGM.theoryKz(n, a, k), kap = WGM.theoryKappa(n, a, k);
        var kappas = [1, 2, 3].map(function (m) { return WGM.theoryKappa(m, a, k); }).filter(function (v) { return v; });
        var kappaMin = kappas.length ? Math.min.apply(null, kappas) : null;
        var win = WGM.fitWindowZ(CFG.z0, L, kappaMin);
        if (kz) {
          var mkz = WGM.measureKzN(s.tot, y0pix, a, n, xLeft, win);
          line += ' — 전파 k_z: 측정 ' + (mkz != null ? mkz.toFixed(4) : '—') + ' / 이론 ' + kz.toFixed(4) +
            (mkz != null ? ' (' + (mkz / kz * 100).toFixed(0) + '%)' : '');
        } else if (kap) {
          var amp2 = WGM.modeCoefGridN(s.tot, y0pix, a, n);
          var kwin = WGM.kappaWindowN(L, kap, s.d);
          var mkap = WGM.measureKappaN(amp2, xLeft, kwin);
          if (mkap != null) {
            line += ' — 차단 κ: 측정 ' + mkap.toFixed(4) + ' / 이론 ' + kap.toFixed(4) +
              ' (' + (mkap / kap * 100).toFixed(0) + '%)';
          } else if (!kwin.resolvable) {
            line += ' — 차단 κ 이론 ' + kap.toFixed(4) + ' — <b>측정 불가</b>(감쇠길이 1/κ=' +
              (0.1 / kap).toFixed(2) + ' cm < 도선간격 d=' + (s.d / 10).toFixed(2) + ' cm, 분해능 한계)';
          } else {
            line += ' — 차단 κ 이론 ' + kap.toFixed(4) + ' — <b>측정 불가</b>(수치 바닥/분해능 한계)';
          }
        }
      }
      html += line + '</div>';
    });
    el('readouts').innerHTML = html;
  }

  // 그래프 캔버스 백킹 해상도를 실제 표시 크기 × dpr로 맞춰 선명하게
  function fitGraph() {
    var cv = el('cvGraph'), dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
  window.addEventListener('resize', function () {
    if (window.__scene) { fitGraph(); WG.drawModeGraph(el('cvGraph').getContext('2d'), window.__scene, CFG); }
  });

  window.__hoState = state; window.__hoRebuild = rebuild; window.__hoCFG = CFG; window.__hoCurrentD = currentD;
  window.__afterRebuild = function (s) {
    fitGraph();
    WG.drawModeGraph(el('cvGraph').getContext('2d'), s, CFG);
    renderReadouts(s);
  };
  rebuild(); requestAnimationFrame(frame);
  requestAnimationFrame(function () { if (window.__scene) { fitGraph(); WG.drawModeGraph(el('cvGraph').getContext('2d'), window.__scene, CFG); } });
})();
