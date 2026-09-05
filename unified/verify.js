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
var N_IMG = GEO.N;   // 160. Cesàro 기본 (GEO.CESARO)

// 세 열 — 모드합 / 영상법 / 도선관. d 는 벽 이산화 가드(κ·d ≤ C) 판정에만 쓴다.
function columns(c) {
  var d = AD.dAuto(c.lambda, c.a, c.y0OverA);
  return [
    { key: 'sum',   label: '모드합',  d: 1, scene: AD.imageScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, modeInfinity: true }) },
    { key: 'image', label: '영상법',  d: 1, scene: AD.imageScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, N: N_IMG }) },
    { key: 'wire',  label: '도선관',  d: d, scene: AD.wireScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, d: d }) }
  ];
}

// 값 + R² 를 한 칸에. R²는 가드로 켜지 않고 보고만 한다 (임계값 미정).
function cell(r, thy, width) {
  var s = (r.value === null) ? r.reason
        : (r.value / thy * 100).toFixed(1) + '% R²' + (r.r2 === undefined ? '—' : r.r2.toFixed(4));
  return padR(s, width || 24);
}

// 임계값 사전 규칙 (조건부 확정) — 벗어나면 멈추고 보고한다. 느슨하게 고치지 않는다.
var TH = { G2: 0.03, G3: 0.03, G4_wire: 0.03, G4_image: 0.08 };
var BREACH = [];
function chk(name, val, lim) {
  if (val > lim) BREACH.push(name + ' = ' + val.toFixed(4) + ' > ' + lim);
  return val <= lim;
}

function qualityLine(cols) {
  var q = {};
  cols.forEach(function (c) { q[c.key] = c.scene.quality; });
  return '  모드합: (해석해)   영상법: N=' + q.image.N + (q.image.cesaro ? '(Cesàro)' : '(단순 합)') +
         ', plateAvg=' + q.image.plateAvg.toFixed(6) + '\n' +
         '  도선관: d=' + q.wire.d.toFixed(3) + ', a_w=' + q.wire.aw.toFixed(4) +
         (q.wire.awAuto ? '(자동 d/2π)' : '(수동)') +
         ', a_w/d=' + q.wire.awOverD.toFixed(4) +
         ', δ=' + (q.wire.delta >= 0 ? '+' : '') + q.wire.delta.toFixed(4) +
         ', a_eff=' + q.wire.aEff.toFixed(3) + ', wallT=' + q.wire.wallT.toFixed(4);
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
  var lambda = 144, bad = 0, n = 0;
  L('  조건: λ=' + lambda + ', N=4(영상법), d=a별 자동(도선관)');
  L();
  L('    a   y₀/a     srcPix  srcYPix    wallBot  wallTop   Nx   Ny   |inc|최대점   판정');
  L('  ' + '-'.repeat(84));
  AS.forEach(function (a) { YS.forEach(function (y) {
    var si = AD.imageScene({ lambda: lambda, a: a, y0OverA: y, N: 4 });
    var sw = AD.wireScene({ lambda: lambda, a: a, y0OverA: y, d: AD.dAuto(lambda, a, y) });
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
    var sw = AD.wireScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, d: AD.dAuto(c.lambda, c.a, c.y0OverA) });
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
    var dW = AD.dAuto(c.lambda, c.a, c.y0OverA), res = kap * dW <= GEO.KAPPA_D_MAX;
    L('  mode ' + n + '  (이론 κ = ' + kap.toFixed(7) + ' /셀,  1/κ = ' + (1 / kap).toFixed(2) +
      '셀,  결합 = ' + cp.toExponential(2) + ',  도선관 κ·d = ' + (kap * dW).toFixed(3) +
      ' ' + (res ? '≤' : '>') + ' ' + GEO.KAPPA_D_MAX + ' ' + (res ? '✓' : '✗') + ')');
    L('    창          z구간             ' + cols.map(function (q) { return padR(q.label, 24); }).join(''));
    M.WINDOW_IDS.forEach(function (w) {
      var win = M.kappaWindow(w, kap);
      var cells = cols.map(function (q) {
        var r = M.measureKappa(q.scene.tot, c.a, n, w, q.d, kap);
        if (r.value !== null) {
          var pct = r.value / kap * 100;
          if (q.key === 'sum') dev.push(Math.abs(pct - 100));
          // 임계값 사전 규칙: 확정창(GEO.KAPPA_WIN) · 모드 1 · 값이 나온 모든 열
          if (w === GEO.KAPPA_WIN && n === 1) chk('G2 창' + w + ' mode1 ' + q.label, Math.abs(pct / 100 - 1), TH.G2);
        }
        return cell(r, kap);
      });
      L('    ' + padR(M.WINDOW_LABEL[w], 11) + padR('[' + win.zStart.toFixed(1) + ', ' + win.zEnd.toFixed(1) + ']', 17) + cells.join('') +
        (w === GEO.KAPPA_WIN ? ' ★확정창' : ''));
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

/* ================================================== G2-WALL 유효 벽 정합 ON/OFF */
// 정책(a_w = d/2π)이 실제로 δ를 없애는지 확인한다.
// δ = (d/2π)·ln(d/(2π·a_w)),  a_eff = a + 2δ.  자유 매개변수 없음.
function runG2WALL() {
  hr('[G2-WALL] 유효 벽 정합 ON/OFF — 정책이 δ를 실제로 없애는가');
  L('  δ = (d/2π)·ln( d/(2π·a_w) ) 벽 하나당,  a_eff = a + 2δ');
  L('  OFF = a_w 0.8 고정(종전),  ON = a_w = d/2π (δ≡0)');
  L('  κ 예측은 a_eff로 계산한 이론값의 비 — 측정값이 이 예측과 맞으면 δ 설명이 옳다.');
  ['P1'].forEach(function (key) {
    var c = COND[key], k = 2 * Math.PI / c.lambda, d = AD.dAuto(c.lambda, c.a, c.y0OverA);
    var kap = M.theoryKappa(1, c.a, k);
    L();
    L('── ' + c.name + '  a=' + c.a + ', λ=' + c.lambda + ', d=' + d.toFixed(3) + ',  이론 κ₁=' + kap.toFixed(7) + ' ──');
    L('    정합    a_w      a_w/d      δ         a_eff      κ 예측    κ 실측(창C)   wallT     경고');
    [false, true].forEach(function (auto) {
      var sc = AD.wireScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, d: d, awAuto: auto, aw: GEO.aw });
      var q = sc.quality;
      var kapEff = M.theoryKappa(1, q.aEff, k);
      var r = M.measureKappa(sc.tot, c.a, 1, 'C', d, kap);
      var warn = q.awOverD >= 0.5 ? '⛔ 겹침' : (q.awOverD > 0.25 ? '⚠ 근사 이탈' : '');
      L('    ' + padR(auto ? 'ON ' : 'OFF', 6) + pad(q.aw.toFixed(4), 7) + '  ' + pad(q.awOverD.toFixed(4), 7) +
        '  ' + pad((q.delta >= 0 ? '+' : '') + q.delta.toFixed(4), 8) + '  ' + pad(q.aEff.toFixed(3), 8) +
        '  ' + pad((kapEff / kap * 100).toFixed(1) + '%', 8) +
        '  ' + pad(r.value === null ? r.reason : (r.value / kap * 100).toFixed(1) + '%', 10) +
        '  ' + pad(q.wallT.toFixed(4), 8) + '   ' + warn);
    });
  });
  L();
  L('  ▸ 참고: a_w = d/2π 는 d 가 어떻게 정해지든 성립하므로 δ ≡ 0 과 a_w/d = 1/2π = 0.1592 는');
  L('    d 와 무관하게 유지된다 — 얇은 도선 근사의 a_w ≪ d 조건은 전 범위에서 같다.');
  L('    다른 조건 a_w ≪ λ 는 k·a_w = d/λ 라 d 를 따라간다. d = 0.055λ 구간에서만 0.055 로 일정하고,');
  L('    κ·d 항이 걸리면 그보다 작아진다 — 근사가 좋아지는 방향이다.');
}

/* ========================================================== G2-PROFILE 국소 기울기 */
function runG2P() {
  var c = COND.P1;
  hr('[G2-PROFILE] 국소 기울기 프로파일   a=' + c.a + ', λ=' + c.lambda + ', y₀/a=' + c.y0OverA);
  L('  부분창마다 §7-4 가드 없이 로그 기울기만 계산. 평탄 구간을 데이터에서 직접 읽는다.');
  L('  앞쪽이 휘면 소스 근접장, 뒤쪽이 휘면 누설 바닥. 이것이 창 결정의 1차 근거다.');
  var cols = columns(c);
  var k = 2 * Math.PI / c.lambda;

  // 단순 합 열을 하나 더 붙인다 — 진동은 결과이므로 보존해 나란히 보인다 (설계 §11-7)
  cols = cols.concat([{ key: 'plain', label: '단순합',
    scene: AD.imageScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, N: N_IMG, cesaro: false }) }]);

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
    L('    z중심    ' + cols.map(function (q) { return pad(q.label + ' (R²)', 17); }).join('') + '   비고');
    profs[0].rows.forEach(function (row, i) {
      var cells = profs.map(function (p) {
        var r = p.rows[i].ratio, q2 = p.rows[i].r2;
        return pad(r === null ? '—' : (r * 100).toFixed(1) + '% (' + (q2 === null ? '—' : q2.toFixed(3)) + ')', 17);
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
    L('    모드  결합     이론 k_z     λ_g       주기수   변형   ' + cols.map(function (q) { return padR(q.label, 24); }).join(''));
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
          // 임계값 사전 규칙: resolvable=true인 모든 전파 모드 (표준 창)
          if (!tr && r.value !== null) chk('G3 ' + c.name + ' m' + n + ' ' + q.label, Math.abs(r.value / kz - 1), TH.G3);
          return cell(r, kz);
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
  L('  core.js 사용 조건은 a_w ≪ d. 이 절은 정합 OFF(a_w = 0.8 고정)라 a_w/d = 0.8/d 이고,');
  L('  프리셋 ③④가 이미 문턱(0.25)을 넘는다 — 그 둘이 곧 G3(b)(c) 조건이다.');
  L('  모드합·영상법은 a_w와 무관하므로 같은 값이 나오는 것이 정상이다 (대조군).');
  L('  ⚠ 이 절은 유효 벽 정합을 끈 상태(awAuto=false)에서만 의미가 있다.');
  L('    정합이 켜지면 a_w = d/2π 로 d에 묶여 독립 변수가 아니므로 스캔 자체가 성립하지 않는다.');

  ['P3', 'P4'].forEach(function (key) {
    var c = COND[key];
    var d = AD.dAuto(c.lambda, c.a, c.y0OverA), k = 2 * Math.PI / c.lambda;
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
        var sw = AD.wireScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, d: d, aw: aw, awAuto: false });
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
  hr('[G4] 차단 영역 전체장 일치도');
  L('  게이트 : 모드합 ↔ 도선관,  모드합 ↔ 영상법   (각 방법을 정확해와 비교)');
  L('  보고   : 영상법 ↔ 도선관 ★  — 두 오차의 합이라 게이트로 부적절 (삼각부등식으로 위 둘의 합 이하)');
  L('  이 프로젝트의 논리: 두 근사를 서로 비교하는 게 아니라, 각각이 공통의 참값으로 수렴함을 보인다.');
  L('  지표: RMS(차) / max|E_tot|   (영역 내)');
  L();
  var cols = columns(c);
  L(qualityLine(cols));
  var t = M.jBotTop(c.a);

  function cmp(A, B, zr) {
    var i0 = Math.round(GEO.zToPix(zr[0])), i1 = Math.round(GEO.zToPix(zr[1]));
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
  var REGIONS = [GEO.G4_ZRANGE, [56.0, 150.0]];
  L();
  L('    비교쌍                   z[' + GEO.G4_ZRANGE.join(', ') + '] (확정)    z[56, 150] (참고)   임계');
  L('  ' + '-'.repeat(78));
  [['모드합 ↔ 도선관  게이트', 0, 2, TH.G4_wire],
   ['모드합 ↔ 영상법  게이트', 0, 1, TH.G4_image],
   ['영상법 ↔ 도선관  ★보고', 1, 2, null]].forEach(function (p) {
    var vals = REGIONS.map(function (zr) { return cmp(cols[p[1]].scene.tot, cols[p[2]].scene.tot, zr); });
    if (p[3] !== null) chk('G4 ' + p[0].split('  ')[0] + ' [56,106]', vals[0], p[3]);
    L('  ' + padR(p[0], 26) + pad(vals[0].toExponential(4), 14) + '       ' +
      pad(vals[1].toExponential(4), 14) + '   ' + (p[3] === null ? '보고만' : '≤ ' + p[3]));
  });
  L('  ' + '-'.repeat(78));
  L('  두 영역의 값이 크게 다르면 영역 선택이 결과를 좌우한다는 뜻이다.');
}

/* ================================================================= G5 이중 수렴 */
function runG5() {
  var c = COND.P1;
  hr('[G5] 이중 수렴 스캔 — 판정 없음');
  L('  손잡이를 조일수록 각각 이론값에 가까워지는지 본다. 확정창은 ' + GEO.KAPPA_WIN +
    ' 이나, 창 의존성이 손잡이에 따라 어떻게 사라지는지 보이려고 A·B·C를 모두 출력한다.');
  var k = 2 * Math.PI / c.lambda, kap = M.theoryKappa(1, c.a, k);
  L('  mode 1,  이론 κ = ' + kap.toFixed(7));
  L();
  L('  ▸ 영상법  N ↑   (단순 합 / Cesàro)  — 탭 4-C가 겹쳐 그릴 두 곡선');
  L('     N    방식      plateAvg      창A         창B         창C');
  [40, 80, 160, 320].forEach(function (N) {
    [false, true].forEach(function (ces) {
      var sc = AD.imageScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, N: N, cesaro: ces });
      var cells = M.WINDOW_IDS.map(function (w) {
        var r = M.measureKappa(sc.tot, c.a, 1, w, 1, kap);
        return pad(r.value === null ? r.reason : (r.value / kap * 100).toFixed(1) + '%', 12);
      });
      L('   ' + (ces ? '     ' : pad(N, 4) + ' ') + ' ' + padR(ces ? 'Cesàro' : '단순 합', 8) +
        pad(sc.quality.plateAvg.toFixed(6), 10) + cells.join('') +
        (!ces && N === 40 ? '   ← v1 §13: 잘림 간섭의 골짜기' : (ces && N === GEO.N ? '   ← 기본값' : '')));
    });
  });
  L();
  L('  ▸ plateAvg는 두 방식 모두 단조 감소하는데 κ는 단순 합에서만 진동한다.');
  L('    경계조건 만족도가 좋아져도 관 내부 감쇠는 좋아지지 않는다 — N=40은 우연한 골짜기가 아니다.');
  L();
  L('  ▸ 도선관  d ↓   (유효 벽 정합 OFF = a_w 0.8 고정 / ON = a_w = d/2π)');
  L('     d     정합   a_w      δ         wallT     창A       창B       창C');
  var dA5 = AD.dAuto(c.lambda, c.a, c.y0OverA);
  [8, 5, 3, dA5].forEach(function (d) {
    [false, true].forEach(function (auto) {
      var sc = AD.wireScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, d: d, awAuto: auto, aw: GEO.aw });
      var q = sc.quality;
      var cells = M.WINDOW_IDS.map(function (w) {
        var r = M.measureKappa(sc.tot, c.a, 1, w, d, kap);
        return pad(r.value === null ? r.reason : (r.value / kap * 100).toFixed(1) + '%', 10);
      });
      L('   ' + (auto ? '      ' : pad(d.toFixed(3), 6)) + '  ' + padR(auto ? 'ON ' : 'OFF', 5) +
        pad(q.aw.toFixed(4), 7) + '  ' + pad((q.delta >= 0 ? '+' : '') + q.delta.toFixed(4), 8) +
        '  ' + pad(q.wallT.toFixed(4), 8) + cells.join('') +
        (auto && Math.abs(d - dA5) < 1e-9 ? '   ← dAuto' : ''));
    });
  });
}

/* ================================================================= TIME 성능 실측 */
// 최악 조건은 λ=2.4cm(24셀) — dAuto=1.32, 도선 456개 (차단 모드가 없어 κ·d 항이 안 걸린다).
// 비용은 도선 수에 선형이다 — 브라우저 실측 74~194도선에서 약 1.06ms/도선이고,
// MoM O(n³) 이 아니라 격자 위 장 계산(도선당 Nx×Ny = 114400점)이 지배한다. (v1 §11-1)
// 단일 측정은 JIT·GC 때문에 3~4배까지 흔들린다. 워밍업 후 중앙값을 쓴다.
// (임계값을 느슨하게 하는 것이 아니라 측정을 신뢰 가능하게 만드는 것)
function bench(fn, rep, warm) {
  rep = rep || 5; warm = warm || 2;
  for (var i = 0; i < warm; i++) fn();
  var ts = [];
  for (var j = 0; j < rep; j++) {
    var t = process.hrtime.bigint(); fn(); ts.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  ts.sort(function (x, y) { return x - y; });
  return { med: ts[ts.length >> 1], min: ts[0], max: ts[ts.length - 1] };
}

function runTIME() {
  hr('[TIME] 재계산 실측 시간 — 워밍업 2회 후 5회, 중앙값');
  L('  ⚠ node 측정이며 브라우저와 다르다. 이 환경은 부하 변동이 커서 같은 계산이 3~4배까지 흔들린다.');
  var dW24 = AD.dAuto(24, 60, 0.5);
  L('  구조적 비용: 최악 λ=24셀 → d=' + dW24.toFixed(3) + ', 도선 ' + (2 * GEO.nWires(dW24)) +
    '개 → 선형 추정 ' + (2 * GEO.nWires(dW24) * 1.06).toFixed(0) + 'ms (브라우저, 약 1.06ms/도선)');
  L();
  L('    조건              단계             중앙값     최소     최대');
  L('  ' + '-'.repeat(66));
  [[144, '기본 λ=14.4cm'], [24, '최악 λ=2.4cm']].forEach(function (LC) {
    var lam = LC[0];
    var bi = bench(function () { AD.imageScene({ lambda: lam, a: 60, y0OverA: 0.5 }); });
    var bw = bench(function () { AD.wireScene({ lambda: lam, a: 60, y0OverA: 0.5 }); });
    var bb = bench(function () {
      AD.imageScene({ lambda: lam, a: 60, y0OverA: 0.5 });
      AD.wireScene({ lambda: lam, a: 60, y0OverA: 0.5 });
    });
    [['영상법 N=' + GEO.N, bi], ['도선관 (도선 ' + (2 * GEO.nWires(AD.dAuto(lam, 60, 0.5))) + ')', bw],
     ['탭 3 = 둘 다', bb]].forEach(function (row, i) {
      L('  ' + padR(i === 0 ? LC[1] : '', 16) + padR(row[0], 18) +
        pad(row[1].med.toFixed(0), 6) + '   ' + pad(row[1].min.toFixed(0), 6) + '   ' + pad(row[1].max.toFixed(0), 6) +
        (i === 2 ? '   ' + (row[1].med > 1500 ? '⛔ 1.5초 초과' : 'OK') : ''));
    });
    L('  ' + '-'.repeat(66));
  });
  L();
  L('  ▸ 이 절은 보고 전용이며 게이트가 아니다. v1 §11-1의 1.5초는 UI 응답성 기준이고,');
  L('    그것은 브라우저의 성질이다. node 측정은 대리 지표였고 지금 그 대리 지표가 망가졌다.');
  L('    진짜 게이트는 단계 8의 브라우저 계시기다:');
  L('      차단 무대(λ ≥ 9.6cm) 합계 중앙값 > 600ms   → 보고·중단');
  L('      슬라이더 최악(λ = 2.4cm) 합계 중앙값 > 2500ms → 보고·중단');
}

/* ========================================== D-DSCAN 도선 간격 d 스캔 (1회성 진단) */
/* 논문 표3의 '도선 관' 열에서 값을 못 낸 칸(T5 모드3)과 5% 이상 벗어난 칸(T4 모드3)이
 * 도선 간격 d 하나로 설명되는지 데이터로 확인한다. 판정 없음 — 표만 낸다.
 *
 * 가설: 도선 관의 κ 오차는 무차원량 κ·d 가 지배한다.
 *   d 는 벽을 이산화한 격자 간격이고, 차단 모드는 벽을 따라 e^{−κz} 로 변한다.
 *   한 칸 사이의 진폭 변화가 e^{−κd} 이므로, κ·d 가 작을 때만 도선 열이
 *   연속 도체 벽을 대신할 수 있다.
 *
 * 이 절에서는 어떤 상수도 코드에 박지 않는다. 기본값(dAuto·가드·GEO)은 그대로 둔다.
 * 벽 이산화 가드는 이 진단 경로에서만 우회한다 — measure.js 는 고치지 않고,
 * measureKappa 의 d 인자에 0에 가까운 값을 넘겨 가드 조건을 지나가게 한다.
 * 가드에 걸렸을 사실은 별도 열에 표시한다. */
var DCOND = {
  T4: { name: 'T4', a:  50, lambda: 100, y0OverA: 0.5, note: 'λ/2a=1.00  모드1 문턱, 3 차단' },
  T5: { name: 'T5', a:  50, lambda: 125, y0OverA: 0.5, note: 'λ/2a=1.25  모드1,3 차단' }
};
// 기준점(현재 정상인 칸) — 곡선에 함께 얹어 κ·d 축을 넓게 덮는다. d 는 각자의 dAuto.
var DREF = {
  T2: { name: 'T2', a:  50, lambda:  50, y0OverA: 0.5, modes: [3] },
  T3: { name: 'T3', a: 100, lambda: 100, y0OverA: 0.5, modes: [3] }
};
var D_LIST = [6.875, 5.5, 4, 3, 2.5, 2, 1.5];

var DPTS = [];   // κ·d 오차 곡선용 점

// 가드 우회 측정. measure.js 의 조건은 1/kThy >= (d || 1) 이므로 d에 1e-12를 넘기면 지나간다.
function kappaNoResGuard(scene, a, n, winId, kThy) {
  return M.measureKappa(scene.tot, a, n, winId, 1e-12, kThy);
}
// 창 안 진폭비 (시작/끝) — measureKappa 의 '진폭비 부족(<1.5)' 가드와 같은 정의.
function ampRatioIn(scene, a, n, win) {
  var amp = M.modeCoefMag(scene.tot, a, n), first = null, last = null;
  for (var z = win.zStart; z <= win.zEnd; z += 1) {
    var ip = Math.round(z) + GEO.xLeft;
    if (ip < 0 || ip >= amp.length) continue;
    if (first === null) first = amp[ip];
    last = amp[ip];
  }
  return (first !== null && last > 0) ? first / last : null;
}

var DHEAD = '      d 도선수     κ·d  창 [z0, z1]      진폭비     a_w        δ   a_eff  κ측정/이론             R²  가드  시간ms';

function dscanRow(c, n, d, kap, tag) {
  var t0 = Date.now();
  var sc = AD.wireScene({ lambda: c.lambda, a: c.a, y0OverA: c.y0OverA, d: d });
  var ms = Date.now() - t0;
  var q = sc.quality, winId = GEO.KAPPA_WIN;
  var win = M.kappaWindow(winId, kap);
  var r = kappaNoResGuard(sc, c.a, n, winId, kap);
  var guarded = !(kap * d <= GEO.KAPPA_D_MAX);       // 기본 경로였다면 가드에 걸렸는가
  var ratio = ampRatioIn(sc, c.a, n, win);
  var pct = (r.value === null) ? null : r.value / kap * 100;
  if (pct !== null)
    DPTS.push({ tag: tag, kd: kap * d, err: pct - 100, r2: r.r2, guarded: guarded, d: d });
  L('  ' + pad(d.toFixed(3), 6) + pad(2 * GEO.nWires(d), 6) + '  ' + pad((kap * d).toFixed(4), 7) +
    '  ' + padR('[' + win.zStart.toFixed(1) + ', ' + win.zEnd.toFixed(1) + ']', 16) +
    pad(ratio === null ? '—' : ratio.toFixed(2), 7) +
    pad(q.aw.toFixed(4), 8) + pad((q.delta >= 0 ? '+' : '') + q.delta.toFixed(4), 9) +
    pad(q.aEff.toFixed(3), 8) + '  ' +
    padR(pct === null ? r.reason : pct.toFixed(2) + '%', 19) +
    pad(r.r2 === undefined ? '—' : r.r2.toFixed(5), 8) +
    pad(guarded ? '차단' : '통과', 6) + pad(ms, 7));
}

function runDSCAN() {
  hr('[D-DSCAN] 도선 간격 d 스캔 — 표3 미산출·이탈 칸의 원인 진단 (판정 없음)');
  L('  결론(반영 완료): κ·d 가 지배 변수다. 세 조건의 오차 곡선이 κ·d 축에서 겹치고,');
  L('  κ·d = 1.5 에서 동시에 무너진다. 상한 C = ' + GEO.KAPPA_D_MAX + ' 는 |오차| ≤ 0.5% 선에서 읽었다.');
  L('  ※ 이 표는 스캔이므로 d 를 직접 준다. 앱의 기본 d 는 dAuto 가 정한다.');
  L('  ※ 벽 이산화 가드 (κ·d ≤ ' + GEO.KAPPA_D_MAX + ') 는 이 절에서만 우회해 값을 끝까지 낸다.');
  L('    가드 열: 차단 = 기본 경로였다면 계산 전에 막혔을 행, 통과 = 원래도 값이 나오는 행.');
  L('  ※ 창은 확정창 ' + GEO.KAPPA_WIN + ' (' + M.WINDOW_LABEL[GEO.KAPPA_WIN] + ').');
  L('    창 A는 κ로만 정해지므로 d 를 바꿔도 같다 — 창 차이가 아니라 벽 이산화 차이만 본다.');
  L('  ※ a_w 는 유효 벽 정합(a_w = d/2π) 자동. 정의상 δ ≡ 0, a_eff ≡ a 가 되는지 함께 확인한다.');

  Object.keys(DCOND).forEach(function (key) {
    var c = DCOND[key], k = 2 * Math.PI / c.lambda;
    L();
    L('── ' + c.name + '  a=' + c.a + ', λ=' + c.lambda + ', y₀/a=' + c.y0OverA + '   (' + c.note + ') ──');
    var kap3 = M.theoryKappa(3, c.a, k);
    L('  모드 3  이론 κ = ' + kap3.toFixed(7) + ' /셀 = ' + (kap3 * 10).toFixed(4) +
      ' cm⁻¹,  1/κ = ' + (1 / kap3).toFixed(3) + '셀,  결합 = ' + M.coupling(3, c.y0OverA).toFixed(3) +
      ',  현재 dAuto = ' + AD.dAuto(c.lambda, c.a, c.y0OverA).toFixed(3));
    L(DHEAD);
    L('  ' + '-'.repeat(100));
    D_LIST.forEach(function (d) { dscanRow(c, 3, d, kap3, c.name + '-m3'); });
    L('  ' + '-'.repeat(100));

    var kap1 = M.theoryKappa(1, c.a, k);
    if (kap1 !== null && M.coupling(1, c.y0OverA) > 1e-12) {
      L();
      L('  모드 1  이론 κ = ' + kap1.toFixed(7) + ' /셀 = ' + (kap1 * 10).toFixed(4) +
        ' cm⁻¹,  1/κ = ' + (1 / kap1).toFixed(3) + '셀   (같은 조건의 저-κ·d 대조군)');
      L(DHEAD);
      L('  ' + '-'.repeat(100));
      D_LIST.forEach(function (d) { dscanRow(c, 1, d, kap1, c.name + '-m1'); });
      L('  ' + '-'.repeat(100));
    } else {
      L();
      L('  모드 1  — ' + (kap1 === null ? '차단 아님 (λ = 2a 문턱: k = k_c 라 κ = k_z = 0)' : '결합 0'));
    }
  });

  // 현재 정상인 칸을 곡선에 얹는다 (각자의 dAuto 그대로)
  L();
  L('── 기준점 (현재 정상, dAuto 그대로 — 곡선 대조용) ──');
  L(DHEAD);
  L('  ' + '-'.repeat(100));
  Object.keys(DREF).forEach(function (key) {
    var c = DREF[key], k = 2 * Math.PI / c.lambda, d = AD.dAuto(c.lambda, c.a, c.y0OverA);
    c.modes.forEach(function (n) {
      var kap = M.theoryKappa(n, c.a, k);
      if (kap === null) return;
      dscanRow(c, n, d, kap, c.name + '-m' + n);
    });
  });
  L('  ' + '-'.repeat(100));

  /* ---- κ·d 오차 곡선 ---- */
  L();
  L('  ▸ 오차 곡선 — 가로축 κ·d, 세로축 (측정/이론 − 1)');
  L('    조건이 달라도 같은 κ·d 에서 오차가 겹치면 κ·d 가 지배 변수라는 뜻이다.');
  L();
  DPTS.sort(function (x, y) { return x.kd - y.kd; });
  var MAXE = 0;
  DPTS.forEach(function (p) { MAXE = Math.max(MAXE, Math.abs(p.err)); });
  var SCALE = MAXE > 0 ? 40 / MAXE : 1;
  L('      κ·d     오차%     조건       d       R²  가드   ' + ' '.repeat(37) + '0');
  L('  ' + '-'.repeat(100));
  DPTS.forEach(function (p) {
    var nb = Math.round(Math.abs(p.err) * SCALE);
    var bar = (p.err >= 0) ? ' '.repeat(40) + '|' + '#'.repeat(nb)
                           : ' '.repeat(40 - nb) + '#'.repeat(nb) + '|';
    L('  ' + pad(p.kd.toFixed(4), 7) + pad((p.err >= 0 ? '+' : '') + p.err.toFixed(3), 10) +
      '  ' + padR(p.tag, 8) + pad(p.d.toFixed(3), 6) + pad(p.r2 === undefined ? '—' : p.r2.toFixed(4), 9) +
      pad(p.guarded ? '차단' : '통과', 6) + '   ' + bar);
  });
  L('  ' + '-'.repeat(100));
  L('    (막대 1칸 = ' + (1 / SCALE).toFixed(4) + '%p,  최대 |오차| = ' + MAXE.toFixed(3) + '%p)');
  L();
  L('  ▸ |오차| ≤ 0.5% 를 만족하는 κ·d 상한을 여기서 읽는다.');
  var okMax = null, badMin = null;
  DPTS.forEach(function (p) {
    if (Math.abs(p.err) <= 0.5) { if (okMax === null || p.kd > okMax) okMax = p.kd; }
    else { if (badMin === null || p.kd < badMin) badMin = p.kd; }
  });
  L('    |오차| ≤ 0.5% 인 최대 κ·d = ' + (okMax === null ? '없음' : okMax.toFixed(4)));
  L('    |오차| > 0.5% 인 최소 κ·d = ' + (badMin === null ? '없음' : badMin.toFixed(4)));
  L('    → 앞이 뒤보다 작으면 그 사이 어디를 잡아도 되고, 뒤집히면 κ·d 단일 변수 가설이 깨진 것이다.');
  L();
  L('  ▸ 이 절은 진단이다. 여기서 읽은 상한을 코드에 박는 일은 다음 단계에서 한다.');
}

/* ================================================== TAB3 논문 표3 (이론 vs 도선 관) */
/* 변경 전(종전 규칙)과 변경 후(새 규칙)를 나란히 낸다.
 *   종전: d = min(0.1λ, max(0.055λ, L/Nmax)),  가드 1/κ ≥ d  (= κ·d ≤ 1)
 *   신규: d = min(0.055λ, C/κ_max) 후 클램프,  가드 κ·d ≤ C  (C = GEO.KAPPA_D_MAX)
 * 값은 cm⁻¹ (내부 단위 1셀 = 1mm 이므로 ×10). 판정 없음 — 표만 낸다. */
var TAB3 = [
  { n: 'T1', a:  50, lambda:  25, y0OverA: 0.5, note: 'λ/2a=0.25  모드1,3 전파' },
  { n: 'T2', a:  50, lambda:  50, y0OverA: 0.5, note: 'λ/2a=0.50  모드1 전파, 3 차단' },
  { n: 'T3', a: 100, lambda: 100, y0OverA: 0.5, note: 'λ/2a=0.50  모드1 전파, 3 차단' },
  { n: 'T4', a:  50, lambda: 100, y0OverA: 0.5, note: 'λ/2a=1.00  모드1 문턱, 3 차단' },
  { n: 'T5', a:  50, lambda: 125, y0OverA: 0.5, note: 'λ/2a=1.25  모드1,3 차단' }
];
function dAutoOld(lambda) {
  var floor = GEO.L / GEO.Nmax, cap = 0.1 * lambda, target = 0.055 * lambda;
  return Math.min(cap, Math.max(target, floor));
}

function runTAB3() {
  hr('[TAB3] 논문 표3 — 이론 vs 도선 관 (판정 없음, 값은 cm⁻¹)');
  L('  변경 전 = 종전 규칙 d=min(0.1λ, max(0.055λ, L/Nmax)), 가드 1/κ ≥ d (= κ·d ≤ 1)');
  L('  변경 후 = 새 규칙   d=min(0.055λ, C/κ_max) 후 클램프, 가드 κ·d ≤ C,  C = ' + GEO.KAPPA_D_MAX);
  L('  차단 모드는 κ, 전파 모드는 k_z. 결합계수 0인 모드는 선파원이 여기하지 않아 측정 대상이 아니다.');
  L();
  L('   조건  모드  종류   이론값        변경 전 d/도선  값(오차%)            변경 후 d/도선  값(오차%)          ms');
  L('  ' + '-'.repeat(112));
  TAB3.forEach(function (t) {
    var k = 2 * Math.PI / t.lambda;
    var dOld = dAutoOld(t.lambda), dNew = AD.dAuto(t.lambda, t.a, t.y0OverA);
    var kmin = M.kappaMinOfCutoff(t.a, k, 3);
    var tO = Date.now(); var scO = AD.wireScene({ lambda: t.lambda, a: t.a, y0OverA: t.y0OverA, d: dOld }); var msO = Date.now() - tO;
    var tN = Date.now(); var scN = AD.wireScene({ lambda: t.lambda, a: t.a, y0OverA: t.y0OverA, d: dNew }); var msN = Date.now() - tN;
    var first = true;
    for (var n = 1; n <= 3; n++) {
      var kap = M.theoryKappa(n, t.a, k), kz = M.theoryKz(n, t.a, k);
      var cp = M.coupling(n, t.y0OverA);
      var kind, thy, cells;
      if (cp < 1e-12) { kind = '—'; thy = null; cells = ['결합 0 (여기 안 됨)', '결합 0 (여기 안 됨)']; }
      else if (kap === null && kz === null) {
        // k = k_c 문턱. κ = k_z = 0 이고 모드 진폭이 1/k_z 로 발산한다 → 이론값이 없다.
        kind = '문턱'; thy = null; cells = ['— (k = k_c)', '— (k = k_c)'];
      } else if (kap !== null) {
        kind = 'κ'; thy = kap;
        cells = [[scO, dOld, true], [scN, dNew, false]].map(function (q) {
          var r = M.measureKappa(q[0].tot, t.a, n, GEO.KAPPA_WIN, 1e-12, kap);   // 가드는 아래서 각각 적용
          var pass = q[2] ? (1 / kap >= q[1]) : (kap * q[1] <= GEO.KAPPA_D_MAX);
          if (!pass) return '가드 차단 (κ·d=' + (kap * q[1]).toFixed(3) + ')';
          if (r.value === null) return r.reason;
          return (r.value * 10).toFixed(4) + ' (' + (r.value / kap * 100 - 100 >= 0 ? '+' : '') +
                 (r.value / kap * 100 - 100).toFixed(2) + '%)';
        });
      } else {
        kind = 'k_z'; thy = kz;
        cells = [scO, scN].map(function (sc) {
          var r = M.measureKz(sc.tot, t.a, n, kz, kmin);
          if (r.value === null) return r.reason;
          return (r.value * 10).toFixed(4) + ' (' + (r.value / kz * 100 - 100 >= 0 ? '+' : '') +
                 (r.value / kz * 100 - 100).toFixed(2) + '%)';
        });
      }
      L('  ' + (first ? padR(' ' + t.n, 6) : ' '.repeat(6)) + pad('m' + n, 4) + pad(kind, 6) + '  ' +
        padR(thy === null ? '—' : (thy * 10).toFixed(4), 12) +
        padR(first ? (dOld.toFixed(3) + '/' + 2 * GEO.nWires(dOld)) : '', 12) + '  ' + padR(cells[0], 22) +
        padR(first ? (dNew.toFixed(3) + '/' + 2 * GEO.nWires(dNew)) : '', 12) + '  ' + padR(cells[1], 20) +
        (first ? pad(msO + '→' + msN, 9) : ''));
      first = false;
    }
    L('  ' + padR('', 6) + '  ' + t.note + (Math.abs(dNew - dOld) > 1e-9 ? '   · d 변경 ' + dOld.toFixed(3) + ' → ' + dNew.toFixed(3) : '   · d 불변'));
  });
  L('  ' + '-'.repeat(112));
  L();
  L('  ▸ T4 모드1 각주: λ = 2a 라 k 와 k_c 가 부동소수점상 비트 단위로 같다 (k − k_c = 0).');
  L('    κ = k_z = 0 이고 선파원이 여기하는 모드 진폭이 1/k_z 로 발산하므로 이론값이 없다.');
  L('    모드합(정확해) 열도 이 조건에서는 정의되지 않는다 — 비교 기준 자체가 존재하지 않는다.');
  L('    유한 길이 열린 관에서 나오는 수치는 관 길이 L이 정한 값이지 모드의 성질이 아니다.');
}

/* ------------------------------------------------------------------- 실행 */
var want = process.argv.slice(2);
var T0 = Date.now();
[['G0', runG0], ['G1', runG1], ['G2', runG2], ['G2-WALL', runG2WALL], ['G2-PROFILE', runG2P],
 ['G3', runG3], ['G3-AW', runG3AW], ['G4', runG4], ['G5', runG5], ['TAB3', runTAB3], ['D-DSCAN', runDSCAN], ['TIME', runTIME]].forEach(function (g) {
  if (want.length && want.indexOf(g[0]) < 0) return;
  var t = Date.now();
  g[1]();
  L('\n  (' + g[0] + ' 소요 ' + ((Date.now() - t) / 1000).toFixed(1) + 's)');
});

hr('요약');
L('  총 소요 ' + ((Date.now() - T0) / 1000).toFixed(1) + 's');
L('  설정: κ창 ' + GEO.KAPPA_WIN + ',  영상법 N=' + GEO.N + (GEO.CESARO ? ' Cesàro' : ' 단순 합') +
  ',  유효 벽 정합 ' + (GEO.AW_AUTO ? 'ON (a_w=d/2π)' : 'OFF') +
  ',  벽 사이 제한 ' + (GEO.SCAT_BAND ? 'ON' : 'OFF (전 영역, 대조용)') +
  ',  G4 영역 [' + GEO.G4_ZRANGE.join(', ') + ']');
L();
if (FAIL.length) { L('  판정 대상 FAIL ' + FAIL.length + '건:\n    ' + FAIL.join('\n    ')); process.exitCode = 1; }
else L('  G0·G1 + 모드합 무결성 — PASS');

L();
L('  [임계값 사전 규칙]  G2 ≤' + TH.G2 + ' / G3 ≤' + TH.G3 +
  ' / G4 도선관 ≤' + TH.G4_wire + ' · 영상법 ≤' + TH.G4_image);
if (BREACH.length) {
  L('  ⛔ 이탈 ' + BREACH.length + '건 — 멈추고 보고한다. 임계값을 느슨하게 고치지 않는다.');
  BREACH.forEach(function (b) { L('    ' + b); });
  process.exitCode = 1;
} else {
  L('  ✅ 전 항목이 사전 규칙 범위 안 — 임계값 확정 조건 충족.');
}
L('  ※ 모드 2·3의 측정 불가는 FAIL이 아니다. ' +
  (M.R2_MIN === null ? 'R² 가드 꺼짐.' : 'R² 가드 ON (R²_min = ' + M.R2_MIN + ').'));
L('  ※ TIME은 게이트가 아니다 — 진짜 기준은 단계 8의 브라우저 계시기.');
