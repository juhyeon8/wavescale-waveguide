'use strict';
/* =============================================================================
 * unified/verify.js — 검증 게이트 (렌더 이전)
 * =============================================================================
 *   node unified/verify.js               모든 게이트
 *   node unified/verify.js G0 G1         선택 실행
 *
 * G0·G1 은 PASS/FAIL. 나머지는 판정 없이 표만 출력한다. (설계 §7-0)
 * 임계값을 추측해서 박지 말 것 — 추측한 임계값은 검증이 아니라 자기충족적 선언이다.
 * 창(A/B/C)과 임계값은 단계 6에서 사람이 확정한다.
 * ========================================================================== */

var GEO = require('./geometry.js');
var M   = require('./measure.js');
var AD  = require('./adapters.js');

var FAIL = [];
function L(s) { console.log(s === undefined ? '' : s); }
// 한글·CJK는 터미널에서 두 칸을 차지한다. 이걸 세지 않으면 표가 어긋난다.
function w(s) {
  s = String(s); var n = 0;
  for (var i = 0; i < s.length; i++)
    n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(s[i]) ? 2 : 1;
  return n;
}
function pad(s, n)  { s = String(s); var k = n - w(s); return k > 0 ? ' '.repeat(k) + s : s; }
function padR(s, n) { s = String(s); var k = n - w(s); return k > 0 ? s + ' '.repeat(k) : s; }
function hr(t) { L(); L('='.repeat(86)); L(t); L('='.repeat(86)); }

// 조건 = 프리셋 (설계 §9-1). 프리셋과 검증 조건이 같은 것이 이 설계의 성질이다.
var COND = {
  P1: { name: '① 완전차단', a: 60, lambda: 144, y0OverA: 0.5   },   // = G2
  P2: { name: '② 단일모드', a: 60, lambda:  90, y0OverA: 0.5   },   // = G3(a)
  P3: { name: '③ 2모드',    a: 60, lambda:  48, y0OverA: 0.25  },   // = G3(b)
  P4: { name: '④ 3모드',    a: 60, lambda:  33, y0OverA: 0.167 }    // = G3(c) 슬라이더 스냅값
};
var N_IMG = 80;   // v1 §13: N=40은 잘림 간섭의 골짜기(κ 76%)라 쓰면 안 된다

// 세 열 — 모드합 / 영상법 / 도선관. d 는 resolvable 판정에만 쓴다.
function columns(c) {
  var d = AD.dAuto(c.lambda);
  return [
    { key: 'sum',   label: '모드합',  d: 1, scene: AD.imageScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, modeInfinity: true }) },
    { key: 'image', label: '영상법',  d: 1, scene: AD.imageScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, N: N_IMG }) },
    { key: 'wire',  label: '도선관',  d: d, scene: AD.wireScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, d: d }) }
  ];
}

function qualityLine(cols) {
  var q = {};
  cols.forEach(function (c) { q[c.key] = c.scene.quality; });
  return '  모드합: (해석해)   영상법: N=' + q.image.N + ', plateAvg=' + q.image.plateAvg.toFixed(6) +
         '   도선관: d=' + q.wire.d.toFixed(3) + ', wallT=' + q.wire.wallT.toFixed(4) + ', aw=' + q.wire.aw;
}

/* ================================================================= G0 좌표 정합 */
function argmaxInc(sc) {
  var f = sc.inc, best = -1, bi = 0, bj = 0;
  for (var i = 0; i < f.Nx; i++) for (var j = 0; j < f.Ny; j++) {
    var idx = i * f.Ny + j, m = f.re[idx] * f.re[idx] + f.im[idx] * f.im[idx];
    if (m > best) { best = m; bi = i; bj = j; }
  }
  return [bi, bj];
}

function runG0() {
  hr('[G0] 좌표 정합 — 두 Scene이 정확히 일치해야 한다 (오차 허용 없음)');
  var AS = [48, 60, 100, 160], YS = [0.05, 0.25, 0.5, 1 / 6, 0.95];
  var lambda = 144, d = AD.dAuto(lambda), bad = 0, n = 0;
  L('  조건: λ=' + lambda + ', N=4(영상법), d=' + d.toFixed(3) + '(도선관)');
  L();
  L('    a   y₀/a     srcPix  srcYPix    wallBot  wallTop   Nx   Ny   |inc|최대점   판정');
  L('  ' + '-'.repeat(84));
  AS.forEach(function (a) { YS.forEach(function (y) {
    var si = AD.imageScene({ lambda: lambda, a: a, y0OverA: y, N: 4 });
    var sw = AD.wireScene({ lambda: lambda, a: a, y0OverA: y, d: d });
    n++;
    var mi = si.markers.filter(function (m) { return m.kind === 'source'; })[0];
    var mw = sw.markers.filter(function (m) { return m.kind === 'source'; })[0];
    var ai = argmaxInc(si), aw = argmaxInc(sw);
    var ok = [ mi.xPix === mw.xPix, mi.yPix === mw.yPix,
               si.walls.yBotPix === sw.walls.yBotPix, si.walls.yTopPix === sw.walls.yTopPix,
               si.Nx === sw.Nx, si.Ny === sw.Ny,
               mi.xPix === GEO.srcPix(), mi.yPix === GEO.srcYPix(a, y),
               ai[0] === aw[0] && ai[1] === aw[1], ai[0] === GEO.srcPix() ].every(Boolean);
    if (!ok) { bad++; FAIL.push('G0 a=' + a + ' y0/a=' + y.toFixed(4)); }
    L('  ' + pad(a, 3) + '  ' + pad(y.toFixed(4), 6) + '   ' + pad(mi.xPix, 6) + '  ' +
      pad(mi.yPix.toFixed(3), 8) + '   ' + pad(si.walls.yBotPix, 6) + '   ' + pad(si.walls.yTopPix, 6) +
      '  ' + pad(si.Nx, 4) + ' ' + pad(si.Ny, 4) + '   (' + pad(ai[0], 3) + ',' + pad(ai[1], 4) + ')    ' +
      (ok ? 'OK' : 'FAIL'));
  }); });
  L('  ' + '-'.repeat(84));
  L('  ' + n + '개 조합 중 ' + (n - bad) + '개 일치 → ' + (bad === 0 ? 'G0 PASS' : 'G0 FAIL (' + bad + '건)'));
}

/* ================================================================= G1 입사장 동일성 */
// 비교 영역: 소스 중심에서 r ≥ 5셀. 근접장에서 H₀가 발산하고 영상법은 룩업 보간을 쓰므로 제외.
// 지표: 영역 내 max|E_inc| 로 정규화한 상대 L2.  PASS < 1e-3
function relL2Inc(sa, sb, a, y0OverA) {
  var x0 = GEO.srcPix(), ys = GEO.srcYPix(a, y0OverA);
  var A = sa.inc, B = sb.inc, sum = 0, cnt = 0, mx = 0;
  for (var i = 0; i < A.Nx; i++) {
    var dx = i - x0, dx2 = dx * dx;
    for (var j = 0; j < A.Ny; j++) {
      var dy = j - ys;
      if (dx2 + dy * dy < 25) continue;                 // r < 5셀 제외
      var k = i * A.Ny + j;
      var dr = A.re[k] - B.re[k], di = A.im[k] - B.im[k];
      sum += dr * dr + di * di; cnt++;
      var m = A.re[k] * A.re[k] + A.im[k] * A.im[k];
      if (m > mx) mx = m;
    }
  }
  return Math.sqrt(sum / cnt) / Math.sqrt(mx);
}

function runG1() {
  hr('[G1] 입사장 동일성 — 상대 L2 < 1e-3');
  L('  비교 영역: 소스에서 r ≥ 5셀인 모든 픽셀. 지표: RMS(차) / max|E_inc|');
  L('  두 입사장이 안 맞으면 아래 게이트가 전부 무의미하다. 영상법 Hankel 테이블 보간 정확도도 함께 잰다.');
  L();
  L('    조건            a     λ    y₀/a     상대 L2      판정');
  L('  ' + '-'.repeat(60));
  Object.keys(COND).forEach(function (key) {
    var c = COND[key];
    var si = AD.imageScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, N: 4 });
    var sw = AD.wireScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, d: AD.dAuto(c.lambda) });
    var r = relL2Inc(si, sw, c.a, c.y0OverA);
    var ok = r < 1e-3;
    if (!ok) FAIL.push('G1 ' + c.name);
    L('  ' + padR(c.name, 14) + pad(c.a, 4) + pad(c.lambda, 6) + pad(c.y0OverA.toFixed(3), 8) + '   ' +
      pad(r.toExponential(3), 11) + '    ' + (ok ? 'PASS' : 'FAIL'));
  });
  L('  ' + '-'.repeat(60));
}

/* ================================================================= G2 κ (판정 없음) */
function runG2() {
  var c = COND.P1;
  hr('[G2] κ 측정/이론 (%)   ' + c.name + ' : a=' + c.a + ', λ=' + c.lambda + ', y₀/a=' + c.y0OverA);
  L('  ※ 모드합 열은 해석적 정확해입니다. 세 창 모두 100.0%가 정상이며,');
  L('    이 열은 창의 우열을 가리지 않습니다. 측정 코드 정상 여부만 확인합니다.');
  L('  판정(PASS/FAIL) 없음 — 실측만 보고합니다. 창과 임계값은 단계 6에서 확정합니다.');
  L();
  var cols = columns(c);
  L(qualityLine(cols));
  var k = 2 * Math.PI / c.lambda, dev = [];

  for (var n = 1; n <= 3; n++) {
    var kap = M.theoryKappa(n, c.a, k), cp = M.coupling(n, c.y0OverA);
    L();
    if (kap === null) { L('  mode ' + n + '  — 전파 모드 (G3 참조)'); continue; }
    var res = 1 / kap >= AD.dAuto(c.lambda);
    L('  mode ' + n + '  (이론 κ = ' + kap.toFixed(7) + ' /셀,  1/κ = ' + (1 / kap).toFixed(2) +
      '셀,  결합 = ' + cp.toExponential(2) + ',  도선관 resolvable ' + (res ? '✓' : '✗') + ')');
    L('    창          z구간             ' + cols.map(function (q) { return padR(q.label, 22); }).join(''));
    M.WINDOW_IDS.forEach(function (w) {
      var win = M.kappaWindow(w, kap);
      var cells = cols.map(function (q) {
        var r = M.measureKappa(q.scene.tot, c.a, n, w, q.d, kap);
        if (r.value === null) return padR(r.reason, 22);
        var pct = r.value / kap * 100;
        if (q.key === 'sum') dev.push(Math.abs(pct - 100));
        return padR(pct.toFixed(1) + '%', 22);
      });
      L('    ' + padR(M.WINDOW_LABEL[w], 11) + padR('[' + win.zStart.toFixed(1) + ', ' + win.zEnd.toFixed(1) + ']', 17) + cells.join(''));
    });
  }
  L();
  var worst = dev.length ? Math.max.apply(null, dev) : 0;
  L('  모드합 열 최대 이탈: ' + worst.toFixed(3) + '%p  → ' +
    (worst < 0.5 ? '측정 코드 정상 (< 0.5%p)' : '⛔ 0.5%p 이상 — 측정 코드 버그. 중단하고 보고할 것'));
  if (worst >= 0.5) FAIL.push('G2 모드합 이탈 ' + worst.toFixed(3) + '%p');
  L();
  L('  ▸ 모드합이 100.0%인데 영상법·도선관이 측정 불가로 나오면,');
  L('    그것은 측정의 한계가 아니라 그 방법 자체의 한계입니다.');
}

/* ========================================================== G2-PROFILE 국소 기울기 */
function runG2P() {
  var c = COND.P1;
  hr('[G2-PROFILE] 국소 기울기 프로파일   a=' + c.a + ', λ=' + c.lambda + ', y₀/a=' + c.y0OverA);
  L('  부분창마다 §7-4 가드 없이 로그 기울기만 계산. 평탄 구간을 데이터에서 직접 읽는다.');
  L('  앞쪽이 휘면 소스 근접장, 뒤쪽이 휘면 누설 바닥. 이것이 창 결정의 1차 근거다.');
  var cols = columns(c);
  var k = 2 * Math.PI / c.lambda;

  [1, 2].forEach(function (n) {
    var kap = M.theoryKappa(n, c.a, k);
    if (kap === null) return;
    var profs = cols.map(function (q) { return M.localKappaProfile(q.scene.tot, c.a, n, kap); });
    var wins = M.WINDOW_IDS.map(function (w) {
      var win = M.kappaWindow(w, kap);
      return w + ' ' + win.zStart.toFixed(1) + '~' + win.zEnd.toFixed(1);
    }).join(',  ');
    L();
    L('  mode ' + n + '  부분창 ' + profs[0].len.toFixed(0) + '셀,  결합 ' + M.coupling(n, c.y0OverA).toExponential(2) +
      '   (창 ' + wins + ')');
    L('    z중심    ' + cols.map(function (q) { return pad(q.label, 9); }).join('') + '   비고');
    profs[0].rows.forEach(function (row, i) {
      var cells = profs.map(function (p) {
        var r = p.rows[i].ratio;
        return pad(r === null ? '—' : (r * 100).toFixed(1) + '%', 9);
      });
      L('    ' + pad(row.zCenter.toFixed(1), 6) + '  ' + cells.join('') + '   ' +
        (row.crossesSource ? '← 창이 소스를 가로지름' : ''));
    });
  });
  L();
  L('  ▸ 모드합이 100.0%가 아닌 행은 나머지 두 열도 무효다. §7-1의 0.5%p 중단 조건은 여기 적용하지 않는다.');
}

/* ================================================================= G3 k_z (판정 없음) */
function runG3() {
  hr('[G3] k_z 측정/이론 (%) — 판정 없음');
  L('  창은 fitWindowZ 하나. (i) 표준 / (ii) 리플 절단 — 창 길이를 λ_g 정수배로 자른 것.');
  L('  위상 섭동항의 주기가 λ_g/2이므로 정수 주기로 자르면 최소제곱 기울기에서 상쇄된다.');
  L('  두 값이 크게 다르면 리플 편향이 실재, 같으면 무시해도 된다.');

  ['P2', 'P3', 'P4'].forEach(function (key) {
    var c = COND[key];
    var cols = columns(c);
    var k = 2 * Math.PI / c.lambda;
    var kmin = M.kappaMinOfCutoff(c.a, k, 3);
    var win = M.kzWindow(kmin);
    L();
    L('── ' + c.name + '  a=' + c.a + ', λ=' + c.lambda + ' (λ/a=' + (c.lambda / c.a).toFixed(2) +
      '), y₀/a=' + c.y0OverA + ' ──');
    L(qualityLine(cols));
    L('  k_z 창 [' + win.zStart.toFixed(4) + ', ' + win.zEnd.toFixed(1) + ']  길이 ' +
      (win.zEnd - win.zStart).toFixed(6) + (kmin ? '   (κ_min = ' + kmin.toFixed(6) + ')' : '   (차단 모드 없음)'));
    L('    모드  결합     이론 k_z     λ_g       주기수   변형   ' + cols.map(function (q) { return padR(q.label, 20); }).join(''));
    for (var n = 1; n <= 3; n++) {
      var kz = M.theoryKz(n, c.a, k);
      if (kz === null) {
        L('     ' + n + '   ' + pad(M.coupling(n, c.y0OverA).toFixed(3), 6) + '   — 차단 (κ = ' +
          M.theoryKappa(n, c.a, k).toFixed(6) + ')');
        continue;
      }
      var lamG = 2 * Math.PI / kz;
      var per = (win.zEnd - win.zStart) / (lamG / 2);
      [false, true].forEach(function (tr) {
        var cells = cols.map(function (q) {
          var r = M.measureKz(q.scene.tot, c.a, n, kz, kmin, { truncate: tr });
          return padR(r.value === null ? r.reason : (r.value / kz * 100).toFixed(1) + '%', 20);
        });
        L('     ' + (tr ? ' ' : n) + '   ' + (tr ? '      ' : pad(M.coupling(n, c.y0OverA).toFixed(3), 6)) + '   ' +
          (tr ? '           ' : pad(kz.toFixed(6), 9) + '  ') + (tr ? '        ' : pad(lamG.toFixed(3), 8)) +
          '  ' + (tr ? '       ' : pad(per.toFixed(4), 7)) + '  ' + padR(tr ? '(ii)절단' : '(i)표준', 11) + cells.join(''));
      });
    }
  });
}

/* ================================================================= G3-AW a_w 민감도 */
function runG3AW() {
  hr('[G3-AW] a_w 민감도 스캔');
  L('  core.js 사용 조건은 a_w ≪ d. dAuto = 0.055λ이므로 a_w/d = 14.5/λ 이고,');
  L('  프리셋 ③④가 이미 문턱(0.25)을 넘는다 — 그 둘이 곧 G3(b)(c) 조건이다.');
  L('  모드합·영상법은 a_w와 무관하므로 같은 값이 나오는 것이 정상이다 (대조군).');

  ['P3', 'P4'].forEach(function (key) {
    var c = COND[key];
    var d = AD.dAuto(c.lambda), k = 2 * Math.PI / c.lambda;
    var kmin = M.kappaMinOfCutoff(c.a, k, 3);
    var base = [
      { key: 'sum',   label: '모드합', scene: AD.imageScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, modeInfinity: true }) },
      { key: 'image', label: '영상법', scene: AD.imageScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, N: N_IMG }) }
    ];
    L();
    L('── ' + c.name + '  λ=' + c.lambda + ', d=' + d.toFixed(3) + ' ──');
    for (var n = 1; n <= 3; n++) {
      var kz = M.theoryKz(n, c.a, k);
      if (kz === null) continue;
      L('  mode ' + n + '  (이론 k_z = ' + kz.toFixed(6) + ')');
      L('    a_w    a_w/d   틈       모드합    영상법    도선관    wallT     경고');
      [0.8, 0.5, 0.3].forEach(function (aw) {
        var sw = AD.wireScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, d: d, aw: aw });
        var cells = base.concat([{ key: 'wire', scene: sw }]).map(function (q) {
          var r = M.measureKz(q.scene.tot, c.a, n, kz, kmin);
          return pad(r.value === null ? r.reason : (r.value / kz * 100).toFixed(1) + '%', 9);
        });
        var ratio = aw / d;
        var warn = ratio >= 0.5 ? '⛔ 도선 겹침' : (ratio > 0.25 ? '⚠ 근사 이탈' : '');
        L('    ' + pad(aw.toFixed(1), 4) + '  ' + pad(ratio.toFixed(3), 6) + '  ' +
          pad((d - 2 * aw).toFixed(3), 6) + '  ' + cells.join('') + '  ' +
          pad(sw.quality.wallT.toFixed(4), 7) + '   ' + warn);
      });
    }
  });
}

/* ================================================================= G4 (실측만) */
function runG4() {
  var c = COND.P1;
  hr('[G4] 차단 영역 전체장 일치도 — 임계값 없음, 실측값만 보고');
  L('  비교 영역(고정): 벽 사이 ∧ z ∈ [' + GEO.G4_ZRANGE[0] + ', ' + GEO.G4_ZRANGE[1] + ']');
  L('  이 영역은 κ 창 결정(A/B/C)과 무관하며 단계 6에서 바뀌지 않는다. 단계 5′ 재실행 때도 같은 영역.');
  L('  지표: RMS(차) / max|E_tot|   (영역 내)');
  L();
  var cols = columns(c);
  L(qualityLine(cols));
  var t = M.jBotTop(c.a);
  var i0 = Math.round(GEO.zToPix(GEO.G4_ZRANGE[0])), i1 = Math.round(GEO.zToPix(GEO.G4_ZRANGE[1]));

  function cmp(A, B) {
    var sum = 0, cnt = 0, mx = 0;
    for (var i = i0; i <= i1; i++) for (var j = t.jBot + 1; j < t.jTop; j++) {
      var idx = i * A.Ny + j;
      var dr = A.re[idx] - B.re[idx], di = A.im[idx] - B.im[idx];
      sum += dr * dr + di * di; cnt++;
      var ma = A.re[idx] * A.re[idx] + A.im[idx] * A.im[idx];
      var mb = B.re[idx] * B.re[idx] + B.im[idx] * B.im[idx];
      if (ma > mx) mx = ma; if (mb > mx) mx = mb;
    }
    return Math.sqrt(sum / cnt) / Math.sqrt(mx);
  }
  L('  픽셀 x [' + i0 + ', ' + i1 + '],  y (' + t.jBot + ', ' + t.jTop + ') 배타');
  L();
  L('    비교쌍                   상대 L2');
  L('  ' + '-'.repeat(44));
  [['모드합 ↔ 영상법', 0, 1], ['모드합 ↔ 도선관', 0, 2], ['영상법 ↔ 도선관  ★', 1, 2]].forEach(function (p) {
    L('  ' + padR(p[0], 24) + pad(cmp(cols[p[1]].scene.tot, cols[p[2]].scene.tot).toExponential(4), 12));
  });
  L('  ' + '-'.repeat(44));
  L('  ★ = v1 §8의 G4 대상. 임계값은 이 실측값을 보고 사람이 확정한다.');
}

/* ================================================================= G5 이중 수렴 */
function runG5() {
  var c = COND.P1;
  hr('[G5] 이중 수렴 스캔 — 판정 없음');
  L('  손잡이를 조일수록 각각 이론값에 가까워지는지 본다. 창 A·B·C를 모두 보인다 (창 미확정이므로).');
  var k = 2 * Math.PI / c.lambda, kap = M.theoryKappa(1, c.a, k);
  L('  mode 1,  이론 κ = ' + kap.toFixed(7));
  L();
  L('  ▸ 영상법  N ↑');
  L('     N     plateAvg      창A       창B       창C');
  [10, 20, 40, 80].forEach(function (N) {
    var sc = AD.imageScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, N: N });
    var cells = M.WINDOW_IDS.map(function (w) {
      var r = M.measureKappa(sc.tot, c.a, 1, w, 1, kap);
      return pad(r.value === null ? r.reason : (r.value / kap * 100).toFixed(1) + '%', 10);
    });
    L('   ' + pad(N, 4) + '   ' + pad(sc.quality.plateAvg.toFixed(6), 10) + cells.join('') +
      (N === 40 ? '   ← v1 §13: 잘림 간섭의 골짜기' : ''));
  });
  L();
  L('  ▸ 도선관  d ↓');
  L('     d      wallT       a_w/d    창A       창B       창C');
  [8, 5, 3, AD.dAuto(c.lambda)].forEach(function (d) {
    var sc = AD.wireScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, d: d });
    var cells = M.WINDOW_IDS.map(function (w) {
      var r = M.measureKappa(sc.tot, c.a, 1, w, d, kap);
      return pad(r.value === null ? r.reason : (r.value / kap * 100).toFixed(1) + '%', 10);
    });
    L('   ' + pad(d.toFixed(3), 6) + '  ' + pad(sc.quality.wallT.toFixed(4), 8) + '  ' +
      pad(sc.quality.awOverD.toFixed(3), 7) + cells.join('') +
      (Math.abs(d - AD.dAuto(c.lambda)) < 1e-9 ? '   ← dAuto' : ''));
  });
}

/* ------------------------------------------------------------------- 실행 */
var want = process.argv.slice(2);
var T0 = Date.now();
[['G0', runG0], ['G1', runG1], ['G2', runG2], ['G2-PROFILE', runG2P],
 ['G3', runG3], ['G3-AW', runG3AW], ['G4', runG4], ['G5', runG5]].forEach(function (g) {
  if (want.length && want.indexOf(g[0]) < 0) return;
  var t = Date.now();
  g[1]();
  L('\n  (' + g[0] + ' 소요 ' + ((Date.now() - t) / 1000).toFixed(1) + 's)');
});

hr('요약');
L('  총 소요 ' + ((Date.now() - T0) / 1000).toFixed(1) + 's');
if (FAIL.length) { L('  판정 대상 FAIL ' + FAIL.length + '건:\n    ' + FAIL.join('\n    ')); process.exitCode = 1; }
else L('  판정 대상(G0·G1 + 모드합 무결성) 전부 PASS');
L('  나머지는 판정 없이 실측만 보고했다. 창(A/B/C)과 임계값 3종은 단계 6에서 확정한다.');
