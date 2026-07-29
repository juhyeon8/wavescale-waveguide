(function (global, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./geometry.js'), require('./measure.js'));
  else global.Render = factory(global.GEO, global.Measure);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GEO, M) {
  'use strict';

  // ===== 렌더러 한 벌 (v1 §1-4 / §9) =====
  // 감마·색 매핑·진폭 스케일을 패널마다 다르게 두지 않는다.
  // 원본 render.js(선형 감마)와 render-ho.js(감마 0.4)를 둘 다 로드하지 않는다.

  /* ---------- 9-1. 색 매핑 — 하나만 ---------- */
  // 시간 규약: 인스턴스값 = re·cosφ + im·sinφ (양쪽 원본과 동일, 바꾸지 말 것)
  function colorForValue(v, scale, gamma) {
    var t = v / scale;
    var sign = t < 0 ? -1 : 1;
    var mag = Math.min(1, Math.abs(t));
    t = sign * Math.pow(mag, gamma);
    if (t >= 0) { var c = Math.round(255 * (1 - t)); return [255, c, c]; }
    var d = Math.round(255 * (1 + t)); return [d, d, 255];
  }

  function drawField(ctx, field, scale, gamma, phase) {
    var Nx = field.Nx, Ny = field.Ny, re = field.re, im = field.im;
    var img = ctx.createImageData(Nx, Ny), px = img.data;
    var cw = Math.cos(phase), sw = Math.sin(phase);
    for (var i = 0; i < Nx; i++) {
      for (var j = 0; j < Ny; j++) {
        var idx = i * Ny + j;
        var v = re[idx] * cw + im[idx] * sw;
        var rgb = colorForValue(v, scale, gamma);
        var p = ((Ny - 1 - j) * Nx + i) * 4;      // 캔버스 y는 아래로 증가 → 뒤집는다
        px[p] = rgb[0]; px[p + 1] = rgb[1]; px[p + 2] = rgb[2]; px[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- 9-2. 진폭 스케일 — 행별 공통 ----------
   * 각 행(입사/산란/전체)마다 스케일 하나. 그 행 스케일 = 비교 영역(벽 사이) 내
   * 좌우 두 장의 최댓값. 6패널 공통 스케일을 쓰면 차단 깊은 곳에서
   * |E_산란| ≈ |E_입사| ≫ |E_전체| 이므로 전체장 행이 백지가 된다. */
  function maxInTube(field, a) {
    var t = M.jBotTop(a), Ny = field.Ny, mx = 0;
    for (var i = 0; i < field.Nx; i++)
      for (var j = t.jBot; j <= t.jTop; j++) {
        var k = i * Ny + j, m = field.re[k] * field.re[k] + field.im[k] * field.im[k];
        if (m > mx) mx = m;
      }
    return Math.sqrt(mx);
  }
  function rowScale(fieldL, fieldR, a) {
    return Math.max(1e-9, maxInTube(fieldL, a), maxInTube(fieldR, a));
  }

  /* ---------- 좌표 변환 ---------- */
  // 셀 좌표 → 캔버스 픽셀. 캔버스는 백킹 Nx×Ny 이므로 x는 그대로, y만 뒤집는다.
  function cy(jPix) { return GEO.Ny - 1 - jPix; }

  /* ---------- 9-3(대체). 마스킹 — 영역 세 종류, 처리도 셋 다 다르다 ----------
   * row: 'inc' | 'scat' | 'tot'
   *   1행 입사파  : 양쪽 마스크 없음 — 자유공간 선원장이라 전 영역에서 정의되고 G1이 같음을 검증한다.
   *                두 그림이 전 영역에서 똑같이 보이는 것이 G1의 시각판이다.
   *   영상법 벽 바깥 : 불투명 마스크 (수학적 잔여물 — 값 자체가 없어야 할 자리)
   *   도선관        : 가리지 않음. 경계선만 (값이 있으나 좌우 비교 대상이 아닐 뿐) */
  var MASK_FILL = 'rgba(20,24,40,0.72)';

  function drawMask(ctx, scene, row) {
    if (row === 'inc') return { boxes: [] };          // 1행은 양쪽 모두 마스크 없음
    var yTop = cy(Math.round(scene.walls.yTopPix));
    var yBot = cy(Math.round(scene.walls.yBotPix));
    var boxes = [];

    if (scene.method === 'image') {
      // 벽 바깥 = 가림
      ctx.fillStyle = MASK_FILL;
      ctx.fillRect(0, 0, GEO.Nx, yTop);                       // 위쪽 띠
      ctx.fillRect(0, yBot + 1, GEO.Nx, GEO.Ny - yBot - 1);   // 아래쪽 띠
      boxes.push([0, 0, GEO.Nx, yTop], [0, yBot + 1, GEO.Nx, GEO.Ny - yBot - 1]);
      ctx.save();
      ctx.fillStyle = '#9aa3b8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('계산 영역 밖', GEO.Nx / 2, yTop / 2 + 4);
      ctx.fillText('계산 영역 밖', GEO.Nx / 2, yBot + (GEO.Ny - yBot) / 2 + 4);
      ctx.restore();
    }
    return { boxes: boxes };
  }

  /* ---------- 벽·경계선 ---------- */
  function drawWalls(ctx, scene) {
    var yTop = cy(Math.round(scene.walls.yTopPix));
    var yBot = cy(Math.round(scene.walls.yBotPix));
    var x0 = scene.walls.xFromPix, x1 = scene.walls.xToPix;
    ctx.save();
    ctx.strokeStyle = '#2b3145'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, yTop + 0.5); ctx.lineTo(x1, yTop + 0.5);
    ctx.moveTo(x0, yBot + 0.5); ctx.lineTo(x1, yBot + 0.5);
    ctx.stroke();

    if (scene.method === 'wire') {
      // 관 끝 세로 점선 — 실제 도선 끝(= walls.xToPix)에 그린다. xLeft+L 이 아니다.
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#6b748f';
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, GEO.Ny);
      ctx.moveTo(x1 + 0.5, 0); ctx.lineTo(x1 + 0.5, GEO.Ny);
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /* ---------- 5-1. 마커 — kind를 반드시 구분해서 그릴 것 ----------
   * 영상원은 경계조건을 만족시키기 위한 수학적 구성물이고, 도선 점은 실제로 전류가
   * 흐르는 물체다. 같은 모양으로 그리면 이 존재론적 차이가 지워진다.
   * 물리적 정직성 요구사항이며 미적 선택이 아니다. */
  function drawMarkers(ctx, scene, maxWeight) {
    var stat = { 'image-source': 0, wire: 0, source: 0 };
    ctx.save();
    scene.markers.forEach(function (m) {
      stat[m.kind] = (stat[m.kind] || 0) + 1;
      var x = m.xPix + 0.5, y = cy(m.yPix) + 0.5;
      if (m.kind === 'image-source') {
        ctx.strokeStyle = 'rgba(120,150,220,' + Math.max(0.15, m.weight) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.2832); ctx.stroke();   // 속 빈 원
      } else if (m.kind === 'wire') {
        var r = 1 + 2.5 * Math.min(1, m.weight / (maxWeight || 1));
        ctx.fillStyle = '#cfd6e6';
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();      // 채운 원
      } else {
        ctx.fillStyle = '#ffd54a';
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.2832); ctx.fill();      // 노란 채운 원
      }
    });
    ctx.restore();
    return stat;
  }

  function maxWireWeight(scene) {
    var mx = 0;
    scene.markers.forEach(function (m) { if (m.kind === 'wire' && m.weight > mx) mx = m.weight; });
    return mx;
  }

  /* ---------- 9-4. 눈금자 오버레이 (탭 3 전체장 행) ----------
   * 목적: 눈으로 본 것(마루 간격 / 감쇠 거리)과 탭 4에서 잰 숫자(k_z, κ)가
   * 같은 대상임을 연결한다. 좌우 열에 같은 길이로 그린다. */
  function rulerSpec(a, lambda) {
    var k = 2 * Math.PI / lambda;
    var kz = M.theoryKz(1, a, k), kap = M.theoryKappa(1, a, k);
    if (kz !== null) {
      var lamG = 2 * Math.PI / kz;
      return { kind: 'lambda_g', len: lamG, zStart: GEO.z0 + 10,
               label: 'λ_g = ' + (lamG / 10).toFixed(1) + ' cm (모드 1)', theory: kz };
    }
    var win = M.kappaWindow(GEO.KAPPA_WIN, kap);
    return { kind: 'kappa', len: 1 / kap, zStart: win.zStart,
             label: '감쇠길이 1/κ = ' + (1 / kap / 10).toFixed(1) + ' cm (모드 1)', theory: kap };
  }

  function drawRuler(ctx, spec) {
    var y = cy(GEO.y0pix);
    var x0 = GEO.zToPix(spec.zStart), x1 = GEO.zToPix(spec.zStart + spec.len);
    ctx.save();
    ctx.strokeStyle = '#1b2030'; ctx.fillStyle = '#1b2030'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y - 6); ctx.lineTo(x0 + 0.5, y + 6);
    ctx.moveTo(x1 + 0.5, y - 6); ctx.lineTo(x1 + 0.5, y + 6);
    ctx.moveTo(x0 + 0.5, y + 0.5); ctx.lineTo(x1 + 0.5, y + 0.5);
    ctx.stroke();
    ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(spec.label, (x0 + x1) / 2, y - 10);
    ctx.restore();
    return { x0: x0, x1: x1 };
  }

  /* ---------- 한 패널 그리기 ---------- */
  function drawPanel(ctx, scene, row, scale, gamma, phase, opts) {
    opts = opts || {};
    var info = { scale: scale };
    drawField(ctx, scene[row], scale, gamma, phase);
    info.mask = drawMask(ctx, scene, row);
    drawWalls(ctx, scene);
    if (opts.ruler) info.ruler = drawRuler(ctx, opts.ruler);
    info.markers = drawMarkers(ctx, scene, maxWireWeight(scene));
    return info;
  }

  return {
    colorForValue: colorForValue, drawField: drawField,
    maxInTube: maxInTube, rowScale: rowScale,
    drawMask: drawMask, drawWalls: drawWalls, drawMarkers: drawMarkers,
    rulerSpec: rulerSpec, drawRuler: drawRuler, drawPanel: drawPanel,
    cy: cy
  };
});
