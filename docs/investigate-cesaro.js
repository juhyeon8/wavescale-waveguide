'use strict';
// 조사 (가) N 상향  /  (나) Cesàro 평균 — 영상법 잘림 바닥
var U = 'C:/dev/03-task(waveguide unified)/unified/';
var GEO = require(U + 'geometry.js');
var M   = require(U + 'measure.js');
var AD  = require(U + 'adapters.js');

var a = 60, lambda = 144, y0 = 0.5;
var k = 2 * Math.PI / lambda, kap = M.theoryKappa(1, a, k);
function pad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

// 프로파일이 음수로 꺾이는 z (모드 1)
function flipZ(sc) {
  var p = M.localKappaProfile(sc.tot, a, 1, kap);
  for (var i = 0; i < p.rows.length; i++)
    if (p.rows[i].ratio !== null && p.rows[i].ratio < 0) return p.rows[i].zCenter;
  return null;
}
function kC(sc) {
  var r = M.measureKappa(sc.tot, a, 1, 'C', 1, kap);
  return r.value === null ? r.reason : (r.value / kap * 100).toFixed(1) + '%';
}
function kC3(sc) {
  var k3 = M.theoryKappa(3, a, k);
  var r = M.measureKappa(sc.tot, a, 3, 'C', 1, k3);
  return r.value === null ? r.reason : (r.value / k3 * 100).toFixed(1) + '%';
}

console.log('조사 (가)(나)   a=' + a + ', λ=' + lambda + ', y₀/a=' + y0 + ',  이론 κ₁=' + kap.toFixed(7));
console.log('창 C = [56.0, 106.0]\n');
console.log('  방식        N     plateAvg    κ₁(창C)   κ₃(창C)   프로파일 음수 전환 z   소요');
console.log('  ' + '-'.repeat(78));

[[false, 80], [false, 160], [false, 320], [true, 80], [true, 160], [true, 320]].forEach(function (cn) {
  var ces = cn[0], N = cn[1], t = Date.now();
  var sc = AD.imageScene({ lambda: lambda, a: a, y0OverA: y0, N: N, cesaro: ces });
  var fz = flipZ(sc), ms = Date.now() - t;
  console.log('  ' + (ces ? 'Cesàro  ' : '단순 합 ') + pad(N, 5) + '   ' +
    pad(sc.quality.plateAvg.toFixed(6), 9) + '  ' + pad(kC(sc), 9) + ' ' + pad(kC3(sc), 22) + '  ' +
    pad(fz === null ? '없음 (전 구간 양수)' : fz.toFixed(1), 20) + '   ' + pad(ms + 'ms', 7));
});

// 프로파일 상세 비교 (모드 1)
console.log('\n  [프로파일 모드 1]  z중심별 국소 κ/이론');
var cases = [['단순 N=80', { N: 80 }], ['단순 N=320', { N: 320 }],
             ['Cesàro N=80', { N: 80, cesaro: true }], ['Cesàro N=320', { N: 320, cesaro: true }],
             ['모드합(정확해)', { modeInfinity: true }]];
var profs = cases.map(function (c) {
  var sc = AD.imageScene(Object.assign({ lambda: lambda, a: a, y0OverA: y0 }, c[1]));
  return M.localKappaProfile(sc.tot, a, 1, kap);
});
console.log('    z중심  ' + cases.map(function (c) { return pad(c[0], 15); }).join(''));
profs[0].rows.forEach(function (row, i) {
  console.log('    ' + pad(row.zCenter.toFixed(1), 6) + '  ' + profs.map(function (p) {
    var r = p.rows[i].ratio;
    return pad(r === null ? '—' : (r * 100).toFixed(1) + '%', 15);
  }).join('') + (row.crossesSource ? '   ← 소스 가로지름' : ''));
});
