(function (global) {
  'use strict';
  // 단계 1 완료 조건 (v1 §3): 아래 6개가 모두 function 이어야 한다.
  // 화면에도 찍는다 — 개발자 도구를 열지 않고 더블클릭만으로 확인할 수 있게.

  var CHECKS = [
    ['IMG.buildHankelTable',    function () { return global.IMG    && global.IMG.buildHankelTable; }],
    ['IMG.generateImages',      function () { return global.IMG    && global.IMG.generateImages; }],
    ['IMG.computeModeField',    function () { return global.IMG    && global.IMG.computeModeField; }],
    ['WIRE.computeScatteredGrid', function () { return global.WIRE && global.WIRE.computeScatteredGrid; }],
    ['WireWG.solveMoM',         function () { return global.WireWG && global.WireWG.solveMoM; }],
    ['WGM.computeScene',        function () { return global.WGM    && global.WGM.computeScene; }]
  ];

  var lines = [], allOk = true;
  for (var i = 0; i < CHECKS.length; i++) {
    var name = CHECKS[i][0], v;
    try { v = CHECKS[i][1](); } catch (e) { v = undefined; }
    var t = typeof v;
    var ok = (t === 'function');
    if (!ok) allOk = false;
    lines.push((ok ? '  OK   ' : '  FAIL ') + name + ' : ' + t);
  }

  // 격리가 실제로 먹었는지 — 두 field.js의 서로 다른 API가 각자에게만 있어야 한다
  var iso = [
    ['IMG.addOneSource   (영상법 전용)', typeof (global.IMG && global.IMG.addOneSource) === 'function'],
    ['IMG.addWireSource  (없어야 함)',   typeof (global.IMG && global.IMG.addWireSource) === 'undefined'],
    ['WIRE.addWireSource (도선관 전용)', typeof (global.WIRE && global.WIRE.addWireSource) === 'function'],
    ['WIRE.addOneSource  (없어야 함)',   typeof (global.WIRE && global.WIRE.addOneSource) === 'undefined'],
    ['window.WG === null (의도된 봉인)', global.WG === null]
  ];
  var isoLines = [], isoOk = true;
  for (var j = 0; j < iso.length; j++) {
    if (!iso[j][1]) isoOk = false;
    isoLines.push((iso[j][1] ? '  OK   ' : '  FAIL ') + iso[j][0]);
  }

  // 단계 2~4 산출물이 브라우저에서도 올라왔는지
  var uni = [
    ['GEO.srcPix() = 146',        function () { return global.GEO && global.GEO.srcPix() === 146; }],
    ['GEO.G4_ZRANGE',             function () { return global.GEO && global.GEO.G4_ZRANGE.length === 2; }],
    ['Measure.measureKappa',      function () { return typeof (global.Measure && global.Measure.measureKappa) === 'function'; }],
    ['Measure.KAPPA_WINDOWS A·B·C', function () { return global.Measure && global.Measure.WINDOW_IDS.join('') === 'ABC'; }],
    ['Adapters.imageScene',       function () { return typeof (global.Adapters && global.Adapters.imageScene) === 'function'; }],
    ['Adapters.wireScene',        function () { return typeof (global.Adapters && global.Adapters.wireScene) === 'function'; }]
  ];
  var uniLines = [], uniOk = true;
  for (var u = 0; u < uni.length; u++) {
    var r; try { r = !!uni[u][1](); } catch (e) { r = false; }
    if (!r) uniOk = false;
    uniLines.push((r ? '  OK   ' : '  FAIL ') + uni[u][0]);
  }

  var out =
    '[단계 1] v1 §3 — 6개 함수\n' + lines.join('\n') +
    '\n\n[단계 1] 네임스페이스 격리\n' + isoLines.join('\n') +
    '\n\n[단계 2~4] unified 모듈\n' + uniLines.join('\n') +
    '\n\n' + (allOk && isoOk && uniOk ? '전체 PASS — 부트스트랩 정상' : 'FAIL 있음 — 스크립트 순서 확인 필요');
  allOk = allOk && uniOk;

  if (typeof console !== 'undefined' && console.log) console.log(out);
  var el = global.document && global.document.getElementById('bootlog');
  if (el) {
    el.textContent = out;
    el.className = (allOk && isoOk) ? 'pass' : 'fail';
  }
  global.__bootOK = allOk && isoOk;
})(typeof globalThis !== 'undefined' ? globalThis : this);
