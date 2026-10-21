// being/physics.mjs - embodied viscoelastic and fluid-slosh proprioception. Pure module (no DOM).
//
// The body is not a weightless camera target: it has mass, a viscoelastic membrane, and an inner fluid core that
// sloshes when the window is dragged, when the pointer whips past it, or when sub-bass and drum hits strike it.
// Its mechanical strain and vestibular jolt feed back into the mind (proprioception), closing the embodied loop.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);
const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

export function createPhysics({ kBody = 28, cBody = 5.2, kSlosh = 16, cSlosh = 2.8, dragSpin = 1.8 } = {}) {
  // 3D center-of-mass displacement and velocity
  const pos = new Float64Array(3), vel = new Float64Array(3);
  // 3D internal fluid dipole (nucleus/cytoplasm slosh relative to the membrane)
  const slosh = new Float64Array(3), sVel = new Float64Array(3);
  // 3D angular velocity impulse from cursor/window whip
  const omega = new Float64Array(3);
  // 5 Rayleigh-Lamb l=2 quadrupole capillary-gravity surface modes (m = -2..+2: xy, yz, 2z^2-x^2-y^2, xz, x^2-y^2)
  const modes = new Float64Array(5), modeVel = new Float64Array(5);
  const kMode = [34, 38, 42, 36, 40], cMode = [3.6, 3.8, 3.2, 3.7, 3.5];
  let strain = 0, jolt = 0, squash = 0, prevSpeed = 0;

  /**
   * Advance the viscoelastic body, internal slosh, and l=2 capillary surface modes by dt seconds.
   * Accepts both { ax, ay, az, wx, wy, wz } and { fx, fy, fz, tx, ty, tz } drive conventions.
   */
  function step(dt, drive = {}) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    if (dt <= 0) return state;
    const rawAx = drive.ax !== undefined ? fin(drive.ax) : fin(drive.fx);
    const rawAy = drive.ay !== undefined ? fin(drive.ay) : fin(drive.fy);
    const rawAz = drive.az !== undefined ? fin(drive.az) : fin(drive.fz);
    const rawWx = drive.wx !== undefined ? fin(drive.wx) : fin(drive.tx);
    const rawWy = drive.wy !== undefined ? fin(drive.wy) : fin(drive.ty);
    const rawWz = drive.wz !== undefined ? fin(drive.wz) : fin(drive.tz);
    const sub = clamp01(fin(drive.sub) * 6);
    const hit = clamp01(fin(drive.hit) * 0.5);
    const groove = clamp01(fin(drive.groove));
    const arousal = clamp01(fin(drive.arousal));
    const ph = fin(drive.pulsePhase) * Math.PI * 2;

    // External inertial acceleration (from window drag, pointer whip, or acoustic pressure along z/y)
    const extX = clamp(rawAx, -12, 12) + 0.35 * groove * Math.sin(ph);
    const extY = clamp(rawAy, -12, 12) + 0.25 * groove * Math.cos(ph * 2) - 1.8 * hit;
    const extZ = clamp(rawAz, -12, 12) + 3.2 * sub + 2.4 * hit;
    const ext = [extX, extY, extZ];

    // Quadrupole forcing from quadratic stress tensor of internal slosh, spin, and acoustic pressure
    const mDrive0 = 1.4 * slosh[0] * slosh[1] + 0.45 * omega[2] + 0.35 * groove * Math.sin(ph);
    const mDrive1 = 1.4 * slosh[1] * slosh[2] + 0.45 * omega[0] + 0.3 * (sub - hit);
    const mDrive2 = 1.1 * (2 * slosh[2] * slosh[2] - slosh[0] * slosh[0] - slosh[1] * slosh[1]) + 1.8 * hit - 1.4 * sub + 0.4 * groove * Math.cos(ph);
    const mDrive3 = 1.4 * slosh[0] * slosh[2] + 0.45 * omega[1];
    const mDrive4 = 1.1 * (slosh[0] * slosh[0] - slosh[1] * slosh[1]) + 0.35 * (arousal + groove) * Math.sin(ph * 0.5);
    const mExt = [mDrive0, mDrive1, mDrive2, mDrive3, mDrive4];

    // Sub-step at <= 4 ms for unconditional symplectic Euler stability
    const nSub = Math.max(1, Math.ceil(dt / 0.004)), h = dt / nSub;
    for (let s = 0; s < nSub; s++) {
      for (let i = 0; i < 3; i++) {
        const aBody = ext[i] - kBody * pos[i] - cBody * vel[i];
        vel[i] += h * aBody;
        pos[i] = clamp(pos[i] + h * vel[i], -1.5, 1.5);
        // Internal fluid sloshes against the membrane's acceleration
        const aSlosh = -0.85 * aBody - kSlosh * slosh[i] - cSlosh * sVel[i];
        sVel[i] += h * aSlosh;
        slosh[i] = clamp(slosh[i] + h * sVel[i], -1.5, 1.5);
      }
      // Coupled Rayleigh-Lamb l=2 surface modes with weakly nonlinear cubic restoring force
      for (let m = 0; m < 5; m++) {
        const q = modes[m];
        const aMode = mExt[m] * 12 - kMode[m] * q * (1 + 0.35 * q * q) - cMode[m] * modeVel[m];
        modeVel[m] += h * aMode;
        modes[m] = clamp(q + h * modeVel[m], -1.2, 1.2);
      }
    }

    // Angular momentum impulse from cursor/drag torque, decaying by viscous drag
    const decay = Math.exp(-dt * dragSpin);
    omega[0] = clamp(omega[0] * decay + dt * clamp(rawWx, -8, 8), -4, 4);
    omega[1] = clamp(omega[1] * decay + dt * clamp(rawWy, -8, 8), -4, 4);
    omega[2] = clamp(omega[2] * decay + dt * clamp(rawWz, -8, 8), -4, 4);

    for (let i = 0; i < 3; i++) {
      if (!Number.isFinite(pos[i]) || !Number.isFinite(vel[i])) { pos[i] = 0; vel[i] = 0; }
      if (!Number.isFinite(slosh[i]) || !Number.isFinite(sVel[i])) { slosh[i] = 0; sVel[i] = 0; }
      if (!Number.isFinite(omega[i])) omega[i] = 0;
    }
    for (let m = 0; m < 5; m++) {
      if (!Number.isFinite(modes[m]) || !Number.isFinite(modeVel[m])) { modes[m] = 0; modeVel[m] = 0; }
    }

    const disp = Math.hypot(pos[0], pos[1], pos[2]);
    const sloshMag = Math.hypot(slosh[0], slosh[1], slosh[2]);
    const speed = Math.hypot(vel[0], vel[1], vel[2]);
    const rawJolt = Math.max(0, (speed - prevSpeed) / Math.max(dt, 0.004)) * 0.08 + 0.35 * Math.hypot(rawAx, rawAy, rawAz) * 0.12;
    prevSpeed = speed;

    // Volume-preserving Poisson squash-and-stretch from axisymmetric l=2,m=0 mode and vertical velocity
    squash = clamp(0.65 * modes[2] - 0.25 * vel[1] + 0.2 * slosh[2], -0.45, 0.45);
    strain = clamp01(0.75 * disp + 0.65 * sloshMag + 0.15 * Math.hypot(omega[0], omega[1], omega[2]));
    jolt = clamp01(Math.max(jolt * Math.exp(-dt / 0.12), rawJolt));
    return state;
  }

  /** Apply an instantaneous impulse (e.g. a window flick, poke, or bass drop) */
  function impulse(ix = 0, iy = 0, iz = 0, wx = 0, wy = 0, wz = 0) {
    vel[0] = clamp(vel[0] + fin(ix), -8, 8);
    vel[1] = clamp(vel[1] + fin(iy), -8, 8);
    vel[2] = clamp(vel[2] + fin(iz), -8, 8);
    sVel[0] = clamp(sVel[0] - 0.7 * fin(ix), -8, 8);
    sVel[1] = clamp(sVel[1] - 0.7 * fin(iy), -8, 8);
    sVel[2] = clamp(sVel[2] - 0.7 * fin(iz), -8, 8);
    omega[0] = clamp(omega[0] + fin(wx), -4, 4);
    omega[1] = clamp(omega[1] + fin(wy), -4, 4);
    omega[2] = clamp(omega[2] + fin(wz), -4, 4);
    modeVel[2] = clamp(modeVel[2] + 1.2 * fin(iz) - 0.9 * fin(iy), -8, 8);
    modeVel[4] = clamp(modeVel[4] + 0.8 * (fin(ix) - fin(iy)), -8, 8);
    jolt = clamp01(jolt + 0.35 * Math.hypot(fin(ix), fin(iy), fin(iz)));
  }

  const state = {
    step,
    impulse,
    pos,
    vel,
    slosh,
    sVel,
    omega,
    modes,
    modeVel,
    get strain() { return strain; },
    get jolt() { return jolt; },
    get squash() { return squash; },
    get sloshAmp() { return Math.hypot(slosh[0], slosh[1], slosh[2]); },
  };
  return state;
}
