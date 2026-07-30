(function (global, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    // node: 각 엔진을 브라우저와 같은 묶음으로 재구성한다 (설계 §3)
    var IMG = Object.assign({},
      require('../image-source/hankel.js'),  require('../image-source/images.js'),
      require('../image-source/physics.js'), require('../image-source/field.js'));
    var WIRE = Object.assign({},
      require('../line-wire/hankel.js'), require('../line-wire/field.js'));
    module.exports = factory(require('./geometry.js'), require('./measure.js'),
      IMG, WIRE, require('../line-wire/core.js'),
      require('../line-wire/higher-order/modes.js'));
  } else {
    // 브라우저: index.html의 <script> 순서가 만든 전역을 그대로 받는다
    global.Adapters = factory(global.GEO, global.Measure, global.IMG, global.WIRE, global.WireWG, global.WGM);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GEO, M, IMG, WIRE, WireWG, WGM) {
  'use strict';

  function mk() { return IMG.makeField(GEO.Nx, GEO.Ny); }

  /* ---------- 산란장·전체장을 벽 사이 띠에서만 계산 (설계 §8-1) ----------
   * 영상법 2·3행은 벽 바깥이 불투명 마스크로 가려진다. 기본 조건이면 220행 중 61행만
   * 화면에 나오므로 나머지는 계산해서 곧바로 덮어 가리는 낭비다.
   *
   * 원본 field.js의 커널(addOneSource)을 고치지도, 그 내부 루프를 베끼지도 않는다.
   * 대신 띠 높이만큼의 임시 격자에 원본 커널을 그대로 돌리고 제자리로 옮긴다.
   * 소스 y를 jBot만큼 내리면 dy가 같아지므로 물리가 바뀌지 않는다
   * (부동소수점 반올림 차이는 1 ulp 수준이며, verify.js ON/OFF 대조로 확인한다).
   *
   * 범위 밖 배열 원소는 0으로 남는다. 마스크가 덮으므로 화면에는 안 나오지만,
   * 그 값을 읽는 경로가 생기면 조용히 0이 흘러든다. ?debug=1이 범위를 찍는다. */
  function bandOf(a) { return M.jBotTop(a); }

  function computeBand(dst, sources, table, jBot, jTop) {
    var h = jTop - jBot + 1;
    var band = IMG.makeField(GEO.Nx, h);
    IMG.computeField(band, sources.map(function (s) {
      return { x: s.x, y: s.y - jBot, sign: s.sign };
    }), table);
    var Ny = dst.Ny;
    for (var i = 0; i < GEO.Nx; i++) {
      var s = i * h, d = i * Ny + jBot;
      for (var j = 0; j < h; j++) { dst.re[d + j] = band.re[s + j]; dst.im[d + j] = band.im[s + j]; }
    }
    return dst;
  }

  // 띠 안에서만 A±B. 밖은 0으로 둔다 (보정하지 않는다 — 설계 §5-1).
  function combineBand(dst, A, B, sign, jBot, jTop) {
    var Ny = dst.Ny;
    for (var i = 0; i < GEO.Nx; i++) for (var j = jBot; j <= jTop; j++) {
      var k = i * Ny + j;
      dst.re[k] = A.re[k] + sign * B.re[k];
      dst.im[k] = A.im[k] + sign * B.im[k];
    }
    return dst;
  }

  function dAuto(lambda) { return WGM.dAuto(lambda, GEO.L, GEO.Nmax); }

  // 도체판 두 줄 위의 |E| 평균 — 원본 main.js:plateWallAvg 로직 그대로.
  // N ↑ → 0에 수렴하는 것이 영상법의 수치 품질 지표다.
  function plateWallAvg(field, a) {
    var Ny = field.Ny, re = field.re, im = field.im;
    var jTop = Math.round(GEO.wallTopPix(a)), jBot = Math.round(GEO.wallBotPix(a));
    var x0 = GEO.srcPix();
    var xFrom = Math.max(0, x0 - 10), xTo = Math.min(field.Nx - 1, x0 + 10);
    var s = 0, cnt = 0;
    for (var xi = xFrom; xi <= xTo; xi++) {
      var iT = xi * Ny + jTop, iB = xi * Ny + jBot;
      s += Math.sqrt(re[iT] * re[iT] + im[iT] * im[iT]);
      s += Math.sqrt(re[iB] * re[iB] + im[iB] * im[iB]);
      cnt += 2;
    }
    return cnt ? s / cnt : 0;
  }

  // ===== 6-1. 영상법 =====
  // p = { lambda, a, y0OverA, N, modeInfinity }
  // 원본 main.js:recomputeAll 을 그대로 옮기되, 전역 state 대신 p를 쓰고
  // x0에 GEO.srcPix()(=146)를 넣는다. 이것이 영상법에 가하는 유일한 좌표 변경. (v1 §4-1)
  function imageScene(p) {
    var a = p.a, N = (p.N === undefined) ? GEO.N : p.N;
    var cesaro = (p.cesaro === undefined) ? GEO.CESARO : !!p.cesaro;
    var ys = GEO.srcYPix(a, p.y0OverA);
    var x0 = GEO.srcPix();
    var k = 2 * Math.PI / p.lambda;

    var rMax = Math.hypot(GEO.Nx + x0, GEO.Ny + N * a) + 10;
    var table = IMG.buildHankelTable(k, rMax);

    // 1행 입사파는 소스 하나라 저렴하고, 설계 §8-1이 마스크 없음을 요구한다 → 전 영역 유지.
    var inc = IMG.computeField(mk(), [{ x: x0, y: ys, sign: 1 }], table);
    var band = (p.scatBand === undefined) ? GEO.SCAT_BAND : !!p.scatBand;
    var bt = bandOf(a), jBot = band ? bt.jBot : 0, jTop = band ? bt.jTop : GEO.Ny - 1;
    var scat, tot, markers;

    if (p.modeInfinity) {
      tot = IMG.computeModeField(GEO.Nx, GEO.Ny, GEO.y0pix, a, p.lambda, x0, 41, ys);
      // ⚠ 벽 바깥에서 computeModeField는 0이므로 scat = −inc 가 된다. 뺄셈 찌꺼기이며
      //   산란장이 아니다. 렌더러가 그 영역을 불투명 마스크로 가린다. 보정하지 말 것. (설계 §5-1)
      scat = combineBand(mk(), tot, inc, -1, jBot, jTop);
      markers = fadedImageMarkers(a, ys, x0);
    } else {
      var imgs = IMG.generateImages('A', N, x0, GEO.y0pix, a, ys);
      // Cesàro 평균 — 차단 영역의 영상 급수는 거친 교대급수라 유한 N 합이 크게 흔들린다.
      // 부분합의 산술평균 C_N = (1/N)Σ S_r 는 항별 삼각 가중치로 등가 계산된다:
      //   C_N = Σ_j t_j · (N − j + 1)/N          (j = 반사 횟수 r)
      // generateImages는 r마다 2개씩 순서대로 넣으므로 r = floor(i/2)+1.
      // sign이 곱셈 인자이므로 여기에 가중치를 실으면 원본을 고치지 않아도 된다.
      var src = imgs, wOf = null;
      if (cesaro && N > 0) {
        wOf = function (i) { return (N - (Math.floor(i / 2) + 1) + 1) / N; };
        src = imgs.map(function (g, i) {
          return { x: g.x, y: g.y, sign: g.sign * wOf(i) };
        });
      }
      scat = computeBand(mk(), src, table, jBot, jTop);
      tot = combineBand(mk(), inc, scat, +1, jBot, jTop);
      markers = imgs.map(function (g, i) {
        return { xPix: g.x, yPix: g.y, kind: 'image-source', weight: wOf ? wOf(i) : 1 };
      });
    }
    markers.push({ xPix: x0, yPix: ys, kind: 'source', weight: 1 });

    return {
      method: 'image',
      Nx: GEO.Nx, Ny: GEO.Ny, y0pix: GEO.y0pix,
      a: a, lambda: p.lambda, k: k, y0OverA: p.y0OverA,
      inc: inc, scat: scat, tot: tot,
      walls: { yTopPix: GEO.wallTopPix(a), yBotPix: GEO.wallBotPix(a),
               xFromPix: 0, xToPix: GEO.Nx },
      markers: markers,
      quality: { N: N, modeInfinity: !!p.modeInfinity, cesaro: cesaro && !p.modeInfinity,
                 scatBand: band, jBot: jBot, jTop: jTop, bandRows: jTop - jBot + 1,
                 plateAvg: plateWallAvg(tot, a) }
    };
  }

  // N=∞ 표시용 — 반사 횟수가 클수록 희미해지는 영상 점 (원본 main.js:buildFadedImages)
  // generateImages는 반사 r마다 2개씩 순서대로 넣으므로 인덱스로 r을 되짚을 수 있다.
  function fadedImageMarkers(a, ys, x0) {
    var N_disp = 40;
    var imgs = IMG.generateImages('A', N_disp, x0, GEO.y0pix, a, ys);
    return imgs.map(function (g, i) {
      var r = Math.floor(i / 2) + 1;
      return { xPix: g.x, yPix: g.y, kind: 'image-source',
               weight: Math.max(0.05, 1 - r / (N_disp + 1)) };
    });
  }

  // ===== 6-2. 도선 관 =====
  // p = { lambda, a, y0OverA, d, aw }
  function wireScene(p) {
    var a = p.a, d = (p.d === undefined || p.d === null) ? dAuto(p.lambda) : p.d;
    // 유효 벽 정합 — a_w = d/2π 이면 δ = 0 이다. a_w는 물리 상수가 아니라 이산화
    // 설계 변수이고, 0.8도 임의의 선택이었다. 자유 매개변수를 더하는 게 아니라
    // 이미 있던 임의성을 물리적 기준으로 제거하는 것이다. (설계 §11-6)
    // d = 0.055λ 이므로 k·a_w = 2π·a_w/λ = 0.055 로 λ에 무관한 상수가 되고,
    // a_w/d = 1/2π = 0.1592 로 고정되어 얇은 도선 근사 두 조건이 전 범위에서 같아진다.
    var awAuto = (p.awAuto === undefined) ? GEO.AW_AUTO : !!p.awAuto;
    var aw = awAuto ? M.awMatched(d) : ((p.aw === undefined) ? GEO.aw : p.aw);

    var q = {
      lambda: p.lambda, a: a, L: GEO.L, d: d,
      y0spec: p.y0OverA * a,          // 아래벽 기준 셀
      aw: aw,
      xLeft: GEO.xLeft, xRight: GEO.xRight,
      Ny: GEO.Ny, y0pix: GEO.y0pix, z0: GEO.z0
    };
    var s = WGM.computeScene(WireWG, WIRE, q);

    var markers = s.wiresPixDraw.map(function (w, j) {
      return { xPix: w.x, yPix: w.y, kind: 'wire',
               weight: Math.hypot(s.cre[j], s.cim[j]) };
    });
    markers.push({ xPix: GEO.srcPix(), yPix: GEO.srcYPix(a, p.y0OverA),
                   kind: 'source', weight: 1 });

    return {
      method: 'wire',
      Nx: s.Nx, Ny: s.Ny, y0pix: GEO.y0pix,
      a: a, lambda: p.lambda, k: s.k, y0OverA: p.y0OverA,
      inc: s.inc, scat: s.scat, tot: s.tot,
      walls: { yTopPix: GEO.wallTopPix(a), yBotPix: GEO.wallBotPix(a),
               xFromPix: GEO.xLeft, xToPix: GEO.wallXToPix(d) },
      markers: markers,
      quality: { d: d, aw: aw, awAuto: awAuto, awOverD: aw / d,
                 nW: GEO.nWires(d), lastWireZ: GEO.lastWireZ(d),
                 gap: d - 2 * aw, dOverLambda: d / p.lambda,
                 delta: M.wallShift(d, aw), aEff: M.aEff(a, d, aw),
                 wallT: s.wallT }
    };
  }

  return { imageScene: imageScene, wireScene: wireScene, dAuto: dAuto };
});
