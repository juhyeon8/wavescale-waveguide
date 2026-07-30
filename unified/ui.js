(function (global) {
  'use strict';
  var GEO = global.GEO, M = global.Measure, AD = global.Adapters, R = global.Render;
  var el = function (id) { return document.getElementById(id); };
  var DEBUG = /[?&]debug=1/.test(location.search);

  // 내부는 셀(=mm), UI는 cm. 변환은 이 파일에서만 한다. (v1 §12-5)
  var cm = function (cell) { return cell / 10; };

  var state = {
    a: 60, lambda: 144, y0OverA: 0.500,
    N: GEO.N, cesaro: GEO.CESARO, awAuto: GEO.AW_AUTO, aw: GEO.aw, scatBand: GEO.SCAT_BAND,
    dAutoOn: true, dManual: 5,
    gamma: 0.4, phase: 0, dPhi: 0.15, paused: false, singleScale: false
  };

  var PRESETS = [
    { label: '① 완전차단  a=6.0 · λ=2.4a', a: 60, lambda: 144, y0OverA: 0.500 },
    { label: '② 단일모드  a=6.0 · λ=1.5a', a: 60, lambda:  90, y0OverA: 0.500 },
    { label: '③ 2모드     a=6.0 · λ=0.8a', a: 60, lambda:  48, y0OverA: 0.250 },
    { label: '④ 3모드     a=6.0 · λ=0.55a', a: 60, lambda: 33, y0OverA: 0.167 }
  ];

  function currentD() { return state.dAutoOn ? AD.dAuto(state.lambda) : state.dManual; }

  /* ---------------- 계산 ---------------- */
  var scenes = null, scales = null, timing = null, rulerS = null;

  function recompute() {
    var t0 = performance.now();
    var p = { lambda: state.lambda, a: state.a, y0OverA: state.y0OverA };

    var si = AD.imageScene(Object.assign({}, p, { N: state.N, cesaro: state.cesaro,
                                                  scatBand: state.scatBand }));
    var t1 = performance.now();
    var sw = AD.wireScene(Object.assign({}, p, {
      d: currentD(), awAuto: state.awAuto, aw: state.aw }));
    var t2 = performance.now();

    scenes = { image: si, wire: sw };

    // 측정 — 탭 4가 쓸 값. 여기서 한 번만 재고 캐시한다.
    var k = 2 * Math.PI / state.lambda;
    var kmin = M.kappaMinOfCutoff(state.a, k, 3);
    var meas = [1, 2, 3].map(function (n) {
      var kap = M.theoryKappa(n, state.a, k), kz = M.theoryKz(n, state.a, k);
      var row = { n: n, coupling: M.coupling(n, state.y0OverA), kappa: kap, kz: kz };
      ['image', 'wire'].forEach(function (key) {
        var d = key === 'wire' ? currentD() : 1;
        row[key] = (kap !== null)
          ? M.measureKappa(scenes[key].tot, state.a, n, GEO.KAPPA_WIN, d, kap)
          : M.measureKz(scenes[key].tot, state.a, n, kz, kmin);
      });
      return row;
    });
    var t3 = performance.now();

    // 행별 스케일 — 각 행마다 하나, 좌우 두 장의 최댓값 (v1 §9-2)
    scales = {};
    ['inc', 'scat', 'tot'].forEach(function (row) {
      scales[row] = R.rowScale(si[row], sw[row], state.a);
    });
    if (state.singleScale) {
      var one = Math.max(scales.inc, scales.scat, scales.tot);
      scales = { inc: one, scat: one, tot: one };
    }
    rulerS = R.rulerSpec(state.a, state.lambda);

    timing = { image: t1 - t0, wire: t2 - t1, measure: t3 - t2, render: 0, total: 0 };
    markDirty();
    window.__meas = meas;
    syncReadouts(meas);
    drawFrame();          // rAF를 기다리지 않는다 (창이 숨겨져 있어도 그림이 남는다)
  }

  /* ---------------- 렌더 ---------------- */
  var CTX = {}, dirty = true;
  function ctxOf(id) { return CTX[id] || (CTX[id] = el(id).getContext('2d')); }
  function markDirty() { dirty = true; }

  // rAF는 창이 숨겨지면 아예 실행되지 않는다. 첫 프레임은 기다리지 않고 직접 그린다.
  function render() {
    // 정지 중이고 바뀐 것이 없으면 다시 그리지 않는다 (CPU 절약 + 화면이 안정되어 캡처 가능)
    if (!scenes || (state.paused && !dirty)) { requestAnimationFrame(render); return; }
    if (!state.paused) state.phase += state.dPhi;
    drawFrame();
    requestAnimationFrame(render);
  }

  function drawFrame() {
    if (!scenes) return;
    dirty = false;
    var t0 = performance.now();
    var dbg = { panels: {} };

    ['inc', 'scat', 'tot'].forEach(function (row) {
      ['image', 'wire'].forEach(function (side) {
        var id = 'cv-' + row + '-' + side;
        var opts = (row === 'tot') ? { ruler: rulerS } : {};
        var info = R.drawPanel(ctxOf(id), scenes[side], row, scales[row], state.gamma, state.phase, opts);
        if (DEBUG) dbg.panels[id] = info;
      });
      el('scale-' + row).textContent = scales[row].toExponential(3);
    });

    var t1 = performance.now();
    timing.render = t1 - t0;
    timing.total = timing.image + timing.wire + timing.measure + timing.render;
    el('timer').textContent =
      '계산 시간:  영상법 ' + timing.image.toFixed(0) + 'ms · 도선관 ' + timing.wire.toFixed(0) +
      'ms · 측정 ' + timing.measure.toFixed(0) + 'ms · 렌더 ' + timing.render.toFixed(0) +
      'ms · 합계 ' + timing.total.toFixed(0) + 'ms';

    if (DEBUG) dumpDebug(dbg);
  }

  /* ---------------- ?debug=1 텍스트 출력 ---------------- */
  var dbgFrames = 0;
  function dumpDebug(dbg) {
    if (dbgFrames++ % 30 !== 0) return;              // 30프레임마다 한 번만 갱신
    var L = [];

    // ── 배치 실측 (진단) ──
    L.push('── 배치 ──');
    layoutProbe().forEach(function (s) { L.push(s); });
    L.push('── 장 ──');

    var qi = scenes.image.quality;
    L.push('산란장 계산 범위: j=[' + qi.jBot + ',' + qi.jTop + '] (' + GEO.Ny + '행 중 ' +
           qi.bandRows + '행)' + (qi.scatBand ? '' : '  ← 벽 사이 제한 OFF (전 영역, 대조용)'));

    ['image', 'wire'].forEach(function (side) {
      var s = scenes[side], w = s.walls;
      L.push('벽 ' + side.padEnd(6) + ' yTop=' + w.yTopPix + ' yBot=' + w.yBotPix +
             ' xFrom=' + w.xFromPix + ' xTo=' + w.xToPix.toFixed(3));
    });
    ['inc', 'scat', 'tot'].forEach(function (row) {
      ['image', 'wire'].forEach(function (side) {
        var info = dbg.panels['cv-' + row + '-' + side];
        if (!info) return;
        if (info.mask.boxes.length)
          L.push('마스크 ' + row + '/' + side + '  ' + info.mask.boxes.map(function (b) {
            return '[' + b.join(',') + ']'; }).join(' '));
      });
    });
    ['image', 'wire'].forEach(function (side) {
      var mk = scenes[side].markers, st = {};
      mk.forEach(function (m) { st[m.kind] = (st[m.kind] || 0) + 1; });
      L.push('마커 ' + side.padEnd(6) + ' 총 ' + mk.length + '  ' +
             Object.keys(st).map(function (k) { return k + '=' + st[k]; }).join(' ') +
             '  첫(' + mk[0].xPix.toFixed(1) + ',' + mk[0].yPix.toFixed(1) + ')' +
             ' 끝(' + mk[mk.length - 1].xPix.toFixed(1) + ',' + mk[mk.length - 1].yPix.toFixed(1) + ')');
    });
    var r = dbg.panels['cv-tot-image'].ruler, r2 = dbg.panels['cv-tot-wire'].ruler;
    L.push('눈금자 ' + rulerS.kind + '  image x[' + r.x0.toFixed(1) + ',' + r.x1.toFixed(1) + ']' +
           '  wire x[' + r2.x0.toFixed(1) + ',' + r2.x1.toFixed(1) + ']' +
           '  길이=' + rulerS.len.toFixed(3) + '셀  이론=' + rulerS.theory.toFixed(6));
    L.push('스케일 inc=' + scales.inc.toExponential(4) + ' scat=' + scales.scat.toExponential(4) +
           ' tot=' + scales.tot.toExponential(4));
    L.push('계시기 영상법=' + timing.image.toFixed(1) + ' 도선관=' + timing.wire.toFixed(1) +
           ' 측정=' + timing.measure.toFixed(1) + ' 렌더=' + timing.render.toFixed(1) +
           ' 합계=' + timing.total.toFixed(1) + ' ms');
    L.push('품질 image ' + JSON.stringify(scenes.image.quality));
    L.push('품질 wire  ' + JSON.stringify(scenes.wire.quality));
    el('debugout').textContent = L.join('\n');
  }

  /* ---------------- 측정 버튼 (상시 기능, ?debug=1 무관) ----------------
   * 페이지가 스스로 잰다. 브라우저를 밖에서 조작해 반복할 필요가 없다.
   * 숨겨진 창에서는 Chrome이 렌더러 우선순위를 낮춰 동기 계산도 느려진다
   * (실측 2549 → 340 ms, 7.5배). 그래서 vis !== 'visible' 이면 재지 않는다. */
  function med(arr) { var b = arr.slice().sort(function (x, y) { return x - y; }); return b[(b.length - 1) >> 1]; }
  function nextFrame() {
    return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); });
  }

  var benching = false;
  function bench() {
    if (benching) return;
    var out = el('measOut');
    if (document.visibilityState !== 'visible') {
      out.textContent = '창이 보이지 않아 측정할 수 없습니다'; return;
    }
    benching = true;
    el('measBtn').disabled = true;
    out.textContent = '측정 중…';

    var runs = [];
    var i = 0;
    nextFrame().then(function step() {
      recompute();
      if (i >= 2) runs.push({ image: timing.image, wire: timing.wire, measure: timing.measure,
                              render: timing.render, total: timing.total });
      i++;
      if (i < 7) return nextFrame().then(step);
      return null;
    }).then(function () {
      var q = scenes.wire.quality;
      var cond = 'λ=' + cm(state.lambda).toFixed(1) + 'cm a=' + cm(state.a).toFixed(1) +
        ' y₀/a=' + state.y0OverA.toFixed(3) + ' N=' + state.N +
        (state.cesaro ? ' Cesàro' : ' 단순합') + ' d=' + q.d.toFixed(3) +
        (q.awAuto ? ' 정합ON' : ' 정합OFF') + (state.scatBand ? ' 벽제한ON' : ' 벽제한OFF');
      var env = 'DPR=' + window.devicePixelRatio +
        '  outer/inner=' + (window.outerWidth / window.innerWidth).toFixed(4) +
        '  viewport=' + window.innerWidth + 'x' + window.innerHeight +
        '  vis=' + document.visibilityState;
      out.textContent =
        '측정 · 중앙값/5회 (워밍업 2회)\n' + cond + '\n' + env + '\n' +
        '영상법 ' + med(runs.map(function (r) { return r.image; })).toFixed(0) +
        ' · 도선관 ' + med(runs.map(function (r) { return r.wire; })).toFixed(0) +
        ' · 측정 ' + med(runs.map(function (r) { return r.measure; })).toFixed(0) +
        ' · 렌더 ' + med(runs.map(function (r) { return r.render; })).toFixed(0) +
        ' · 합계 ' + med(runs.map(function (r) { return r.total; })).toFixed(0) + ' ms\n' +
        '원시 합계: ' + runs.map(function (r) { return r.total.toFixed(0); }).join(' ');
      benching = false;
      el('measBtn').disabled = false;
    });
  }

  /* ---------------- 읽기값 ---------------- */
  function syncReadouts(meas) {
    var k = 2 * Math.PI / state.lambda;
    var kap1 = M.theoryKappa(1, state.a, k);
    var cutoffStage = (kap1 !== null) && (kap1 * GEO.L >= 3);   // v1 §10-3 자동 판정

    el('lambdaVal').textContent = cm(state.lambda).toFixed(1) + ' cm  (λ/a=' + (state.lambda / state.a).toFixed(2) + ')';
    el('aVal').textContent = cm(state.a).toFixed(1) + ' cm';
    el('y0Val').textContent = state.y0OverA.toFixed(3);
    el('nVal').textContent = state.N + ' 쌍' + (state.cesaro ? ' (Cesàro)' : ' (단순 합)');
    el('gammaVal').textContent = state.gamma.toFixed(2);

    var q = scenes.wire.quality;
    el('dVal').textContent = q.d.toFixed(3) + ' mm  (d/λ=' + q.dOverLambda.toFixed(3) + ')';
    el('awVal').textContent = q.aw.toFixed(4) + ' mm' + (q.awAuto ? ' (자동 d/2π)' : '') +
      '  a_w/d=' + q.awOverD.toFixed(4);
    el('deltaVal').textContent = 'δ = ' + (q.delta >= 0 ? '+' : '') + q.delta.toFixed(4) +
      '셀,  a_eff = ' + q.aEff.toFixed(2) + '셀 (명목 ' + state.a + ')';
    el('plateVal').textContent = '도체판 위 |E| 평균: ' + scenes.image.quality.plateAvg.toFixed(6);
    el('wallTVal').textContent = '벽 누설 |T| = ' + q.wallT.toFixed(4) + ',  도선 ' + (2 * q.nW) + '개';

    // 경고 배지 (v1 §10-2 + a_w 2단계)
    var warn = [];
    if (q.dOverLambda > 0.1) warn.push('⚠ d/λ = ' + q.dOverLambda.toFixed(3) + ' — 벽 근사 무너짐');
    if (q.wallT > 0.35) warn.push('⚠ |T| = ' + q.wallT.toFixed(3) + ' — 모드 분해 신뢰도 낮음');
    if (q.awOverD >= 0.5) warn.push('⛔ 도선이 물리적으로 겹칩니다 (a_w/d = ' + q.awOverD.toFixed(3) + ') — 결과가 무의미합니다');
    else if (q.awOverD > 0.25) warn.push('⚠ 얇은 도선 근사 이탈 (a_w/d = ' + q.awOverD.toFixed(3) + ') — 반지름을 줄이거나 간격을 넓히세요');
    el('warnBox').innerHTML = warn.map(function (w) { return '<div class="warn">' + w + '</div>'; }).join('');

    el('stageBadge').textContent = cutoffStage
      ? '차단 무대 (κ₁·L = ' + (kap1 * GEO.L).toFixed(1) + ' ≥ 3)'
      : '전파 영역 — 내부 양상 비교 · 정량 지표는 탭 4';
    el('stageBadge').className = cutoffStage ? 'badge cutoff' : 'badge prop';

    // 차단 무대일 때만 관 내부 상대 차이 (G4와 같은 지표·같은 영역)
    if (cutoffStage) {
      el('diffVal').textContent = '관 내부 상대 차이: ' +
        (relL2(scenes.image.tot, scenes.wire.tot) * 100).toFixed(1) + '%';
      el('diffVal').style.display = '';
    } else el('diffVal').style.display = 'none';
  }

  function relL2(A, B) {
    var t = M.jBotTop(state.a);
    var i0 = Math.round(GEO.zToPix(GEO.G4_ZRANGE[0])), i1 = Math.round(GEO.zToPix(GEO.G4_ZRANGE[1]));
    var sum = 0, cnt = 0, mx = 0;
    for (var i = i0; i <= i1; i++) for (var j = t.jBot + 1; j < t.jTop; j++) {
      var k = i * A.Ny + j;
      var dr = A.re[k] - B.re[k], di = A.im[k] - B.im[k];
      sum += dr * dr + di * di; cnt++;
      var ma = A.re[k] * A.re[k] + A.im[k] * A.im[k], mb = B.re[k] * B.re[k] + B.im[k] * B.im[k];
      if (ma > mx) mx = ma; if (mb > mx) mx = mb;
    }
    return Math.sqrt(sum / cnt) / Math.sqrt(mx);
  }

  /* ---------------- 배치 ----------------
   * 캔버스 종횡비(520:220)를 컨테이너가 정확히 갖게 만든다 → 레터박스가 생기지 않는다.
   *   행 높이 = (가용 높이 − 열머리 − 캡션 − 행간격) / 3
   *   컬럼 폭 = 행 높이 × Nx/Ny
   * 캡션 높이는 컬럼 폭에 의존하므로(줄바꿈) 2회 반복해 수렴시킨다.
   * 남는 가로 폭은 사이드바가 전부 흡수한다 (.sidebar flex:1 1 auto). */
  /* ---------------- 배치 ----------------
   * 캔버스를 축소 표시하면 안 된다. image-rendering: pixelated 는 최근접 샘플링이라
   * 배율이 1 미만이면 소스 행이 통째로 버려지고 1px 벽선이 점선으로 끊긴다.
   * 벽은 이 시뮬의 인과 서술(경계조건 → 유도 전류/산란파 → 장)의 출발점이므로
   * 미적 문제가 아니다. 표현 방식(pixelated)을 바꾸는 대신 축소 자체를 막는다.
   *
   * 제약 순서 (위가 우선)
   *   1  colW × 실효DPR ≥ Nx        절대 바닥. 축소 금지
   *   2  rowH × 실효DPR ≥ Ny        종횡비를 유지하므로 1과 동시 충족
   *   3  사이드바 ≥ SIDE_2COL       2열 유지 (가능할 때)
   *   4  사이드바 상한 SIDE_MAX     남는 폭을 무한 흡수하지 않게
   *   5  더 큰 캔버스
   *
   * 1을 만족시킬 수 없으면 세로를 확보한다: (a) 진단 패널은 이미 흐름 밖,
   * (b) 캡션 접기, (c) — , (d) 사이드바 1열. 그래도 안 되면 축소하고 경고를 찍는다.
   *
   * 실효DPR = devicePixelRatio 하나다. Chrome의 devicePixelRatio 에는 이미 줌이
   * 곱해져 있다 (이 PC: 100%→1.25, 80%→1.0). outer/inner 는 줌 표시용이다. */
  var GAP_Y = 8, GAP_X = 14, COL_GAP = 10, LBL_W = 56;
  var SIDE_MIN = 340;                       // style.css 의 .sidebar min-width
  var SIDE_2COL = 560;                      // 2열로 바뀌는 문턱
  var SIDE_MAX = 2 * SIDE_MIN + 12;         // 2열 × 1열 최소폭 + 내부 gap = 692

  var layoutLog = { calls: 0, applied: 0, fallback: 0, lastMain: '—' };

  function effDpr() { return window.devicePixelRatio || 1; }
  function zoomOf() { return window.outerWidth ? window.outerWidth / window.innerWidth : 1; }

  function layout() {
    layoutLog.calls++;
    var main = document.querySelector('.app-main'), grid = el('compare'), side = el('sidebar');
    if (!main || !grid) return;
    layoutLog.lastMain = main.clientWidth + 'x' + main.clientHeight;

    if (window.matchMedia('(max-width:1365px)').matches) {   // 폴백에서는 CSS에 맡긴다
      grid.style.gridTemplateColumns = ''; grid.style.gridTemplateRows = '';
      side.style.flex = ''; side.classList.remove('wide');
      layoutLog.fallback++; layoutLog.d = null;
      return;
    }

    var dpr = effDpr();
    var colWmin = Math.ceil(GEO.Nx / dpr);          // 제약 1
    var availW = main.clientWidth;

    // 사이드바에 sw 를 남겼을 때 가로가 허용하는 컬럼 폭
    function byWidth(sw) {
      return Math.floor((availW - sw - GAP_X - LBL_W - 2 * COL_GAP) / 2);
    }
    // 세로가 허용하는 컬럼 폭 (캡션 높이는 컬럼 폭에 의존하므로 호출부에서 반복 수렴)
    function byHeight() {
      var headH = el('head-image').offsetHeight;
      var capH = grid.classList.contains('capfold') ? 0
               : Math.max(el('cap-image').offsetHeight, el('cap-wire').offsetHeight);
      var rowH = Math.floor((main.clientHeight - headH - capH - 4 * GAP_Y) / 3);
      return Math.floor(rowH * GEO.Nx / GEO.Ny);
    }

    // 캡션 높이가 컬럼 폭에 의존하므로(줄바꿈) 2회 반복해 수렴시킨다.
    function solve() {
      var d = { dpr: dpr, zoom: zoomOf(), colWmin: colWmin };
      for (var pass = 0; pass < 2; pass++) {
        d.byH = byHeight();
        d.byW2 = byWidth(SIDE_2COL);
        d.byW1 = byWidth(SIDE_MIN);

        d.relaxed = false;                           // 제약 3(2열)을 포기했는가
        d.colW = Math.min(d.byH, d.byW2);
        if (d.colW < colWmin && d.byW1 > d.byW2) {   // (d) 2열을 포기하면 가로가 트인다
          d.relaxed = true;
          d.colW = Math.min(d.byH, d.byW1);
        }
        if (!(d.colW > 40)) return null;

        d.rowH = Math.round(d.colW * GEO.Ny / GEO.Nx);
        d.gridW = LBL_W + 2 * d.colW + 2 * COL_GAP;
        // 제약 4 — 남는 폭은 사이드바가 흡수하되 상한을 넘지 않는다
        d.sideW = Math.max(d.relaxed ? SIDE_MIN : SIDE_2COL,
                    Math.min(SIDE_MAX, availW - d.gridW - GAP_X));
        d.twoCol = d.sideW >= SIDE_2COL;             // 실제로 2열이 되었는가
        d.scale = d.colW * dpr / GEO.Nx;
        d.shrink = d.colW < colWmin;                 // 축소 불가피

        side.style.flex = '0 0 ' + d.sideW + 'px';
        side.classList.toggle('wide', d.twoCol);
        grid.style.gridTemplateColumns = LBL_W + 'px ' + d.colW + 'px ' + d.colW + 'px';
        grid.style.gridTemplateRows = 'auto ' + d.rowH + 'px ' + d.rowH + 'px ' + d.rowH + 'px auto';
      }
      return d;
    }

    // (c) 제목·캡션 여백 압축 — 축소가 불가피할 때만 켠다.
    // 판정은 항상 tight OFF 상태에서 시작해 결정론적으로 내린다 (켰다 껐다 진동 방지).
    var body = document.body;
    body.classList.remove('tight');
    var d = solve();
    if (d && d.shrink) {
      body.classList.add('tight');
      var d2 = solve();
      if (d2 && d2.colW > d.colW) d = d2;
      else { body.classList.remove('tight'); d = solve(); }
    }
    if (!d) return;
    d.tight = body.classList.contains('tight');
    layoutLog.applied++;
    layoutLog.d = d;
  }

  // ?debug=1 배치 실측 — 계산값과 실제로 화면이 준 폭을 나란히 놓는다.
  function layoutProbe() {
    var main = document.querySelector('.app-main'), side = el('sidebar'), grid = el('compare');
    if (!main) return [];
    var d = layoutLog.d;
    return [
      'app-main:  clientWidth ' + main.clientWidth + ' clientHeight ' + main.clientHeight,
      'sidebar:   offsetWidth ' + side.offsetWidth + ' scrollWidth ' + side.scrollWidth +
        ' scrollHeight ' + side.scrollHeight + '  세로스크롤 ' +
        (side.scrollHeight > side.clientHeight ? '있음' : '없음') + '  2열 ' + (side.classList.contains('wide') ? 'ON' : 'OFF'),
      'compare:   offsetWidth ' + grid.offsetWidth + ' scrollWidth ' + grid.scrollWidth +
        '  넘침 ' + (grid.scrollWidth > grid.offsetWidth ? '있음' : '없음') +
        '  실제 캔버스폭 ' + el('cv-tot-image').getBoundingClientRect().width.toFixed(1) +
        ' 높이 ' + el('cv-tot-image').getBoundingClientRect().height.toFixed(1),
      'layout():  호출 ' + layoutLog.calls + '회 (적용 ' + layoutLog.applied + ' · 폴백 ' + layoutLog.fallback +
        ') · 마지막 호출 시점의 app-main ' + layoutLog.lastMain,
      '창:        viewport ' + window.innerWidth + 'x' + window.innerHeight +
        '  DPR ' + window.devicePixelRatio + '  outer/inner ' + zoomOf().toFixed(4) +
        '  vis ' + document.visibilityState
    ].concat(d ? [
      '실효DPR ' + d.dpr.toFixed(3) + '  (devicePixelRatio 단독 — 줌이 이미 곱해져 있다.' +
        ' 참고 줌 ' + d.zoom.toFixed(3) + ')',
      '캔버스 배율 ' + d.scale.toFixed(3) + '  (= colW ' + d.colW + ' × 실효DPR ' + d.dpr.toFixed(3) +
        ' / ' + GEO.Nx + ')' + (d.scale >= 1 ? '  ✓ 축소 없음' : '  ⚠ 축소 — 벽선이 끊길 수 있음'),
      '제약 판정: 가로 ' + (d.relaxed ? d.byW1 : d.byW2) + ' / 세로 ' + d.byH +
        ' / 사이드바 2열 ' + (d.twoCol ? 'ON' : 'OFF') + '(' + d.sideW + ')' +
        ' / 채택 colW ' + d.colW + '  (바닥 ' + d.colWmin + ')',
      '           바인딩 = ' + (d.colW === d.byH ? '세로' : '가로') +
        ' · 캡션 ' + (el('compare').classList.contains('capfold') ? '접힘' : '펼침') +
        ' · 압축(c) ' + (d.tight ? 'ON' : 'OFF') +
        ' · 2열예약포기(d) ' + (d.relaxed ? 'ON' : 'OFF') +
        ' · rowH ' + d.rowH + ' gridW ' + d.gridW +
        ' · 가로 여유 ' + (main.clientWidth - d.gridW - GAP_X - d.sideW)
    ] : ['제약 판정: (폴백 배치 — CSS에 맡김)']);
  }

  /* ---------------- 입력 ---------------- */
  var debounce = null;
  function schedule() {
    el('busy').style.display = '';          // 이전 프레임을 지우지 않는다 (백지 금지)
    clearTimeout(debounce);
    debounce = setTimeout(function () { recompute(); el('busy').style.display = 'none'; }, 250);
  }

  // mode: 'calc' = 디바운스 후 재계산 / 'view' = 표시만 (렌더 루프가 다음 프레임에 반영)
  function bind(id, fn, mode) {
    el(id).addEventListener('input', function (e) {
      fn(e.target);
      if (mode === 'view') { el('gammaVal').textContent = state.gamma.toFixed(2); markDirty(); }
      else schedule();
    });
  }

  function init() {
    bind('lambda', function (t) { state.lambda = Math.round(+t.value * 10); });
    bind('aGap',   function (t) { state.a = Math.round(+t.value * 10); });
    bind('y0',     function (t) { state.y0OverA = +t.value; });
    bind('nImg',   function (t) { state.N = +t.value; });
    bind('dMan',   function (t) { state.dManual = +t.value; });
    bind('awMan',  function (t) { state.aw = +t.value; });
    bind('gamma',  function (t) { state.gamma = +t.value; }, 'view');
    bind('speed',  function (t) { state.dPhi = +t.value; }, 'view');

    el('centerBtn').addEventListener('click', function () {
      state.y0OverA = 0.5; el('y0').value = 0.5; recompute();
    });
    el('cesaro').addEventListener('change', function (e) { state.cesaro = e.target.checked; recompute(); });
    el('awAuto').addEventListener('change', function (e) {
      state.awAuto = e.target.checked; el('awMan').disabled = state.awAuto; recompute();
    });
    el('dAuto').addEventListener('change', function (e) {
      state.dAutoOn = e.target.checked; el('dMan').disabled = state.dAutoOn; recompute();
    });
    el('singleScale').addEventListener('change', function (e) { state.singleScale = e.target.checked; recompute(); });
    el('measBtn').addEventListener('click', bench);
    // 캡션 접기 — 펼치면 세로를 먹고, 컬럼 폭이 행 높이에서 역산되므로 캔버스가 작아진다
    el('capBtn').addEventListener('click', function () {
      var on = el('compare').classList.toggle('capfold');
      el('capBtn').textContent = on ? '캡션 ▸' : '캡션 ▾';
      layout(); markDirty();
    });
    el('dbgBtn').addEventListener('click', function () {
      var on = el('debugbox').classList.toggle('folded');
      el('dbgBtn').textContent = on ? '?debug=1 ▸' : '?debug=1 ▾';
    });
    // 벽 사이 제한 대조 토글 — ?debug=1 에서만 노출한다 (평소엔 켜 둔 채로 쓴다)
    el('scatAll').addEventListener('change', function (e) { state.scatBand = !e.target.checked; recompute(); });
    el('pauseBtn').addEventListener('click', function () {
      state.paused = !state.paused; markDirty();
      el('pauseBtn').textContent = state.paused ? '▶ 재개' : '⏸ 일시정지';
    });

    var box = el('presets');
    PRESETS.forEach(function (p, i) {
      var b = document.createElement('button');
      b.className = 'preset'; b.textContent = p.label;
      b.addEventListener('click', function () {
        state.a = p.a; state.lambda = p.lambda; state.y0OverA = p.y0OverA;
        el('aGap').value = cm(p.a); el('lambda').value = cm(p.lambda); el('y0').value = p.y0OverA;
        Array.prototype.forEach.call(box.children, function (c) { c.className = 'preset'; });
        b.className = 'preset active';
        recompute();
      });
      box.appendChild(b);
    });

    // 캔버스 백킹 520×220, CSS로 축소, image-rendering: pixelated (v1 §9-5)
    ['inc', 'scat', 'tot'].forEach(function (row) {
      ['image', 'wire'].forEach(function (side) {
        var c = el('cv-' + row + '-' + side);
        c.width = GEO.Nx; c.height = GEO.Ny;
      });
    });

    el('compare').classList.add('capfold');      // 캡션 기본 접힘
    if (DEBUG) { el('debugbox').style.display = ''; el('scatAllRow').style.display = ''; }
    el('nImg').max = GEO.N_MAX;
    el('scatAll').checked = !state.scatBand;

    layout();
    var relayout = null;
    function scheduleLayout() { clearTimeout(relayout); relayout = setTimeout(layout, 80); }
    window.addEventListener('resize', scheduleLayout);
    if (window.ResizeObserver) new ResizeObserver(scheduleLayout).observe(document.querySelector('.app-main'));

    recompute();
    requestAnimationFrame(render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
