/**
 * Continuous Mathematical Pipeline (JavaScript Edition)
 * Mirrors the C++ ArmPipeline implementation.
 */

// Armic: `var` rather than `const` so this table is reachable as window.JOINTS
// and can be patched from calibration-client.js at page load. Values here are
// only the fallback used before /calibration resolves.
var JOINTS = {
    base:     { pmin: 100, pmid: 300, pmax: 500, amin: 0, amid: 90, amax: 180, smin: 0, smax: 180, dir:  1 },
    shoulder: { pmin:  90, pmid: 290, pmax: 490, amin: 0, amid: 90, amax: 180, smin: 0, smax: 180, dir: -1 },
    elbow:    { pmin: 100, pmid: 300, pmax: 500, amin: 0, amid: 90, amax: 180, smin: 90, smax: 180, dir:  1 },
    wrist:    { pmin: 100, pmid: 300, pmax: 500, amin: 0, amid: 90, amax: 180, smin: 0, smax: 180, dir: -1 },
};

function angleToPwm(deg, joint) {
    const j = JOINTS[joint];
    let d = Math.max(j.smin, Math.min(j.smax, deg));
    let pwm;
    if (d <= j.amid) {
        let t = (d - j.amin) / (j.amid - j.amin);
        pwm = Math.round(j.pmin + t * (j.pmid - j.pmin));
    } else {
        let t = (d - j.amid) / (j.amax - j.amid);
        pwm = Math.round(j.pmid + t * (j.pmax - j.pmid));
    }

    if (j.dir < 0) {
        if (pwm <= j.pmid) {
            let t = (pwm - j.pmin) / (j.pmid - j.pmin);
            pwm = Math.round(j.pmax + t * (j.pmid - j.pmax));
        } else {
            let t = (pwm - j.pmid) / (j.pmax - j.pmid);
            pwm = Math.round(j.pmid + t * (j.pmin - j.pmid));
        }
    }
    return Math.max(j.pmin, Math.min(j.pmax, pwm));
}

function pwmToAngle(pwm, joint) {
    const j = JOINTS[joint];
    let p = Math.max(j.pmin, Math.min(j.pmax, pwm));
    let q = p;
    if (j.dir < 0) {
        if (p <= j.pmid) {
            let t = (p - j.pmax) / (j.pmid - j.pmax);
            q = Math.round(j.pmin + t * (j.pmid - j.pmin));
        } else {
            let t = (p - j.pmid) / (j.pmin - j.pmid);
            q = Math.round(j.pmid + t * (j.pmax - j.pmid));
        }
    }
    let deg;
    if (q <= j.pmid) {
        let t = (q - j.pmin) / (j.pmid - j.pmin);
        deg = j.amin + t * (j.amid - j.amin);
    } else {
        let t = (q - j.pmid) / (j.pmax - j.pmid);
        deg = j.amid + t * (j.amax - j.amid);
    }
    return Math.max(j.smin, Math.min(j.smax, deg));
}

class PlannerJS {
    constructor() {
        this.target = { x: 0.1, y: 0, z: 300 };
        this.intermediateTarget = { x: 0.1, y: 0, z: 300 };
        this.isMoving = false;
        this.state = 'IDLE'; // IDLE, LINEAR, TUCKING, ROTATING, EXTENDING
    }
    moveTo(current, targetX, targetY, targetZ, isLoaded = false) {
        this.target = { x: targetX, y: targetY, z: targetZ };
        this.isMoving = true;

        const dx = targetX - current.x;
        const dy = targetY - current.y;
        const dz = targetZ - current.z;
        const dist = Math.hypot(dx, dy, dz);

        if (isLoaded && dist > 50.0) {
            this.state = 'TUCKING';
            const current_r = Math.hypot(current.x, current.y);
            const current_theta = Math.atan2(current.y, current.x);
            
            if (current_r <= 65.0 && current.z >= 180.0) {
                this.state = 'ROTATING';
                this.intermediateTarget = { ...current };
            } else {
                const safe_r = 60.0;
                const safe_z = 200.0;
                this.intermediateTarget = {
                    x: safe_r * Math.cos(current_theta),
                    y: safe_r * Math.sin(current_theta),
                    z: safe_z
                };
            }
        } else {
            this.state = 'LINEAR';
            this.intermediateTarget = { ...this.target };
        }
    }
    advanceState() {
        if (this.state === 'TUCKING') {
            this.state = 'ROTATING';
            const target_theta = Math.atan2(this.target.y, this.target.x);
            const safe_r = 60.0;
            const safe_z = 200.0;
            this.intermediateTarget = {
                x: safe_r * Math.cos(target_theta),
                y: safe_r * Math.sin(target_theta),
                z: safe_z
            };
        } else if (this.state === 'ROTATING') {
            this.state = 'EXTENDING';
            this.intermediateTarget = { ...this.target };
        } else if (this.state === 'EXTENDING' || this.state === 'LINEAR') {
            this.state = 'IDLE';
            this.isMoving = false;
        }
    }
    getNextWaypoint(current, stepSizeMM) {
        if (!this.isMoving) return current;
        
        let dx = this.intermediateTarget.x - current.x;
        let dy = this.intermediateTarget.y - current.y;
        let dz = this.intermediateTarget.z - current.z;
        let dist = Math.hypot(dx, dy, dz);
        
        if (dist <= stepSizeMM) {
            this.advanceState();
            if (!this.isMoving) return { ...this.target };
            
            dx = this.intermediateTarget.x - current.x;
            dy = this.intermediateTarget.y - current.y;
            dz = this.intermediateTarget.z - current.z;
            dist = Math.hypot(dx, dy, dz);
            
            if (dist <= stepSizeMM) {
                return current;
            }
        }
        
        const ratio = stepSizeMM / dist;
        return {
            x: current.x + dx * ratio,
            y: current.y + dy * ratio,
            z: current.z + dz * ratio
        };
    }
}

class CompensatorsJS {
    constructor() {
        this.k_droop = 0.015;
        this.backlash = { base: 1.0, shoulder: 1.5, elbow: 2.0, wrist: 1.0 };
        
        this.lastDir = { base: 0, shoulder: 0, elbow: 0, wrist: 0 };
        this.prevAngles = { base: 90, shoulder: 90, elbow: 90, wrist: 90 };
        this.activeBacklash = { base: 0, shoulder: 0, elbow: 0, wrist: 0 };
    }
    applyDroop(angles, targetPos) {
        const R = Math.hypot(targetPos.x, targetPos.y);
        angles.shoulder += R * this.k_droop;
    }
    applyBacklash(angles) {
        const process = (joint, current, prev, amt) => {
            const diff = current - prev;
            let dir = (diff > 0.01) ? 1 : ((diff < -0.01) ? -1 : this.lastDir[joint]);
            if (dir !== 0) {
                this.activeBacklash[joint] = dir * amt;
                this.lastDir[joint] = dir;
            }
            return current + this.activeBacklash[joint];
        };

        angles.base = process('base', angles.base, this.prevAngles.base, this.backlash.base);
        angles.shoulder = process('shoulder', angles.shoulder, this.prevAngles.shoulder, this.backlash.shoulder);
        angles.elbow = process('elbow', angles.elbow, this.prevAngles.elbow, this.backlash.elbow);
        angles.wrist = process('wrist', angles.wrist, this.prevAngles.wrist, this.backlash.wrist);
        
        this.prevAngles = { ...angles };
    }
}

class MotionProfileJS {
    constructor() {
        // max degrees per second
        this.maxVelDegPerSec = 90.0;
        this.currentAngles = { base: 90, shoulder: 90, elbow: 90, wrist: 90 };
    }
    setCurrentAngles(angles) {
        this.currentAngles = { ...angles };
    }
    step(targetAngles, dt_ms) {
        const maxStep = (this.maxVelDegPerSec / 1000.0) * dt_ms;
        
        const move = (joint, current, target, stepLimit) => {
            const diff = target - current;
            if (Math.abs(diff) <= stepLimit) return target;
            return current + Math.sign(diff) * stepLimit;
        };

        this.currentAngles.base = move('base', this.currentAngles.base, targetAngles.base, maxStep);
        this.currentAngles.shoulder = move('shoulder', this.currentAngles.shoulder, targetAngles.shoulder, maxStep);
        this.currentAngles.elbow = move('elbow', this.currentAngles.elbow, targetAngles.elbow, maxStep);
        this.currentAngles.wrist = move('wrist', this.currentAngles.wrist, targetAngles.wrist, maxStep);

        return { ...this.currentAngles };
    }
}

class ArmPipelineJS {
    constructor() {
        this.planner = new PlannerJS();
        this.compensators = new CompensatorsJS();
        this.motion = new MotionProfileJS();
        
        this.enabled = false;
        this.currentPos = { x: 0.1, y: 0, z: 300 };
        this.pitch = 90;
        
        // Dithering parameters
        this.ditherAmp = 0.5; // degrees
        this.ditherHz = 15.0; // Hz
        this.ditherEnabled = false;

        // Static offsets
        this.offsets = { base: 0, shoulder: 0, elbow: 0, wrist: 0 };
    }

    init(startPos, startPitch) {
        this.currentPos = { ...startPos };
        this.pitch = startPitch;
        // Requires ikSolve from arm-simulator.html
        if (typeof ikSolve !== 'undefined') {
            const out = ikSolve(startPos.x, startPos.y, startPos.z, startPitch);
            if (out.status === 'OK') {
                this.motion.setCurrentAngles(out.angles);
            }
        }
    }

    setTarget(x, y, z, pitch, isLoaded = false) {
        this.planner.moveTo(this.currentPos, x, y, z, isLoaded);
        this.pitch = pitch;
    }

    update(dt_ms, now_ms) {
        if (!this.enabled) return null;

        // 1. Planner Layer (max 2mm per tick)
        const targetPos = this.planner.getNextWaypoint(this.currentPos, 2.0);
        this.currentPos = targetPos;

        // 2. Kinematics Layer with Offsets
        let targetAngles = null;
        if (typeof ikSolve !== 'undefined') {
            const out = ikSolve(targetPos.x, targetPos.y, targetPos.z, this.pitch);
            if (out.status === 'OK') {
                targetAngles = { ...out.angles };
                // Apply offsets logically before physical output
                targetAngles.base += this.offsets.base;
                targetAngles.shoulder += this.offsets.shoulder;
                targetAngles.elbow += this.offsets.elbow;
                targetAngles.wrist += this.offsets.wrist;
            }
        }

        if (!targetAngles) return null;

        // 3 & 4. Compensators
        this.compensators.applyDroop(targetAngles, targetPos);
        this.compensators.applyBacklash(targetAngles);

        // 5. Motion Profile
        const currentStep = this.motion.step(targetAngles, dt_ms);

        // 6. Dithering
        let ditherVal = 0;
        if (this.ditherEnabled && this.ditherAmp > 0) {
            const t_sec = now_ms / 1000.0;
            ditherVal = this.ditherAmp * Math.sin(2.0 * Math.PI * this.ditherHz * t_sec);
        }

        const finalAngles = {
            base: currentStep.base + ditherVal,
            shoulder: currentStep.shoulder + ditherVal,
            elbow: currentStep.elbow + ditherVal,
            wrist: currentStep.wrist + ditherVal
        };

        // Output hardware PWM values
        return {
            base: angleToPwm(finalAngles.base, 'base'),
            shoulder: angleToPwm(finalAngles.shoulder, 'shoulder'),
            elbow: angleToPwm(finalAngles.elbow, 'elbow'),
            wrist: angleToPwm(finalAngles.wrist, 'wrist'),
            _angles: finalAngles // Exposing angles for UI convenience if needed
        };
    }
}

// Global instance to be used by the main HTML file
const globalPipeline = new ArmPipelineJS();
