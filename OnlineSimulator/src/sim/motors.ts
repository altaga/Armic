// MG90D/S PWM mapping — port of armic-webui/pipeline.js JOINTS + angleToPwm
export type MotorJoint = 'base' | 'shoulder' | 'elbow' | 'wrist' | 'gripper';

const JOINTS = {
  base:     { pmin: 100, pmid: 300, pmax: 500, amin: 0, amid: 90, amax: 180, smin: 0, smax: 180, dir:  1 },
  shoulder: { pmin:  90, pmid: 290, pmax: 490, amin: 0, amid: 90, amax: 180, smin: 0, smax: 180, dir: -1 },
  elbow:    { pmin: 100, pmid: 300, pmax: 500, amin: 0, amid: 90, amax: 180, smin: 90, smax: 180, dir:  1 },
  wrist:    { pmin: 100, pmid: 300, pmax: 500, amin: 0, amid: 90, amax: 180, smin: 0, smax: 180, dir: -1 },
  gripper:  { pmin: 236, pmid: 338, pmax: 440, amin: 0, amid: 45, amax: 90, smin: 0, smax: 90, dir: 1 },
} as const;

export function angleToPwm(deg: number, joint: MotorJoint): number {
  const j = JOINTS[joint];
  let d = Math.max(j.smin, Math.min(j.smax, deg));
  let pwm: number;
  if (d <= j.amid) {
    const t = (d - j.amin) / (j.amid - j.amin);
    pwm = Math.round(j.pmin + t * (j.pmid - j.pmin));
  } else {
    const t = (d - j.amid) / (j.amax - j.amid);
    pwm = Math.round(j.pmid + t * (j.pmax - j.pmid));
  }
  if (j.dir < 0) {
    if (pwm <= j.pmid) {
      const t = (pwm - j.pmin) / (j.pmid - j.pmin);
      pwm = Math.round(j.pmax + t * (j.pmid - j.pmax));
    } else {
      const t = (pwm - j.pmid) / (j.pmax - j.pmid);
      pwm = Math.round(j.pmid + t * (j.pmin - j.pmid));
    }
  }
  return Math.max(j.pmin, Math.min(j.pmax, pwm));
}

export function clawPctToPwm(pct: number): number {
  return angleToPwm(Math.max(0, Math.min(100, pct)) * 0.9, 'gripper');
}
