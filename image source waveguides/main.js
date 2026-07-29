(function () {
  'use strict';
  var W = window.WG;
  var Nx = 520, Ny = 220, y0 = 110;
  var x0Const = 130;

  // hRatio = h/a ∈ (0,1) — 소스 높이를 비율로 들고 있어야 a 를 바꿔도 벽 안에 머문다
  var state = { lambda: 160, a: 64, N: 12, hRatio: 0.5, phase: 0, dPhi: 0.15,
                paused: false, modeInfinity: false };
  var MODE_COLORS = ['#7fd6ff', '#6ee7a0', '#ffa657'];   // n=1,2,3 — style.css .m1/.m2/.m3 과 일치

  // MoM 도선관 모형과 같은 시나리오 — 무차원 비율(λ/a, y₀/a)로 정의하고 a 를 곱해 셀로 환산.
  // a=100셀(=10 cm) 기준이면 λ = 240/150/80/55 셀 — 모두 슬라이더 범위(24~250) 안.
  // N=80: λ/a=2.4 의 잘림 간섭은 N 주기 12로 진동하는데 N=40 이 하필 골짜기(κ 76%)라 쓸 수 없다.
  //       N=80 은 κ 106%, 창을 바꿔도 ±1.3%p — 도체판 |E| 도 0.078→0.055 로 실제로 더 수렴한다.
  var PRESETS = [
    { label: '① 완전차단', lamOverA: 2.4,  yOverA: 0.5,    aCell: 100, N: 80 },
    { label: '② 단일모드', lamOverA: 1.5,  yOverA: 0.5,    aCell: 100, N: 80 },
    { label: '③ 2모드',    lamOverA: 0.8,  yOverA: 0.25,   aCell: 100, N: 80 },
    { label: '④ 3모드',    lamOverA: 0.55, yOverA: 1 / 6,  aCell: 100, N: 80 }
  ];

  function applyPreset(p) {
    state.a = p.aCell;
    state.lambda = Math.round(p.lamOverA * p.aCell);
    // 슬라이더 격자(step 0.001)에 맞춰 스냅 — 안 그러면 ④(=1/6) 처럼 슬라이더 위치와 state 가 어긋난다
    state.hRatio = Math.round(p.yOverA * 1000) / 1000;
    state.N = p.N;
    state.modeInfinity = false;
    el('aGap').value = state.a;
    el('lambda').value = state.lambda;
    el('ySrc').value = state.hRatio;
    el('nImg').value = state.N;
    el('modeInf').checked = false;
    el('nImg').disabled = false;
    el('modeInfCaption').style.display = 'none';
    recomputeAll();
  }

  var table = null, incident = null, scattered = null, total = null, scale = 1;
  var cachedAmp = null, cachedModes = null, graphModes = null;
  var fadedImgs = [];

  function ySrc() { return (y0 - state.a / 2) + state.hRatio * state.a; }

  var el = function (id) { return document.getElementById(id); };
  var cvInc = el('cvInc'), cvScat = el('cvScat'), cvTot = el('cvTot'), cvGraph = el('cvGraph');
  var wraps = { inc: cvInc.parentNode, scat: cvScat.parentNode, tot: cvTot.parentNode, graph: cvGraph.parentNode };
  [cvInc, cvScat, cvTot].forEach(function (c) { c.width = Nx; c.height = Ny; });
  cvGraph.width = Nx; cvGraph.height = 220;
  var gInc = cvInc.getContext('2d'), gScat = cvScat.getContext('2d'),
      gTot = cvTot.getContext('2d'), gGraph = cvGraph.getContext('2d');

  function geom() { return { Nx: Nx, Ny: Ny, y0: y0, a: state.a, x0: x0Const, mmPerCell: 1 }; }

  // 셀⁻¹ → cm⁻¹ (셀 = 1 mm = 0.1 cm)
  function perCm(kCell) { return kCell * 10; }

  // n번째 모드의 이론값: 결합 sin(nπh/a), 전파 k_z 또는 차단 κ
  function modeTheory(n) {
    var k = 2 * Math.PI / state.lambda, kc = n * Math.PI / state.a;
    var k2 = k * k, kc2 = kc * kc;
    var prop = k2 > kc2;
    return { n: n,
             coupling: Math.abs(Math.sin(n * Math.PI * state.hRatio)),
             propagating: prop,
             kz: prop ? Math.sqrt(k2 - kc2) : null,
             kappa: prop ? null : Math.sqrt(kc2 - k2) };
  }

  function plateWallAvg(field, y0pos, aCell, x0pos) {
    var fNy = field.Ny, re = field.re, im = field.im;
    var jTop = Math.round(y0pos + aCell / 2);
    var jBot = Math.round(y0pos - aCell / 2);
    var s = 0, cnt = 0;
    var xFrom = Math.max(0, x0pos - 10), xTo = Math.min(field.Nx - 1, x0pos + 10);
    for (var xi = xFrom; xi <= xTo; xi++) {
      var idxT = xi * fNy + jTop, idxB = xi * fNy + jBot;
      s += Math.sqrt(re[idxT] * re[idxT] + im[idxT] * im[idxT]);
      s += Math.sqrt(re[idxB] * re[idxB] + im[idxB] * im[idxB]);
      cnt += 2;
    }
    return cnt > 0 ? s / cnt : 0;
  }

  // 창 [x0+20, x0+70]: 근접장(0~20셀)과 noise floor(x0+80~ 이후) 사이의 sweet spot
  // N=40 기준으로 검증됨 — N 부족 시 κ 오차 >20%가 되어 경고가 표시됨
  // κ 가 큰 고차 모드는 이 창이 통째로 noise floor 에 들어가 기울기가 무의미해질 수 있다
  // (음수 κ 로 드러남) — 그 경우는 modeDiagLine 에서 측정값을 주장하지 않는다.
  function computeFitInterval(amp, x0pos) {
    var xStart = x0pos + 20;
    var xEnd = Math.min(x0pos + 70, amp.length - 1);
    return { xStart: xStart, xEnd: xEnd, valid: (xEnd - xStart) >= 10 };
  }

  // 창의 끝이 이미 잡음 바닥(먼 꼬리의 중앙값)에 닿았으면 기울기가 무의미하다.
  // 깊이 차단된 고차 모드가 그렇다 — 이건 N 을 올려도 안 고쳐지므로 측정을 주장하면 안 된다.
  // (창의 '시작'을 바닥과 비교하면 안 된다 — 멀쩡한 n=1 까지 잘려나간다)
  function fitTrustworthy(amp, fi) {
    var tail = [];
    for (var i = Math.max(fi.xEnd + 1, amp.length - 60); i < amp.length; i++) tail.push(amp[i]);
    if (!tail.length) return true;
    tail.sort(function (p, q) { return p - q; });
    var floor = tail[Math.floor(tail.length / 2)];
    return floor <= 0 || amp[fi.xEnd] > floor * 2;
  }

  // N=∞ 표시용 — 반사 횟수가 클수록 희미해지는 영상 점 목록 (alpha 페이드아웃)
  // generateImages 는 반사 r 마다 2개씩 순서대로 넣으므로 인덱스로 r 을 되짚을 수 있다
  function buildFadedImages() {
    var N_disp = 40;
    var imgs = W.generateImages('A', N_disp, x0Const, y0, state.a, ySrc());
    for (var i = 0; i < imgs.length; i++) {
      var r = Math.floor(i / 2) + 1;
      imgs[i].alpha = Math.max(0.05, 1 - r / (N_disp + 1));
    }
    return imgs;
  }

  function rebuildTable() {
    var k = 2 * Math.PI / state.lambda;
    var rMax = Math.hypot(Nx + x0Const, Ny + state.N * state.a) + 10;
    table = W.buildHankelTable(k, rMax);
  }

  function recomputeAll() {
    rebuildTable();
    var ys = ySrc();
    incident = W.computeField(W.makeField(Nx, Ny), [{ x: x0Const, y: ys, sign: 1 }], table);
    if (state.modeInfinity) {
      total = W.computeModeField(Nx, Ny, y0, state.a, state.lambda, x0Const, 41, ys);
      scattered = W.subtractComplex(W.makeField(Nx, Ny), total, incident);
      fadedImgs = buildFadedImages();
    } else {
      scattered = W.computeField(W.makeField(Nx, Ny),
        W.generateImages('A', state.N, x0Const, y0, state.a, ys), table);
      total = W.addComplex(W.makeField(Nx, Ny), incident, scattered);
      fadedImgs = [];
    }
    afterFieldsSet();
  }

  function afterFieldsSet() {
    // 소스가 지나는 높이에서 재야 스케일이 소스 위치에 따라 흔들리지 않는다 (중앙이면 기존과 동일)
    cachedAmp = W.centerlineAmplitude(total, Math.round(ySrc()));
    cachedModes = [1, 2, 3].map(function (n) { return W.modeCoefficient(total, y0, state.a, n); });
    graphModes = [1, 2, 3].map(function (n) {
      return { arr: cachedModes[n - 1], color: MODE_COLORS[n - 1], kappa: modeTheory(n).kappa };
    });
    var max = 1e-9;
    for (var i = 0; i < cachedAmp.length; i++) if (cachedAmp[i] > max) max = cachedAmp[i];
    scale = max * 0.55;

    var wallAvg = plateWallAvg(total, y0, state.a, x0Const);
    var wallNote = state.modeInfinity
      ? '도체판 위 |E| 평균: ' + wallAvg.toFixed(6) + '  (N=∞ → 이론값 0)'
      : '도체판 위 |E| 평균: ' + wallAvg.toFixed(4) + '  (N ↑ → 0에 수렴)';
    el('plateInfo').textContent = wallNote;

    W.updateOverlays(wraps, geom());
    syncLabels();
  }

  // 모드 한 줄: 결합 sin(nπh/a) + 전파 k_z(이론) 또는 차단 κ(측정/이론 %)
  function modeDiagLine(n) {
    var th = modeTheory(n);
    var txt = '결합 ' + th.coupling.toFixed(3);
    var warn = false;

    if (th.coupling < 0.005) {
      txt += ' — 여기되지 않음(마디 위치)';
    } else if (th.propagating) {
      txt += ' — 전파 k_z = ' + perCm(th.kz).toFixed(4) + ' /cm (이론)';
    } else {
      var arr = cachedModes[n - 1];
      var fi = computeFitInterval(arr, x0Const);
      var meas = (fi && fi.valid && fitTrustworthy(arr, fi))
        ? W.fitExponential(arr, fi.xStart, fi.xEnd) : null;
      if (meas !== null && meas <= 0) meas = null;
      if (meas === null) {
        // N 을 올리라고 하면 거짓말이 된다 — 모드가 잡음 바닥 아래라 측정 자체가 불가능하다
        txt += ' — 차단 κ = ' + perCm(th.kappa).toFixed(4) + ' /cm (이론) · 감쇠가 빨라 측정 불가';
      } else {
        var ratio = meas / th.kappa;
        txt += ' — 차단 κ: 측정 ' + perCm(meas).toFixed(4) +
               ' / 이론 ' + perCm(th.kappa).toFixed(4) + ' /cm  (' + (ratio * 100).toFixed(1) + '%)';
        if (ratio < 0.80 || ratio > 1.20) { txt += '  ⚠ N 증가 권장'; warn = true; }
      }
    }
    return '<div class="mode-diag m' + n + (warn ? ' mode-warn' : '') +
           '"><b>mode ' + n + '</b> · ' + txt + '</div>';
  }

  function syncLabels() {
    var lamCm = state.lambda / 10, aCm = state.a / 10;
    el('lambdaVal').textContent = lamCm.toFixed(1) + ' cm  (λ/a=' +
      (state.lambda / state.a).toFixed(2) + ')';
    el('aVal').textContent = aCm.toFixed(1) + ' cm  (2a = ' + (aCm * 2).toFixed(1) + ' cm)';
    el('ySrcVal').textContent = (state.hRatio * aCm).toFixed(1) + ' cm  (y₀/a=' +
      state.hRatio.toFixed(3) + ')';
    el('nVal').textContent = state.modeInfinity ? '∞ (모드 합)' : state.N + ' 쌍';

    var freqHz = 3e11 / state.lambda;          // 셀 = 1 mm
    var freqStr = freqHz >= 1e9
      ? (freqHz / 1e9).toFixed(2) + ' GHz'
      : Math.round(freqHz / 1e6) + ' MHz';
    el('freqInfo').textContent = '자유공간 주파수 f = c/λ:  ' + freqStr;

    var info = W.cutoffInfo(state.lambda, state.a);
    el('cutoffBadge').textContent = info.evanescent
      ? '차단: λ > 2a → 지수 감쇠'
      : '전파: λ < 2a → 모드 진행';

    el('modeDiag').innerHTML = modeDiagLine(1) + modeDiagLine(2) + modeDiagLine(3);
  }

  function render() {
    if (!state.paused) state.phase += state.dPhi;
    W.drawField(gInc, incident, scale, state.phase);
    W.drawField(gScat, scattered, scale, state.phase);
    W.drawField(gTot, total, scale, state.phase);
    var g = geom();
    if (state.modeInfinity) W.drawExternalMask(gTot, g);  // ③에만, N=∞일 때만
    W.drawPlates(gInc, g); W.drawPlates(gScat, g); W.drawPlates(gTot, g);
    var orig = { x: x0Const, y: ySrc() };
    var imgs = state.modeInfinity
      ? fadedImgs : W.generateImages('A', state.N, x0Const, y0, state.a, ySrc());
    W.drawSourceDots(gInc, [], orig, g);
    W.drawSourceDots(gScat, imgs, null, g);
    W.drawSourceDots(gTot, imgs, orig, g);
    W.drawModeGraph(gGraph, graphModes, x0Const, g);
    requestAnimationFrame(render);
  }

  el('lambda').addEventListener('input', function (e) {
    state.lambda = +e.target.value;      // mm → 셀 (셀 = 1 mm)
    recomputeAll();
  });
  el('aGap').addEventListener('input', function (e) {
    state.a = +e.target.value;           // mm → 셀 (셀 = 1 mm)
    recomputeAll();
  });
  el('ySrc').addEventListener('input', function (e) {
    state.hRatio = +e.target.value;
    recomputeAll();
  });
  el('centerBtn').addEventListener('click', function () {
    state.hRatio = 0.5;
    el('ySrc').value = 0.5;
    recomputeAll();
  });
  Array.prototype.forEach.call(document.getElementsByClassName('preset'), function (btn) {
    btn.addEventListener('click', function () {
      applyPreset(PRESETS[+btn.getAttribute('data-preset')]);
      Array.prototype.forEach.call(document.getElementsByClassName('preset'), function (b) {
        b.className = (b === btn) ? 'preset active' : 'preset';
      });
    });
  });
  el('nImg').addEventListener('input', function (e) {
    state.N = +e.target.value; recomputeAll(); el('nImg').value = state.N;
  });
  el('modeInf').addEventListener('change', function (e) {
    state.modeInfinity = e.target.checked;
    el('nImg').disabled = state.modeInfinity;
    el('modeInfCaption').style.display = state.modeInfinity ? 'block' : 'none';
    recomputeAll();
  });
  el('speed').addEventListener('input', function (e) {
    state.dPhi = +e.target.value;
    el('speedVal').textContent = (+e.target.value).toFixed(2) + ' rad/f';
  });
  el('pauseBtn').addEventListener('click', function () {
    state.paused = !state.paused;
    el('pauseBtn').textContent = state.paused ? '▶ 재개' : '⏸ 일시정지';
  });

  recomputeAll();
  requestAnimationFrame(render);
})();
