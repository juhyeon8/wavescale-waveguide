(function (global, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./geometry.js'));
  else global.Measure = factory(global.GEO);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GEO) {
  'use strict';

  // ===== 측정 코드 한 벌 (v1 §1-3 / §7) =====
  // 두 방법(영상법/도선관)과 모드합에 똑같은 함수를 적용한다. 방법별 분기를 두지 않는다.
  // 측정 규칙이 다르면 두 방법의 차이가 물리 차이인지 측정 코드 차이인지 구분할 수 없다.

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---------- 7-1. 모드 계수 ----------
   * render.js:modeCoefficient 와 modes.js:modeCoefGridN 이 수식까지 동일 → 하나로 합침.
   * j = jBot…jTop (span+1점), 가중치 sin(nπ(j−jBot)/span). 양 끝점이 0인 DST-I 형태라
   * 이산 직교성이 정확히 성립한다 — 모드 간 누설 없음. */
  function jBotTop(a) {
    return { jBot: Math.round(GEO.y0pix - a / 2), jTop: Math.round(GEO.y0pix + a / 2) };
  }

  function modeCoefMag(field, a, n) {
    var Nx = field.Nx, Ny = field.Ny, re = field.re, im = field.im;
    var t = jBotTop(a), jBot = t.jBot, jTop = t.jTop, span = jTop - jBot;
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

  function modeCoefComplexAt(field, a, iPix, n) {
    var Ny = field.Ny, re = field.re, im = field.im;
    var t = jBotTop(a), jBot = t.jBot, jTop = t.jTop, span = jTop - jBot;
    var sr = 0, si = 0;
    for (var j = jBot; j <= jTop; j++) {
      var w = Math.sin(n * Math.PI * (j - jBot) / span), idx = iPix * Ny + j;
      sr += re[idx] * w; si += im[idx] * w;
    }
    return [sr / span, si / span];
  }

  /* ---------- 7-2. 이론값 (Griffiths) ---------- */
  // 도선 격자의 유효 반사면 변위 (벽 하나당). 자유 매개변수 없음.
  //   δ = (d/2π)·ln( d / (2π·a_w) ),   a_eff = a + 2δ
  // d > 2π·a_w → δ>0 → 관이 넓어짐 → κ 감소.  d = 2π·a_w 에서 정확히 0.
  // G5 실측 4/4가 0.05%p 이내로 맞았다 (설계 §11-6).
  function wallShift(d, aw) { return (d / (2 * Math.PI)) * Math.log(d / (2 * Math.PI * aw)); }
  function aEff(a, d, aw) { return a + 2 * wallShift(d, aw); }
  function awMatched(d) { return d / (2 * Math.PI); }   // δ = 0 이 되는 a_w

  function kc(n, a) { return n * Math.PI / a; }
  function theoryKz(n, a, k) { var c = kc(n, a); return (k > c) ? Math.sqrt(k * k - c * c) : null; }
  function theoryKappa(n, a, k) { var c = kc(n, a); return (k < c) ? Math.sqrt(c * c - k * k) : null; }
  function coupling(n, y0OverA) { return Math.abs(Math.sin(n * Math.PI * y0OverA)); }

  // 모드 1·2·3 중 차단인 것들의 최소 κ — k_z 창의 시작점을 정한다
  function kappaMinOfCutoff(a, k, nMax) {
    var m = null;
    for (var n = 1; n <= (nMax || 3); n++) {
      var kap = theoryKappa(n, a, k);
      if (kap !== null && (m === null || kap < m)) m = kap;
    }
    return m;
  }

  /* ---------- 7-3. 측정 창 ----------
   * κ 창은 후보 3종을 데이터로 둔다. 함수 분기가 아니라 선택이다. (설계 §6-1)
   * 단계 6에서 확정되면 GEO.KAPPA_WIN 한 줄만 고친다. */
  var KAPPA_WINDOWS = {
    // A — line-wire 원본 (core.js:kappaFitWindow ≡ modes.js:kappaWindowN)
    A: function (kThy) {
      var zStart = 0.15 * GEO.L;
      return { zStart: zStart, zEnd: Math.min(0.7 * GEO.L, zStart + 2.5 / kThy) };
    },
    // B — v1 §7-3
    B: function (kThy) {
      var zStart = clamp(GEO.z0 + 2 / kThy, 0.2 * GEO.L, 0.5 * GEO.L);
      return { zStart: zStart, zEnd: Math.min(0.7 * GEO.L, zStart + 2.5 / kThy) };
    },
    // C — image-source 원본 (main.js:computeFitInterval), 고정 길이 50셀
    C: function (kThy) {
      var zStart = GEO.srcZ() + 20;
      return { zStart: zStart, zEnd: zStart + 50 };
    }
  };
  // 직선성 가드 임계값. null = 가드 끔(R²는 보고만).
  // Cesàro N=320에서 모드 3이 43.4%로 값을 내면서 가드 넷을 전부 통과했다 — 57% 틀린 값이다.
  // κ₃=0.1509라 창 C 50셀에서 exp(−7.54)=5.3e−4까지 내려가 잘림 잔차 바닥에 잠긴 것이고,
  // N을 올려도 바닥을 따라 기어오를 뿐이다(3.8→15.1→25.9→43.4%). 영상법의 실제 한계다.
  // 확정: 0.96. 0.99는 정상 측정(0.9984~1.0000)과 이상 측정(0.5910~0.9514)
  // 사이가 비어 있다는 관측에 근거했으나, 현재 조건에서는 그 구간에 값이
  // 들어와 근거가 성립하지 않는다. 이상 측정이 관측된 범위의 위쪽으로 내린다.
  var R2_MIN = 0.96;

  var WINDOW_IDS = ['A', 'B', 'C'];
  var WINDOW_LABEL = { A: 'A 0.15L', B: 'B z0+2/κ', C: 'C 소스+20' };

  function kappaWindow(winId, kThy) {
    var w = KAPPA_WINDOWS[winId](kThy);
    w.valid = (w.zEnd - w.zStart) > 0 && isFinite(kThy) && kThy > 0;
    return w;
  }

  // k_z 창 — 하나만 쓴다 (modes.js:fitWindowZ 승계)
  function kzWindow(kappaMin) {
    var lo = 0.2 * GEO.L, cap = 0.5 * GEO.L, zStart;
    if (kappaMin && isFinite(kappaMin) && kappaMin > 0) zStart = clamp(GEO.z0 + 2 / kappaMin, lo, cap);
    else zStart = lo;                       // 차단 모드 없음 → 여유 항 미사용 (NaN 방지)
    return { zStart: zStart, zEnd: 0.7 * GEO.L };
  }

  /* ---------- 공통 도구 ---------- */
  function sampleZ(win) {
    var xs = [];
    for (var z = win.zStart; z <= win.zEnd; z += 1) xs.push(z);
    return xs;
  }
  // 최소제곱 직선맞춤 + 결정계수 R².
  // R²는 "깨끗한 지수인가"를 정답을 모른 채 판정할 수 있는 유일한 기준이다.
  // 바닥에 잠긴 잡음은 기울기가 그럴듯해도 R²가 낮다.
  function fitLine(xs, ys) {
    var sx = 0, sy = 0, sxx = 0, sxy = 0, n = xs.length;
    if (n < 2) return null;
    for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    var den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-300) return null;
    var b = (n * sxy - sx * sy) / den, aC = (sy - b * sx) / n;
    var ybar = sy / n, ssTot = 0, ssRes = 0;
    for (var j = 0; j < n; j++) {
      var d1 = ys[j] - ybar, d2 = ys[j] - (aC + b * xs[j]);
      ssTot += d1 * d1; ssRes += d2 * d2;
    }
    return { slope: b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, n: n };
  }

  function fitLogSlope(xs, amps) {
    var X = [], Y = [];
    for (var i = 0; i < xs.length; i++) {
      if (amps[i] < 1e-14) continue;
      X.push(xs[i]); Y.push(Math.log(amps[i]));
    }
    return fitLine(X, Y);
  }

  /* ---------- 7-4. κ 측정 ----------
   * modes.js:measureKappaN 의 가드 4종을 전부 유지한다.
   * null 이면 "측정 불가"를 그대로 표시한다 — 추정값으로 채우지 말 것. */
  function measureKappa(field, a, n, winId, d, kThy) {
    var win = kappaWindow(winId, kThy);
    if (!win.valid) return { value: null, reason: '창 무효', win: win };
    if (!(1 / kThy >= (d || 1))) return { value: null, reason: '분해능 한계 (1/κ < d)', win: win };

    var amp = modeCoefMag(field, a, n);
    var xs = [], amps = [];
    sampleZ(win).forEach(function (z) {
      var ip = Math.round(z) + GEO.xLeft;
      if (ip < 0 || ip >= amp.length) return;
      xs.push(z); amps.push(amp[ip]);
    });
    if (xs.length < 2) return { value: null, reason: '창 무효', win: win };

    var endAmp = amps[amps.length - 1], startAmp = amps[0];
    if (!(endAmp > 0)) return { value: null, reason: '수치 바닥', win: win };
    if (startAmp > 0 && startAmp / endAmp < 1.5) return { value: null, reason: '진폭비 부족 (< 1.5)', win: win };

    var f = fitLogSlope(xs, amps);
    if (f === null) return { value: null, reason: '수치 바닥', win: win };
    if (f.slope >= 0) return { value: null, reason: '기울기 비물리 (≥ 0)', win: win, r2: f.r2 };
    // 직선성 가드 — 임계값 확정 전까지 켜지 않는다. R²는 항상 함께 보고한다.
    if (R2_MIN !== null && f.r2 < R2_MIN)
      return { value: null, reason: '직선성 부족 (R²=' + f.r2.toFixed(3) + ')', win: win, r2: f.r2 };
    return { value: -f.slope, reason: null, win: win, r2: f.r2 };
  }

  /* ---------- 7-5. k_z 측정 ----------
   * 위상 언랩 + 최소제곱. resolvable 조건 λ_g ≤ 창 길이는 신규 (원본 두 코드에 없음).
   * 근거: 모드가 문턱 바로 아래면 k_z→0이라 λ_g가 무한히 길어진다. 창 안에 마루가
   * 하나도 안 들어오면 위상 기울기는 의미가 없는데, 가드가 없으면 그럴듯한 숫자가 나온다. */
  function measureKz(field, a, n, kzThy, kappaMin, opts) {
    opts = opts || {};
    var win = kzWindow(kappaMin);
    var lamG = 2 * Math.PI / kzThy;

    if (opts.truncate) {
      // 리플 절단 (verify 진단 전용) — 창 길이를 λ_g의 정수배로 맞춘다.
      // 위상 섭동항 arg(1+ρe^{−2ik_z z})의 주기가 λ_g/2이므로 정수 주기면 기울기에서 상쇄된다.
      var half = lamG / 2, len0 = win.zEnd - win.zStart;
      var nPer = Math.floor(len0 / half);
      if (nPer < 1) return { value: null, reason: '창보다 λ_g가 김', win: win, periods: len0 / half };
      win = { zStart: win.zStart, zEnd: win.zStart + nPer * half };
      // 절단은 길이를 λ_g 정수배로 만들어 λ_g ≤ 길이가 정확히 등호에 걸린다 → 검사 생략 (설계 §12-5)
    } else {
      if (!((win.zEnd - win.zStart) > 0) || !isFinite(kzThy) || !(kzThy > 0))
        return { value: null, reason: '창 무효', win: win };
      if (!(lamG <= (win.zEnd - win.zStart)))
        return { value: null, reason: '창보다 λ_g가 김', win: win, periods: (win.zEnd - win.zStart) / (lamG / 2) };
    }

    var xs = [], phis = [];
    sampleZ(win).forEach(function (z) {
      var c = modeCoefComplexAt(field, a, Math.round(z) + GEO.xLeft, n);
      xs.push(z); phis.push(Math.atan2(c[1], c[0]));
    });
    if (xs.length < 2) return { value: null, reason: '창 무효', win: win };

    for (var i = 1; i < phis.length; i++) {
      while (phis[i] - phis[i - 1] > Math.PI) phis[i] -= 2 * Math.PI;
      while (phis[i] - phis[i - 1] < -Math.PI) phis[i] += 2 * Math.PI;
    }
    var f = fitLine(xs, phis);
    if (f === null) return { value: null, reason: '창 무효', win: win };
    return { value: Math.abs(f.slope), reason: null, r2: f.r2,
             win: win, periods: (win.zEnd - win.zStart) / (lamG / 2) };
  }

  /* ---------- G2-PROFILE. 국소 기울기 프로파일 (설계 §7-2) ----------
   * 창 후보 3종은 추측 3종이다. z를 따라가며 짧은 구간마다 κ를 재면 평탄 구간이
   * 데이터에서 직접 읽힌다. 가드는 여기서 끈다 — 무효 구간의 모양 자체를 봐야 한다. */
  function localKappaProfile(field, a, n, kThy) {
    var len = Math.max(20, 2 / kThy);
    var amp = modeCoefMag(field, a, n);
    var out = [];
    for (var z0 = 5; z0 <= 0.9 * GEO.L - len; z0 += 15) {
      var xs = [], amps = [];
      for (var z = z0; z <= z0 + len; z += 1) {
        var ip = Math.round(z) + GEO.xLeft;
        if (ip < 0 || ip >= amp.length) continue;
        xs.push(z); amps.push(amp[ip]);
      }
      var f = fitLogSlope(xs, amps);
      out.push({ zStart: z0, zEnd: z0 + len, zCenter: z0 + len / 2,
                 kappa: (f === null ? null : -f.slope),
                 ratio: (f === null ? null : -f.slope / kThy),
                 r2: (f === null ? null : f.r2),
                 crossesSource: z0 < GEO.srcZ() });
    }
    return { len: len, rows: out };
  }

  return {
    jBotTop: jBotTop, modeCoefMag: modeCoefMag, modeCoefComplexAt: modeCoefComplexAt,
    kc: kc, theoryKz: theoryKz, theoryKappa: theoryKappa, coupling: coupling,
    wallShift: wallShift, aEff: aEff, awMatched: awMatched,
    kappaMinOfCutoff: kappaMinOfCutoff,
    KAPPA_WINDOWS: KAPPA_WINDOWS, WINDOW_IDS: WINDOW_IDS, WINDOW_LABEL: WINDOW_LABEL,
    kappaWindow: kappaWindow, kzWindow: kzWindow, R2_MIN: R2_MIN,
    measureKappa: measureKappa, measureKz: measureKz,
    localKappaProfile: localKappaProfile
  };
});
