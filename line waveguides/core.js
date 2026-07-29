'use strict';
/* =============================================================================
 * 도선 배열 도파관 — 2D TM (E_z) Method of Moments 참조 구현
 * =============================================================================
 * 목적: 본 시뮬레이션 구현 시 그대로 이식할 수 있는 검증된 물리 코어.
 *
 * 물리 규약
 *  - 편광: E∥도선 (E_z만 존재, 2D TM). 이 편광에는 TEM 모드가 없음.
 *  - 도선 j의 산란장: E_scat(r) = c_j · H0^(1)(k|r − r_j|)
 *  - 경계조건: 각 도선 표면(반지름 a_w)에서 E_inc + Σ_j c_j H0 = 0
 *    → 이 조건이 전류(c_j)를 강제하고, 상쇄·차단은 그 결과.
 *  - 시간 규약: 위상 φ의 인스턴스값 = re·cosφ + im·sinφ (기존 시뮬과 동일)
 *
 * 검증된 사실 (2026-07-07 테스트, a=60, L=300, d=5, a_w=0.8)
 *  - 차단 κ: 이론 대비 99.9~100.4% (평면파·선원파 모두)
 *  - 전파 k_z: 이론 대비 100.5~100.6%
 *  - d=10 → κ 119% (경고 영역), d=25 → PEC 근사 붕괴
 *  - 깊은 차단에서 투과 바닥 ~3–7% (유한 도선 벽 누설, 물리적 실재)
 *  - 풀이 시간: 122도선 ≈ 10–100 ms (복소 가우스 소거)
 *
 * 사용 조건 (얇은 도선 근사)
 *  - a_w ≪ d  그리고  a_w ≪ λ  (슬라이더 범위를 이 안으로 제한할 것)
 * ========================================================================== */

/* ---------- 1. Bessel J0, Y0 — Abramowitz & Stegun 9.4.1/9.4.3 근사 ---------- */
function besselJ0(x) {
  var ax = Math.abs(x);
  if (ax < 3) {
    var y = (x * x) / 9;
    return 1 + y * (-2.2499997 + y * (1.2656208 + y * (-0.3163866 +
           y * (0.0444479 + y * (-0.0039444 + y * 0.0002100)))));
  }
  var z = 3 / ax;
  var f0 = 0.79788456 + z * (-0.00000077 + z * (-0.00552740 + z * (-0.00009512 +
           z * (0.00137237 + z * (-0.00072805 + z * 0.00014476)))));
  var th0 = ax - 0.78539816 + z * (-0.04166397 + z * (-0.00003954 + z * (0.00262573 +
            z * (-0.00054125 + z * (-0.00029333 + z * 0.00013558)))));
  return f0 * Math.cos(th0) / Math.sqrt(ax);
}

function besselY0(x) {
  if (x < 3) {
    var y = (x * x) / 9;
    var poly = 0.36746691 + y * (0.60559366 + y * (-0.74350384 + y * (0.25300117 +
               y * (-0.04261214 + y * (0.00427916 + y * -0.00024846)))));
    return 0.636619772 * Math.log(x / 2) * besselJ0(x) + poly;
  }
  var z = 3 / x;
  var f0 = 0.79788456 + z * (-0.00000077 + z * (-0.00552740 + z * (-0.00009512 +
           z * (0.00137237 + z * (-0.00072805 + z * 0.00014476)))));
  var th0 = x - 0.78539816 + z * (-0.04166397 + z * (-0.00003954 + z * (0.00262573 +
            z * (-0.00054125 + z * (-0.00029333 + z * 0.00013558)))));
  return f0 * Math.sin(th0) / Math.sqrt(x);
}

function H0(x) { return [besselJ0(x), besselY0(x)]; } // H0^(1) = J0 + iY0 → [re, im]

/* ---------- 2. 복소 선형계 풀이 — 부분 피벗 가우스 소거 ----------
 * A·x = b, A는 n×n 복소 행렬 (Are/Aim 평탄 배열), O(n³).
 * n ≤ 500이면 브라우저에서도 슬라이더 반응 속도로 충분. */
function solveComplex(Are, Aim, bre, bim, n) {
  for (var col = 0; col < n; col++) {
    var p = col, pm = Are[col * n + col] ** 2 + Aim[col * n + col] ** 2;
    for (var r = col + 1; r < n; r++) {
      var m = Are[r * n + col] ** 2 + Aim[r * n + col] ** 2;
      if (m > pm) { pm = m; p = r; }
    }
    if (p !== col) {
      for (var cc = col; cc < n; cc++) {
        var t1 = Are[col * n + cc]; Are[col * n + cc] = Are[p * n + cc]; Are[p * n + cc] = t1;
        var t2 = Aim[col * n + cc]; Aim[col * n + cc] = Aim[p * n + cc]; Aim[p * n + cc] = t2;
      }
      var t3 = bre[col]; bre[col] = bre[p]; bre[p] = t3;
      var t4 = bim[col]; bim[col] = bim[p]; bim[p] = t4;
    }
    var dre = Are[col * n + col], dim = Aim[col * n + col];
    var dd = dre * dre + dim * dim;
    for (var r2 = col + 1; r2 < n; r2++) {
      var nre = Are[r2 * n + col], nim = Aim[r2 * n + col];
      if (nre === 0 && nim === 0) continue;
      var fre = (nre * dre + nim * dim) / dd;
      var fim = (nim * dre - nre * dim) / dd;
      for (var cc2 = col; cc2 < n; cc2++) {
        var are = Are[col * n + cc2], aim = Aim[col * n + cc2];
        Are[r2 * n + cc2] -= fre * are - fim * aim;
        Aim[r2 * n + cc2] -= fre * aim + fim * are;
      }
      bre[r2] -= fre * bre[col] - fim * bim[col];
      bim[r2] -= fre * bim[col] + fim * bre[col];
    }
  }
  var xre = new Float64Array(n), xim = new Float64Array(n);
  for (var i = n - 1; i >= 0; i--) {
    var sre = bre[i], sim = bim[i];
    for (var j = i + 1; j < n; j++) {
      var are2 = Are[i * n + j], aim2 = Aim[i * n + j];
      sre -= are2 * xre[j] - aim2 * xim[j];
      sim -= are2 * xim[j] + aim2 * xre[j];
    }
    var dre2 = Are[i * n + i], dim2 = Aim[i * n + i];
    var dd2 = dre2 * dre2 + dim2 * dim2;
    xre[i] = (sre * dre2 + sim * dim2) / dd2;
    xim[i] = (sim * dre2 - sre * dim2) / dd2;
  }
  return [xre, xim];
}

/* ---------- 3. 기하: 도선 배열 도파관 ----------
 * 두 벽 y = ±a/2, x ∈ [0, L], 도선 간격 d, 반지름 a_w */
function buildWires(a, L, d, aw) {
  var wires = [];
  var nW = Math.round(L / d) + 1;
  for (var i = 0; i < nW; i++) {
    var x = i * d;
    wires.push({ x: x, y: +a / 2, aw: aw });
    wires.push({ x: x, y: -a / 2, aw: aw });
  }
  return wires;
}

/* ---------- 4. 입사장 두 종류 ---------- */
// 평면파 e^{ikx} (왼쪽에서 입구로)
function incPlane(k, x, y) { return [Math.cos(k * x), Math.sin(k * x)]; }
// 선원파 H0^(1)(k·r) — (xs, ys)에 놓인 도선 파원
function incLine(k, xs, ys, x, y) {
  var r = Math.hypot(x - xs, y - ys);
  if (r < 1e-6) r = 1e-6;
  return H0(k * r);
}

/* ---------- 5. MoM 풀이: 경계조건이 전류 c_j를 강제 ---------- */
function solveMoM(wires, k, incFn) {
  var n = wires.length;
  var Are = new Float64Array(n * n), Aim = new Float64Array(n * n);
  var bre = new Float64Array(n), bim = new Float64Array(n);
  for (var i = 0; i < n; i++) {
    for (var j = 0; j < n; j++) {
      // 대각(자기) 항: 자기 표면 r = a_w 에서 평가 (얇은 도선 근사의 핵심)
      var r = (i === j) ? wires[i].aw
            : Math.hypot(wires[i].x - wires[j].x, wires[i].y - wires[j].y);
      var h = H0(k * r);
      Are[i * n + j] = h[0]; Aim[i * n + j] = h[1];
    }
    var e = incFn(wires[i].x, wires[i].y);
    bre[i] = -e[0]; bim[i] = -e[1];   // E_inc + Σ c_j H0 = 0
  }
  return solveComplex(Are, Aim, bre, bim, n);
}

/* ---------- 6. 장 계산 ---------- */
// 전체장 = 입사장 + 산란장 (한 점). 렌더링 그리드에서는 Hankel 룩업 테이블 권장.
function totalField(wires, cre, cim, k, incFn, x, y) {
  var e = incFn(x, y);
  var re = e[0], im = e[1];
  for (var j = 0; j < wires.length; j++) {
    var r = Math.hypot(x - wires[j].x, y - wires[j].y);
    if (r < wires[j].aw) r = wires[j].aw;
    var h = H0(k * r);
    re += cre[j] * h[0] - cim[j] * h[1];
    im += cre[j] * h[1] + cim[j] * h[0];
  }
  return [re, im];
}

// 산란장만 (① ② ③ 패널 분리용)
function scatteredField(wires, cre, cim, k, x, y) {
  var re = 0, im = 0;
  for (var j = 0; j < wires.length; j++) {
    var r = Math.hypot(x - wires[j].x, y - wires[j].y);
    if (r < wires[j].aw) r = wires[j].aw;
    var h = H0(k * r);
    re += cre[j] * h[0] - cim[j] * h[1];
    im += cre[j] * h[1] + cim[j] * h[0];
  }
  return [re, im];
}

/* ---------- 7. 진단: n=1 모드 계수 (복소) ----------
 * c1(x) = (1/nY) Σ_y E(x,y)·sin(π(y+a/2)/a)
 * 차단: |c1| ∝ exp(−κx) / 전파: |c1| ≈ 상수, 위상이 k_z로 전진.
 * ⚠ 차단 영역에서 c1의 "위상"은 그래프·라벨에 쓰지 말 것 (동위상, 감쇠만). */
function modeCoefC(wires, cre, cim, k, incFn, a, x, nY) {
  var sumRe = 0, sumIm = 0;
  for (var m = 1; m < nY; m++) {
    var y = -a / 2 + a * m / nY;
    var w = Math.sin(Math.PI * (y + a / 2) / a);
    var f = totalField(wires, cre, cim, k, incFn, x, y);
    sumRe += f[0] * w; sumIm += f[1] * w;
  }
  return [sumRe / nY, sumIm / nY];
}

/* ---------- 8. 진단: κ 피팅 (차단 영역) ----------
 * ⚠ 검증된 피팅 구간 규칙 — 반드시 준수:
 *   시작: x = L·0.15 (입구 가장자리 회절 회피)
 *   끝:   min(L·0.7, 시작 + 2.5/κ_이론)  ← 누설 바닥에 닿기 전에서 중단
 * 이 규칙 없이 넓게 피팅하면 κ가 계통적으로 낮게 나옴 (테스트에서 82.8% 사례). */
function kappaFitWindow(L, kappaThy) {
  var xStart = L * 0.15;
  var xEnd = Math.min(L * 0.7, xStart + 2.5 / kappaThy);
  return { xStart: xStart, xEnd: xEnd, valid: (xEnd - xStart) > 0 };
}

function fitKappa(xs, amps) {
  var sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (var i = 0; i < xs.length; i++) {
    if (amps[i] < 1e-14) continue;
    var lv = Math.log(amps[i]);
    sx += xs[i]; sy += lv; sxx += xs[i] * xs[i]; sxy += xs[i] * lv; n++;
  }
  if (n < 2) return null;
  var slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return -slope;
}

/* ---------- 9. 진단: k_z 측정 (전파 영역, 위상 언랩) ---------- */
function measureKz(xs, phis) {
  for (var i = 1; i < phis.length; i++) {
    while (phis[i] - phis[i - 1] > Math.PI) phis[i] -= 2 * Math.PI;
    while (phis[i] - phis[i - 1] < -Math.PI) phis[i] += 2 * Math.PI;
  }
  var sx = 0, sy = 0, sxx = 0, sxy = 0, n = xs.length;
  for (var j = 0; j < n; j++) { sx += xs[j]; sy += phis[j]; sxx += xs[j] * xs[j]; sxy += xs[j] * phis[j]; }
  return Math.abs((n * sxy - sx * sy) / (n * sxx - sx * sx));
}

/* ---------- 10. 이론값 ---------- */
function cutoffInfo(lambda, a) {
  var k = 2 * Math.PI / lambda, kc = Math.PI / a;
  var evanescent = lambda > 2 * a;
  return {
    evanescent: evanescent,
    kappa: evanescent ? Math.sqrt(kc * kc - k * k) : null,
    kguide: evanescent ? null : Math.sqrt(k * k - kc * kc)
  };
}

/* ---------- 11. 자체 검증 (node cleaned_mom.js 로 실행) ---------- */
function selfTest() {
  var a = 60, L = 300, d = 5, aw = 0.8;
  var cases = [
    { name: '평면파·차단 λ=180', lambda: 180, inc: 'plane' },
    { name: '평면파·차단 λ=140', lambda: 140, inc: 'plane' },
    { name: '선원파·차단 λ=140', lambda: 140, inc: 'line'  },
    { name: '평면파·전파 λ=90',  lambda: 90,  inc: 'plane' },
    { name: '선원파·전파 λ=90',  lambda: 90,  inc: 'line'  }
  ];
  var allPass = true;
  cases.forEach(function (cs) {
    var k = 2 * Math.PI / cs.lambda;
    var wires = buildWires(a, L, d, aw);
    var incFn = cs.inc === 'plane'
      ? function (x, y) { return incPlane(k, x, y); }
      : function (x, y) { return incLine(k, -80, 0, x, y); };
    var sol = solveMoM(wires, k, incFn), cre = sol[0], cim = sol[1];
    var info = cutoffInfo(cs.lambda, a);
    var line;
    if (info.evanescent) {
      var win = kappaFitWindow(L, info.kappa);
      var xs = [], amps = [];
      for (var x = win.xStart; x <= win.xEnd; x += d) {
        var c = modeCoefC(wires, cre, cim, k, incFn, a, x, 40);
        xs.push(x); amps.push(Math.hypot(c[0], c[1]));
      }
      var kap = fitKappa(xs, amps);
      var pct = kap / info.kappa * 100;
      var pass = pct > 85 && pct < 115;
      allPass = allPass && pass;
      line = cs.name + ':  κ ' + pct.toFixed(1) + '% ' + (pass ? 'PASS' : 'FAIL');
    } else {
      var xs2 = [], phis = [];
      for (var x2 = L * 0.2; x2 <= L * 0.7; x2 += d) {
        var c2 = modeCoefC(wires, cre, cim, k, incFn, a, x2, 40);
        xs2.push(x2); phis.push(Math.atan2(c2[1], c2[0]));
      }
      var kz = measureKz(xs2, phis);
      var pct2 = kz / info.kguide * 100;
      var pass2 = pct2 > 85 && pct2 < 115;
      allPass = allPass && pass2;
      line = cs.name + ':  k_z ' + pct2.toFixed(1) + '% ' + (pass2 ? 'PASS' : 'FAIL');
    }
    console.log(line);
  });
  console.log(allPass ? '\n전체 PASS — 물리 코어 정상' : '\nFAIL 있음 — 규약 확인 필요');
}

/* ---------- 모듈 내보내기 ---------- */
var API = {
  besselJ0: besselJ0, besselY0: besselY0, H0: H0,
  solveComplex: solveComplex, buildWires: buildWires,
  incPlane: incPlane, incLine: incLine, solveMoM: solveMoM,
  totalField: totalField, scatteredField: scatteredField,
  modeCoefC: modeCoefC, kappaFitWindow: kappaFitWindow,
  fitKappa: fitKappa, measureKz: measureKz, cutoffInfo: cutoffInfo
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
  if (require.main === module) selfTest();
} else {
  (typeof globalThis !== 'undefined' ? globalThis : this).WireWG = API;
}
