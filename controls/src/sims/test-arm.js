/* node sims/test-arm.js : the arm sandbox must show P alone working, and must show where it stops working. */
'use strict';
const assert = require('node:assert');
const GTPL = require('./node-stub.js');
require('./sim-arm.js');
const m = GTPL.math.arm;
const P = m.params;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} +/- ${tol}`);

/* 0. constants the page copy quotes */
assert.strictEqual(P.L, 0.3); assert.strictEqual(P.m, 0.02); assert.strictEqual(P.tauMax, 0.2);
near(m.gravTau * 1e3, 29.43, 0.01, 'gravity torque with the arm horizontal, mN m');
assert.deepStrictEqual([m.defaults.Kp, m.defaults.target, m.defaults.gravity], [1, 60, false]);
assert.deepStrictEqual(m.ranges, { Kp: [0, 10], target: [0, 180] });

/* 1. the controller is Kp times error and nothing else */
{
  const c = m.controller(2, 60, 50);
  near(c.e, 10, 1e-12, 'error'); near(c.u, 0.020, 1e-12, 'torque = 2 mN m/deg * 10 deg');
  assert.strictEqual(m.controller(2, 60, 60).u, 0, 'zero error, zero torque');
  assert.strictEqual(m.controller(10, 180, 0).u, P.tauMax, 'clipped at the motor limit');
}

/* 2. no gravity: P alone settles on the target with no steady-state error, at every gain on the slider */
for (const Kp of [0.2, 0.5, 1, 2, 5, 10]) {
  for (const target of [30, 60, 150]) {
    const r = m.scenario({ Kp, target, tEnd: 25 });
    near(r.angle, target, 0.01, `Kp ${Kp} target ${target} ends on target`);
    near(r.rate, 0, 0.01, `Kp ${Kp} target ${target} at rest`);
    assert.notStrictEqual(r.metrics.settle, null, `Kp ${Kp} target ${target} settles`);
  }
}

/* 3. the gain trades speed for overshoot */
{
  const os = (Kp) => m.overshootPct(m.scenario({ Kp, target: 60, tEnd: 20 }).metrics);
  const settle = (Kp) => m.scenario({ Kp, target: 60, tEnd: 20 }).metrics.settle;
  assert.ok(os(0.2) < 0.5 && os(0.5) < 0.5, 'low gain creeps in without overshoot');
  near(os(1), 6, 1.5, 'default gain overshoots a little');
  assert.ok(os(2) > 15 && os(5) > 30 && os(5) > os(2), 'high gain overshoots more');
  assert.ok(settle(0.2) > 3 * settle(1), 'low gain is slow');
  assert.ok(settle(1) < 2, 'default gain settles in under 2 s');
  assert.ok(m.zeta(0.5) < 1 && m.zeta(0.2) > 1, 'damping ratio crosses 1 between Kp 0.2 and 0.5');
}

/* 4. a bump knocks it off and P brings it back */
for (const Kp of [1, 2, 5]) {
  const r = m.scenario({ Kp, target: 60, tEnd: 12, bumpAt: 6 });
  assert.ok(r.maxDev > 5 && r.maxDev < 20, `Kp ${Kp} bump deflects the arm (${r.maxDev.toFixed(1)} deg)`);
  near(r.angle, 60, 0.01, `Kp ${Kp} recovers from the bump`);
}

/* 5. gravity on: P alone sags until Kp * error equals the gravity torque */
for (const [Kp, target] of [[1, 0], [2, 0], [5, 0], [2, 60]]) {
  const r = m.scenario({ Kp, target, gravity: true, tEnd: 30 });
  const e = target - r.angle;
  near(Kp * e, m.gravTau * 1e3 * Math.cos(r.state.th), 0.01, `Kp ${Kp} target ${target} torque balance`);
  assert.ok(e > P.settleBand, `Kp ${Kp} target ${target} sags out of the band`);
}
near(0 - m.scenario({ Kp: 2, target: 0, gravity: true, tEnd: 30 }).angle, 14.3, 0.1, 'sag quoted on the page, Kp 2 horizontal');
near(0 - m.scenario({ Kp: 10, target: 0, gravity: true, tEnd: 30 }).angle, 2.9, 0.1, 'sag quoted on the page, Kp 10 horizontal');
/* straight up, gravity has no lever arm */
near(m.scenario({ Kp: 2, target: 90, gravity: true, tEnd: 30 }).angle, 90, 0.01, 'no sag pointing straight up');

console.log('test-arm: all assertions passed');
