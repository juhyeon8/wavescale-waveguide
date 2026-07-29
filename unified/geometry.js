(function (global, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else global.GEO = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ===== 좌표 단일 진실원 (v1 §1-2 / §4) =====
  // 다른 파일에서 이 숫자들을 직접 쓰면 안 된다. 반드시 GEO.* 로 참조한다.
  // 내부 단위는 셀(=mm). UI의 cm 변환은 ui.js에서만 한다. (v1 §12-5)

  var GEO = {
    Nx: 520, Ny: 220,
    y0pix: 110,          // 관 중심의 픽셀 y
    xLeft: 110,          // 관 입구(z=0)의 픽셀 x
    L: 300,              // 관 길이(셀)
    xRight: 110,
    z0: 36,              // 소스의 z 좌표(셀, 관 입구 기준)
    aw: 0.8,             // 도선 반지름 기본값(mm=셀)
    Nmax: 420,

    srcPix: function () { return this.xLeft + this.z0; },        // = 146
    srcZ:   function () { return this.z0; },                     // = 36 (관 입구 기준)
    wallTopPix:  function (a) { return this.y0pix + a / 2; },
    wallBotPix:  function (a) { return this.y0pix - a / 2; },
    srcYPix:     function (a, y0OverA) {
      return this.y0pix - a / 2 + y0OverA * a;
    },
    zToPix: function (z) { return this.xLeft + z; },

    // 도선 개수와 마지막 도선 위치 — core.js:buildWires 와 같은 식이어야 한다.
    // nW = round(L/d) + 1 이므로 마지막 도선은 (nW−1)·d 이고 L을 넘을 수 있다.
    nWires:     function (d) { return Math.round(this.L / d) + 1; },
    lastWireZ:  function (d) { return (this.nWires(d) - 1) * d; },
    wallXToPix: function (d) { return this.xLeft + this.lastWireZ(d); },

    // 앱(탭 1~4)이 쓰는 κ 창. verify.js는 이 값을 무시하고 A·B·C를 전부 돈다.
    // 단계 6에서 확정되면 이 한 줄만 고친다. (설계 §4)
    KAPPA_WIN: 'B',

    // G4 비교 영역 — 고정 상수. κ 창 결정(A/B/C)과 무관하며 단계 6에서 바뀌지 않는다.
    // = clamp(z0 + 2/κ₁, 0.2L, 0.5L) ~ 0.7L,  κ₁(a=60, λ=144) = 0.0289431
    // 영역이 움직이면 그 영역에서 정한 G4 임계값이 무효가 된다. (설계 §7-5)
    // κ 창 함수와 코드 경로를 공유하지 않는다.
    G4_ZRANGE: [105.10, 210.0]
  };

  return GEO;
});
