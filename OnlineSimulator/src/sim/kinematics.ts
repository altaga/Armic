// ---- armic analytical FK/IK (Law-of-Cosines β, dual-branch, 0.5mm self-verify) ----
// Exact math port of armic-firmware kinematics.cpp. The Expo simulator uses this
// to behave 1:1 like the real board, so a clinician can preview motion on a
// phone before letting the UNO Q move the real arm.

import {
  DEG2RAD, RAD2DEG, JointsDeg, clampBand, SERVO_LOAD_EST_N,
} from './safety';

// 2-axis planar chain (arm plane, R is radial, pz is vertical above base plane)
export const LINK_1_MM = 90;      // upper arm shoulder → elbow
export const LINK_2_MM = 110;     // forearm elbow → wrist
export const BASE_OFFSET_MM = 25; // radial offset base joint → shoulder pivot
export const TOOL_XYZ_MM = 30;    // gripper length past wrist
export const IK_SELF_VERIFY_MM2 = 0.25; // 0.5mm tolerance (squared)

export type PoseXYZ = { x: number; y: number; z: number; tool: number };

export function fkForward(j: JointsDeg): PoseXYZ {
  const baseRad = j.base * DEG2RAD;
  // shoulder angle counted from horizontal up; 90° shoulder ⇒ straight up relative
  const shRad = (180 - j.shoulder) * DEG2RAD;  // from horizontal (link pointing up = shoulder high)
  const elRad = (180 - j.elbow) * DEG2RAD;      // elbow interior via β (180 - β = interior supplementary)
  const totalElbowAngleSh = shRad + elRad;      // forearm angle

  const shR = LINK_1_MM * Math.cos(shRad);
  const shZ = LINK_1_MM * Math.sin(shRad);
  const fR = shR + LINK_2_MM * Math.cos(totalElbowAngleSh);
  const fZ = shZ + LINK_2_MM * Math.sin(totalElbowAngleSh);
  const radial = fR + BASE_OFFSET_MM;
  const toolR = radial + TOOL_XYZ_MM * Math.cos(j.wrist * DEG2RAD);
  const toolZ = fZ + TOOL_XYZ_MM * Math.sin(j.wrist * DEG2RAD);
  return {
    x: toolR * Math.cos(baseRad),
    y: toolR * Math.sin(baseRad),
    z: toolZ,
    tool: j.wrist,
  };
}

export type IKResult =
  | { kind: 'OK'; joints: JointsDeg; branch: 'A' | 'B'; torqueRatio: number }
  | { kind: 'OUT_OF_REACH' }
  | { kind: 'SELF_VERIFY_FAIL' };

export function solveIKAnalytical(
  target: PoseXYZ,
  prev: JointsDeg,
): IKResult {
  const baseRad = Math.atan2(target.y, target.x);
  const toolRad = Math.hypot(target.x, target.y);
  const R = toolRad - BASE_OFFSET_MM - TOOL_XYZ_MM * Math.cos(target.tool * DEG2RAD);
  const Z = target.z - TOOL_XYZ_MM * Math.sin(target.tool * DEG2RAD);
  const L1 = LINK_1_MM, L2 = LINK_2_MM;

  const cosbeta = (R * R + L1 * L1 - L2 * L2) / (2 * R * L1);
  if (Math.abs(cosbeta) > 1.0) return { kind: 'OUT_OF_REACH' };
  const beta = Math.acos(cosbeta);

  const atan1 = Math.atan2(Z, R);

  const q2A = (atan1 + beta) * RAD2DEG;     // shoulder branch A
  const q2B = (atan1 - beta) * RAD2DEG;     // shoulder branch B (other side)
  // elbow interior angle from law of cosines on outer triangle
  const cosgamma = (L1 * L1 + L2 * L2 - R * R - Z * Z) / (2 * L1 * L2);
  const gamma = Math.acos(Math.max(-1, Math.min(1, cosgamma)));
  const q3A = 180 - gamma * RAD2DEG;         // elbow-down (default)
  const q3B = 180 + gamma * RAD2DEG;         // elbow-up (rare valid)

  function soln(q2: number, q3: number): JointsDeg {
    return {
      base: baseRad * RAD2DEG,
      shoulder: 180 - q2,
      elbow: q3,
      wrist: target.tool,
      gripper: prev.gripper,
    };
  }

  const A = soln(q2A, q3A);
  const B = soln(q2B, q3B);

  function tau(j: JointsDeg) {
    // Peak shoulder torque estimate (cos(shoulder_from_horiz)) × load_est
    const shHoriz = 180 - j.shoulder;
    return L1 * Math.abs(Math.cos(shHoriz * DEG2RAD)) * SERVO_LOAD_EST_N;
  }
  let pick = A;
  let branch: 'A' | 'B' = 'A';
  if (tau(B) < tau(A)) { pick = B; branch = 'B'; }

  if (Math.abs(tau(A) - tau(B)) < 0.05) {
    // tie: nearest-prev for minimal motion
    const distA = Math.abs(A.shoulder - prev.shoulder);
    const distB = Math.abs(B.shoulder - prev.shoulder);
    if (distB < distA) { pick = B; branch = 'B'; }
  }

  // Joint-band pre-clamp before verify so we pass values that would actually ship
  const clamped: JointsDeg = { ...pick };
  clamped.base = clampBand(clamped.base, 10, 170);
  clamped.shoulder = clampBand(clamped.shoulder, 0, 135);
  clamped.elbow = clampBand(clamped.elbow, 90, 180);

  const verify = fkForward(clamped);
  const dx = verify.x - target.x;
  const dy = verify.y - target.y;
  const dz = verify.z - target.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > IK_SELF_VERIFY_MM2) return { kind: 'SELF_VERIFY_FAIL' };

  return { kind: 'OK', joints: clamped, branch, torqueRatio: tau(clamped) / (L1 * SERVO_LOAD_EST_N) };
}

// Yoshikawa manipulability → velocity derate [0.4, 1.0]
export function yoshikawaDerate(j: JointsDeg): number {
  const eps = 0.05;
  const shHoriz = (180 - j.shoulder) * DEG2RAD;
  const elInterior = (180 - j.elbow) * DEG2RAD;
  const sinval = Math.abs(Math.sin(elInterior));
  const horiz = Math.max(eps, Math.abs(Math.cos(shHoriz)));
  const manip = sinval * (horiz + eps);
  const minFrac = 0.4;
  return Math.max(minFrac, Math.min(1.0, minFrac + (1 - minFrac) * manip));
}
