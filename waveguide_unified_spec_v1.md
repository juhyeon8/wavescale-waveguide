# 도파관 통합 비교 시뮬레이션 — 구현 사양서 v1

> 대상: superpowers (VS Code / Claude Code)
> 작성 원칙: **물리 확정 → 수치 검증 → 렌더링**. 각 단계는 콘솔 PASS 후에만 다음으로 넘어간다.
> 이 문서에 없는 사항은 임의로 결정하지 말고 **질문할 것**.

---

## 0. 한 줄 목적

영상법(image source method)과 도선 관 MoM이 **같은 도파관 물리를 기술한다는 것**을,
(1) 나란히 놓은 장 그림과 (2) Griffiths 이론값 대비 k_z·κ 측정으로 보인다.

---

## 1. 절대 금지 사항

위반 시 즉시 중단하고 보고한다.

### 1-1. 원본 폴더는 읽기 전용

`image-source/`, `line-wire/` 안의 **모든 파일을 수정·삭제하지 않는다.**
수정이 필요해 보이면 고치지 말고 **무엇을 왜 고쳐야 하는지 보고**한다.
통합 페이지는 새 폴더 `unified/`에만 파일을 만든다.

### 1-2. 좌표·상수 중복 정의 금지

Nx, Ny, y0pix, xLeft, L, 소스 위치, 측정 창 경계는 **`geometry.js` 한 곳에만** 둔다.
다른 파일에서 숫자를 직접 쓰면 안 된다. 반드시 `GEO.*`로 참조한다.

> 근거: 좌표가 두 군데 박히면 조용히 어긋난 채 "그럴듯한 그림"이 나온다.
> 이 프로젝트에서 가장 위험한 실패 모드다.

### 1-3. 측정 코드 중복 금지

k_z·κ·모드계수 측정은 **`measure.js` 한 벌**만 존재한다.
두 방법(영상법/도선관)에 **똑같은 함수를 적용**한다.

> 근거: 측정 규칙이 다르면, 두 방법의 측정값 차이가 물리 차이인지
> 측정 코드 차이인지 구분할 수 없다. 그러면 탭 4 전체가 무의미해진다.

### 1-4. 표시 규약 통일

- 감마·색 매핑·진폭 스케일을 패널마다 다르게 두지 않는다.
- 원본의 `render.js`(선형 감마)와 `render-ho.js`(감마 0.4)를 **둘 다 로드하지 않는다.**
  통합 페이지는 자체 렌더러 하나만 쓴다.

### 1-5. 용어 규약 (§9)

**금지어**

| 금지 | 대체 |
|---|---|
| 복사파 | 산란파 |
| evanescent / 증발장 | 감쇠파 |
| z방향 "경로차" | (사용 금지) |
| "상쇄가 차단을 일으킨다" | "진행파 해가 존재하지 않음 → 감쇠·반사" |
| 자기항 | 자체 산란 (self term) |

**인과 방향 고정**

```
경계조건  →  유도 전류 / 산란파  →  장 결과(상쇄·차폐)
```

상쇄·차폐는 언제나 **결과**이지 원인이 아니다.
UI 문구·주석·콘솔 출력 전부에 적용한다.

**추가 규칙**

- 영상원(수학적 구성물)과 도선 전류(실제 전류)를 같은 것처럼 서술하지 않는다.
- "우드 이상" 단독 사용 금지 (이 프로젝트에서는 등장하지 않을 것으로 예상되나 규약은 유지).

---

## 2. 폴더 정리 (작업 0단계)

### 2-1. 이름 변경

공백이 `<script src>` 경로에 `%20`으로 들어가고 git·배포에서 계속 문제가 된다.

```
git mv "image source waveguides" image-source
git mv "line waveguides"         line-wire
```

### 2-2. 최종 구조

```
03-task/
├── image-source/
│   ├── index.html  style.css  README.md
│   ├── hankel.js  images.js  physics.js  field.js     ← 통합에서 사용
│   └── render.js  main.js                              ← 통합에서 미사용
├── line-wire/
│   ├── core.js  hankel.js  field.js                    ← 통합에서 사용
│   └── higher-order/
│       ├── index.html  style.css
│       ├── modes.js                                    ← 통합에서 사용
│       └── graph.js  render-ho.js  script.js           ← 통합에서 미사용
└── unified/                                            ← 신규
    ├── index.html
    ├── style.css
    ├── geometry.js        좌표 단일 진실원
    ├── adapters.js        두 엔진 → 공통 Scene
    ├── measure.js         측정 코드 한 벌
    ├── render-unified.js  렌더러 한 벌
    ├── ui.js              탭·슬라이더·읽기값
    └── verify.js          node 실행 검증 게이트
```

**작업 0 완료 조건**: 기존 두 페이지(`image-source/index.html`,
`line-wire/higher-order/index.html`)가 rename 후에도 브라우저에서 정상 동작할 것.

---

## 3. 네임스페이스 격리

두 엔진 모두 `global.WG`에 붙는다. 그리고 `field.js`가 양쪽에 있으나 API가 다르다
(`addOneSource` vs `addWireSource`). 원본을 고치지 않고 부트스트랩만으로 격리한다.

`unified/index.html`의 script 순서를 **정확히 이대로** 쓴다.

```html
<script>window.WG = {};</script>

<script src="../image-source/hankel.js"></script>
<script src="../image-source/images.js"></script>
<script src="../image-source/physics.js"></script>
<script src="../image-source/field.js"></script>
<script>window.IMG = window.WG; window.WG = {};</script>

<script src="../line-wire/core.js"></script>
<script src="../line-wire/hankel.js"></script>
<script src="../line-wire/field.js"></script>
<script src="../line-wire/higher-order/modes.js"></script>
<script>window.WIRE = window.WG; window.WG = null;</script>

<script src="geometry.js"></script>
<script src="measure.js"></script>
<script src="adapters.js"></script>
<script src="render-unified.js"></script>
<script src="ui.js"></script>
```

- `core.js` → `window.WireWG` (별도 네임스페이스, 그대로 사용)
- `modes.js` → `window.WGM` (별도 네임스페이스, 그대로 사용)
- `WGM.computeScene(core, WG, p)`는 WG를 **인자로** 받으므로
  `WGM.computeScene(WireWG, WIRE, p)`로 호출하면 된다.
- `window.WG = null`은 이후 코드가 실수로 전역 WG를 참조하면 즉시 터지게 하려는 것이다.
  의도된 동작이므로 되살리지 말 것.

**작업 완료 조건**: 콘솔에
`IMG.buildHankelTable`, `IMG.generateImages`, `IMG.computeModeField`,
`WIRE.computeScatteredGrid`, `WireWG.solveMoM`, `WGM.computeScene`
가 모두 function으로 찍힐 것.

---

## 4. `geometry.js` — 좌표 단일 진실원

```js
var GEO = {
  Nx: 520, Ny: 220,
  y0pix: 110,          // 관 중심의 픽셀 y
  xLeft: 110,          // 관 입구(z=0)의 픽셀 x
  L: 300,              // 관 길이(셀)
  xRight: 110,
  z0: 36,              // 소스의 z 좌표(셀, 관 입구 기준)
  aw: 0.8,             // 도선 반지름(mm=셀)
  Nmax: 420,

  srcPix: function () { return this.xLeft + this.z0; },        // = 146
  wallTopPix:  function (a) { return this.y0pix + a / 2; },
  wallBotPix:  function (a) { return this.y0pix - a / 2; },
  srcYPix:     function (a, y0OverA) {
    return this.y0pix - a / 2 + y0OverA * a;
  },
  zToPix: function (z) { return this.xLeft + z; }
};
```

### 4-1. 반드시 지킬 좌표 정합

두 엔진의 좌표계는 이미 거의 일치한다. 어긋나는 곳은 **소스 x 하나뿐**이다.

| 항목 | 영상법 원본 | 도선관 원본 | 통합 |
|---|---|---|---|
| Nx × Ny | 520 × 220 | 110+300+110 × 220 | 동일 |
| 관 중심 | y0 = 110 | y0pix = 110 | 동일 |
| 소스 x | x0Const = **130** | xLeft + z0 = **146** | **146으로 통일** |
| 소스 y | (y0 − a/2) + hRatio·a | y0pix + (y0spec − a/2) | 이미 동일 |

> 소스 y가 이미 같은 이유: 영상법 `hRatio`와 도선관 `y0spec/a`가
> 둘 다 **아래벽 기준 높이 / a** 로 정의된 같은 양이다. 그대로 대응시킨다.

영상법 어댑터는 `x0Const = 130` 대신 `GEO.srcPix()`(=146)를 넘긴다.
이것이 영상법 쪽에 가하는 **유일한 좌표 변경**이다.

### 4-2. `a`의 반올림 함정

`Math.round(y0pix - a/2)`가 두 곳에서 다르게 반올림되면 벽 위치가 1픽셀 어긋난다.
이를 원천 차단하기 위해 **a는 항상 짝수 셀**로만 만든다.

- a 슬라이더: cm 단위, **step 0.2** (= 2셀), 범위 4.8 ~ 16.0 cm → 48 ~ 160 셀
- 어댑터는 반드시 `GEO.wallTopPix(a)` / `GEO.wallBotPix(a)`만 사용한다.

---

## 5. Scene 계약

두 어댑터는 **완전히 같은 모양의 객체**를 반환한다. 이것이 잠기면 나머지는 기계적이다.

```js
{
  method: 'image' | 'wire',

  Nx, Ny, y0pix,        // GEO에서 복사
  a,                    // 셀
  lambda,               // 셀
  k,                    // 2π/lambda
  y0OverA,              // 0.05 ~ 0.95

  inc:  { re, im, Nx, Ny },   // 입사장  — Float32Array
  scat: { re, im, Nx, Ny },   // 산란장
  tot:  { re, im, Nx, Ny },   // 전체장 = inc + scat

  walls: { yTopPix, yBotPix, xFromPix, xToPix },
  //  image: xFromPix = 0,   xToPix = Nx      (무한 평행판)
  //  wire : xFromPix = 110, xToPix = 410     (유한 도선 벽)

  markers: [ { xPix, yPix, kind, weight } ],
  //  kind = 'image-source'  → 영상원. 수학적 구성물.
  //  kind = 'wire'          → 실제 전류가 흐르는 도선. weight = |c_j|
  //  kind = 'source'        → 원본 소스 도선 (양쪽 공통)

  quality: {
    // image: { N: 영상 쌍 개수, plateAvg: 도체판 위 |E| 평균 }
    // wire : { d: 도선 간격, aw, wallT: 누설 |T| }
  }
}
```

### 5-1. `markers.kind`를 반드시 구분해서 그릴 것

- `image-source` → **속 빈 원** (테두리만)
- `wire` → **채운 원**, 반지름이 `weight`에 따라 변함
- `source` → 노란 채운 원

> 근거: 영상원은 경계조건을 만족시키기 위한 수학적 구성물이고,
> 도선 점은 실제로 전류가 흐르는 물체다. 같은 모양으로 그리면
> 이 존재론적 차이가 지워진다. **물리적 정직성 요구사항이며 미적 선택이 아니다.**

---

## 6. `adapters.js`

### 6-1. `imageScene(p)`

```js
// p = { lambda, a, y0OverA, N, modeInfinity }
```

원본 `image-source/main.js`의 `recomputeAll()` 로직을 그대로 옮기되,
**전역 state 대신 인자 p를 쓰고, x0에 `GEO.srcPix()`를 넣는다.**

```
ys      = GEO.srcYPix(p.a, p.y0OverA)
k       = 2π / p.lambda
rMax    = hypot(GEO.Nx + GEO.srcPix(), GEO.Ny + p.N * p.a) + 10
table   = IMG.buildHankelTable(k, rMax)

inc     = IMG.computeField(IMG.makeField(Nx,Ny),
                           [{x: GEO.srcPix(), y: ys, sign: 1}], table)

if (modeInfinity) {
  tot   = IMG.computeModeField(Nx, Ny, GEO.y0pix, p.a, p.lambda, GEO.srcPix(), 41, ys)
  scat  = IMG.subtractComplex(makeField(), tot, inc)
} else {
  scat  = IMG.computeField(makeField(),
            IMG.generateImages('A', p.N, GEO.srcPix(), GEO.y0pix, p.a, ys), table)
  tot   = IMG.addComplex(makeField(), inc, scat)
}
```

`quality.plateAvg`는 원본 `main.js`의 `plateWallAvg()` 로직을 그대로 쓴다
(도체판 두 줄 위에서 |E| 평균, x는 소스 ±10셀).

### 6-2. `wireScene(p)`

```js
// p = { lambda, a, y0OverA, d, aw }
```

`WGM.computeScene(WireWG, WIRE, q)`를 호출한다. q는 다음과 같이 만든다:

```
q = {
  lambda:  p.lambda,
  a:       p.a,
  L:       GEO.L,
  d:       p.d,
  y0spec:  p.y0OverA * p.a,     // 아래벽 기준 셀
  aw:      p.aw,
  xLeft:   GEO.xLeft,
  xRight:  GEO.xRight,
  Ny:      GEO.Ny,
  y0pix:   GEO.y0pix,
  z0:      GEO.z0
}
```

반환된 `s.inc / s.scat / s.tot`을 그대로 쓰고, `s.wiresPixDraw`를
`markers`(kind='wire', weight = hypot(cre[j], cim[j]))로 변환한다.

**성능**: `WGM.computeScene` 안의 `wallTransmittanceT`는 별도 MoM을 한 번 더 푼다.
슬라이더 드래그 중에는 건너뛰고, 드래그가 끝난 뒤(디바운스 확정 시)에만 계산한다.
→ `computeScene`을 그대로 쓰되, 드래그 중에는 `wallT: null`로 두고
읽기값에 `계산 중`으로 표시. **원본 `modes.js`는 고치지 말 것** —
필요하면 `adapters.js`에서 `computeScene`을 감싸거나, 드래그 중에는
`wallTransmittanceT` 없이 동작하는 경량 경로를 `adapters.js` 안에 새로 쓴다.

### 6-3. `d`의 기본값

```
d = WGM.dAuto(lambda, GEO.L, GEO.Nmax)    // = clamp(0.055λ, L/Nmax, 0.1λ)
```

수동 슬라이더도 제공한다 (2 ~ 20 mm, step 1).

---

## 7. `measure.js` — 측정 코드 한 벌

**두 Scene에 똑같이 적용된다.** 방법별 분기를 두지 말 것.

### 7-1. 모드 계수

원본 `render.js:modeCoefficient`와 `modes.js:modeCoefGridN`이 **수식까지 동일**하다.
그대로 옮겨 하나로 만든다.

```js
function jBotTop(a) {
  return { jBot: Math.round(GEO.y0pix - a/2),
           jTop: Math.round(GEO.y0pix + a/2) };
}
// span = jTop - jBot, 가중치 w = sin(nπ(j - jBot)/span), 결과를 span으로 나눔

modeCoefMag(field, a, n)              → Float32Array (길이 Nx), |c_n(픽셀)|
modeCoefComplexAt(field, a, iPix, n)  → [re, im]
```

### 7-2. 이론값 (Griffiths)

```js
kc(n, a)          = n·π/a
theoryKz(n, a, k) = (k > kc) ? sqrt(k² − kc²) : null
theoryKappa(n,a,k)= (k < kc) ? sqrt(kc² − k²) : null
coupling(n, y0OverA) = |sin(n·π·y0OverA)|
```

### 7-3. 측정 창 — 하나의 규칙

```js
// 차단 모드가 하나라도 있으면, 그 감쇠가 죽는 지점부터 시작한다
function windowStart(kappaMinOfCutoffModes) {
  if (kappaMinOfCutoffModes > 0)
    return clamp(GEO.z0 + 2/kappaMinOfCutoffModes, 0.2*GEO.L, 0.5*GEO.L);
  return 0.2 * GEO.L;
}

// κ 전용 창 (모드마다 다름)
function kappaWindow(kappaThy, d) {
  var zStart = clamp(GEO.z0 + 2/kappaThy, 0.2*GEO.L, 0.5*GEO.L);
  var zEnd   = Math.min(0.7*GEO.L, zStart + 2.5/kappaThy);
  return {
    zStart: zStart, zEnd: zEnd,
    valid:      (zEnd - zStart) > 0 && isFinite(kappaThy) && kappaThy > 0,
    resolvable: (1/kappaThy) >= (d || 1)      // 영상법은 d 없음 → d=1(셀)
  };
}

// k_z 전용 창
function kzWindow(kzThy, kappaMin) {
  var zStart = windowStart(kappaMin);
  var zEnd   = 0.7 * GEO.L;
  var lamG   = 2*Math.PI / kzThy;
  return {
    zStart: zStart, zEnd: zEnd,
    valid:      (zEnd - zStart) > 0 && isFinite(kzThy) && kzThy > 0,
    resolvable: lamG <= (zEnd - zStart)       // ★ 신규 조건 (7-5 참조)
  };
}
```

**`GEO.z0 + 2/κ` 규칙의 근거**: 소스가 관 입구가 아니라 관 안(z=36)에 놓여 있다.
소스 근접장이 살아 있는 구간에서 기울기를 재면 계통 오차가 생긴다.
원본 `modes.js:fitWindowZ`가 이미 이 규칙을 쓰고 있으므로 그대로 승계한다.
(원본 `core.js:kappaFitWindow`는 `0.15L` 고정인데, 이는 소스가 관 밖 z=−80에
있던 selfTest 조건에서 검증된 값이라 지금 배치에는 맞지 않는다. **`modes.js` 쪽을 채택.**)

### 7-4. κ 측정

`modes.js:measureKappaN`을 그대로 옮긴다. 다음 가드를 전부 유지할 것:

- `!valid || !resolvable` → null
- 끝 진폭 ≤ 0 → null
- 시작/끝 진폭비 < 1.5 (거의 감쇠 안 함) → null
- 로그 기울기 ≥ 0 (성장·평탄, 비물리) → null

null이면 **"측정 불가"를 그대로 표시**한다. 추정값으로 채우지 말 것.

### 7-5. k_z 측정 — resolvable 조건 신규 추가

`modes.js:measureKzN`의 위상 언랩 + 최소제곱 직선 맞춤을 그대로 쓰되,
**다음 조건을 새로 넣는다.**

```
λ_g = 2π/k_z ≤ (zEnd − zStart)
```

**근거**: 모드 n이 자기 문턱 바로 아래에 있으면 k_z → 0이라 λ_g가 무한히 길어진다.
측정 창 안에 마루가 하나도 안 들어오면 위상 기울기는 의미가 없는데,
가드가 없으면 **그럴듯한 숫자가 그대로 표시된다.**
모드 2·3을 넣으면 문턱이 세 개가 되므로 이 함정을 만날 확률도 세 배가 된다.

원본 두 코드에 이 조건은 없다. **신규 작성 항목이다.**

### 7-6. 리플에 대하여 (해설 — 코드 아님)

전파 영역에서 도선관은 관 끝이 열려 있어 부분 반사가 생기고, |c_n(z)|에
정상파 리플이 나타난다. 영상법(무한 평행판)에는 없다.

**이것은 k_z 측정에 영향을 주지 않는다.** k_z는 진폭이 아니라 **위상 기울기**에서
재는데, 되돌아온 몫이 더하는 위상은 한 주기를 돌면 제자리로 돌아오기 때문이다
(|r|<1이면 원점을 감싸지 않아 arg의 순 증가가 0).
여러 주기에 걸쳐 직선을 맞추면 리플이 저절로 상쇄된다.

→ **포락선·기하평균 같은 별도 장치를 넣지 말 것.** 불필요하다.

---

## 8. `verify.js` — 검증 게이트 (렌더 이전)

`node unified/verify.js`로 실행. **모든 게이트가 PASS여야 렌더 작업으로 넘어간다.**

원본 파일들이 `module.exports`를 지원하므로 node에서 require 가능하다.
`core.js`는 `require.main === module`일 때 selfTest를 돌리므로, require만 하면 조용하다.

### G0 — 좌표 정합

두 Scene의 다음 값이 **정수까지 정확히 일치**해야 한다. 오차 허용 없음.

```
srcPix           (=146)
srcYPix(a, y0OverA)
wallTopPix(a), wallBotPix(a)
Nx, Ny
```

테스트 조건: a ∈ {48, 60, 100, 160}, y0OverA ∈ {0.05, 0.25, 0.5, 1/6, 0.95}

### G1 — 입사장 동일성

두 Scene의 `inc`를 비교한다.

- 비교 영역: 소스 중심에서 **r ≥ 5셀**인 모든 픽셀
  (근접장에서 H₀가 발산하고, 영상법은 룩업 테이블 보간을 쓰므로 제외)
- 지표: 영역 내 max|E_inc|로 정규화한 상대 L2
- **PASS: < 1e-3**

> 이 게이트가 가장 싸고 가장 근본적이다. 두 입사장이 안 맞으면 아래는 전부 무의미하다.
> 영상법의 Hankel 테이블 보간 정확도를 재는 게이트이기도 하다.

### G2 — 차단 κ 정확도

조건: a=60, λ/a=2.4 (λ=144), y0OverA=0.5, N=80, d=dAuto

```
mode 1:  |측정 κ / 이론 κ − 1| ≤ 0.05   (양쪽 방법 모두)
mode 2,3: 측정 불가로 나오는 것이 정상 — FAIL 아님. 판정 결과를 로그로 남길 것.
```

### G3 — 전파 k_z 정확도

조건 (a): a=60, λ/a=1.5 (λ=90), y0OverA=0.5 → mode 1만 전파
조건 (b): a=60, λ/a=0.8 (λ=48), y0OverA=0.25 → mode 1·2 전파
조건 (c): a=60, λ/a=0.55 (λ=33), y0OverA=1/6 → mode 1·2·3 전파

```
각 전파 모드:  |측정 k_z / 이론 k_z − 1| ≤ 0.05   (양쪽 방법 모두)
resolvable=false로 걸러진 모드는 FAIL 아님. 판정 결과를 로그로 남길 것.
```

### G4 — 차단 영역 두 전체장 일치도

조건: G2와 동일.
비교 영역: 벽 사이 (`wallBot < j < wallTop`) **그리고** `windowStart ≤ z ≤ 0.7L`

```
지표: 영역 내 max|E_tot|로 정규화한 상대 L2
판정: 임계값을 지금 정하지 않는다. 실측값을 콘솔에 출력하고 중단할 것.
```

> **중요**: G4의 임계값을 추측해서 코드에 박지 말 것.
> 추측한 임계값은 검증이 아니라 자기충족적 선언이 된다.
> 실측값을 보고하면 사람이 임계값을 확정한다.

### G5 — 이중 수렴 (보고 항목)

G2 조건에서 다음을 스캔하고 표를 출력한다. **PASS/FAIL 판정 없음.**

```
영상법: N ∈ {10, 20, 40, 80}          → plateAvg, κ측정/κ이론
도선관: d ∈ {8, 5, 3, dAuto}          → wallT,    κ측정/κ이론
```

기대: 손잡이를 조일수록 각각 이론값에 가까워진다. 그렇지 않으면 보고할 것.

---

## 9. `render-unified.js`

### 9-1. 색 매핑 — 하나만

```js
function colorForValue(v, scale, gamma) {
  var t = v / scale;
  var sign = t < 0 ? -1 : 1;
  var mag  = Math.min(1, Math.abs(t));
  t = sign * Math.pow(mag, gamma);
  if (t >= 0) { var c = Math.round(255*(1-t)); return {r:255, g:c, b:c}; }
  var d = Math.round(255*(1+t));  return {r:d, g:d, b:255};
}
```

- `gamma` 기본값 **0.4**, 슬라이더로 0.2 ~ 1.0 노출
- 캡션에 `색 = |E|^0.4 (약한 장 강조 표시)` 명기 — 변환을 숨기지 않는다
- 시간 규약: 인스턴스값 = `re·cosφ + im·sinφ` (양쪽 원본과 동일, 바꾸지 말 것)

### 9-2. 진폭 스케일 — 행별 공통

탭 3의 3×2 배치에서 **각 행(입사/산란/전체)마다 스케일 하나**를 쓴다.
그 행 스케일 = **비교 영역 내 좌우 두 장의 최댓값**.

> 근거: 이 화면의 주장은 "왼쪽 열 = 오른쪽 열"이며 전부 행 안에서의 비교다.
> 6패널 공통 스케일을 쓰면, 차단 깊은 곳에서 |E_산란| ≈ |E_입사| ≫ |E_전체| 이므로
> 전체장 행이 백지가 되거나 입사·산란 행이 포화된다.
> 한쪽 방법을 기준으로 삼으면 그쪽이 항상 더 밝아 보인다.

`[6패널 단일 스케일]` 토글도 제공한다 (행 사이 크기 비교용).
각 행 우상단에 그 행의 스케일 수치를 표시한다.

### 9-3. 마스킹

| 영역 | 처리 |
|---|---|
| 영상법 · 벽 바깥 | 마스킹. 캡션: `계산 영역 밖 — 영상 합은 벽 사이에서만 해를 재현합니다` |
| 도선관 · 벽 바깥 | 마스킹. 캡션: `도선 틈으로 새어 나온 실제 장입니다 — 이상적 도체판인 영상법에는 대응물이 없습니다` |
| 도선관 · z<0, z>L | 마스킹. 캡션: `관 밖 — 영상법(무한 평행판)에는 대응하는 영역이 없습니다` |

두 마스크의 캡션이 다른 것이 핵심이다. 영상법 바깥은 **의미 없는 값**이고,
도선관 바깥은 **실재하는 누설**이다. 같은 문구를 쓰면 안 된다.

### 9-4. 눈금자 오버레이 (탭 3 전체장 행)

**전파 영역**: 길이 `λ_g = 2π/k_z(mode 1, 이론)` 인 양끝 눈금자를
관 중앙 높이에 그린다. 좌우 열에 **같은 길이**로.
라벨: `λ_g = ○○ cm (모드 1)`

**차단 영역**: 길이 `1/κ(mode 1, 이론)` 인 눈금자를 `windowStart`에서 시작해 그린다.
라벨: `감쇠길이 1/κ = ○○ cm (모드 1)`

> 목적: 눈으로 본 것(마루 간격 / 감쇠 거리)과 탭 4에서 잰 숫자(k_z, κ)가
> **같은 대상**임을 연결한다.

### 9-5. 캔버스 규격

- 장 패널: 백킹 520×220, CSS로 축소. `image-rendering: pixelated`
- 그래프: `devicePixelRatio` 반영 (원본 `script.js:fitGraph` 방식), `image-rendering: auto`

---

## 10. 화면 사양

### 10-0. 공통 — 컨트롤 3분할

컨트롤 패널을 **시각적으로 분리된 3개 그룹**으로 만든다. 이것은 UI 정리가 아니라
"같은 입력"의 의미를 화면 구조로 말하는 장치다.

```
[물리 입력]  두 방법 공통. 하나의 슬라이더가 양쪽을 동시에 구동한다.
   λ        2.4 ~ 15.0 cm, step 0.1   (= 24 ~ 150 셀)
   a        4.8 ~ 16.0 cm, step 0.2   (= 48 ~ 160 셀, 항상 짝수)
   y₀/a     0.05 ~ 0.95,   step 0.01
   [벽 사이 중앙으로] 버튼
   프리셋 ① 2.4a  ② 1.5a  ③ 0.8a·y₀=a/4  ④ 0.55a·y₀=a/6

[수치 품질]  방법별로 따로. 물리 입력이 아니다.
   영상법: 영상 쌍 개수 N (0~80)  |  [N=∞ 정확 모드합] 토글
   도선관: 도선 간격 d [자동 0.055λ] 체크박스 / 수동 슬라이더 2~20 mm
           도선 반지름 aw 슬라이더 (기본 0.8 mm)

[표시]  물리와 무관.
   감마 0.2~1.0 (기본 0.4)  |  [6패널 단일 스케일] 토글
   속도 / 일시정지
```

**슬라이더 상태는 탭을 넘어 유지된다.** 탭 1에서 λ를 바꾸고 탭 3으로 가면 그대로다.

**λ·a 범위 근거**: 두 원본의 교집합이다.
(영상법 λ 24~250·a 48~160, 도선관 λ 20~150·a 20~160)

**`aw` 노출 근거**: 현재 `script.js:CFG.aw`와 `core.js:selfTest` 두 곳에 0.8이 박혀 있고,
별도 위상자 시뮬은 0.5를 쓴다. 통합 페이지가 이 값을 표면으로 끌어낸다.

### 10-1. 탭 1 — 영상법

세로 3패널: 입사파 / 산란파 / 전체장. 통합 렌더러 사용.
`quality.plateAvg` 표시: `도체판 위 |E| 평균: ○○ (N↑ → 0에 수렴)`

> iframe으로 기존 페이지를 붙이지 말 것. 세 탭의 색·스케일·감마가 달라지면
> 정작 탭 3의 "같다"는 주장이 약해진다. 통합 렌더러를 쓰면
> 탭 1·2는 사실상 "탭 3에서 한 열을 숨긴 것"이라 추가 코드가 거의 없다.

### 10-2. 탭 2 — 도선 관

세로 3패널. 동일 렌더러.
`quality.wallT` 표시: `벽 누설 |T| = ○○ , d/λ = ○○`
`d/λ > 0.1` 또는 `wallT > 0.35`면 경고 배지 `⚠ 벽 근사 무너짐 — 모드 분해 신뢰도 낮음`

### 10-3. 탭 3 — 나란히

```
             영상법 (왼쪽)        도선 관 (오른쪽)
  1행  입사파      [캔버스]            [캔버스]
  2행  산란파      [캔버스]            [캔버스]
  3행  전체장      [캔버스]            [캔버스]      ← 눈금자 오버레이
```

**정량 표시**

- 차단 영역: `관 내부 상대 차이: ○○%` (G4와 같은 지표·같은 영역)
- 전파 영역: 수치 없음. 배지 `내부 양상 비교 · 정량 지표는 탭 4`

**차단/전파 판정은 자동**으로 한다. 고정 λ/a 값을 박지 말 것.

```
차단 무대 조건:  κ(mode 1) · L ≥ 3
```

> 근거: 관 끝에서 진폭이 입구의 5% 이하로 죽어야 끝단 반사가 무시된다.
> a=6cm면 λ/a > 2.04, a=16cm면 λ/a > 2.32 — a에 따라 달라지므로 실시간 계산이 정확하다.
> 차단 시작(λ=2a) 바로 근처는 무대 밖이다.

**하단 고정 캡션 (문구 그대로)**

```
관 내부는 두 방법이 같은 양상을 보입니다. 관의 앞뒤와 도선 벽 바깥이 다른 것은,
영상법이 무한 평행판을 다루고 도선 관은 유한하며 양 끝이 열려 있기 때문입니다.
```

### 10-4. 탭 4 — 물리 지표 비교

**(A) 지표 표** — 모드 1·2·3, 현재 λ·a·y₀ 기준

전파 모드는 k_z, 차단 모드는 κ를 보인다. 한 표 안에 섞어 쓴다.

| 모드 | 결합 | 상태 | Griffiths 이론 | 영상법 | 도선 관 |
|---|---|---|---|---|---|
| 1 | 1.000 | 전파 | k_z = 0.0462 | 0.0464 (100.4%) | 0.0459 (99.4%) |
| 2 | 0.000 | — | — | 여기되지 않음(마디 위치) | 여기되지 않음(마디 위치) |
| 3 | 1.000 | 차단 | κ = 0.1552 | 측정 불가 | 측정 불가 |

- `결합 = |sin(nπ·y₀/a)|`, 0.02 미만이면 `여기되지 않음(마디 위치)`
- 측정 불가 사유를 구분해 표시: `분해능 한계(1/κ < d)` / `수치 바닥` / `창보다 λ_g가 김`
- 오차 5% 초과 시 해당 칸에 경고색

**(B) 분산 곡선**

```
가로축: λ/a  (범위 0.6 ~ 3.0)
세로축: k_c1(=π/a)로 나눈 값. 축 위 = k_z, 축 아래 = κ
```

- **이론 곡선 3개** (모드 1·2·3): 즉시 그림. 공식이므로 계산 비용 없음
  - 문턱: 모드 n은 λ/a = 2/n 에서 축을 가로지름 (2.0 / 1.0 / 0.667)
- **측정점 자동 누적**:
  - λ 슬라이더 이동 후 계산이 확정될 때마다, 측정에 성공한 모드의 점을 찍고 **남긴다**
  - 영상법 = 채운 원, 도선관 = 속 빈 사각형. 같은 λ면 사각형이 원을 감싸도록 겹쳐 그린다
  - `measure`가 null을 반환한 모드는 **점을 찍지 않는다** (측정 불가 구간이 빈칸으로 남는 것이 정직한 표시)
  - 현재 λ의 점은 강조 표시
- **[측정점 지우기] 버튼**
- 누적 점 상한 200개 (초과 시 오래된 것부터 제거)
- 점은 λ·a·y₀ 중 **a나 y₀가 바뀌면 전부 지운다** (곡선 자체가 달라지므로)

**(C) 수렴 스캔 — 접이식, 기본 접힘**

`[실행]` 버튼을 눌러야 계산 시작. G5와 같은 스캔.
가로축 = 수치 품질 손잡이(N 또는 d), 세로축 = 측정/이론 (%).
두 곡선이 100%로 다가가는 것을 보인다.

---

## 11. 작업 순서와 게이트

**각 단계 완료 후 콘솔 출력을 보고하고, 승인 전에는 다음 단계로 넘어가지 않는다.**

| 단계 | 작업 | 완료 조건 |
|---|---|---|
| **0** | 폴더 rename, 기존 두 페이지 동작 확인 | 두 원본 페이지 정상 동작 스크린샷/보고 |
| **1** | `unified/index.html` 부트스트랩, 네임스페이스 격리 | §3의 6개 함수가 콘솔에 function으로 출력 |
| **2** | `geometry.js` + Scene 계약 확정 | — |
| **3** | `adapters.js` 두 함수 구현 | **G0 PASS** |
| **4** | `measure.js` 구현 (k_z resolvable 신규 포함) | — |
| **5** | `verify.js` 작성 및 실행 | **G1·G2·G3 PASS**, **G4 실측값 보고**, G5 표 출력 |
| **6** | ⏸ **여기서 중단하고 승인받는다** | G4 임계값을 사람이 확정 |
| **7** | `render-unified.js` | — |
| **8** | 탭 3 (핵심 화면) | 시각 확인 |
| **9** | 탭 1·2 (탭 3에서 열 하나 숨김) | 시각 확인 |
| **10** | 탭 4 (A)(B) | 시각 확인 |
| **11** | 탭 4 (C) 수렴 스캔 | 시각 확인 |

### 11-1. 성능 처리 (단계 7 이후)

- 슬라이더 입력 디바운스 **250 ms**
- 계산 중 `계산 중…` 오버레이. **이전 프레임을 지우지 말 것** (백지 금지)
- 드래그 중에는 `wallTransmittanceT` 건너뛰기
- 최악 조건(λ=2.4cm) 실측 시간을 보고할 것. **1.5초 초과 시 보고하고 중단** —
  Web Worker 도입 여부는 사람이 결정한다.
  처음부터 Worker를 넣지 말 것. 게이트 디버깅이 훨씬 어려워진다.

> 참고 규모: λ=2.4cm, d=0.055λ → 양 벽 도선 456개.
> MoM O(n³) ≈ 9.5×10⁷ 복소 연산 + 격자 산란장 누적 ≈ 5.2×10⁷.
> λ가 크면(15cm) 도선 76개라 즉시 끝난다 — 슬라이더 왼쪽 끝에서만 무겁다.

---

## 12. 알려진 함정 (미리 읽을 것)

1. **`graph.js`의 역방향 전역 의존**
   원본 `graph.js:theoryHeight`가 `window.__hoState.y0spec`를 전역에서 집어온다.
   통합 페이지는 `graph.js`를 로드하지 않으므로 해당 없으나, 같은 실수를 반복하지 말 것.
   필요한 값은 전부 Scene 객체나 인자로 넘긴다.

2. **`core.js`와 `hankel.js`의 `besselJ0/Y0` 중복**
   다항식 계수까지 문자 그대로 같다. **통합하지 말 것.**
   `core.js`는 `node core.js`로 단독 selfTest를 돌리는 자립 모듈이고,
   `hankel.js`는 부모 폴더 공유 파일이다. 지금의 중복은 모듈 분리의 의도된 대가다.

3. **정수 λ/d 회피**
   Floquet 계열 계산에서 정수 d/λ는 항 누락을 일으킨다.
   이번 시뮬은 Floquet를 쓰지 않으므로 직접 해당하지 않으나,
   프리셋·테스트에서 `|d/λ − 정수| < 0.02`가 되는 조합은 피한다.

4. **짝수 모드 투영 0 확인**
   `y₀/a = 0.5`에서 모드 2의 결합이 정확히 0이 되는지 반드시 확인한다.
   부호·정규화 오류로 0이 아닌 값이 나오는 사례가 있었다.
   G3 조건 (a)에서 mode 2 결합이 `< 1e-6`인지 검사할 것.

5. **`state.a` 단위 혼동**
   원본 두 코드 모두 내부는 셀(=mm), UI는 cm다. 통합에서도 이 규약을 유지하되
   변환은 `ui.js`에서만 한다. 물리 코드에 cm가 들어가면 안 된다.

---

## 13. 참고 — 검증된 사실 (원본 주석에서)

- 도선관 MoM: 차단 κ 이론 대비 99.9~100.4%, 전파 k_z 100.5~100.6%
  (a=60, L=300, d=5, aw=0.8 조건)
- `d=10 → κ 119%` (경고 영역), `d=25 → PEC 근사 붕괴`
- 깊은 차단에서 투과 바닥 ~3–7% (유한 도선 벽 누설, 물리적 실재)
- 영상법 N=80: κ 106%, 창을 바꿔도 ±1.3%p.
  **N=40은 잘림 간섭의 골짜기(κ 76%)라 쓰면 안 된다** — 기본값은 80으로 둘 것.
- 도선관 풀이 시간: 122도선 ≈ 10–100 ms

---

## 14. 질문이 필요한 경우

다음은 임의로 결정하지 말고 반드시 질문한다.

- G4 임계값
- 측정 창 규칙을 §7-3과 다르게 잡아야 할 이유가 발견된 경우
- 원본 파일 수정이 불가피해 보이는 경우
- 실측 성능이 1.5초를 초과하는 경우
- §10의 UI 문구를 바꿔야 할 이유가 있는 경우 (특히 마스크 캡션과 탭 3 하단 캡션)
