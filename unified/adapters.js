(function (global, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    // node: 각 엔진을 브라우저와 같은 묶음으로 재구성한다 (설계 §3)
    var IMG = Object.assign({},
      require('../image-source/hankel.js'),  require('../image-source/images.js'),
      require('../image-source/physics.js'), require('../image-source/field.js'));
    var WIRE = Object.assign({},
      require('../line-wire/hankel.js'), require('../line-wire/field.js'));
    module.exports = factory(require('./geometry.js'),
      IMG, WIRE, require('../line-wire/core.js'),
      require('../line-wire/higher-order/modes.js'));
  } else {
    // 브라우저: index.html의 <script> 순서가 만든 전역을 그대로 받는다
    global.Adapters = factory(global.GEO, global.IMG, global.WIRE, global.WireWG, global.WGM);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GEO, IMG, WIRE, WireWG, WGM) {
  'use strict';

  function mk() { return IMG.makeField(GEO.Nx, GEO.Ny); }

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
    var a = p.a, N = p.N || 0;
    var ys = GEO.srcYPix(a, p.y0OverA);
    var x0 = GEO.srcPix();
    var k = 2 * Math.PI / p.lambda;

    var rMax = Math.hypot(GEO.Nx + x0, GEO.Ny + N * a) + 10;
    var table = IMG.buildHankelTable(k, rMax);

    var inc = IMG.computeField(mk(), [{ x: x0, y: ys, sign: 1 }], table);
    var scat, tot, markers;

    if (p.modeInfinity) {
      tot = IMG.computeModeField(GEO.Nx, GEO.Ny, GEO.y0pix, a, p.lambda, x0, 41, ys);
      // ⚠ 벽 바깥에서 computeModeField는 0이므로 scat = −inc 가 된다. 뺄셈 찌꺼기이며
      //   산란장이 아니다. 렌더러가 그 영역을 불투명 마스크로 가린다. 보정하지 말 것. (설계 §5-1)
      scat = IMG.subtractComplex(mk(), tot, inc);
      markers = fadedImageMarkers(a, ys, x0);
    } else {
      var imgs = IMG.generateImages('A', N, x0, GEO.y0pix, a, ys);
      scat = IMG.computeField(mk(), imgs, table);
      tot = IMG.addComplex(mk(), inc, scat);
      markers = imgs.map(function (g) {
        return { xPix: g.x, yPix: g.y, kind: 'image-source', weight: 1 };
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
      quality: { N: N, modeInfinity: !!p.modeInfinity, plateAvg: plateWallAvg(tot, a) }
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
    var aw = (p.aw === undefined) ? GEO.aw : p.aw;

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
      quality: { d: d, aw: aw, awOverD: aw / d,
                 nW: GEO.nWires(d), lastWireZ: GEO.lastWireZ(d),
                 gap: d - 2 * aw, dOverLambda: d / p.lambda,
                 wallT: s.wallT }
    };
  }

  return { imageScene: imageScene, wireScene: wireScene, dAuto: dAuto };
});
