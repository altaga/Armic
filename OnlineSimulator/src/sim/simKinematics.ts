// Visual sim FK/IK — port of armic-webui/arm-simulator.html + armic-firmware/kinematics.cpp
// Link lengths L0–L3 and floor frame match kinematics.h; IK branch pick matches ik_solve().
import { JointsDeg } from './safety';
import { computeTorques } from './torque';

export const L0_MM = 30;
export const L1_MM = 90;
export const L2_MM = 70;
export const L3_MM = 50;
export const FLOOR_OFFSET_MM = 60;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export const SIM_RESTRICTIONS = {
  base: { min: 0, max: 180 },
  shoulder: { min: 0, max: 180 },
  elbow: { min: 90, max: 180 },
  wrist: { min: 0, max: 180 },
} as const;

export function inSimBand(j: keyof typeof SIM_RESTRICTIONS, d: number): boolean {
  const r = SIM_RESTRICTIONS[j];
  return d >= r.min && d <= r.max;
}

export type SimPose = { x: number; y: number; z: number; pitch: number };

export function fkSim(a: Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'>): SimPose {
  const baseRad = (a.base - 90) * DEG;
  const shDir = (a.shoulder - 90) * DEG;
  const elDir = shDir + (a.elbow - 90) * DEG;
  const wrDir = elDir + (a.wrist - 90) * DEG;
  const sh_r = L1_MM * Math.sin(shDir);
  const sh_z = L0_MM + L1_MM * Math.cos(shDir);
  const el_r = sh_r + L2_MM * Math.sin(elDir);
  const el_z = sh_z + L2_MM * Math.cos(elDir);
  const ee_r = el_r + L3_MM * Math.sin(wrDir);
  const ee_z = el_z + L3_MM * Math.cos(wrDir);
  return {
    x: ee_r * Math.cos(baseRad),
    y: -ee_r * Math.sin(baseRad),
    z: ee_z + FLOOR_OFFSET_MM,
    pitch: 90 - wrDir * RAD,
  };
}

export function shoulderForXyZero(elbow: number, wrist: number): number {
  const alpha = (elbow - 90) * DEG;
  const gamma = (wrist - 90) * DEG;
  const B = L2_MM * Math.sin(alpha) + L3_MM * Math.sin(alpha + gamma);
  const A = L1_MM + L2_MM * Math.cos(alpha) + L3_MM * Math.cos(alpha + gamma);
  const shDir0 = Math.atan2(-B, A);
  let best: number | null = null;
  for (let branch = 0; branch < 2; branch++) {
    const shDir = shDir0 + branch * Math.PI;
    let sh = 90 + shDir * RAD;
    while (sh < 0) sh += 360;
    while (sh >= 360) sh -= 360;
    if (sh < 0 || sh > 180) continue;
    const f = fkSim({ base: 90, shoulder: sh, elbow, wrist });
    if (Math.abs(f.x) < 0.5 && Math.abs(f.y) < 0.5) {
      if (best === null || sh < best) best = sh;
    }
  }
  return best ?? 90;
}

export type IkSimFail = 'BASE_SINGULARITY' | 'UNREACHABLE' | 'OUT_OF_RANGE' | 'JOINT_LIMIT';

export type IkSimResult =
  | { status: 'OK'; angles: Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'> }
  | { status: IkSimFail };

export function ikSim(
  x: number,
  y: number,
  z: number,
  pitchDeg = 0,
  payloadKg = 0,
  prefer?: Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'>,
): IkSimResult {
  const r = Math.hypot(x, y);
  if (r < 1e-3) return { status: 'BASE_SINGULARITY' };
  const base_deg = Math.atan2(y, x) * RAD;
  const target_base = 90 - base_deg;
  const pitch = pitchDeg * DEG;
  const z_local = z - FLOOR_OFFSET_MM;
  const rw = r - L3_MM * Math.cos(pitch);
  const zw = (z_local - L0_MM) - L3_MM * Math.sin(pitch);
  const D2 = rw * rw + zw * zw;
  const D = Math.sqrt(D2);
  const reachMax = L1_MM + L2_MM;
  const reachMin = Math.abs(L1_MM - L2_MM);
  if (D > reachMax + 1e-3) return { status: 'UNREACHABLE' };
  if (D < reachMin - 1e-3) return { status: 'OUT_OF_RANGE' };
  const cosE = Math.max(-1, Math.min(1, (D2 - L1_MM * L1_MM - L2_MM * L2_MM) / (2 * L1_MM * L2_MM)));

  function wrap(d: number) {
    while (d < 0) d += 360;
    while (d >= 360) d -= 360;
    return d;
  }

  const tryBranch = (ei: number) => {
    const mathS = Math.atan2(zw, rw) - Math.atan2(L2_MM * Math.sin(ei), L1_MM + L2_MM * Math.cos(ei));
    const mathW = pitch - mathS - ei;
    const sh = wrap(180 - mathS * RAD);
    const el = wrap(90 + Math.abs(ei) * RAD);
    const wr = wrap(90 - mathW * RAD);
    if (!inSimBand('shoulder', sh)) return null;
    if (!inSimBand('elbow', el)) return null;
    if (!inSimBand('wrist', wr)) return null;
    const cand = { base: target_base, shoulder: sh, elbow: el, wrist: wr };
    const f = fkSim(cand);
    if (Math.abs(f.z - z) > 0.5) return null;
    if (Math.abs(Math.hypot(f.x, f.y) - r) > 0.5) return null;
    return cand;
  };

  const candA = tryBranch(+Math.acos(cosE));
  const candB = tryBranch(-Math.acos(cosE));
  let sol: ReturnType<typeof tryBranch> = null;
  if (candA && candB) {
    if (prefer) {
      const dist2 = (c: NonNullable<typeof candA>) =>
        (c.base - prefer.base) ** 2 + (c.shoulder - prefer.shoulder) ** 2
        + (c.elbow - prefer.elbow) ** 2 + (c.wrist - prefer.wrist) ** 2;
      sol = dist2(candA) <= dist2(candB) ? candA : candB;
    } else {
      const tA = computeTorques(candA, payloadKg);
      const tB = computeTorques(candB, payloadKg);
      const maxA = Math.max(tA.strainSh, tA.strainEl, tA.strainWr);
      const maxB = Math.max(tB.strainSh, tB.strainEl, tB.strainWr);
      sol = maxA <= maxB ? candA : candB;
    }
  } else {
    sol = candA || candB;
  }
  if (!sol) return { status: 'JOINT_LIMIT' };
  if (!inSimBand('base', sol.base)) return { status: 'JOINT_LIMIT' };
  return { status: 'OK', angles: sol };
}

export function clampSimJoints(j: JointsDeg): JointsDeg {
  return {
    base: Math.max(0, Math.min(180, j.base)),
    shoulder: Math.max(0, Math.min(180, j.shoulder)),
    elbow: Math.max(90, Math.min(180, j.elbow)),
    wrist: Math.max(0, Math.min(180, j.wrist)),
    gripper: j.gripper,
  };
}
