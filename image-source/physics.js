(function (global) {
  'use strict';

  function waveNumber(lambda) { return 2 * Math.PI / lambda; }

  function cutoffInfo(lambda, a) {
    var cutoffLambda = 2 * a;
    var evanescent = lambda > cutoffLambda;
    var k = 2 * Math.PI / lambda;
    var kc = Math.PI / a;
    var kappa = null, kguide = null;
    if (evanescent) kappa = Math.sqrt(kc * kc - k * k);
    else kguide = Math.sqrt(k * k - kc * kc);
    return { cutoffLambda: cutoffLambda, evanescent: evanescent,
             kappa: kappa, kguide: kguide };
  }

  function theoryCurve(lambda, a, x0, xs) {
    var info = cutoffInfo(lambda, a);
    var out = [];
    for (var i = 0; i < xs.length; i++) {
      var dx = xs[i] - x0;
      out.push(info.evanescent ? Math.exp(-info.kappa * dx) : 1);
    }
    return out;
  }

  function fitExponential(ampArr, xStart, xEnd) {
    var sumXX = 0, sumXY = 0, sumX = 0, sumY = 0, cnt = 0;
    for (var x = xStart; x <= xEnd; x++) {
      if (ampArr[x] < 1e-10) continue;
      var lv = Math.log(ampArr[x]);
      sumXX += x * x; sumXY += x * lv; sumX += x; sumY += lv; cnt++;
    }
    if (cnt < 2) return 0;
    var denom = cnt * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-12) return 0;
    var slope = (cnt * sumXY - sumX * sumY) / denom;
    return -slope;
  }

  // 닫힌 해: 도파관 모드 합 (N=∞ 극한)
  // ySrc: 소스의 y좌표 (생략 시 y0 = 벽 사이 중앙)
  // n번째 모드의 소스항 = sin(nπ·h/a),  h = ySrc − yBot
  //   h=a/2 → sin(nπ/2): 짝수 모드 0 (중심 선원은 홀수 모드만 여기)
  //   h=a/4 → n=2 최대,  h=a/6 → n=3 계열 부각
  // 반환 필드는 영상 합 방식과 동일 규격 (H₀⁽¹⁾ 기반, 1/4 인수 없음)
  // 참조: G_wg = (i/a) Σ sin_y·sin_y0·e^{ik_zn|dx|}/k_zn,  코드 값 = (4/i)G_wg
  //   Dirichlet 정규화 고유함수 φ_n = √(2/a)·sin(nπy/a), 1D 그린함수 u_n = (i/2k_zn)·e^{ik_zn|dx|}
  //   → G_wg = Σ (2/a)·sin·sin·(i/2k_zn)·e^{...} = (i/a) Σ ...  (i/2a 아님)
  function computeModeField(Nx, Ny, y0, a, lambda, x0, nMax, ySrc) {
    var re = new Float32Array(Nx * Ny);
    var im = new Float32Array(Nx * Ny);
    var k = 2 * Math.PI / lambda;
    var yBot = y0 - a / 2;
    var h = ((ySrc === undefined) ? y0 : ySrc) - yBot;
    var jBot = Math.round(yBot), jTop = Math.round(y0 + a / 2);
    var span = jTop - jBot;

    var dropped = [], undef = [];

    for (var n = 1; n <= nMax; n++) {
      var kc_n = n * Math.PI / a;
      var srcAmp = Math.sin(n * Math.PI * h / a);
      var k2 = k * k, kc2 = kc_n * kc_n;
      var propagating = k2 > kc2;
      var kzn = propagating ? Math.sqrt(k2 - kc2) : 0;
      var kappan = propagating ? 0 : Math.sqrt(kc2 - k2);

      /* 문턱 모드 (k = k_c) — 아래 두 분기의 계수 4/(a·k_zn), 4/(a·κ_n) 이 발산한다.
       * λ = 2a/n 이면 부동소수점상 k 와 k_c 가 비트 단위로 같아져 실제로 일어난다.
       * 그때 propagating = (k2 > kc2) 가 false 라 차단 분기로 가고 κ_n = 0 이 된다.
       *  - 결합계수가 수치적 0 이면 항을 버린다. y₀/a = 0.5 의 짝수 모드가 그렇다:
       *    sin(nπ/2) 가 정확히 0 이 아니라 1.22e−16 이라 0 × ∞ = NaN 이 되던 자리다.
       *    a=5.0·λ=5.0 과 a=10.0·λ=10.0 에서 격자 전체가 ±Inf/NaN 으로 덮이던 원인이다.
       *  - 결합계수가 살아 있으면 발산이 물리적 실재다 (선파원이 여기하는 모드 진폭이
       *    1/k_z 로 발산한다). 값을 지어내지 않고 "정의되지 않음"으로 표시하고,
       *    NaN·Inf 를 배열에 흘려보내지 않는다. 소비자가 undefinedThresholdModes 를 본다. */
      if (!propagating && kappan === 0) {
        if (Math.abs(srcAmp) < 1e-12) { dropped.push(n); continue; }
        undef.push(n); continue;
      }

      // sin_y 룩업 테이블 (sin 반복 연산 절감)
      var sinY = new Float32Array(span + 1);
      for (var jj = 0; jj <= span; jj++)
        sinY[jj] = Math.sin(n * Math.PI * jj / span);

      for (var i = 0; i < Nx; i++) {
        var dx = Math.abs(i - x0);
        var base = i * Ny;
        var fRe, fIm;

        if (propagating) {
          // 기여: (4/(a·k_zn))·sin(nπh/a)·sin_y·(cos(k_zn·dx) + i·sin(k_zn·dx))
          var amp = 4 / (a * kzn) * srcAmp;
          fRe = amp * Math.cos(kzn * dx);
          fIm = amp * Math.sin(kzn * dx);
        } else {
          // 기여: -(4/(a·κ_n))·sin(nπh/a)·sin_y·exp(-κ_n·dx)  [순 허수부]
          var expD = Math.exp(-kappan * dx);
          fRe = 0;
          fIm = -(4 / (a * kappan)) * srcAmp * expD;
        }

        for (var j = jBot; j <= jTop; j++) {
          var sy = sinY[j - jBot];
          var idx = base + j;
          re[idx] += fRe * sy;
          im[idx] += fIm * sy;
        }
      }
    }
    // defined=false 면 이 격자는 "그 모드를 뺀 나머지 합"이며 정확해가 아니다.
    // 그 조건에서는 값을 쓰지 말고 '정의되지 않음'으로 표시할 것.
    return { re: re, im: im, Nx: Nx, Ny: Ny,
             droppedThresholdModes: dropped,     // 결합 0 → 버린 항 (정확해 유지)
             undefinedThresholdModes: undef,     // 결합 살아 있음 → 발산
             defined: undef.length === 0 };
  }

  var API = { waveNumber: waveNumber, cutoffInfo: cutoffInfo, theoryCurve: theoryCurve,
              fitExponential: fitExponential, computeModeField: computeModeField };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { global.WG = global.WG || {}; Object.assign(global.WG, API); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
