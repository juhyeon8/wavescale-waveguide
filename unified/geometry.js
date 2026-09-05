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

    // 도선 벽 이산화 한계 — 무차원량 κ·d 의 상한. 도선 간격 자동 규칙과 κ 가드가 같이 쓴다.
    // 근거(D-DSCAN): κ₃가 2.6배 다른 세 조건 T2·T3·T5를 κ·d 축에 얹으면 오차 곡선이 겹치고,
    //   κ·d = 1.5 에서 셋이 동시에 무너진다 (−6.35 / −4.63 / −3.85%).
    //   그 지점의 d/λ 는 0.214 / 0.214 / 0.066 으로 3배 넘게 다르다 → 축은 d/λ 가 아니라 κ·d 다.
    // 값: κ·d 를 0.55부터 0.05 간격으로 올리며 세 조건의 |오차| 최대를 읽으면
    //   0.55→0.31%, 0.60→0.14%, 0.65→0.39%, 0.70→0.50%, 0.80→0.70%, 0.95→1.14%.
    //   무너짐이 부드러운 문턱이 아니라 진동 포락선이므로 상한에 붙이지 않고 한 칸 안쪽인 0.60을 쓴다.
    //   0.65 대비 비용은 도선 28개(T4·T5 합계 1106→1134), 시간 183→198ms 로 무시할 수준이고,
    //   그 대가로 T4 모드3이 −2.16% → −0.36% 로 들어온다.
    KAPPA_D_MAX: 0.60,

    // 앱(탭 1~4)이 쓰는 κ 창. verify.js는 이 값을 무시하고 A·B·C를 전부 돈다.
    // 단계 6에서 확정되면 이 한 줄만 고친다. (설계 §4)
    // 단계 6b 최종: 'A'. 창 길이가 2.5/κ로 적응해 고-κ(모드 3)에서 바닥에 닿지 않고,
    // 저-κ(차단 무대 경계 κ=0.01)에서도 진폭비 5.21로 여유가 크다 (C는 1.65로 가드에 근접).
    KAPPA_WIN: 'A',

    // 영상법 — Cesàro 총합 기본 채택 (설계 §11-7). 단순 합은 토글로 남긴다.
    CESARO: true,
    N: 160,        // 영상 쌍 개수 기본
    N_MAX: 320,    // 슬라이더 상한

    // 영상법 산란장·전체장을 벽 사이(j∈[jBot,jTop])에서만 계산한다. 기본 켜짐.
    // 밖은 렌더러가 불투명 마스크로 덮으므로(설계 §8-1) 계산해서 곧바로 가리는 낭비다.
    // 벽 바깥 값을 읽는 경로는 없다 — G4 영역·모드 계수·행별 스케일·plateAvg 전부 벽 사이.
    // 끄면 전 영역을 계산한다 (대조용). 범위 밖 배열 원소는 0으로 남는다.
    SCAT_BAND: true,

    // 유효 벽 정합 — a_w = d/2π (δ=0). 기본 켜짐. 끄면 GEO.aw 또는 수동 슬라이더 값을 쓴다.
    // 자동일 때 a_w는 슬라이더 상한(2.0)에 구속되지 않는다 (수동 d=20이면 a_w=3.18).
    AW_AUTO: true,

    // G4 비교 영역 — 고정 상수. κ 창 함수와 코드 경로를 공유하지 않는다.
    // 단계 6a에서 [105.10, 210.0] → [56.0, 106.0] 으로 옮김.
    // 근거: G2-PROFILE 실측상 영상법은 z≈105에서 이미 50%대이고 z≈155부터 음수다.
    //       옛 영역은 영상법이 죽은 구간 전체라, 잰 값(0.487)이 두 방법의 차이가 아니라
    //       영상법 잘림 바닥이었다. 양쪽이 모두 유효한 구간(= 창 C와 같은 영역)으로 맞춘다.
    // 이후 임계값이 이 영역에서 정해지므로, 확정 후에는 다시 움직이지 않는다. (설계 §7-5)
    G4_ZRANGE: [56.0, 106.0]
  };

  return GEO;
});
