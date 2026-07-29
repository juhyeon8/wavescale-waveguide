(function (global) {
  'use strict';

  // ySrc: 소스의 y좌표 (생략 시 y0 = 벽 사이 중앙)
  // 소스 높이 h = ySrc − yBot 를 두 벽에서 번갈아 반사시킨 무한 영상열.
  // r번 반사한 영상의 부호는 (−1)^r (도체판, Dirichlet).
  // 사슬 A = 아래벽부터 반사 시작, 사슬 B = 위벽부터 반사 시작 → r마다 2개씩.
  // h=a/2면 A·B가 합쳐져 기존 배열(y0±r·a, 부호 (−1)^r)로 그대로 환원된다.
  function generateImages(geometry, N, x0, y0, a, ySrc) {
    var yBot = y0 - a / 2;
    var ys = (ySrc === undefined) ? y0 : ySrc;
    var h = ys - yBot;
    var imgs = [];
    for (var r = 1; r <= N; r++) {
      var sign = (r % 2 === 0) ? 1 : -1;       // (−1)^r
      var yA, yB;
      if (r % 2 === 1) {
        var p = (r - 1) / 2;
        yA = yBot - 2 * p * a - h;             // 아래벽 시작, 홀수번째
        yB = yBot + (r + 1) * a - h;           // 위벽 시작, 홀수번째
      } else {
        yA = yBot + r * a + h;                 // 아래벽 시작, 짝수번째
        yB = yBot - r * a + h;                 // 위벽 시작, 짝수번째
      }
      imgs.push({ x: x0, y: yA, sign: sign });
      imgs.push({ x: x0, y: yB, sign: sign });
    }
    if (geometry === 'B') {
      // 끝벽(x=0) 미러: 원본 + 세로영상 전부를 x=−x0 로 반사, 부호 반전
      var mirrored = [{ x: -x0, y: ys, sign: -1 }];   // 원본의 미러
      for (var i = 0; i < imgs.length; i++) {
        mirrored.push({ x: -x0, y: imgs[i].y, sign: -imgs[i].sign });
      }
      imgs = imgs.concat(mirrored);
    }
    return imgs;
  }

  var API = { generateImages: generateImages };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { global.WG = global.WG || {}; Object.assign(global.WG, API); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
