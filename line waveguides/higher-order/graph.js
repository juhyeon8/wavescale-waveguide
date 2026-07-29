(function (global) {
  'use strict';
  var COLORS = { 1: '#4a90d9', 2: '#3fb56b', 3: '#e8913a' };

  function drawModeGraph(ctx, s, CFG) {
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);           // 논리좌표(CSS px)로 그림 → dpr 배율만큼 선명
    var W = ctx.canvas.width / dpr, H = ctx.canvas.height / dpr;
    // ★ z축 정렬: 전체장 패널과 동일한 가로 비율(xLeft·L·xRight 기준)로 여백 계산
    var NxTot = CFG.xLeft + CFG.L + CFG.xRight;
    var padL = (CFG.xLeft / NxTot) * W, padR = (CFG.xRight / NxTot) * W, padB = 30, padT = 46;
    ctx.clearRect(0, 0, W, H);
    var a = CFG.a, k = s.k, y0pix = CFG.y0pix, xLeft = CFG.xLeft, L = CFG.L;

    var kappas = [1, 2, 3].map(function (n) { return WGM.theoryKappa(n, a, k); }).filter(function (v) { return v; });
    var kappaMin = kappas.length ? Math.min.apply(null, kappas) : null;
    var win = WGM.fitWindowZ(CFG.z0, L, kappaMin);

    var amps = {}, refIPix = Math.round(win.zStart) + xLeft, norm = 1e-9;
    [1, 2, 3].forEach(function (n) {
      amps[n] = WGM.modeCoefGridN(s.tot, y0pix, a, n);
      if (amps[n][refIPix] > norm) norm = amps[n][refIPix];
    });

    var decades = 4, yMaxLog = 0.3;
    function X(zc) { return padL + (zc / L) * (W - padL - padR); }
    function Y(val) {
      var lg = Math.log(Math.max(val, 1e-12) / norm) / Math.LN10;
      var t = (yMaxLog - lg) / decades; if (t < 0) t = 0; if (t > 1) t = 1;
      return padT + t * (H - padT - padB);
    }
    ctx.strokeStyle = '#2a3050'; ctx.strokeRect(padL, padT, W - padL - padR, H - padT - padB);
    ctx.fillStyle = '#8892b5'; ctx.font = '11px "Segoe UI",sans-serif';
    for (var dd = 0; dd <= decades; dd++) {
      var yy = padT + (dd / decades) * (H - padT - padB);
      ctx.strokeStyle = '#1b2140'; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText('1e' + (Math.round(yMaxLog) - dd), padL - 5, yy + 4);
    }
    // ★ 가로축 z 눈금 (5 cm = 50칸 간격)
    ctx.textAlign = 'center';
    for (var zt = 0; zt <= L + 0.1; zt += 50) {
      var xx = X(zt);
      ctx.strokeStyle = '#1b2140'; ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, H - padB); ctx.stroke();
      ctx.fillStyle = '#8892b5'; ctx.fillText((zt / 10).toFixed(0), xx, H - padB + 14);
    }
    ctx.fillStyle = '#8892b5'; ctx.fillText('z (진행축, cm)', (padL + (W - padR)) / 2, H - 4);
    // §3-4 y축 세로 라벨 — 눈금값 가까이로
    ctx.save();
    ctx.translate(Math.max(12, padL - 38), padT + (H - padT - padB) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.fillStyle = '#8892b5'; ctx.font = '11px "Segoe UI",sans-serif';
    ctx.fillText('|cₙ(z)|  (모드 계수 크기, 로그)', 0, 0);
    ctx.restore();

    var floorThresh = norm * 1e-4; // §3-6 수치 바닥(하단 1e-4 데케이드)
    [1, 2, 3].forEach(function (n) {
      var col = COLORS[n];
      // 실측 실선 — 바닥 아래 구간은 반투명(0.25)
      ctx.lineWidth = 1.8; ctx.setLineDash([]); ctx.strokeStyle = col;
      var seg = [], curBelow = null;
      function strokeSeg(pts, below) {
        if (pts.length < 2) return;
        ctx.globalAlpha = below ? 0.25 : 1; ctx.beginPath();
        for (var q = 0; q < pts.length; q++) { if (q === 0) ctx.moveTo(pts[q].x, pts[q].y); else ctx.lineTo(pts[q].x, pts[q].y); }
        ctx.stroke();
      }
      for (var zc = 0; zc <= L; zc += 1) {
        var v = amps[n][Math.round(zc) + xLeft];
        var below = v < floorThresh, pt = { x: X(zc), y: Y(v) };
        if (curBelow === null) { curBelow = below; seg = [pt]; }
        else if (below === curBelow) { seg.push(pt); }
        else { seg.push(pt); strokeSeg(seg, curBelow); seg = [pt]; curBelow = below; }
      }
      strokeSeg(seg, curBelow);
      ctx.globalAlpha = 1;

      // 이론 점선
      var kap = WGM.theoryKappa(n, a, k), kz = WGM.theoryKz(n, a, k);
      ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.beginPath();
      if (kap) {
        var kwin = WGM.kappaWindowN(L, kap, s.d);
        var anchorI = Math.round(kwin.zStart) + xLeft;
        var anchor = amps[n][anchorI];
        for (var zc2 = kwin.zStart; zc2 <= L; zc2 += 1) {
          var tv = anchor * Math.exp(-kap * (zc2 - kwin.zStart));
          if (zc2 === kwin.zStart) ctx.moveTo(X(zc2), Y(tv)); else ctx.lineTo(X(zc2), Y(tv));
        }
      } else if (kz) {
        var h = theoryHeight(n, s, CFG, win, amps, xLeft);
        ctx.moveTo(X(win.zStart), Y(h)); ctx.lineTo(X(L), Y(h));
      }
      ctx.stroke(); ctx.setLineDash([]);
    });

    drawLegend(ctx, padL, W, padR);
    if (s.dOverLambda > 0.1 || s.wallT > 0.35) drawCollapseWarn(ctx, W, padT, padR);
  }

  function theoryHeight(n, s, CFG, win, amps, xLeft) {
    var a = CFG.a, k = s.k, y0spec = window.__hoState.y0spec;
    var base = geoMean(amps[1], Math.round(win.zStart) + xLeft, Math.round(win.zEnd) + xLeft);
    var amp1 = WGM.theoryPropAmp(1, y0spec, a, k), ampN = WGM.theoryPropAmp(n, y0spec, a, k);
    if (!amp1 || amp1 < 1e-12 || ampN === null) return base;
    return base * (ampN / amp1);
  }
  function geoMean(arr, i0, i1) { var sIn = 0, c = 0;
    for (var i = i0; i <= i1; i++) { var v = arr[i]; if (v < 1e-14) v = 1e-14; sIn += Math.log(v); c++; }
    return c ? Math.exp(sIn / c) : 1e-9; }

  // 플롯 바깥(상단 왼쪽 위) 가로 2줄 범례 — 곡선과 겹치지 않음
  function drawLegend(ctx, plotL, W, padR) {
    ctx.textAlign = 'left'; ctx.font = '11px "Segoe UI",sans-serif';
    var x0 = plotL, ya = 13, yb = 30;   // 플롯 위(padT=46) 바깥 영역
    // 1줄: 모드 색
    var mx = x0;
    [[1, 'mode1'], [2, 'mode2'], [3, 'mode3']].forEach(function (it) {
      ctx.strokeStyle = COLORS[it[0]]; ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(mx, ya); ctx.lineTo(mx + 18, ya); ctx.stroke();
      ctx.fillStyle = COLORS[it[0]]; ctx.fillText(it[1], mx + 22, ya + 4);
      mx += 74;
    });
    // 2줄: 실선/점선 + 주석
    var sx = x0;
    ctx.strokeStyle = '#aab2cf'; ctx.lineWidth = 1.8; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(sx, yb); ctx.lineTo(sx + 18, yb); ctx.stroke();
    ctx.fillStyle = '#8892b5'; ctx.fillText('실측(MoM)', sx + 22, yb + 4); sx += 98;
    ctx.strokeStyle = '#aab2cf'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(sx, yb); ctx.lineTo(sx + 18, yb); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#8892b5'; ctx.fillText('이론', sx + 22, yb + 4); sx += 58;
    ctx.fillText('(n≥4 미표시)', sx, yb + 4);
  }
  function drawCollapseWarn(ctx, W, y, padR) {
    ctx.fillStyle = '#f4a261'; ctx.textAlign = 'right'; ctx.font = 'bold 12px "Segoe UI",sans-serif';
    ctx.fillText('⚠ 벽 근사 무너짐 — 모드 분해 신뢰도 낮음', W - (padR || 12) - 4, y + 12);
  }

  global.WG = global.WG || {}; global.WG.drawModeGraph = drawModeGraph;
})(typeof globalThis !== 'undefined' ? globalThis : this);
