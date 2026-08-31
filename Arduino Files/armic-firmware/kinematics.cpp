// ============================================================================
// ArmDriver kinematics — implementation
//
// User convention (locked 2026-08-21):
//   ALL joints at 90° → arm is fully straight.
//   shoulder=90° → upper arm straight up (+Z).
//   elbow=90°    → forearm aligned with upper arm (straight).
//   wrist=90°    → L3 aligned with forearm (straight).
//   elbow=0°     → forearm folded back perpendicular to upper arm.
//   base=90°     → arm along +X.
//
// World frame: (x, y) = floor plane, z = vertical up.
//
// Per-joint DIRECT/INVERTED is handled by angle_to_pwm() — the math here
// always uses joint-label degrees, not PWM.
//
// Restrictions (mirrors RESTRICTIONS in the simulator):
//   elbow ∈ [90°, 180°]   ← locked 2026-08-21
//   base / shoulder / wrist ∈ [0°, 180°] for now
// ============================================================================

#include "kinematics.h"
#include <math.h>

// ---------------------------------------------------------------------------
// Calibration storage — the single mutable definition for the extern
// declarations in kinematics.h.
//
// These initialisers are the PROJECT DEFAULTS: the measured calibration of this
// specific arm. "Restore defaults" in the settings UI returns to exactly these
// numbers, so a bad calibration session is always recoverable without a
// rebuild. Keep them in sync with DEFAULT_CALIBRATION in
// ../Arduino Files/armic-brick/__init__.py.
// ---------------------------------------------------------------------------
namespace joints {
    // ch0 base — DIRECT
    uint16_t PWM_MIN_B   = 100;
    uint16_t PWM_MAX_B   = 500;
    uint16_t PWM_MID_B   = 300;
    int8_t   DIR_BASE    = +1;
    float    SOFT_MIN_B  = 0.0f;
    float    SOFT_MAX_B  = 180.0f;
    float    OFFSET_B    = 0.0f;

    // ch1 shoulder — INVERTED
    uint16_t PWM_MIN_S   = 90;
    uint16_t PWM_MAX_S   = 490;
    uint16_t PWM_MID_S   = 290;
    int8_t   DIR_SHOULDER = -1;
    float    SOFT_MIN_S  = 0.0f;
    float    SOFT_MAX_S  = 180.0f;
    float    OFFSET_S    = 0.0f;

    // ch2 elbow — DIRECT, band locked to [90, 180]
    uint16_t PWM_MIN_E   = 100;
    uint16_t PWM_MAX_E   = 500;
    uint16_t PWM_MID_E   = 300;
    int8_t   DIR_ELBOW   = +1;
    float    SOFT_MIN_E  = 90.0f;
    float    SOFT_MAX_E  = 180.0f;
    float    OFFSET_E    = 0.0f;

    // ch3 wrist — INVERTED
    uint16_t PWM_MIN_W   = 100;
    uint16_t PWM_MAX_W   = 500;
    uint16_t PWM_MID_W   = 300;
    int8_t   DIR_WRIST   = -1;
    float    SOFT_MIN_W  = 0.0f;
    float    SOFT_MAX_W  = 180.0f;
    float    OFFSET_W    = 0.0f;
}

namespace { constexpr float DEG_TO_RAD = 0.017453292519943295f;
            constexpr float RAD_TO_DEG = 57.29577951308232f; }

// ---------------------------------------------------------------------------
// Forward kinematics — joint angles → world (x, y, z) in mm.
//
// In the user's convention:
//   shoulder = absolute link direction from +Z (90° = up)
//   elbow    = relative fold from upper arm (90° = straight/aligned)
//   wrist    = relative fold from forearm  (90° = straight/aligned)
//
// The cumulative world-frame direction of each link is:
//   link1_dir = (shoulder - 90)°
//   link2_dir = link1_dir + (elbow - 90)°
//   link3_dir = link2_dir + (wrist - 90)°
//
// We compute in the (r, z) arm plane, then rotate into (x, y) using base yaw.
// ---------------------------------------------------------------------------

void fk_solve(const JointAngles& a, float& x, float& y, float& z) {
    // Cumulative world-frame directions:
    // shoulder: 90° = vertical up
    // elbow:    0° = straight, 180° = folded
    // wrist:    90° = straight
    float shDir = (a.shoulder - 90.0f) * DEG_TO_RAD;
    float elDir = shDir + (a.elbow - 90.0f) * DEG_TO_RAD;
    float wrDir = elDir + (a.wrist - 90.0f) * DEG_TO_RAD;

    float sh_r = links::L1 * sinf(shDir);
    float sh_z = links::FLOOR_OFFSET + links::L0 + links::L1 * cosf(shDir);
    float el_r = sh_r + links::L2 * sinf(elDir);
    float el_z = sh_z + links::L2 * cosf(elDir);
    float ee_r = el_r + links::L3 * sinf(wrDir);
    float ee_z = el_z + links::L3 * cosf(wrDir);

    // Base convention (locked with simulator): base=90° → arm along +X.
    //   baseRad = (base - 90)°
    //   x =  ee_r · cos(baseRad)
    //   y = -ee_r · sin(baseRad)
    float baseRad = (a.base - 90.0f) * DEG_TO_RAD;
    x =  ee_r * cosf(baseRad);
    y = -ee_r * sinf(baseRad);
    z =  ee_z;
}

// ---------------------------------------------------------------------------
// Shoulder angle for x = y = 0 (tool tip above base column).
//
// With elbow and wrist fixed, r = L1·sin(shDir) + L2·sin(elDir) + L3·sin(wrDir).
// Expand sin(shDir + θ) → A·sin(shDir) + B·cos(shDir) = 0  ⇒  shDir = atan2(−B, A).
// ---------------------------------------------------------------------------

bool shoulder_for_xy_zero(float elbow_deg, float wrist_deg, float& shoulder_out) {
    float alpha = (elbow_deg - 90.0f) * DEG_TO_RAD;
    float gamma = (wrist_deg - 90.0f) * DEG_TO_RAD;
    float B = links::L2 * sinf(alpha) + links::L3 * sinf(alpha + gamma);
    float A = links::L1 + links::L2 * cosf(alpha) + links::L3 * cosf(alpha + gamma);

    float shDir0 = atan2f(-B, A);
    bool found = false;
    float best_sh = 0.0f;

    for (int branch = 0; branch < 2; branch++) {
        float shDir = shDir0 + (float)branch * (float)M_PI;
        float sh = 90.0f + shDir * RAD_TO_DEG;
        while (sh < 0.0f) sh += 360.0f;
        while (sh >= 360.0f) sh -= 360.0f;
        if (sh < joints::SOFT_MIN_S || sh > joints::SOFT_MAX_S) continue;

        JointAngles probe{90.0f, sh, elbow_deg, wrist_deg};
        float x, y, z;
        fk_solve(probe, x, y, z);
        if (fabsf(x) > 0.5f || fabsf(y) > 0.5f) continue;

        if (!found || sh < best_sh) {
            best_sh = sh;
            found = true;
        }
    }

    if (!found) return false;
    shoulder_out = best_sh;
    return true;
}

// ---------------------------------------------------------------------------
// Inverse kinematics — world (x, y, z) + pitch → joint angles.
// ---------------------------------------------------------------------------

IkStatus ik_solve(float x, float y, float z, float pitch_deg, JointAngles& a) {
    return ik_solve(x, y, z, pitch_deg, a, nullptr);
}

IkStatus ik_solve(float x, float y, float z, float pitch_deg, JointAngles& a, const JointAngles* prefer) {
    // Step 1: base yaw.
    float r = sqrtf(x * x + y * y);
    if (r < 1e-3f) return IkStatus::ERR_BASE_SINGULARITY;

    // Match simulator: joint base = 90° - atan2(y, x)°  (so +X → base 90°)
    float target_yaw = 90.0f - atan2f(y, x) * RAD_TO_DEG;

    // Step 2: planar 2-DOF IK in the (r, z) arm plane.
    // The input (x, y, z) is in the floor frame (z = 0 at floor). Convert to
    // the base-anchored frame by subtracting FLOOR_OFFSET before computing.
    //   rw = r - L3·cos(pitch)   (radial distance from base column to wrist attach)
    //   vw = (z - FLOOR_OFFSET) - L0 - L3·sin(pitch)  (height of wrist attach above shoulder)
    float pitch_rad = pitch_deg * DEG_TO_RAD;
    float z_local = z - links::FLOOR_OFFSET;
    float rw = r - links::L3 * cosf(pitch_rad);
    float vw = (z_local - links::L0) - links::L3 * sinf(pitch_rad);

    // Distance from shoulder to wrist attachment point.
    float D2 = rw * rw + vw * vw;
    float D  = sqrtf(D2);

    // Reachability: D must lie in [|L1-L2|, L1+L2].
    float reach_max = links::L1 + links::L2;
    float reach_min = fabsf(links::L1 - links::L2);
    if (D > reach_max + 1e-3f) return IkStatus::ERR_UNREACHABLE;
    if (D < reach_min - 1e-3f) return IkStatus::ERR_OUT_OF_RANGE;

    // Law of cosines: elbow fold angle (internal angle between upper and lower arm).
    //   cos(β) = (D² - L1² - L2²) / (2·L1·L2)
    // In our convention, β=0 means forearm aligned with upper arm (elbow=90°).
    // β>0 means forearm folds "backward" (elbow>90°); β<0 means folds forward.
    float cos_elbow_internal = (D2 - links::L1 * links::L1 - links::L2 * links::L2)
                             / (2.0f * links::L1 * links::L2);
    if (cos_elbow_internal >  1.0f) cos_elbow_internal =  1.0f;
    if (cos_elbow_internal < -1.0f) cos_elbow_internal = -1.0f;
    float acos_val = acosf(cos_elbow_internal);   // in [0, π]

    // Try both mirror branches; pick lower peak gravity torque (matches sim).
    JointAngles candA{}, candB{};
    bool okA = false, okB = false;

    auto try_branch = [&](float elbow_internal_rad, JointAngles& out) -> bool {
        float math_s = atan2f(vw, rw)
                     - atan2f(links::L2 * sinf(elbow_internal_rad),
                              links::L1 + links::L2 * cosf(elbow_internal_rad));
        float math_w = pitch_rad - math_s - elbow_internal_rad;

        float sh_deg = 180.0f - math_s * RAD_TO_DEG;
        float el_deg = 90.0f + fabsf(elbow_internal_rad) * RAD_TO_DEG;
        float wr_deg = 90.0f - math_w * RAD_TO_DEG;

        while (sh_deg <    0.0f) sh_deg += 360.0f;
        while (sh_deg >= 360.0f) sh_deg -= 360.0f;
        while (el_deg <    0.0f) el_deg += 360.0f;
        while (el_deg >= 360.0f) el_deg -= 360.0f;
        while (wr_deg <    0.0f) wr_deg += 360.0f;
        while (wr_deg >= 360.0f) wr_deg -= 360.0f;

        sh_deg += joints::OFFSET_S;
        el_deg += joints::OFFSET_E;
        wr_deg += joints::OFFSET_W;

        if (sh_deg < joints::SOFT_MIN_S || sh_deg > joints::SOFT_MAX_S) return false;
        if (el_deg < joints::SOFT_MIN_E || el_deg > joints::SOFT_MAX_E) return false;
        if (wr_deg < joints::SOFT_MIN_W || wr_deg > joints::SOFT_MAX_W) return false;

        JointAngles cand{target_yaw, sh_deg, el_deg, wr_deg};
        float fx, fy, fz;
        fk_solve(cand, fx, fy, fz);
        if (fabsf(fz - z) > 0.5f) return false;
        float fr = sqrtf(fx * fx + fy * fy);
        if (fabsf(fr - r) > 0.5f) return false;

        out = cand;
        return true;
    };

    okA = try_branch(+acos_val, candA);
    okB = try_branch(-acos_val, candB);
    if (!okA && !okB) return IkStatus::ERR_JOINT_LIMIT;

    auto peakTau = [](const JointAngles& ja) {
        TorqueEstimate t = estimate_torques(ja, 100.0f);
        float m = t.shoulder_Nm;
        if (t.elbow_Nm > m) m = t.elbow_Nm;
        if (t.wrist_Nm > m) m = t.wrist_Nm;
        return m;
    };

    if (okA && okB) {
        if (prefer) {
            auto dist = [&](const JointAngles& c) {
                float db = c.base - prefer->base;
                float ds = c.shoulder - prefer->shoulder;
                float de = c.elbow - prefer->elbow;
                float dw = c.wrist - prefer->wrist;
                return db * db + ds * ds + de * de + dw * dw;
            };
            a = (dist(candA) <= dist(candB)) ? candA : candB;
        } else {
            a = (peakTau(candA) <= peakTau(candB)) ? candA : candB;
        }
    } else {
        a = okA ? candA : candB;
    }

    a.base += joints::OFFSET_B;
    if (a.base < joints::SOFT_MIN_B || a.base > joints::SOFT_MAX_B) return IkStatus::ERR_JOINT_LIMIT;
    return IkStatus::OK;
}

IkStatus ik_solve(float x, float y, float z, JointAngles& a) {
    return ik_solve(x, y, z, 0.0f, a);
}

// ---------------------------------------------------------------------------
// Angle → PWM (with per-joint DIRECT/INVERTED).
// ---------------------------------------------------------------------------
static uint16_t angle_to_pwm(float deg, float soft_min, float soft_max,
                             float amin, float amid, float amax,
                             uint16_t pmin, uint16_t pmid, uint16_t pmax,
                             int8_t dir) {
    if (deg < soft_min) deg = soft_min;
    if (deg > soft_max) deg = soft_max;

    uint16_t pwm;
    if (deg <= amid) {
        float t = (deg - amin) / (amid - amin);
        pwm = (uint16_t)roundf(pmin + t * ((float)pmid - (float)pmin));
    } else {
        float t = (deg - amid) / (amax - amid);
        pwm = (uint16_t)roundf(pmid + t * ((float)pmax - (float)pmid));
    }

    if (dir < 0) {
        if (pwm <= pmid) {
            float t = ((float)pwm - (float)pmin) / ((float)pmid - (float)pmin);
            pwm = (uint16_t)roundf(pmax + t * ((float)pmid - (float)pmax));
        } else {
            float t = ((float)pwm - (float)pmid) / ((float)pmax - (float)pmid);
            pwm = (uint16_t)roundf(pmid + t * ((float)pmin - (float)pmid));
        }
    }

    if (pwm < pmin) pwm = pmin;
    if (pwm > pmax) pwm = pmax;
    return pwm;
}

uint16_t angle_to_pwm_base(float deg) {
    return angle_to_pwm(deg, joints::SOFT_MIN_B, joints::SOFT_MAX_B,
                        0.0f, 90.0f, 180.0f,
                        joints::PWM_MIN_B, joints::PWM_MID_B, joints::PWM_MAX_B,
                        joints::DIR_BASE);
}
uint16_t angle_to_pwm_shoulder(float deg) {
    return angle_to_pwm(deg, joints::SOFT_MIN_S, joints::SOFT_MAX_S,
                        0.0f, 90.0f, 180.0f,
                        joints::PWM_MIN_S, joints::PWM_MID_S, joints::PWM_MAX_S,
                        joints::DIR_SHOULDER);
}
uint16_t angle_to_pwm_elbow(float deg) {
    return angle_to_pwm(deg, joints::SOFT_MIN_E, joints::SOFT_MAX_E,
                        0.0f, 90.0f, 180.0f,
                        joints::PWM_MIN_E, joints::PWM_MID_E, joints::PWM_MAX_E,
                        joints::DIR_ELBOW);
}
uint16_t angle_to_pwm_wrist(float deg) {
    return angle_to_pwm(deg, joints::SOFT_MIN_W, joints::SOFT_MAX_W,
                        0.0f, 90.0f, 180.0f,
                        joints::PWM_MIN_W, joints::PWM_MID_W, joints::PWM_MAX_W,
                        joints::DIR_WRIST);
}

JointPwm angles_to_pwm(const JointAngles& a) {
    return JointPwm{
        angle_to_pwm_base    (a.base),
        angle_to_pwm_shoulder(a.shoulder),
        angle_to_pwm_elbow   (a.elbow),
        angle_to_pwm_wrist   (a.wrist),
    };
}

// ---------------------------------------------------------------------------
// PWM → angle (inverse — used when reading back servo state).
// ---------------------------------------------------------------------------
static float pwm_to_angle(uint16_t pwm,
                          uint16_t pmin, uint16_t pmid, uint16_t pmax,
                          float amin, float amid, float amax,
                          float soft_min, float soft_max,
                          int8_t dir) {
    if (pwm < pmin) pwm = pmin;
    if (pwm > pmax) pwm = pmax;
    uint16_t q = pwm;
    if (dir < 0) {
        if (pwm <= pmid) {
            float t = ((float)pwm - (float)pmax) / ((float)pmid - (float)pmax);
            q = (uint16_t)roundf((float)pmin + t * ((float)pmid - (float)pmin));
        } else {
            float t = ((float)pwm - (float)pmid) / ((float)pmin - (float)pmid);
            q = (uint16_t)roundf((float)pmid + t * ((float)pmax - (float)pmid));
        }
    }
    float deg;
    if (q <= pmid) {
        float t = ((float)q - (float)pmin) / ((float)pmid - (float)pmin);
        deg = amin + t * (amid - amin);
    } else {
        float t = ((float)q - (float)pmid) / ((float)pmax - (float)pmid);
        deg = amid + t * (amax - amid);
    }
    if (deg < soft_min) deg = soft_min;
    if (deg > soft_max) deg = soft_max;
    return deg;
}

float pwm_to_angle_base(uint16_t pwm) {
    return pwm_to_angle(pwm, joints::PWM_MIN_B, joints::PWM_MID_B, joints::PWM_MAX_B,
                        0.0f, 90.0f, 180.0f, joints::SOFT_MIN_B, joints::SOFT_MAX_B, joints::DIR_BASE);
}
float pwm_to_angle_shoulder(uint16_t pwm) {
    return pwm_to_angle(pwm, joints::PWM_MIN_S, joints::PWM_MID_S, joints::PWM_MAX_S,
                        0.0f, 90.0f, 180.0f, joints::SOFT_MIN_S, joints::SOFT_MAX_S, joints::DIR_SHOULDER);
}
float pwm_to_angle_elbow(uint16_t pwm) {
    return pwm_to_angle(pwm, joints::PWM_MIN_E, joints::PWM_MID_E, joints::PWM_MAX_E,
                        0.0f, 90.0f, 180.0f, joints::SOFT_MIN_E, joints::SOFT_MAX_E, joints::DIR_ELBOW);
}
float pwm_to_angle_wrist(uint16_t pwm) {
    return pwm_to_angle(pwm, joints::PWM_MIN_W, joints::PWM_MID_W, joints::PWM_MAX_W,
                        0.0f, 90.0f, 180.0f, joints::SOFT_MIN_W, joints::SOFT_MAX_W, joints::DIR_WRIST);
}

const char* ik_status_str(IkStatus s) {
    switch (s) {
        case IkStatus::OK:                       return "OK";
        case IkStatus::ERR_BASE_SINGULARITY:     return "ERR_BASE_SINGULARITY (target on base axis)";
        case IkStatus::ERR_UNREACHABLE:          return "ERR_UNREACHABLE (target beyond L1+L2+L3)";
        case IkStatus::ERR_OUT_OF_RANGE:         return "ERR_OUT_OF_RANGE (target within L1-L2 dead zone)";
        case IkStatus::ERR_JOINT_LIMIT:          return "ERR_JOINT_LIMIT (a joint would exceed safe band)";
    }
    return "?";
}

TorqueEstimate estimate_torques(const JointAngles& a, float payload_grams) {
    static constexpr float M1 = 0.080f, M2 = 0.050f, M3 = 0.030f; // kg
    static constexpr float R_CM1 = 45.0f, R_CM2 = 35.0f, R_CM3 = 25.0f; // mm
    static constexpr float G_ACCEL = 9.81f;

    float m_p = payload_grams / 1000.0f;

    // Cumulative world-frame tilt: shoulder absolute, elbow fold, wrist relative fold
    float phi1 = (a.shoulder - 90.0f) * DEG_TO_RAD;
    float phi2 = phi1 + (a.elbow - 90.0f) * DEG_TO_RAD;
    float phi3 = phi2 + (a.wrist - 90.0f) * DEG_TO_RAD;

    float sin1 = sinf(phi1), sin2 = sinf(phi2), sin3 = sinf(phi3);
    float cos1 = cosf(phi1), cos2 = cosf(phi2), cos3 = cosf(phi3);

    float l1m = links::L1/1000.0f, l2m = links::L2/1000.0f, l3m = links::L3/1000.0f;
    float r1m = R_CM1/1000.0f, r2m = R_CM2/1000.0f, r3m = R_CM3/1000.0f;

    float tauWr = fabsf(G_ACCEL * (M3 * r3m * sin3 + m_p * l3m * sin3));
    float tauEl = fabsf(G_ACCEL * (M2*r2m*sin2 + M3*(l2m*sin2+r3m*sin3) + m_p*(l2m*sin2+l3m*sin3)));
    float tauSh = fabsf(G_ACCEL * (M1*r1m*sin1 + M2*(l1m*sin1+r2m*sin2) + M3*(l1m*sin1+l2m*sin2+r3m*sin3) + m_p*(l1m*sin1+l2m*sin2+l3m*sin3)));
    // Planar Jacobian (cumulative world-frame angles)
    float jl1 = links::L1 / 100.0f, jl2 = links::L2 / 100.0f, jl3 = links::L3 / 100.0f;
    float j00 =  jl1 * cos1;
    float j01 =  jl2 * cos2;
    float j02 =  jl3 * cos3;
    float j10 = -jl1 * sin1;
    float j11 = -jl2 * sin2;
    float j12 = -jl3 * sin3;

    float a00 = j00*j00 + j01*j01 + j02*j02;
    float a01 = j00*j10 + j01*j11 + j02*j12;
    float a11 = j10*j10 + j11*j11 + j12*j12;
    float w = sqrtf(fmaxf(0.0f, a00 * a11 - a01 * a01));

    return TorqueEstimate{tauSh, tauEl, tauWr, w};
}