(function (global) {
  'use strict';

  // Abramowitz & Stegun 9.4.1 / 9.4.3 다항 근사 (오차 < ~1e-7)
  function besselJ0(x) {
    var ax = x < 0 ? -x : x;
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

  function hankel0(x) { return { re: besselJ0(x), im: besselY0(x) }; }

  function buildHankelTable(k, rMax, dx) {
    dx = dx || 0.02;
    var xMax = k * rMax;
    var n = Math.max(2, Math.ceil(xMax / dx));
    var re = new Float32Array(n + 1);
    var im = new Float32Array(n + 1);
    for (var i = 0; i <= n; i++) {
      var x = i * dx;
      if (x < 1e-4) x = 1e-4;            // r→0 발산 클램프
      re[i] = besselJ0(x);
      im[i] = besselY0(x);
    }
    re[0] = re[1]; im[0] = im[1];        // 첫 칸 클램프
    return { re: re, im: im, k: k, dx: dx, n: n };
  }

  var API = { besselJ0: besselJ0, besselY0: besselY0, hankel0: hankel0,
              buildHankelTable: buildHankelTable };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { global.WG = global.WG || {}; Object.assign(global.WG, API); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
