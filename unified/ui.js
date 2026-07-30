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
    gamma: 0.4, phase: 0, dPhi: 0.15, paused: false, singleScale: false,
    tab: 3          // 1 영상법 / 2 도선관 / 3 나란히. 슬라이더 상태는 탭을 넘어 유지된다.
  };

  // 탭이 보여주는 열. 탭 1·2는 탭 3에서 한 열을 숨긴 것이다 (v1 §10-1).
  function sidesOf(tab) { return tab === 1 ? ['image'] : tab === 2 ? ['wire'] : ['image', 'wire']; }

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
    // 대조군(모드합) — 탭 4의 표에서만 쓴다. 탭 1·2·3에서는 계산하지 않는다.
    var ss = (state.tab === 4)
      ? AD.imageScene(Object.assign({}, p, { modeInfinity: true, scatBand: state.scatBand })) : null;
    var t1b = performance.now();
    var sw = AD.wireScene(Object.assign({}, p, {
      d: currentD(), awAuto: state.awAuto, aw: state.aw }));
    var t2 = performance.now();

    scenes = { image: si, wire: sw };
    if (ss) scenes.sum = ss;

    // 측정 — 탭 4가 쓸 값. 여기서 한 번만 재고 캐시한다.
    // 세 열에 똑같은 함수를 적용한다 (v1 §1-3) — 방법별 분기를 두지 않는다.
    var k = 2 * Math.PI / state.lambda;
    var kmin = M.kappaMinOfCutoff(state.a, k, 3);
    var keys = ss ? ['sum', 'image', 'wire'] : ['image', 'wire'];
    var meas = [1, 2, 3].map(function (n) {
      var kap = M.theoryKappa(n, state.a, k), kz = M.theoryKz(n, state.a, k);
      var row = { n: n, coupling: M.coupling(n, state.y0OverA), kappa: kap, kz: kz };
      keys.forEach(function (key) {
        var d = key === 'wire' ? currentD() : 1;   // resolvable 판정용. 영상법·모드합은 1셀
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

    timing = { image: t1 - t0, sum: t1b - t1, wire: t2 - t1b, measure: t3 - t2, render: 0, total: 0 };
    markDirty();
    window.__meas = meas;
    collectPoints(meas);
    syncReadouts(meas);
    if (state.tab === 4) updateTable(meas);
    drawFrame();          // rAF를 기다리지 않는다 (창이 숨겨져 있어도 그림이 남는다)
  }

  /* ---------------- 렌더 ---------------- */
  var CTX = {}, dirty = true;
  function ctxOf(id) { return CTX[id] || (CTX[id] = el(id).getContext('2d')); }
  function markDirty() { dirty = true; }

  /* ---------------- 캔버스 라벨 → HTML span ----------------
   * 원본 image-source/render.js:updateOverlays 와 같은 방식이다.
   * 캔버스 백킹은 Nx×Ny 이고 CSS로 배율이 걸리므로 캔버스에 그린 글자는 리샘플된다.
   * span 은 문서 좌표에 있어 배율과 무관하게 선명하고, 폰트 크기는 CSS(.cv-label)로만
   * 정한다 — 캔버스가 작아져도 읽혀야 한다. 백킹 해상도는 올리지 않는다. */
  var labelPool = {};
  function syncLabels(id, labels) {
    var panel = el(id).parentNode;
    var pool = labelPool[id] || (labelPool[id] = []);
    while (pool.length < labels.length) {
      var s = document.createElement('span');
      panel.appendChild(s); pool.push(s);
    }
    var out = [];
    pool.forEach(function (s, i) {
      var L = labels[i];
      if (!L) { s.style.display = 'none'; return; }
      var left = (L.xPix / GEO.Nx) * 100;
      var top = ((GEO.Ny - 1 - L.yPix) / GEO.Ny) * 100;   // j 뒤집기 유지
      s.style.display = ''; s.className = 'cv-label ' + L.kind;
      s.textContent = L.text;
      s.style.left = left + '%';
      s.style.top = top + '%';
      out.push({ text: L.text, left: left, top: top, kind: L.kind });
    });
    return out;
  }

  // rAF는 창이 숨겨지면 아예 실행되지 않는다. 첫 프레임은 기다리지 않고 직접 그린다.
  function render() {
    // 정지 중이고 바뀐 것이 없으면 다시 그리지 않는다 (CPU 절약 + 화면이 안정되어 캡처 가능)
    // 탭 4는 위상 애니메이션이 없다 — 바뀐 것이 없으면 차트를 다시 그리지 않는다
    if (!scenes || (state.paused && !dirty) || (state.tab === 4 && !dirty)) {
      requestAnimationFrame(render); return;
    }
    if (!state.paused) state.phase += state.dPhi;
    drawFrame();
    requestAnimationFrame(render);
  }

  function drawFrame() {
    if (!scenes) return;
    dirty = false;
    var t0 = performance.now();
    var dbg = { panels: {} };

    if (state.tab === 4) {
      drawDispersion();
      if (!el('t4scan').classList.contains('folded')) drawScan();
      timing.render = performance.now() - t0;
      timing.total = timing.image + timing.sum + timing.wire + timing.measure + timing.render;
      el('timer').textContent = '계산 시간:  영상법 ' + timing.image.toFixed(0) +
        (timing.sum > 0.5 ? 'ms · 대조군 ' + timing.sum.toFixed(0) : '') +
        'ms · 도선관 ' + timing.wire.toFixed(0) + 'ms · 측정 ' + timing.measure.toFixed(0) +
        'ms · 렌더(차트) ' + timing.render.toFixed(0) + 'ms · 합계 ' + timing.total.toFixed(0) + 'ms';
      if (DEBUG) dumpDebug(dbg);
      return;
    }

    ['inc', 'scat', 'tot'].forEach(function (row) {
      sidesOf(state.tab).forEach(function (side) {   // 숨긴 열은 그리지 않는다
        var id = 'cv-' + row + '-' + side;
        var opts = (row === 'tot') ? { ruler: rulerS } : {};
        var info = R.drawPanel(ctxOf(id), scenes[side], row, scales[row], state.gamma, state.phase, opts);
        info.labelBoxes = syncLabels(id, info.labels);
        if (DEBUG) dbg.panels[id] = info;
      });
      el('scale-' + row).textContent = scales[row].toExponential(3);
    });

    var t1 = performance.now();
    timing.render = t1 - t0;
    timing.total = timing.image + timing.sum + timing.wire + timing.measure + timing.render;
    el('timer').textContent =
      '계산 시간:  영상법 ' + timing.image.toFixed(0) +
      (timing.sum > 0.5 ? 'ms · 대조군 ' + timing.sum.toFixed(0) : '') +
      'ms · 도선관 ' + timing.wire.toFixed(0) +
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

    if (state.tab === 4) {
      var cv4 = el('cvDisp'), r4 = cv4.getBoundingClientRect();
      L.push('── 탭 4 (A) 지표 표 ──');
      L.push('  창: κ = ' + GEO.KAPPA_WIN + ' (' + M.WINDOW_LABEL[GEO.KAPPA_WIN] + ')' +
             ' · k_z = fitWindowZ · R²_min 0.99');
      (window.__meas || []).forEach(function (row) {
        var cut = row.kappa !== null, thy = cut ? row.kappa : row.kz;
        var f = function (key) {
          var r = row[key];
          if (!r) return key + '=—';
          return key + '=' + (r.value === null ? r.reason
                 : (r.value / thy * 100).toFixed(2) + '% R²' + (r.r2 === undefined ? '—' : r.r2.toFixed(4)));
        };
        L.push('  모드 ' + row.n + '  결합 ' + row.coupling.toExponential(3) +
               '  ' + (cut ? '차단' : '전파') +
               '  이론 ' + thy.toFixed(7) + '/셀 = ' + (thy * 10).toFixed(4) + '/cm  |  ' +
               f('sum') + '  ' + f('image') + '  ' + f('wire'));
      });
      L.push('── 탭 4 (B) 분산 곡선 ──');
      L.push('  문턱 λ/a = 2/n : 모드1 ' + (2 / 1).toFixed(3) + ' · 모드2 ' + (2 / 2).toFixed(3) +
             ' · 모드3 ' + (2 / 3).toFixed(3) + '   축 범위 u[' + U0 + ',' + U1 + '] y[' + Y0 + ',' + Y1 + ']');
      L.push('  측정점 ' + pts.length + '개 / 상한 ' + PT_MAX +
             (pts.length >= PT_MAX ? ' (상한 도달)' : ' (미도달)') + ' · 범위 밖 ' + ptsOut + '개' +
             ' · 현재 λ/a = ' + (state.lambda / state.a).toFixed(3));
      L.push('  차트 캔버스 백킹 ' + cv4.width + '×' + cv4.height +
             ' · 표시 ' + r4.width.toFixed(0) + '×' + r4.height.toFixed(0) +
             ' · DPR ' + window.devicePixelRatio + ' (표시×DPR 방식, 정수 스냅 미적용)');
      L.push('── 탭 4 (C) 수렴 스캔 ──');
      L.push('  ' + (el('t4scan').classList.contains('folded') ? '접힘' : '펼침') +
             ' · ' + el('scanInfo').textContent);
      ['N', 'D'].forEach(function (w) {
        var c = el(w === 'N' ? 'cvScanN' : 'cvScanD'), rr = c.getBoundingClientRect();
        L.push('  ' + (w === 'N' ? 'C-1 영상법 N축' : 'C-2 도선관 d축') +
               '  백킹 ' + c.width + '×' + c.height +
               ' · 표시 ' + rr.width.toFixed(0) + '×' + rr.height.toFixed(0));
      });
      scan.N.forEach(function (r) {
        var f = function (s) { return s ? (s.ratio === null ? s.reason
                 : (s.ratio * 100).toFixed(2) + '% plateAvg ' + s.plateAvg.toFixed(6)) : '—'; };
        L.push('    N=' + String(r.N).padStart(3) + '  단순 ' + f(r.sim) + '  |  Cesàro ' + f(r.ces));
      });
      scan.D.forEach(function (r) {
        var f = function (s) { return s ? (s.ratio === null ? s.reason : (s.ratio * 100).toFixed(2) + '%') : '—'; };
        var dev = (r.off && r.off.ratio !== null && r.pred !== null)
          ? ((r.off.ratio - r.pred) * 100).toFixed(3) + '%p' : '—';
        L.push('    d=' + String(r.d).padStart(2) + '  OFF ' + f(r.off) +
               ' 예측 ' + (r.pred === null ? '—' : (r.pred * 100).toFixed(2) + '%') +
               ' 차이 ' + dev + '  |  ON ' + f(r.on) +
               '  a_w/d ' + (r.off ? r.off.awOverD.toFixed(3) : '—') +
               ' wallT ' + (r.off ? r.off.wallT.toFixed(4) : '—'));
      });
    }

    L.push('── 장 ──');

    var qi = scenes.image.quality;
    L.push('산란장 계산 범위: j=[' + qi.jBot + ',' + qi.jTop + '] (' + GEO.Ny + '행 중 ' +
           qi.bandRows + '행)' + (qi.scatBand ? '' : '  ← 벽 사이 제한 OFF (전 영역, 대조용)'));

    // 화면 지표의 정의 — 게이트 지표와 같은 영역·같은 정규화인지 대조할 수 있게 명시한다
    var jt = M.jBotTop(state.a);
    L.push('지표 정의: 관 내부 상대 차이 = RMS(E_tot,영상법 − E_tot,도선관) / max|E_tot|');
    L.push('           영역 = 벽 사이 (' + jt.jBot + ' < j < ' + jt.jTop + ')  ∧  z ∈ [' +
           GEO.G4_ZRANGE.join(', ') + '] = 픽셀 x [' +
           Math.round(GEO.zToPix(GEO.G4_ZRANGE[0])) + ', ' +
           Math.round(GEO.zToPix(GEO.G4_ZRANGE[1])) + ']  (GEO.G4_ZRANGE)');
    L.push('           = verify.js G4 의 ★행(영상법↔도선관)과 같은 영역·같은 정규화.');
    L.push('           ★는 두 오차의 합이라 게이트가 아니다 — 게이트는 모드합↔각 방법 (설계 §11-9).');

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
      // 총계는 컬링 전 개수다. 영상원은 y = y0 ± r·a 라 대부분 캔버스 밖이므로
      // 화면 내 개수를 함께 찍는다 — 총계만 보면 전부 그려지는 것처럼 읽힌다.
      var dr = (dbg.panels['cv-tot-' + side] || {}).markers;
      L.push('마커 ' + side.padEnd(6) + ' 총 ' + mk.length +
             (dr ? ' (화면 내 ' + dr.drawn.total + ')' : '') + '  ' +
             Object.keys(st).map(function (k) {
               return k + '=' + st[k] + (dr ? '/' + (dr.drawn[k] || 0) : '');
             }).join(' ') + (dr ? '  (총/화면내)' : '') +
             '  첫(' + mk[0].xPix.toFixed(1) + ',' + mk[0].yPix.toFixed(1) + ')' +
             ' 끝(' + mk[mk.length - 1].xPix.toFixed(1) + ',' + mk[mk.length - 1].yPix.toFixed(1) + ')');
    });

    // ── 라벨 (단계 D) ── 텍스트와 계산된 백분율을 그대로 찍어 대조 가능하게 한다
    L.push('── 라벨 (HTML span) ──');
    ['inc', 'scat', 'tot'].forEach(function (row) {
      ['image', 'wire'].forEach(function (side) {
        var info = dbg.panels['cv-' + row + '-' + side];
        if (!info || !info.labelBoxes || !info.labelBoxes.length) return;
        info.labelBoxes.forEach(function (b) {
          L.push('  ' + (row + '/' + side).padEnd(11) + b.kind.padEnd(6) +
                 ' left ' + b.left.toFixed(2) + '%  top ' + b.top.toFixed(2) + '%  "' + b.text + '"');
        });
      });
    });
    // 탭 1·2는 한 열을 그리지 않으므로 그 패널이 dbg.panels 에 없다. 없는 쪽은 건너뛴다.
    var rul = sidesOf(state.tab).map(function (side) {
      var p = dbg.panels['cv-tot-' + side];
      return p && p.ruler ? side + ' x[' + p.ruler.x0.toFixed(1) + ',' + p.ruler.x1.toFixed(1) + ']' : null;
    }).filter(Boolean).join('  ');
    L.push('눈금자 ' + rulerS.kind + '  ' + rul +
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

  /* ================= 탭 4 (A) 지표 표 =================
   * 네 열이다 — Griffiths 이론(닫힌 공식, 측정 없음) · 대조군(모드합, 정확해 장을
   * 같은 측정 코드로 잰 값) · 영상법 · 도선 관.
   * 앞의 둘은 다른 것이다. 모드합이 100.0%가 아니면 그것은 방법이 아니라
   * 측정 창·코드의 문제라는 뜻이고, 그때 다른 두 열의 실패를 방법 탓으로
   * 돌릴 수 없게 해 준다. 측정 함수는 measure.js 한 벌을 호출만 한다 (v1 §1-3). */
  var MODE_COL = { 1: '#4a90d9', 2: '#3fb56b', 3: '#e8913a' };   // graph.js 규약 재사용
  var perCm = function (perCell) { return perCell * 10; };        // 셀(=mm) → /cm

  function cellFor(r, thy) {
    if (!r) return { text: '—', cls: 'na' };
    if (r.value === null) return { text: r.reason, cls: 'na' };
    var ratio = r.value / thy;
    var txt = (ratio * 100).toFixed(1) + '%  R² ' + (r.r2 === undefined ? '—' : r.r2.toFixed(4));
    // R²가 높아도 5%를 넘으면 칠한다 — R²는 계통 편향을 잡지 못한다 (설계 §11-8)
    return { text: txt, cls: Math.abs(ratio - 1) > 0.05 ? 'bad' : 'hi', ratio: ratio };
  }

  function updateTable(meas) {
    var k = 2 * Math.PI / state.lambda, body = el('metricBody');
    body.innerHTML = '';
    meas.forEach(function (row) {
      var tr = document.createElement('tr');
      var cut = (row.kappa !== null);
      var cells = [
        { text: String(row.n), cls: 'mode' },
        { text: row.coupling.toFixed(3), cls: '' },
        { text: cut ? '차단' : '전파', cls: 'mode' }
      ];
      if (row.coupling < 0.02) {
        // 나머지 칸 대신 한 칸으로 (v1 §10-4)
        cells.push({ text: '여기되지 않음(마디 위치)', cls: 'na', span: 4 });
      } else {
        var thy = cut ? row.kappa : row.kz;
        // /cm 로 표시하고 대응 길이를 병기한다 — 탭 3 눈금자(v1 §9-4)와 같은 숫자여야
        // 눈으로 본 것과 잰 숫자가 연결된다. 셀 단위는 ?debug=1 에만 둔다.
        cells.push({ text: cut
          ? 'κ = ' + perCm(row.kappa).toFixed(4) + ' /cm   (감쇠길이 1/κ = ' + (1 / row.kappa / 10).toFixed(1) + ' cm)'
          : 'k_z = ' + perCm(row.kz).toFixed(4) + ' /cm   (λ_g = ' + (2 * Math.PI / row.kz / 10).toFixed(1) + ' cm)',
          cls: '' });
        ['sum', 'image', 'wire'].forEach(function (key) {
          var c = cellFor(row[key], thy);
          // 대조군은 100.0% 가 정상이라 정보가 없다 → 흐리게. 벗어나면 강조된다.
          if (key === 'sum' && c.ratio !== undefined && Math.abs(c.ratio - 1) < 0.0005) c.cls = 'dim';
          cells.push(c);
        });
      }
      cells.forEach(function (c) {
        var td = document.createElement('td');
        td.textContent = c.text; td.className = c.cls || '';
        if (c.span) td.colSpan = c.span;
        if (c.cls === 'mode' && cells[0] === c) td.style.color = MODE_COL[row.n];
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    var kmin = M.kappaMinOfCutoff(state.a, k, 3);
    var wz = M.kzWindow(kmin);
    el('winNote').textContent =
      '측정 창 — 차단 κ: ' + M.WINDOW_LABEL[GEO.KAPPA_WIN] + '  ·  전파 k_z: fitWindowZ [' +
      wz.zStart.toFixed(1) + ', ' + wz.zEnd.toFixed(1) + '] 셀   |   R² 가드 0.99, 오차 5% 초과 시 경고색';
  }

  /* ================= 탭 4 (B) 분산 곡선 =================
   * 가로 u = λ/a, 세로 = k_c1(=π/a)로 나눈 값. 축 위 k_z, 축 아래 κ.
   *   y(u, n) = √((2/u)² − n²)   진행 파수      (2/u > n)
   *           = −√(n² − (2/u)²)  감쇠율의 크기  (2/u < n)
   * u 에만 의존하므로 a 에 무관하다 — 서로 다른 a 에서 잰 점이 한 곡선에 모인다.
   * 그래서 a·y₀ 변경 시 자동 삭제하지 않는다 (설계 §9-4). */
  /* 세로 범위는 고정한다 — 점이 쌓일 때마다 축이 움직이면 비교가 안 된다.
   * 세 곡선이 잘리지 않는 최소 범위:
   *   최대 +3.180  모드 1, u=0.6  (2/u=3.333 → √(11.111−1))
   *   최소 −2.926  모드 3, u=3.0  (2/u=0.667 → −√(9−0.444))
   * 모드 3은 u=0.6 에서 (2/u)²−9 = 2.11 > 0 이라 아직 전파 상태다(+1.453). */
  var U0 = 0.6, U1 = 3.0, Y0 = -3.1, Y1 = 3.4, PT_MAX = 200;
  var pts = [], ptsOut = 0;

  function yOf(u, n) {
    var r = 2 / u, s = r * r - n * n;
    return s >= 0 ? Math.sqrt(s) : -Math.sqrt(-s);
  }

  function collectPoints(meas) {
    var u = state.lambda / state.a;
    ptsOut = 0;
    meas.forEach(function (row) {
      ['image', 'wire'].forEach(function (key) {          // 모드합은 찍지 않는다
        var r = row[key];
        if (!r || r.value === null) return;               // 측정 불가는 빈칸으로 남긴다
        if (u < U0 || u > U1) { ptsOut++; return; }
        var kc1 = Math.PI / state.a;
        var y = (row.kappa !== null ? -r.value : r.value) / kc1;
        var kk = key + '|' + row.n + '|' + Math.round(u / 0.005);
        var i = pts.findIndex(function (p) { return p.key === kk; });
        var p = { key: kk, u: u, y: y, n: row.n, method: key,
                  a: state.a, y0OverA: state.y0OverA };
        if (i >= 0) pts[i] = p; else pts.push(p);         // 왕복해도 상한이 차지 않는다
      });
    });
    while (pts.length > PT_MAX) pts.shift();
  }

  function fitChart() {
    var cv = el('cvDisp'), dpr = window.devicePixelRatio || 1;
    var r = cv.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }

  var chartBox = null;
  function drawDispersion() {
    var cv = el('cvDisp');
    if (!cv.getBoundingClientRect().width) return;
    var dpr = fitChart(), ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    var padL = 46 * dpr, padR = 14 * dpr, padT = 12 * dpr, padB = 30 * dpr;
    var X = function (u) { return padL + (u - U0) / (U1 - U0) * (W - padL - padR); };
    var Y = function (y) { return padT + (Y1 - y) / (Y1 - Y0) * (H - padT - padB); };
    chartBox = { X: X, Y: Y, dpr: dpr };

    ctx.clearRect(0, 0, W, H);
    ctx.font = (11 * dpr) + 'px sans-serif';

    // 격자
    ctx.lineWidth = 1 * dpr; ctx.strokeStyle = '#1b2140';
    for (var u = 1.0; u <= U1 + 1e-9; u += 0.5) {
      ctx.beginPath(); ctx.moveTo(X(u), padT); ctx.lineTo(X(u), H - padB); ctx.stroke();
    }
    for (var yv = -3; yv <= 3; yv++) {
      ctx.beginPath(); ctx.moveTo(padL, Y(yv)); ctx.lineTo(W - padR, Y(yv)); ctx.stroke();
    }
    ctx.strokeStyle = '#2a3050'; ctx.strokeRect(padL, padT, W - padL - padR, H - padT - padB);

    // y=0 축 — 위는 전파, 아래는 차단
    ctx.strokeStyle = '#aab2cf'; ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(W - padR, Y(0)); ctx.stroke();

    ctx.fillStyle = '#8892b5'; ctx.textAlign = 'right';
    for (var yl = -3; yl <= 3; yl++) ctx.fillText(String(yl), padL - 6 * dpr, Y(yl) + 4 * dpr);
    ctx.textAlign = 'center';
    for (var ul = 1.0; ul <= U1 + 1e-9; ul += 0.5) ctx.fillText(ul.toFixed(1), X(ul), H - padB + 15 * dpr);
    ctx.fillText('λ/a', (padL + W - padR) / 2, H - padB + 28 * dpr);
    ctx.save(); ctx.translate(12 * dpr, (padT + H - padB) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('축 위 k_z / k_c1   ·   축 아래 κ / k_c1', 0, 0); ctx.restore();

    // 이론 곡선 3개 — 공식이라 비용 0
    [1, 2, 3].forEach(function (n) {
      ctx.strokeStyle = MODE_COL[n]; ctx.lineWidth = 1.8 * dpr;
      ctx.beginPath();
      for (var i = 0, first = true; i <= 400; i++) {
        var uu = U0 + (U1 - U0) * i / 400, yy = yOf(uu, n);
        if (yy < Y0 || yy > Y1) { first = true; continue; }
        if (first) { ctx.moveTo(X(uu), Y(yy)); first = false; } else ctx.lineTo(X(uu), Y(yy));
      }
      ctx.stroke();
      // 문턱 — 모드 n 은 λ/a = 2/n 에서 축을 가로지른다 (2.0 / 1.0 / 0.667)
      var ut = 2 / n;
      if (ut >= U0 && ut <= U1) {
        ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath(); ctx.moveTo(X(ut), padT); ctx.lineTo(X(ut), H - padB); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = MODE_COL[n]; ctx.textAlign = 'left';
        ctx.fillText('모드 ' + n, X(ut) + 4 * dpr, padT + 12 * dpr * n);
      }
    });

    // 측정점 — 영상법 채운 원, 도선관 속 빈 사각형 (사각형이 원을 감싸도록 뒤에 그린다)
    var uNow = state.lambda / state.a;
    pts.forEach(function (p) {
      if (p.y < Y0 || p.y > Y1) return;
      var x = X(p.u), y = Y(p.y), cur = Math.abs(p.u - uNow) < 0.005;
      ctx.lineWidth = (cur ? 2.2 : 1.3) * dpr;
      if (p.method === 'wire') {
        ctx.strokeStyle = cur ? '#fff' : MODE_COL[p.n];
        var s = (cur ? 6 : 4.5) * dpr;
        ctx.strokeRect(x - s, y - s, 2 * s, 2 * s);
      } else {
        ctx.fillStyle = MODE_COL[p.n];
        ctx.beginPath(); ctx.arc(x, y, (cur ? 4 : 2.8) * dpr, 0, 6.2832); ctx.fill();
        if (cur) { ctx.strokeStyle = '#fff'; ctx.stroke(); }
      }
    });

    el('ptInfo').textContent = '측정점 ' + pts.length + '개 / 상한 ' + PT_MAX +
      (pts.length >= PT_MAX ? ' (상한 도달 — 오래된 것부터 제거)' : '') +
      (ptsOut ? '  ·  범위 밖 ' + ptsOut + '개' : '') +
      '  ·  영상법 ● / 도선관 □';
  }

  function chartTip(ev) {
    var cv = el('cvDisp'), tip = el('ptTip');
    if (!chartBox) return;
    var r = cv.getBoundingClientRect();
    var mx = (ev.clientX - r.left) * chartBox.dpr, my = (ev.clientY - r.top) * chartBox.dpr;
    var best = null, bd = 12 * chartBox.dpr;
    pts.forEach(function (p) {
      var d = Math.hypot(chartBox.X(p.u) - mx, chartBox.Y(p.y) - my);
      if (d < bd) { bd = d; best = p; }
    });
    if (!best) { tip.style.display = 'none'; return; }
    tip.style.display = '';
    tip.textContent = 'a=' + (best.a / 10).toFixed(1) + 'cm · λ/a=' + best.u.toFixed(3) +
      ' · y₀/a=' + best.y0OverA.toFixed(3) + ' · 모드 ' + best.n +
      ' · ' + (best.method === 'image' ? '영상법' : '도선 관');
    tip.style.left = (chartBox.X(best.u) / chartBox.dpr) + 'px';
    tip.style.top = (chartBox.Y(best.y) / chartBox.dpr) + 'px';
  }

  /* ================= 탭 4 (C) 수렴 스캔 =================
   * 두 패널이 서로 다른 발견을 보인다. "조일수록 좋아진다"가 아니라
   * "무엇이 오차를 만들었고 어떻게 제거됐는가"를 보인다.
   *   C-1 영상법  N축   단순 합 ↔ Cesàro        (설계 §11-7)
   *   C-2 도선관  d축   정합 OFF ↔ 정합 ON      (설계 §11-6)
   * OFF·단순 곡선이 결과이고 ON·Cesàro 는 100%에 평평하다 — 대비가 내용이다.
   * 측정은 GEO.KAPPA_WIN·R² 가드를 포함한 measure.js 한 벌을 호출만 한다. */
  var N_LIST = [10, 20, 40, 80, 160, 320];
  var D_LIST = [3, 4, 5, 6, 8, 10, 12];
  var SY0 = 40, SY1 = 115;                   // 세로 40~115% 고정 (자동 범위 금지)
  var scan = { N: [], D: [], tasks: null, i: 0, t0: 0, ms: 0, running: false };

  function scanKappaOf(field, a, n, d, kThy) {
    return M.measureKappa(field, a, n, GEO.KAPPA_WIN, d, kThy);
  }

  function scanStep() {
    if (!scan.running) return false;
    var t = scan.tasks[scan.i];
    if (!t) { scan.running = false; scan.ms = performance.now() - scan.t0; scanInfo(); markDirty(); return false; }
    var a = state.a, k = 2 * Math.PI / state.lambda, kap = M.theoryKappa(1, a, k);
    var p = { lambda: state.lambda, a: a, y0OverA: state.y0OverA };

    if (t.kind === 'N') {
      var row = { N: t.N };
      [false, true].forEach(function (ces) {
        var s = AD.imageScene(Object.assign({}, p, { N: t.N, cesaro: ces, scatBand: state.scatBand }));
        var r = kap === null ? { value: null, reason: '전파 영역' } : scanKappaOf(s.tot, a, 1, 1, kap);
        row[ces ? 'ces' : 'sim'] = { ratio: r.value === null ? null : r.value / kap,
                                     reason: r.reason, r2: r.r2, plateAvg: s.quality.plateAvg };
      });
      scan.N.push(row);
    } else {
      var rowD = { d: t.d };
      [false, true].forEach(function (auto) {
        var s = AD.wireScene(Object.assign({}, p, { d: t.d, awAuto: auto, aw: GEO.aw }));
        var r = kap === null ? { value: null, reason: '전파 영역' } : scanKappaOf(s.tot, a, 1, t.d, kap);
        rowD[auto ? 'on' : 'off'] = { ratio: r.value === null ? null : r.value / kap,
                                      reason: r.reason, r2: r.r2,
                                      aw: s.quality.aw, awOverD: s.quality.awOverD,
                                      wallT: s.quality.wallT, delta: s.quality.delta };
      });
      // 예측비 — δ 로 넓어진 유효 폭의 이론 κ 비. OFF 측정점과 겹쳐야 한다 (설계 §11-6).
      var aEffOff = M.aEff(a, t.d, GEO.aw);
      var kapEff = M.theoryKappa(1, aEffOff, k);
      rowD.pred = (kap === null || kapEff === null) ? null : kapEff / kap;
      scan.D.push(rowD);
    }
    scan.i++;
    scanInfo(); markDirty();
    return true;
  }

  function scanInfo() {
    var n = scan.tasks ? scan.tasks.length : 0;
    el('scanInfo').textContent = !scan.tasks ? '조건: 현재 사이드바 값. 모드 1만.'
      : scan.running ? (scan.i + '/' + n + ' 완료 — 계산 중…')
      : (scan.i + '/' + n + ' 완료 · 소요 ' + (scan.ms / 1000).toFixed(1) + 's');
    el('scanRun').disabled = scan.running;
  }

  function scanRun() {
    if (scan.running) return;
    scan.N = []; scan.D = []; scan.i = 0; scan.ms = 0;
    scan.tasks = N_LIST.map(function (N) { return { kind: 'N', N: N }; })
      .concat(D_LIST.map(function (d) { return { kind: 'D', d: d }; }));
    scan.running = true; scan.t0 = performance.now();
    scanInfo();
    // rAF 로 한 점씩 끊는다 — 동기 루프로 돌리면 UI가 얼어붙는다
    (function pump() { if (scanStep()) requestAnimationFrame(pump); })();
  }

  /* ---------- (C) 그리기 ---------- */
  function scanAxes(cv, xLab, xs, xOf) {
    var dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    var padL = 44 * dpr, padR = 12 * dpr, padT = 12 * dpr, padB = 34 * dpr;
    var X = function (v) { return padL + xOf(v) * (W - padL - padR); };
    var Y = function (pc) { return padT + (SY1 - pc) / (SY1 - SY0) * (H - padT - padB); };
    ctx.clearRect(0, 0, W, H);
    ctx.font = (10.5 * dpr) + 'px sans-serif';
    ctx.lineWidth = 1 * dpr; ctx.strokeStyle = '#1b2140';
    [50, 60, 70, 80, 90, 110].forEach(function (pc) {
      ctx.beginPath(); ctx.moveTo(padL, Y(pc)); ctx.lineTo(W - padR, Y(pc)); ctx.stroke();
    });
    ctx.strokeStyle = '#2a3050'; ctx.strokeRect(padL, padT, W - padL - padR, H - padT - padB);
    // 100% 기준선 — 강조
    ctx.strokeStyle = '#aab2cf'; ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath(); ctx.moveTo(padL, Y(100)); ctx.lineTo(W - padR, Y(100)); ctx.stroke();
    ctx.fillStyle = '#8892b5'; ctx.textAlign = 'right';
    [50, 60, 70, 80, 90, 100, 110].forEach(function (pc) {
      ctx.fillText(pc + '%', padL - 5 * dpr, Y(pc) + 3.5 * dpr);
    });
    ctx.textAlign = 'center';
    xs.forEach(function (v) { ctx.fillText(String(v), X(v), H - padB + 14 * dpr); });
    ctx.fillText(xLab, (padL + W - padR) / 2, H - padB + 29 * dpr);
    return { ctx: ctx, X: X, Y: Y, dpr: dpr, W: W, H: H, padB: padB };
  }

  function scanSeries(g, rows, xKey, sKey, col, filled) {
    var ctx = g.ctx, first = true;
    ctx.strokeStyle = col; ctx.lineWidth = 1.8 * g.dpr; ctx.setLineDash([]);
    ctx.beginPath();
    rows.forEach(function (r) {
      var s = r[sKey]; if (!s || s.ratio === null) { first = true; return; }
      var x = g.X(r[xKey]), y = g.Y(s.ratio * 100);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    rows.forEach(function (r) {
      var s = r[sKey];
      if (!s || s.ratio === null) {
        if (s) {   // 측정 불가 — 점을 찍지 않고 x축 아래에 사유 약어
          ctx.fillStyle = '#8892b5'; ctx.textAlign = 'center';
          ctx.fillText((s.reason || '?').slice(0, 6), g.X(r[xKey]), g.H - g.padB + 26 * g.dpr);
        }
        return;
      }
      var x = g.X(r[xKey]), y = g.Y(s.ratio * 100);
      // 얇은 도선 근사 이탈은 다른 마커로 — 편차에 δ 효과와 근사 이탈이 섞여 있다
      if (s.awOverD > 0.25) {
        ctx.strokeStyle = col; ctx.lineWidth = 1.5 * g.dpr;
        var t = 5 * g.dpr;
        ctx.beginPath(); ctx.moveTo(x, y - t); ctx.lineTo(x + t, y + t); ctx.lineTo(x - t, y + t);
        ctx.closePath(); ctx.stroke();
      } else if (filled) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 3.4 * g.dpr, 0, 6.2832); ctx.fill();
      } else {
        ctx.strokeStyle = col; ctx.lineWidth = 1.5 * g.dpr;
        ctx.beginPath(); ctx.arc(x, y, 3.4 * g.dpr, 0, 6.2832); ctx.stroke();
      }
    });
  }

  function scanLegend(g, items) {
    var ctx = g.ctx, x = g.X === undefined ? 0 : 0;
    ctx.textAlign = 'left'; ctx.font = (10.5 * g.dpr) + 'px sans-serif';
    items.forEach(function (it, i) {
      var yy = 20 * g.dpr + i * 14 * g.dpr, xx = g.W - 150 * g.dpr;
      ctx.strokeStyle = it[1]; ctx.lineWidth = 2 * g.dpr; ctx.setLineDash(it[2] || []);
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 16 * g.dpr, yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = it[1]; ctx.fillText(it[0], xx + 21 * g.dpr, yy + 3.5 * g.dpr);
    });
  }

  var SIM_COL = '#e8913a', CES_COL = '#3fb56b', OFF_COL = '#e8913a', ON_COL = '#3fb56b', PRED_COL = '#9aa3b8';

  function drawScan() {
    var lx = Math.log(N_LIST[0]), lw = Math.log(N_LIST[N_LIST.length - 1]) - lx;
    var gN = scanAxes(el('cvScanN'), 'N (영상 쌍) — 로그축', N_LIST,
      function (v) { return (Math.log(v) - lx) / lw; });
    scanSeries(gN, scan.N, 'N', 'sim', SIM_COL, true);
    scanSeries(gN, scan.N, 'N', 'ces', CES_COL, true);
    scanLegend(gN, [['단순 합', SIM_COL], ['Cesàro', CES_COL]]);

    var d0 = 2.5, d1 = 12.5;
    var gD = scanAxes(el('cvScanD'), 'd (도선 간격, mm)', D_LIST,
      function (v) { return (v - d0) / (d1 - d0); });
    // 예측 점선 — 연속 곡선으로. OFF 측정점이 이 위에 놓이면 §11-6이 시각적으로 증명된다.
    var a = state.a, k = 2 * Math.PI / state.lambda, kap0 = M.theoryKappa(1, a, k);
    if (kap0 !== null) {
      gD.ctx.strokeStyle = PRED_COL; gD.ctx.lineWidth = 1.4 * gD.dpr;
      gD.ctx.setLineDash([5 * gD.dpr, 4 * gD.dpr]); gD.ctx.beginPath();
      for (var i = 0, f = true; i <= 200; i++) {
        var dd = d0 + (d1 - d0) * i / 200;
        var ke = M.theoryKappa(1, M.aEff(a, dd, GEO.aw), k);
        if (ke === null) { f = true; continue; }
        var pc = ke / kap0 * 100;
        if (pc < SY0 || pc > SY1) { f = true; continue; }
        if (f) { gD.ctx.moveTo(gD.X(dd), gD.Y(pc)); f = false; } else gD.ctx.lineTo(gD.X(dd), gD.Y(pc));
      }
      gD.ctx.stroke(); gD.ctx.setLineDash([]);
    }
    scanSeries(gD, scan.D, 'd', 'off', OFF_COL, true);
    scanSeries(gD, scan.D, 'd', 'on', ON_COL, true);
    scanLegend(gD, [['정합 OFF (a_w=0.8)', OFF_COL], ['정합 ON (a_w=d/2π)', ON_COL],
                    ['예측 κ(a_eff)/κ(a)', PRED_COL, [5, 4]]]);
    scanBoxes = { N: gN, D: gD };
  }

  var scanBoxes = null;
  function scanTip(which, ev) {
    var cv = el(which === 'N' ? 'cvScanN' : 'cvScanD');
    var tip = el(which === 'N' ? 'tipScanN' : 'tipScanD');
    var g = scanBoxes && scanBoxes[which];
    if (!g) return;
    var r = cv.getBoundingClientRect();
    var mx = (ev.clientX - r.left) * g.dpr, my = (ev.clientY - r.top) * g.dpr;
    var best = null, bd = 14 * g.dpr;
    (which === 'N' ? scan.N : scan.D).forEach(function (row) {
      (which === 'N' ? ['sim', 'ces'] : ['off', 'on']).forEach(function (kk) {
        var s = row[kk]; if (!s || s.ratio === null) return;
        var d = Math.hypot(g.X(which === 'N' ? row.N : row.d) - mx, g.Y(s.ratio * 100) - my);
        if (d < bd) { bd = d; best = { row: row, k: kk, s: s }; }
      });
    });
    if (!best) { tip.style.display = 'none'; return; }
    var s = best.s;
    tip.style.display = '';
    tip.textContent = which === 'N'
      ? (best.k === 'sim' ? '단순 합' : 'Cesàro') + ' N=' + best.row.N +
        ' · κ비 ' + (s.ratio * 100).toFixed(1) + '% · plateAvg ' + s.plateAvg.toFixed(6)
      : (best.k === 'off' ? '정합 OFF' : '정합 ON') + ' d=' + best.row.d +
        ' · κ비 ' + (s.ratio * 100).toFixed(1) + '% · a_w/d ' + s.awOverD.toFixed(3) +
        ' · wallT ' + s.wallT.toFixed(4);
    tip.style.left = (g.X(which === 'N' ? best.row.N : best.row.d) / g.dpr) + 'px';
    tip.style.top = (g.Y(s.ratio * 100) / g.dpr) + 'px';
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
      // G4 게이트 임계 3%는 G2 조건(a=6.0cm, λ=14.4cm)에서만 정의된 값이다.
      // 조건을 벗어난 값이 게이트 실패로 오독되지 않게 한 줄 덧붙인다.
      var atG2 = (state.a === 60 && state.lambda === 144);
      el('diffVal').textContent = '관 내부 상대 차이: ' +
        (relL2(scenes.image.tot, scenes.wire.tot) * 100).toFixed(1) + '%' +
        (atG2 ? '' : '   (참고 — G4 게이트 임계 3%는 λ=14.4 cm 조건에서만 정의됨)');
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
      grid.style.gridTemplateColumns = ''; grid.style.gridTemplateRows = ''; grid.style.margin = '';
      grid.classList.remove('smooth');
      side.style.flex = ''; side.classList.remove('wide');
      el('scaleWarn').textContent = ''; el('scaleWarn').style.display = 'none';
      layoutLog.fallback++; layoutLog.d = null;
      return;
    }

    // 탭 4는 필드 캔버스가 없다. 차트는 표시 크기 × DPR 로 백킹을 맞추는
    // 별도 규칙을 쓴다 (원본 script.js:fitGraph) — 정수 스냅을 적용하지 않는다.
    if (state.tab === 4) {
      el('scaleWarn').textContent = ''; el('scaleWarn').style.display = 'none';
      fitChart(); markDirty();
      layoutLog.applied++; layoutLog.d = null;
      return;
    }

    var dpr = effDpr();
    var colWmin = Math.ceil(GEO.Nx / dpr);          // 제약 1
    var availW = main.clientWidth;

    // 열 수 — 탭 1·2는 1열, 탭 3은 2열. 그리드 열은 라벨 1 + nCols 이므로 gap 은 nCols 개.
    var nCols = sidesOf(state.tab).length;

    // 사이드바에 sw 를 남겼을 때 가로가 허용하는 컬럼 폭
    function byWidth(sw) {
      return Math.floor((availW - sw - GAP_X - LBL_W - nCols * COL_GAP) / nCols);
    }
    /* 세로 예산은 뷰포트 산술로 낸다 — main.clientHeight 를 쓰면 안 된다.
     * 캡션을 예산에서 제외하고 펼치면 페이지가 아래로 스크롤되게 했으므로,
     * 펼친 상태의 main.clientHeight 는 캡션만큼 커진다. 그 값으로 행 높이를 정하면
     * 행이 커지고 → main 이 또 커지는 순환이 된다.
     * page-head·footcap 높이는 그리드 크기에 의존하지 않아 안정적이다. */
    function budgetH() {
      var bs = window.getComputedStyle(document.body);
      var used = parseFloat(bs.paddingTop) + parseFloat(bs.paddingBottom);
      var ph = document.querySelector('.page-head'), fc = document.querySelector('.footcap');
      used += ph.offsetHeight;
      used += fc.offsetHeight + parseFloat(window.getComputedStyle(fc).marginTop);
      return document.documentElement.clientHeight - used;
    }
    // 캡션 높이는 예산에 넣지 않는다 (②) — 펼쳐도 그리드 크기가 변하지 않는다.
    function byHeight() {
      // 숨긴 열머리는 offsetHeight 0 이므로 보이는 쪽이 그대로 최댓값이 된다
      var headH = Math.max(el('head-image').offsetHeight, el('head-wire').offsetHeight);
      var rowH = Math.floor((budgetH() - headH - 4 * GAP_Y) / 3);
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

        /* 정수 배율 스냅 — 정확성 요구사항이지 최적화가 아니다.
         * 배율이 정수가 아니면 pixelated 가 일부 소스 행만 두 번 그려 1px 벽선의
         * 두께가 1px·2px 로 섞인다. 정수로 내리면 소스 1픽셀 = 장치 N픽셀이 된다.
         * 종횡비를 유지하고 백킹이 Nx×Ny 이므로 가로가 정수면 세로도 자동으로 정수다. */
        d.colWraw = d.colW;
        d.scaleRaw = d.colW * dpr / GEO.Nx;
        // 경계 허용오차 — 배율이 0.9999999 로 나와 스냅을 건너뛰는 것을 막는다.
        // 이 화면 100% 줌은 채택 colW 가 바닥과 정확히 일치해 늘 경계에 앉는다.
        var k = Math.floor(d.scaleRaw + 1e-9);
        if (k >= 1) {
          d.snap = k;
          d.colW = k * GEO.Nx / dpr;                  // 장치 픽셀로는 정확히 k×Nx
        } else {
          d.snap = 0;                                 // 축소 — 스냅할 정수 배율이 없다
        }
        d.nCols = nCols;
        d.rowH = d.colW * GEO.Ny / GEO.Nx;
        // k===0 이어도 colW 는 손대지 않으므로 0이 될 수 없지만, 어떤 경로로도
        // 0·음수·NaN 이 새어 나가지 않게 막고 발생하면 조용히 넘기지 않는다.
        if (!(d.colW > 40) || !(d.rowH > 16) || !isFinite(d.colW) || !isFinite(d.rowH)) {
          if (typeof console !== 'undefined' && console.error)
            console.error('[layout] colW/rowH 가 비정상입니다 — 배치를 적용하지 않습니다', {
              colW: d.colW, rowH: d.rowH, colWraw: d.colWraw, snap: d.snap,
              dpr: dpr, scaleRaw: d.scaleRaw, byH: d.byH, byW2: d.byW2, byW1: d.byW1
            });
          return null;
        }
        d.gridW = LBL_W + nCols * d.colW + nCols * COL_GAP;
        // 제약 4 — 남는 폭은 사이드바가 흡수하되 상한을 넘지 않는다
        d.sideW = Math.max(d.relaxed ? SIDE_MIN : SIDE_2COL,
                    Math.min(SIDE_MAX, Math.floor(availW - d.gridW - GAP_X)));
        d.twoCol = d.sideW >= SIDE_2COL;             // 실제로 2열이 되었는가
        d.sideCapped = d.sideW >= SIDE_MAX;
        d.scale = d.colW * dpr / GEO.Nx;
        d.shrink = d.scale < 1;                      // 축소 불가피
        d.slack = availW - d.gridW - GAP_X - d.sideW;
        // 바인딩은 스냅 전 값으로 판정한다 — 스냅 후 colW 는 두 후보 중 어느 것도 아니다.
        d.cand = d.relaxed ? d.byW1 : d.byW2;
        d.binding = d.byH < d.cand ? '세로' : (d.byH > d.cand ? '가로' : '세로=가로');
        d.freed = 2 * (d.colWraw - d.colW);          // 스냅으로 회수된 폭

        side.style.flex = '0 0 ' + d.sideW + 'px';
        side.classList.toggle('wide', d.twoCol);
        // 최근접(pixelated)은 축소 구간에서 데이터를 버린다 — 단일 행인 벽선이 통째로
        // 사라진다. 흐릿하더라도 남기는 쪽이 정직하므로 그때만 auto 로 바꾼다.
        grid.classList.toggle('smooth', d.shrink);
        // ⑤ 남는 폭 안에서 그리드를 가운데로 (왼쪽으로 몰리면 사이드바와 붙어 보인다)
        grid.style.margin = '0 auto';
        var cw = d.colW.toFixed(3), rh = d.rowH.toFixed(3);
        grid.style.gridTemplateColumns = LBL_W + 'px ' + (cw + 'px ').repeat(nCols).trim();
        grid.style.gridTemplateRows = 'auto ' + rh + 'px ' + rh + 'px ' + rh + 'px auto';
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

    // 축소 경고는 ?debug=1 밖에 둔다 — 평소에 축소된 화면을 모르고 보면 안 된다.
    // 배율 1.000 이면 표시하지 않는다.
    var w = el('scaleWarn');
    if (d.shrink) {
      w.textContent = '⚠ 캔버스 축소 표시 (배율 ' + d.scale.toFixed(2) +
                      ') — 창을 크게 하거나 줌을 낮추세요';
      w.style.display = '';
    } else { w.textContent = ''; w.style.display = 'none'; }

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
        ' outer/inner ' + d.zoom.toFixed(3) + ' 는 표시용이며 계산에 쓰지 않는다)',
      '캔버스 배율 ' + d.scale.toFixed(3) + '  (= colW ' + d.colW.toFixed(1) + ' × 실효DPR ' +
        d.dpr.toFixed(3) + ' / ' + GEO.Nx + ')' +
        (d.scale >= 1 ? '  ✓ 축소 없음' : '  ⚠ 축소 — 벽선(단일 행)이 사라질 수 있음'),
      '정수 스냅: 스냅 전 colW ' + d.colWraw + ' (배율 ' + d.scaleRaw.toFixed(3) + ')' +
        ' → 후 ' + d.colW.toFixed(1) + ' (×' + (d.snap || '—') + ')' +
        '  · 렌더링 ' + (d.shrink ? 'auto (축소 구간)' : 'pixelated'),
      '제약 판정: 가로 ' + (d.relaxed ? d.byW1 : d.byW2) + ' / 세로 ' + d.byH +
        ' / 사이드바 2열 ' + (d.twoCol ? 'ON' : 'OFF') + '(' + d.sideW + ')' +
        ' / 채택 colW ' + d.colW + '  (바닥 ' + d.colWmin + ')',
      '           바인딩 = ' + d.binding + ' (스냅 전 ' + d.colWraw + ' = min(세로 ' + d.byH +
        ', 가로 ' + d.cand + '))' +
        ' · 캡션 ' + (el('compare').classList.contains('capfold') ? '접힘' : '펼침') +
        ' · 압축(c) ' + (d.tight ? 'ON' : 'OFF') +
        ' · 2열예약포기(d) ' + (d.relaxed ? 'ON' : 'OFF') +
        ' · rowH ' + d.rowH.toFixed(1) + ' gridW ' + d.gridW.toFixed(1),
      '남는 폭 처리: 스냅 회수 ' + d.freed.toFixed(1) + 'px → 사이드바 ' + d.sideW +
        (d.sideCapped ? ' (상한 ' + SIDE_MAX + ' 도달 — 더 흡수 못 함)' : ' (흡수 중)') +
        ' · 여백 ' + d.slack.toFixed(1) + 'px (그리드 가운데 정렬)'
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

  /* ---------------- 탭 (단계 9) ----------------
   * 탭 1·2는 탭 3에서 한 열을 숨긴 것이다 (v1 §10-1). 렌더러·스케일·마스킹·캡션·
   * 눈금자가 전부 같고, 슬라이더 상태도 탭을 넘어 유지된다 (v1 §10-0).
   * 두 Scene 은 탭과 무관하게 항상 계산한다 — 측정값과 읽기값이 탭에 따라
   * 달라지면 "같은 입력이 양쪽을 동시에 구동한다"는 주장이 깨진다. */
  function setTab(n) {
    var was = state.tab;
    state.tab = n;
    var grid = el('compare');
    grid.classList.toggle('only-image', n === 1);
    grid.classList.toggle('only-wire', n === 2);
    grid.style.display = (n === 4) ? 'none' : '';
    el('tab4').style.display = (n === 4) ? '' : 'none';
    // 하단 캡션은 좌우 비교에 대한 문구다 (v1 §10-3) — 다른 탭에서는 숨긴다
    el('footcap').style.display = (n === 3) ? '' : 'none';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', +b.dataset.tab === n);
    });
    layout(); markDirty();
    // 탭 4로 처음 들어오면 대조군(모드합) Scene 이 없다 → 재계산해서 채운다
    if (n === 4 && was !== 4) recompute(); else drawFrame();
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
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      if (!b.disabled) b.addEventListener('click', function () { setTab(+b.dataset.tab); });
    });
    // 자동 삭제는 두지 않는다 — 정규화 축에서 곡선은 a 에 무관하고, 프리셋이 a 를
    // 바꾸므로 자동 삭제를 두면 프리셋을 누를 때마다 점이 날아간다 (설계 §9-4).
    el('clearPts').addEventListener('click', function () { pts = []; markDirty(); });
    el('scanFold').addEventListener('click', function () {
      var on = el('t4scan').classList.toggle('folded');
      el('scanFold').textContent = on ? '(C) 수렴 스캔 ▸' : '(C) 수렴 스캔 ▾';
      markDirty();
    });
    el('scanRun').addEventListener('click', scanRun);
    el('scanClear').addEventListener('click', function () {
      scan.N = []; scan.D = []; scan.tasks = null; scan.i = 0; scanInfo(); markDirty();
    });
    el('cvScanN').addEventListener('mousemove', function (e) { scanTip('N', e); });
    el('cvScanD').addEventListener('mousemove', function (e) { scanTip('D', e); });
    el('cvScanN').addEventListener('mouseleave', function () { el('tipScanN').style.display = 'none'; });
    el('cvScanD').addEventListener('mouseleave', function () { el('tipScanD').style.display = 'none'; });
    // 숨겨진 창은 rAF 가 멈춰 스캔이 진행되지 않는다. 진단용 수동 구동 훅.
    if (DEBUG) window.__scan = { run: scanRun, step: scanStep, data: scan };
    scanInfo();
    el('cvDisp').addEventListener('mousemove', chartTip);
    el('cvDisp').addEventListener('mouseleave', function () { el('ptTip').style.display = 'none'; });
    // 캡션 접기 — 펼치면 세로를 먹고, 컬럼 폭이 행 높이에서 역산되므로 캔버스가 작아진다
    // 캡션은 레이아웃 예산 밖이다 — 펼치면 그리드 크기가 그대로이고 페이지가 아래로
    // 스크롤된다. 배율 1.000과 pixelated 가 유지되며, 좌우 열 대응도 그대로다.
    el('capBtn').addEventListener('click', function () {
      var on = el('compare').classList.toggle('capfold');
      document.body.classList.toggle('capopen', !on);
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
