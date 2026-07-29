(function (global) {
  'use strict';
  // 루트 ../render.js를 건드리지 않기 위해 필요한 draw 함수만 WG에 로컬 정의.
  // §3-1 감마 0.4(부호 보존) · §3-2 벽 가이드선 · §3-3 '입구 (z=0)'
  function colorForValue(v, scale) {
    var t = v / scale;
    var sign = t < 0 ? -1 : 1;
    var mag = Math.min(1, Math.abs(t));
    t = sign * Math.pow(mag, 0.4);
    if (t >= 0) { var c = Math.round(255 * (1 - t)); return { r: 255, g: c, b: c }; }
    var d = Math.round(255 * (1 + t)); return { r: d, g: d, b: 255 };
  }
  function drawField(ctx, field, scale, phase) {
    var Nx = field.Nx, Ny = field.Ny, re = field.re, im = field.im;
    var img = ctx.createImageData(Nx, Ny), d = img.data, c = Math.cos(phase), s = Math.sin(phase);
    for (var i = 0; i < Nx; i++) for (var j = 0; j < Ny; j++) {
      var idx = i * Ny + j, v = re[idx] * c + im[idx] * s, col = colorForValue(v, scale);
      var p = ((Ny - 1 - j) * Nx + i) * 4;
      d[p] = col.r; d[p + 1] = col.g; d[p + 2] = col.b; d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  function drawWireDots(ctx, wiresPix, cre, cim, phase, scale, Ny) {
    var c = Math.cos(phase), s = Math.sin(phase);
    for (var j = 0; j < wiresPix.length; j++) {
      var v = cre[j] * c + cim[j] * s;
      var mag = Math.abs(v) / scale; if (mag > 1) mag = 1;
      var col = colorForValue(v, scale);
      var cx = wiresPix[j].x, cy = Ny - 1 - wiresPix[j].y;
      var rad = 2.2 + 2.3 * mag;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(' + col.r + ',' + col.g + ',' + col.b + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
    }
  }
  function drawPlatesWire(ctx, geom) {
    var Nx = geom.Nx, Ny = geom.Ny, y0 = geom.y0, a = geom.a, xLeft = geom.xLeft, L = geom.L;
    var yTop = Ny - 1 - (y0 + a / 2), yBot = Ny - 1 - (y0 - a / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(xLeft, yTop, L, yBot - yTop);           // 도파관 내부 밴드(벽 사이)
    // §3-2 벽 위치 1px 실선(상·하) — 경계를 또렷하게
    ctx.strokeStyle = 'rgba(154,166,216,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xLeft, yTop + 0.5); ctx.lineTo(xLeft + L, yTop + 0.5);
    ctx.moveTo(xLeft, yBot - 0.5); ctx.lineTo(xLeft + L, yBot - 0.5);
    ctx.stroke();
    // 입구(z=0) 세로 안내선
    ctx.strokeStyle = 'rgba(154,166,216,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xLeft, 0); ctx.lineTo(xLeft, Ny); ctx.stroke();
  }
  function updateOverlays(wraps, geom) {
    var Nx = geom.Nx, Ny = geom.Ny, y0 = geom.y0, a = geom.a, xLeft = geom.xLeft;
    function clear(w) { var e = w.getElementsByClassName('cv-label'); while (e.length) e[0].parentNode.removeChild(e[0]); }
    function mk(w, text, leftPct, topPct, center, color) {
      var s = document.createElement('span'); s.className = 'cv-label' + (center ? ' cv-label-center' : '');
      s.style.left = leftPct.toFixed(2) + '%'; s.style.top = topPct.toFixed(2) + '%'; s.style.color = color; s.textContent = text; w.appendChild(s);
    }
    var yTop = Ny - 1 - (y0 + a / 2), yBot = Ny - 1 - (y0 - a / 2);
    [wraps.inc, wraps.scat, wraps.tot].forEach(function (w) {
      if (!w) return;
      clear(w);
      mk(w, '도선 벽', (xLeft + 4) / Nx * 100, (yTop - 14) / Ny * 100, false, '#9aa6d8');
      mk(w, '도선 벽', (xLeft + 4) / Nx * 100, (yBot + 2) / Ny * 100, false, '#9aa6d8');
      mk(w, '입구 (z=0)', xLeft / Nx * 100, 2, true, '#8a94c0');
    });
  }
  global.WG = global.WG || {};
  global.WG.colorForValue = colorForValue;
  global.WG.drawField = drawField;
  global.WG.drawWireDots = drawWireDots;
  global.WG.drawPlatesWire = drawPlatesWire;
  global.WG.updateOverlays = updateOverlays;
})(typeof globalThis !== 'undefined' ? globalThis : this);
