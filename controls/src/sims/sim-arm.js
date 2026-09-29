/* GTPL controls guide: P-only sandbox on a small geared arm.
   Pure math lives on GTPL.math.arm (testable in node); all DOM/canvas work is inside mount. */
(function () {
  'use strict';
  const G = window.GTPL;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  /* ------------------------------------------------------------------ */
  /* pure math                                                           */
  /* ------------------------------------------------------------------ */
  const params = {
    L: 0.3,            // m, arm length
    m: 0.02,           // kg, arm mass, centred at L/2
    J: 0.004,          // kg m^2, arm plus motor rotor seen through the gearbox
    b: 0.02,           // N m s/rad, gearbox friction
    g: 9.81,           // m/s^2
    tauMax: 0.2,       // N m, motor torque limit
    dt: 1 / 240,       // s
    bumpTau: -0.04,    // N m, a shove on the arm
    bumpT: 0.2,        // s
    settleBand: 2,     // deg
    settleHold: 1.0,   // s
    chartWindow: 8,    // s
  };
  const gravTau = params.m * params.g * params.L / 2;   // 0.0294 N m with the arm horizontal
  const defaults = { Kp: 1, target: 60, gravity: false };
  const ranges = { Kp: [0, 10], target: [0, 180] };      // Kp in mN m per degree, target in degrees

  /* Kp in mN m/deg -> N m/rad */
  function kpSI(Kp) { return Kp * 1e-3 * R2D; }

  function makeState(deg) { return { th: (deg || 0) * D2R, w: 0, t: 0 }; }

  /* J th'' = tau - b th' - (gravity) m g L/2 cos th + dist; angle from horizontal, semi-implicit Euler */
  function stepModel(s, tau, dt, gravity, dist, p) {
    p = p || params;
    const tq = G.clamp(tau, -p.tauMax, p.tauMax);
    const a = (tq - p.b * s.w - (gravity ? p.m * p.g * p.L / 2 * Math.cos(s.th) : 0) + (dist || 0)) / p.J;
    s.w += a * dt;
    s.th += s.w * dt;
    s.t += dt;
    return s;
  }

  /* the whole controller: torque = Kp * error */
  function controller(Kp, targetDeg, angleDeg, p) {
    p = p || params;
    const e = targetDeg - angleDeg;
    const uRaw = Kp * e * 1e-3;
    const u = G.clamp(uRaw, -p.tauMax, p.tauMax);
    return { u, uRaw, e, sat: uRaw > p.tauMax ? 1 : uRaw < -p.tauMax ? -1 : 0 };
  }

  /* damping ratio of the closed loop without gravity; above 1 creeps in, below 1 overshoots */
  function zeta(Kp, p) { p = p || params; return Kp <= 0 ? Infinity : p.b / (2 * Math.sqrt(kpSI(Kp) * p.J)); }

  function makeMetrics() { return { tChange: 0, step: 0, peak: 0, inBandSince: null, settle: null }; }
  function metricsMark(m, t, angle, target, isStep) {
    m.tChange = t; m.step = isStep ? target - angle : 0; m.peak = 0; m.inBandSince = null; m.settle = null;
  }
  function metricsStep(m, t, angle, target, p) {
    p = p || params;
    if (m.step !== 0) {
      const beyond = m.step > 0 ? angle - target : target - angle;
      if (beyond > m.peak) m.peak = beyond;
    }
    if (Math.abs(target - angle) <= p.settleBand) {
      if (m.inBandSince === null) m.inBandSince = t;
      if (m.settle === null && t - m.inBandSince >= p.settleHold) m.settle = m.inBandSince - m.tChange;
    } else if (m.settle === null) m.inBandSince = null;
  }
  function overshootPct(m) { return m.step === 0 ? NaN : 100 * m.peak / Math.abs(m.step); }

  /* Offline scenario runner for tests. o: {Kp, target, start, gravity, tEnd, bumpAt} */
  function scenario(o) {
    const p = params, dt = p.dt;
    const s = makeState(o.start || 0);
    const met = makeMetrics();
    const target = o.target === undefined ? defaults.target : o.target;
    metricsMark(met, 0, s.th * R2D, target, true);
    const n = Math.round((o.tEnd || 10) / dt);
    let out = null, satCount = 0, maxDev = 0;
    for (let i = 0; i <= n; i++) {
      out = controller(o.Kp, target, s.th * R2D, p);
      if (out.sat) satCount++;
      const bumping = o.bumpAt !== undefined && s.t >= o.bumpAt && s.t < o.bumpAt + p.bumpT;
      stepModel(s, out.u, dt, !!o.gravity, bumping ? p.bumpTau : 0, p);
      metricsStep(met, s.t, s.th * R2D, target, p);
      if (o.bumpAt !== undefined && s.t >= o.bumpAt) maxDev = Math.max(maxDev, Math.abs(target - s.th * R2D));
    }
    return { state: s, angle: s.th * R2D, rate: s.w * R2D, metrics: met, last: out, satFrac: satCount / (n + 1), maxDev };
  }

  const math = { params, gravTau, defaults, ranges, kpSI, makeState, stepModel, controller, zeta,
    makeMetrics, metricsMark, metricsStep, overshootPct, scenario };
  G.math = G.math || {};
  G.math.arm = math;

  /* ------------------------------------------------------------------ */
  /* mount                                                               */
  /* ------------------------------------------------------------------ */
  G.sims.arm = function mount(root) {
    const el = G.el;
    const ui = G.scaffold(root);
    /* two stages side by side (stack under 560px): arm | charts */
    ui.stage.className = 'stage-row';
    const stageL = el('div', { class: 'stage' });
    const stageR = el('div', { class: 'stage' });
    ui.stage.append(stageL, stageR);
    const cvL = G.canvas(stageL, { aspect: 1.15, minHeight: 280, maxHeight: 420 });
    const cvR = G.canvas(stageR, { aspect: 1.15, minHeight: 280, maxHeight: 420 });
    root.appendChild(G.hidden('Stage shows an arm on a motor, a dashed line at the target angle, a shaded wedge for the error between them and an arrow for the motor torque, and two charts: angle against target and torque against the motor limits.'));

    /* ---- state ---- */
    let Kp = defaults.Kp, target = defaults.target, gravity = defaults.gravity;
    let s = makeState(0), met = makeMetrics();
    let bumpLeft = 0, pushCount = 0;
    let out = controller(Kp, target, 0);
    const geo = { px: 0, py: 0, len: 1 };

    /* ---- charts ---- */
    const chAng = new G.StripChart({ duration: params.chartWindow, autoscale: true, padding: 0.12, minSpan: 30, yLabel: 'angle (deg)', xLabel: 't (s)',
      series: [{ key: 'ref', color: '--sig-ref', dash: [6, 5], label: 'target', endDot: false }, { key: 'a', color: '--sig-act', label: 'angle' }] });
    const chTau = new G.StripChart({ duration: params.chartWindow, ymin: -280, ymax: 280, yLabel: 'torque', xLabel: 't (s)',
      series: [{ key: 'u', color: '--sig-p', label: 'Kp × error (mN·m)' }],
      thresholds: [{ y: params.tauMax * 1e3, color: '--bad', label: 'motor limit' }, { y: -params.tauMax * 1e3, color: '--bad' }] });

    /* ---- HUD ---- */
    const roAng = G.readout({ label: 'Angle', unit: 'deg', digits: 1 });
    const roErr = G.readout({ label: 'Error', unit: 'deg', digits: 1 });
    const roTau = G.readout({ label: 'Torque', unit: 'mN·m', digits: 0 });
    const roOs = G.readout({ label: 'Overshoot', unit: '%', digits: 0 });
    const roSet = G.readout({ label: 'Settle time', unit: 's', digits: 1 });
    ui.hud.append(roAng.root, roErr.root, roTau.root, roOs.root, roSet.root);

    /* ---- controls ---- */
    function mark(isStep) { metricsMark(met, s.t, s.th * R2D, target, isStep); }
    const sKp = G.slider({ label: 'Kp', unit: 'mN·m/deg', min: ranges.Kp[0], max: ranges.Kp[1], step: 0.1, value: Kp, digits: 1, onInput: v => { Kp = v; } });
    const sTarget = G.slider({ label: 'Target', unit: 'deg', min: ranges.target[0], max: ranges.target[1], step: 5, value: target, digits: 0,
      onInput: v => { if (v === target) return; target = v; mark(true); } });
    const tGrav = G.toggle({ label: 'Gravity (arm lifts its own weight)', value: gravity, onChange: v => { gravity = v; mark(false); } });
    const bBump = G.button({ label: 'Bump', kind: 'primary', onClick: bump });
    const bReset = G.button({ label: 'Reset', onClick: reset });
    const bPlay = G.button({ label: 'Pause', kind: 'ghost', onClick: () => loop.toggle() });
    ui.controls.append(
      G.group('Gain', [sKp.root]),
      G.group('Target', [sTarget.root]),
      G.group('Options', [tGrav.root]),
      el('div', { class: 'btn-row' }, [bBump.root, bReset.root, bPlay.root]),
    );
    ui.foot.append(
      el('p', { class: 'caption', text: 'Toy arm: 30 cm, 20 g, on a geared motor limited to 200 mN·m. Click the stage to move the target.' }),
    );

    function bump() { bumpLeft = params.bumpT; mark(false); }
    /* restart the run from 0 degrees, keep the current settings */
    function restart() {
      s = makeState(0); met = makeMetrics();
      bumpLeft = 0; pushCount = 0;
      out = controller(Kp, target, 0);
      mark(true);
      chAng.clear(); chTau.clear();
    }
    /* restore every default, then restart */
    function reset() {
      Kp = defaults.Kp; target = defaults.target; gravity = defaults.gravity;
      sKp.set(Kp, true); sTarget.set(target, true); tGrav.set(gravity, true);
      restart();
    }

    /* click or tap the stage to point the target there */
    cvL.canvas.style.cursor = 'crosshair';
    cvL.canvas.addEventListener('pointerdown', (ev) => {
      const r = cvL.canvas.getBoundingClientRect();
      const dx = ev.clientX - r.left - geo.px, dy = geo.py - (ev.clientY - r.top);
      if (dx * dx + dy * dy < 100) return;
      let a = Math.atan2(dy, dx) * R2D;
      if (a < -90) a += 360;
      sTarget.set(G.clamp(Math.round(a / 5) * 5, ranges.target[0], ranges.target[1]));
    });

    /* ---- physics step ---- */
    function step(dt) {
      out = controller(Kp, target, s.th * R2D, params);
      let dist = 0;
      if (bumpLeft > 0) { dist = params.bumpTau; bumpLeft -= dt; }
      stepModel(s, out.u, dt, gravity, dist, params);
      metricsStep(met, s.t, s.th * R2D, target, params);
      if (!isFinite(s.th) || !isFinite(s.w)) { restart(); return; }
      if ((pushCount++ & 3) === 0) { chAng.push(s.t, { ref: target, a: s.th * R2D }); chTau.push(s.t, { u: out.u * 1e3 }); }
    }

    /* ---- render ---- */
    /* canvas angles run clockwise with y down, ours run counterclockwise from the right */
    function arc(ctx, r, a0, a1) { ctx.arc(geo.px, geo.py, r, -a0, -a1, a1 > a0); }
    function renderLeft() {
      const ctx = cvL.ctx, W = cvL.width, H = cvL.height, g = G.theme.get;
      cvL.clear();
      const len = Math.min(W * 0.34, H * 0.36);
      const px = W * 0.5, py = H * 0.5 + len * 0.35;
      geo.px = px; geo.py = py; geo.len = len;
      const th = s.th, tg = target * D2R;
      const tip = (a, r) => [px + r * Math.cos(a), py - r * Math.sin(a)];
      ctx.save();
      ctx.font = '11px ' + g('--font-mono');
      /* protractor */
      ctx.strokeStyle = g('--line'); ctx.fillStyle = g('--ink-3'); ctx.lineWidth = 1;
      ctx.beginPath(); arc(ctx, len * 1.08, 0, Math.PI); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let d = 0; d <= 180; d += 30) {
        const a = d * D2R, [x0, y0] = tip(a, len * 1.08), [x1, y1] = tip(a, len * 1.13), [xt, yt] = tip(a, len * 1.26);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.fillText(d + '°', xt, yt);
      }
      /* error wedge */
      if (Math.abs(tg - th) > 0.002) {
        ctx.fillStyle = G.theme.alpha('--sig-p', 0.16);
        ctx.beginPath(); ctx.moveTo(px, py); arc(ctx, len * 0.72, th, tg); ctx.closePath(); ctx.fill();
      }
      /* target */
      ctx.strokeStyle = g('--sig-ref'); ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(...tip(tg, len * 1.05)); ctx.stroke();
      ctx.setLineDash([]);
      /* motor housing, arm, payload */
      ctx.fillStyle = g('--bg-3'); ctx.strokeStyle = g('--line-2'); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(px - 22, py - 6, 44, 34); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = g('--ink'); ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(...tip(th, len)); ctx.stroke();
      ctx.fillStyle = g('--sig-act');
      ctx.beginPath(); ctx.arc(...tip(th, len), 8, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = g('--bg'); ctx.strokeStyle = g('--ink'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      /* torque arrow: sweep grows with the torque the motor is making */
      const sweep = G.clamp(out.u / params.tauMax, -1, 1) * 1.6;
      if (Math.abs(sweep) > 0.03) {
        const r = len * 0.3, a1 = th + sweep, dir = Math.sign(sweep);
        ctx.strokeStyle = g('--sig-p'); ctx.fillStyle = g('--sig-p'); ctx.lineWidth = 2.5; ctx.lineCap = 'butt';
        ctx.beginPath(); arc(ctx, r, th, a1); ctx.stroke();
        const [hx, hy] = tip(a1, r);
        /* head points along the tangent, which on screen is (-sin, -cos) for increasing angle */
        const tx = -Math.sin(a1) * dir, ty = -Math.cos(a1) * dir, nx = Math.cos(a1), ny = -Math.sin(a1);
        ctx.beginPath(); ctx.moveTo(hx + tx * 9, hy + ty * 9); ctx.lineTo(hx + nx * 5, hy + ny * 5); ctx.lineTo(hx - nx * 5, hy - ny * 5); ctx.closePath(); ctx.fill();
      }
      /* labels */
      ctx.fillStyle = g('--ink-3'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(gravity ? 'side view, gravity on' : 'top view, no gravity', 8, 8);
      ctx.fillStyle = g('--sig-ref');
      ctx.fillText('target ' + target + '°', 8, 24);
      if (out.sat) { ctx.fillStyle = g('--bad'); ctx.textBaseline = 'bottom'; ctx.fillText('motor at its limit', 8, H - 8); ctx.textBaseline = 'top'; }
      if (bumpLeft > 0) { ctx.fillStyle = g('--sig-fb'); ctx.textAlign = 'center'; ctx.fillText('bump', ...tip(th, len + 22)); }
      ctx.restore();
    }
    function renderRight() {
      const ctx = cvR.ctx, W = cvR.width, H = cvR.height;
      cvR.clear();
      const half = Math.floor(H / 2);
      chAng.draw(ctx, { x: 0, y: 2, w: W - 2, h: half - 4 });
      chTau.draw(ctx, { x: 0, y: half, w: W - 2, h: H - half - 2 });
    }
    function render() {
      renderLeft();
      renderRight();
      const e = target - s.th * R2D;
      roAng.set(s.th * R2D);
      roErr.set(e, Math.abs(e) <= params.settleBand ? 'good' : Math.abs(e) < 10 ? 'warn' : 'bad');
      roTau.set(out.u * 1e3, out.sat ? 'bad' : '');
      const os = overshootPct(met);
      roOs.set(isFinite(os) ? os : '—', os > 20 ? 'bad' : os > 5 ? 'warn' : '');
      roSet.set(met.settle === null ? '—' : met.settle, met.settle === null ? '' : 'good');
    }

    const loop = G.loop({ step, render, dt: params.dt, root, onState: (running, wanted) => { bPlay.setLabel(wanted ? 'Pause' : 'Play'); } });
    bPlay.setLabel(loop.wanted ? 'Pause' : 'Play');
    cvL.onResize(render); cvR.onResize(render);
    render();

    /* page hooks: apply a scenario through the same controls the reader uses, and read live values */
    function apply(sc) {
      sc = sc || {};
      if (sc.Kp !== undefined) sKp.set(sc.Kp);
      if (sc.gravity !== undefined) tGrav.set(!!sc.gravity);
      if (sc.target !== undefined) sTarget.set(sc.target, true), target = sc.target;
      if (sc.restart) restart();
      else if (sc.target !== undefined) mark(true);
      if (sc.bump) bump();
      if (!loop.wanted) loop.start();
      loop.renderOnce();
    }
    function read() {
      return { angle: s.th * R2D, e: target - s.th * R2D, torque: out.u * 1e3, Kp,
        overshootPct: overshootPct(met), settle: met.settle === null ? NaN : met.settle };
    }

    return {
      reset,
      loop,
      apply, read,
      destroy: () => { loop.destroy(); cvL.destroy(); cvR.destroy(); root.textContent = ''; },
    };
  };
})();
