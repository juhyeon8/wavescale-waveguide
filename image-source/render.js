(function (global) {
  'use strict';

  function colorForValue(v, scale) {
    var t = v / scale;
    if (t > 1) t = 1; else if (t < -1) t = -1;
    if (t >= 0) {
      var c = Math.round(255 * (1 - t));
      return { r: 255, g: c, b: c };       // 흰→빨강
    }
    var d = Math.round(255 * (1 + t));
    return { r: d, g: d, b: 255 };          // 흰→파랑
  }

  function centerlineAmplitude(field, j) {
    var Nx = field.Nx, Ny = field.Ny, re = field.re, im = field.im;
    var out = new Float32Array(Nx);
    for (var i = 0; i < Nx; i++) {
      var idx = i * Ny + j;
      out[i] = Math.sqrt(re[idx] * re[idx] + im[idx] * im[idx]);
    }
    return out;
  }

  // n번째 도파관 모드 계수: E(x,j)를 sin(nπ(j−jBot)/span)에 투영 (n 생략 시 1)
  // 차단 시 |cn(x)| ∝ exp(−κz), 전파 시 ≈ 상수
  function modeCoefficient(field, y0, a, n) {
    var Nx = field.Nx, Ny = field.Ny, re = field.re, im = field.im;
    var nn = n || 1;
    var jBot = Math.round(y0 - a / 2);
    var jTop = Math.round(y0 + a / 2);
    var span = jTop - jBot;
    if (span < 1) return new Float32Array(Nx);
    var out = new Float32Array(Nx);
    for (var i = 0; i < Nx; i++) {
      var sumRe = 0, sumIm = 0;
      for (var j = jBot; j <= jTop; j++) {
        var w = Math.sin(nn * Math.PI * (j - jBot) / span);
        var idx = i * Ny + j;
        sumRe += re[idx] * w;
        sumIm += im[idx] * w;
      }
      out[i] = Math.sqrt(sumRe * sumRe + sumIm * sumIm) / span;
    }
    return out;
  }

  // 복소장 → 캔버스: 인스턴스값 = re·cosφ + im·sinφ (외향파 규약: φ 증가시 파면이 바깥으로)
  // j 뒤집기: 화면 y는 위로 증가하도록 (j=0이 화면 아래)
  function drawField(ctx, field, scale, phase) {
    var Nx = field.Nx, Ny = field.Ny, re = field.re, im = field.im;
    var img = ctx.createImageData(Nx, Ny);
    var d = img.data, c = Math.cos(phase), s = Math.sin(phase);
    for (var i = 0; i < Nx; i++) {
      for (var j = 0; j < Ny; j++) {
        var idx = i * Ny + j;
        var v = re[idx] * c + im[idx] * s;
        var col = colorForValue(v, scale);
        var p = ((Ny - 1 - j) * Nx + i) * 4;   // j 뒤집기
        d[p] = col.r; d[p + 1] = col.g; d[p + 2] = col.b; d[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function drawPlates(ctx, geom) {
    var Nx = geom.Nx, Ny = geom.Ny, y0 = geom.y0, a = geom.a;
    var yTop = Ny - 1 - (y0 + a / 2);   // 캔버스 y (위=0)
    var yBot = Ny - 1 - (y0 - a / 2);

    // 도파관 내부 옅은 밴드
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, yTop, Nx, yBot - yTop);

    // 도체판 선
    ctx.strokeStyle = '#9aa6d8'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, yTop); ctx.lineTo(Nx, yTop);
    ctx.moveTo(0, yBot); ctx.lineTo(Nx, yBot);
    ctx.stroke();

    drawXTicks(ctx, Nx, Ny);
  }

  // 가로 눈금선 (글자는 HTML span — updateOverlays 참고)
  var CELLS_PER_TICK = 50;          // 셀=1mm → 5 cm 간격
  function drawXTicks(ctx, W, H) {
    ctx.strokeStyle = '#3a4270'; ctx.lineWidth = 1;
    for (var cx = 0; cx < W; cx += CELLS_PER_TICK) {
      ctx.beginPath(); ctx.moveTo(cx, H - 13); ctx.lineTo(cx, H - 5); ctx.stroke();
    }
  }

  function drawSourceDots(ctx, sources, original, geom) {
    var Ny = geom.Ny;
    function dot(x, y, fill, alpha) {
      if (x < 0 || x >= geom.Nx) return;
      var cy = Ny - 1 - y;
      ctx.globalAlpha = (alpha !== undefined) ? alpha : 1;
      ctx.beginPath(); ctx.arc(x, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (var i = 0; i < sources.length; i++) {
      dot(sources[i].x, sources[i].y,
          sources[i].sign > 0 ? '#ff6b6b' : '#5b9bff',
          sources[i].alpha);
    }
    if (original) dot(original.x, original.y, '#ffd479');
  }

  // 모드 그래프 log 축 기하 — updateOverlays 의 라벨 위치와 공유
  var GRAPH = { H: 220, top: 34, bot: 200, decades: 4 };   // 1e0 … 1e-4
  function graphToY(v) {
    var floor = Math.pow(10, -GRAPH.decades - 1);
    var L = Math.log10(v > floor ? v : floor);
    var y = GRAPH.top + (-L / GRAPH.decades) * (GRAPH.bot - GRAPH.top);
    return y < GRAPH.top ? GRAPH.top : (y > GRAPH.bot ? GRAPH.bot : y);
  }

  // modes: [{ arr: |cn(x)|, color, kappa: 이론 κ(셀⁻¹) | null(전파) }, ...]
  // 세 모드를 공통 기준(전체 최댓값=1)으로 규격화 → 곡선 높이차 = 모드 세기차
  // 가로축은 ①②③ 패널과 동일한 픽셀 매핑 (x셀 = x픽셀), 축 글자는 HTML span
  function drawModeGraph(ctx, modes, x0pos, geom) {
    var W = geom.Nx, H = GRAPH.H;
    ctx.clearRect(0, 0, W, H);
    if (!modes || !modes.length) return;

    // 공통 정규화 기준: 모든 모드 · x0pos 이후의 최댓값
    var baseline = 1e-12;
    for (var mi = 0; mi < modes.length; mi++) {
      var arr = modes[mi].arr;
      for (var bx = x0pos; bx < arr.length; bx++) if (arr[bx] > baseline) baseline = arr[bx];
    }
    if (baseline < 1e-10) return;

    // log 격자선
    ctx.strokeStyle = 'rgba(90,100,150,0.30)'; ctx.lineWidth = 1;
    for (var e = 0; e <= GRAPH.decades; e++) {
      var gy = graphToY(Math.pow(10, -e));
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // x0 위치 수직 점선 마커
    ctx.strokeStyle = 'rgba(255,212,121,0.30)';
    ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x0pos, GRAPH.top); ctx.lineTo(x0pos, GRAPH.bot);
    ctx.stroke(); ctx.setLineDash([]);

    // 이론 곡선은 근접장을 지난 x0+20 에서 실측에 맞춤 (κ 피팅 구간 시작점)
    var anchor = Math.min(x0pos + 20, W - 1);

    for (var m = 0; m < modes.length; m++) {
      var md = modes[m], a = md.arr;
      var a0 = a[anchor] / baseline;

      if (a0 > 0) {                                   // 이론 (점선)
        ctx.strokeStyle = md.color; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (var t = anchor; t < W; t++) {
          var tv = md.kappa ? a0 * Math.exp(-md.kappa * (t - anchor)) : a0;
          if (t === anchor) ctx.moveTo(t, graphToY(tv)); else ctx.lineTo(t, graphToY(tv));
        }
        ctx.stroke(); ctx.setLineDash([]);
      }

      ctx.strokeStyle = md.color; ctx.lineWidth = 1.8;  // 측정 (실선)
      ctx.beginPath();
      var first = true;
      for (var x = x0pos; x < W; x++) {
        var v = a[x] / baseline;
        if (first) { ctx.moveTo(x, graphToY(v)); first = false; }
        else ctx.lineTo(x, graphToY(v));
      }
      ctx.stroke();
    }

    drawXTicks(ctx, W, H);
  }

  // N=∞ 모드 전용: ③ 전체장에서 도파관 외부를 "계산 영역 밖"으로 마스킹
  // 모드 합은 내부 전용 함수이므로 외부를 계산하지 않음을 시각적으로 명시
  function drawExternalMask(ctx, geom) {
    var Nx = geom.Nx, Ny = geom.Ny, y0 = geom.y0, a = geom.a;
    var yTop = Ny - 1 - (y0 + a / 2);   // 캔버스 y — 위 도체판
    var yBot = Ny - 1 - (y0 - a / 2);   // 캔버스 y — 아래 도체판

    ctx.fillStyle = 'rgba(20,24,40,0.72)';
    if (yTop > 0) ctx.fillRect(0, 0, Nx, yTop);
    if (yBot < Ny) ctx.fillRect(0, yBot, Nx, Ny - yBot);

    ctx.save();
    ctx.fillStyle = 'rgba(160,170,210,0.75)';
    ctx.font = '11px "Segoe UI","Malgun Gothic",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (yTop > 14) ctx.fillText('계산 영역 밖', Nx / 2, yTop / 2);
    if (Ny - yBot > 14) ctx.fillText('계산 영역 밖', Nx / 2, yBot + (Ny - yBot) / 2);
    ctx.restore();
  }

  // wrappers: { inc, scat, tot, graph } — .cv-wrap 요소들
  // 도체판·mm 라벨을 HTML span으로 관리 (캔버스 CSS 스케일에 무관하게 선명)
  function updateOverlays(wrappers, geom) {
    var Nx = geom.Nx, Ny = geom.Ny, y0 = geom.y0, a = geom.a;
    var mmPerCell = geom.mmPerCell || 1;

    function clear(w) {
      var els = w.getElementsByClassName('cv-label');
      while (els.length) els[0].parentNode.removeChild(els[0]);
    }

    function mkSpan(w, text, leftPct, topPct, cls, color) {
      var s = document.createElement('span');
      s.className = 'cv-label' + (cls ? ' ' + cls : '');
      s.style.left = leftPct.toFixed(2) + '%';
      s.style.top = topPct.toFixed(2) + '%';
      s.style.color = color;
      s.textContent = text;
      w.appendChild(s);
    }

    // 가로축 눈금 글자 — 10 cm 마다 (눈금선은 5 cm 마다, drawXTicks)
    function xLabels(w, H, unitText) {
      var markY = H - 13;
      mkSpan(w, unitText, 4 / Nx * 100, (markY - 12) / H * 100, 'cv-label-axis', '#8892b5');
      for (var cx = CELLS_PER_TICK; cx < Nx; cx += CELLS_PER_TICK) {
        var cm = cx * mmPerCell / 10;
        if (cm % 10 === 0)
          mkSpan(w, cm + '', cx / Nx * 100, (markY - 12) / H * 100, 'cv-label-center', '#6a74a0');
      }
    }

    var yTop = Ny - 1 - (y0 + a / 2);
    var yBot = Ny - 1 - (y0 - a / 2);

    [wrappers.inc, wrappers.scat, wrappers.tot].forEach(function (w) {
      clear(w);
      mkSpan(w, '도체판', 4 / Nx * 100, (yTop - 13) / Ny * 100, null, '#9aa6d8');
      mkSpan(w, '도체판', 4 / Nx * 100, (yBot + 2) / Ny * 100, null, '#9aa6d8');
      xLabels(w, Ny, 'cm');
    });

    // 모드 그래프 축 — 곡선은 x0 이후에만 그려지므로 왼쪽 여백에 글자를 놓아도 가리지 않음
    var Hg = GRAPH.H, wg = wrappers.graph;
    clear(wg);
    mkSpan(wg, '|cₙ|  모드 계수 크기', 3.4, 50, 'cv-label-ytitle cv-label-axis', '#aab2cf');
    for (var e = 0; e <= GRAPH.decades; e++) {
      mkSpan(wg, e === 0 ? '1' : ('1e-' + e), 7.5,
             graphToY(Math.pow(10, -e)) / Hg * 100, 'cv-label-mid', '#6a74a0');
    }
    mkSpan(wg, '세로축: 전체장을 모드 sin(nπy/a)에 투영한 계수 |cₙ| — 세 모드 공통 기준(최댓값=1), log 눈금',
           3.4, 2.5, null, '#8892b5');
    xLabels(wg, Hg, 'z (진행축, cm)');
  }

  var API = { colorForValue: colorForValue, centerlineAmplitude: centerlineAmplitude,
              modeCoefficient: modeCoefficient,
              drawField: drawField, drawPlates: drawPlates,
              drawSourceDots: drawSourceDots, drawModeGraph: drawModeGraph,
              drawExternalMask: drawExternalMask,
              updateOverlays: updateOverlays };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { global.WG = global.WG || {}; Object.assign(global.WG, API); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
