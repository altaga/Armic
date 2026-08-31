// Newton-Euler torque + strain — port of armic-webui/arm-simulator.html computeTorques
import { JointsDeg } from './safety';
import { L1_MM, L2_MM, L3_MM } from './simKinematics';

const DEG = Math.PI / 180;
const G = 9.81;
const M1 = 0.080;
const M2 = 0.050;
const M3 = 0.030;
const R_CM1 = 45;
const R_CM2 = 35;
const R_CM3 = 25;

const STALL_TORQUE_NM = { base: 0.1863, shoulder: 0.2108, elbow: 0.2108, wrist: 0.1863 };
const MAX_SAFE = {
  base: STALL_TORQUE_NM.base * 0.8,
  shoulder: STALL_TORQUE_NM.shoulder * 0.8,
  elbow: STALL_TORQUE_NM.elbow * 0.8,
  wrist: STALL_TORQUE_NM.wrist * 0.8,
};

export type TorqueResult = {
  shoulder_Nm: number;
  elbow_Nm: number;
  wrist_Nm: number;
  strainSh: number;
  strainEl: number;
  strainWr: number;
  powerWatts: number;
};

export function computeTorques(
  angles: Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'>,
  payloadKg: number,
): TorqueResult {
  const phi1 = (angles.shoulder - 90) * DEG;
  const phi2 = phi1 + (angles.elbow - 90) * DEG;
  const phi3 = phi2 + (angles.wrist - 90) * DEG;
  const s1 = Math.sin(phi1);
  const s2 = Math.sin(phi2);
  const s3 = Math.sin(phi3);
  const c1 = Math.cos(phi1);
  const c2 = Math.cos(phi2);
  const c3 = Math.cos(phi3);
  const l1m = L1_MM / 1000;
  const l2m = L2_MM / 1000;
  const l3m = L3_MM / 1000;
  const r1m = R_CM1 / 1000;
  const r2m = R_CM2 / 1000;
  const r3m = R_CM3 / 1000;
  const m_p = payloadKg;

  const tauWr = Math.abs(G * (M3 * r3m * s3 + m_p * l3m * s3));
  const tauEl = Math.abs(G * (
    M2 * r2m * s2 + M3 * (l2m * s2 + r3m * s3) + m_p * (l2m * s2 + l3m * s3)
  ));
  const tauSh = Math.abs(G * (
    M1 * r1m * s1 + M2 * (l1m * s1 + r2m * s2) +
    M3 * (l1m * s1 + l2m * s2 + r3m * s3) + m_p * (l1m * s1 + l2m * s2 + l3m * s3)
  ));

  const strainSh = (tauSh / MAX_SAFE.shoulder) * 100;
  const strainEl = (tauEl / MAX_SAFE.elbow) * 100;
  const strainWr = (tauWr / MAX_SAFE.wrist) * 100;
  const powerWatts = (tauSh + tauEl + tauWr) * 0.12;

  return {
    shoulder_Nm: tauSh,
    elbow_Nm: tauEl,
    wrist_Nm: tauWr,
    strainSh,
    strainEl,
    strainWr,
    powerWatts,
  };
}

export function strainScaleForTarget(
  angles: Pick<JointsDeg, 'base' | 'shoulder' | 'elbow' | 'wrist'>,
  payloadKg: number,
): number {
  const t = computeTorques(angles, payloadKg);
  const maxStrain = Math.max(t.strainSh, t.strainEl, t.strainWr);
  return Math.max(0.4, Math.min(1.0, 1.0 - (maxStrain / 100.0) * 0.6));
}
