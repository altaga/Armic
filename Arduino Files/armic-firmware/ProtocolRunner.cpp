#include "ProtocolRunner.h"
#include "DeviceState.h"
#include <Arduino.h>
#include <math.h>
#include <string.h>

namespace {
float easeInOutCubic(float x) {
    if (x < 0.5f) return 4.0f * x * x * x;
    float t = -2.0f * x + 2.0f;
    return 1.0f - (t * t * t) * 0.5f;
}

bool nearAngles(const JointAngles& a, const JointAngles& b, float tol = 2.0f) {
    return fabsf(a.base - b.base) < tol
        && fabsf(a.shoulder - b.shoulder) < tol
        && fabsf(a.elbow - b.elbow) < tol
        && fabsf(a.wrist - b.wrist) < tol;
}

// Live rates
constexpr float HOME_DPS = 45.0f;
constexpr float GOTO_DPS = 55.0f;
constexpr float ANIM_DPS = 80.0f;
constexpr float ORB_DPS = 6.0f; // was 10 — slightly slower orbital scan
constexpr float PEND_DOWN_DPS = 220.0f; // fast down for inertia
constexpr float PEND_UP_DPS = 200.0f;   // snap back to straight
constexpr float HTL_DPS = 40.0f;
// User HTL choreography (base=90): (sh, el, wr) × 5 → home
const JointAngles HTL_WP1 = {90.0f, 180.0f,  90.0f,  90.0f};
// IK-refined via-points: same tuck radii as user path, hold/lift Z (r≈150 Z≈90, r≈80 Z≈101).
const JointAngles HTL_WP2 = {90.0f, 127.0f, 180.0f,  90.0f};
const JointAngles HTL_WP3 = {90.0f, 112.0f, 180.0f, 180.0f};
constexpr float HTL_WP4_ELBOW = 180.0f;
constexpr float HTL_WP4_WRIST = 180.0f;
JointAngles makeHtlWp4() {
    JointAngles wp{90.0f, 30.0f, HTL_WP4_ELBOW, HTL_WP4_WRIST};
    shoulder_for_xy_zero(HTL_WP4_ELBOW, HTL_WP4_WRIST, wp.shoulder);
    return wp;
}
const JointAngles HTL_WP4 = makeHtlWp4(); // shoulder solved for x=y=0
const JointAngles HTL_WP5 = {90.0f,  90.0f,  90.0f,  90.0f};
static const JointAngles* const HTL_WPS[5] = {
    &HTL_WP1, &HTL_WP2, &HTL_WP3, &HTL_WP4, &HTL_WP5,
};

float maxJointDelta(const JointAngles& a, const JointAngles& b) {
    float max_d = fabsf(b.base - a.base);
    float d = fabsf(b.shoulder - a.shoulder);
    if (d > max_d) max_d = d;
    d = fabsf(b.elbow - a.elbow);
    if (d > max_d) max_d = d;
    d = fabsf(b.wrist - a.wrist);
    if (d > max_d) max_d = d;
    return max_d;
}

JointAngles lerpAnglesLinear(const JointAngles& from, const JointAngles& to, float u) {
    JointAngles a;
    a.base     = from.base     + (to.base     - from.base)     * u;
    a.shoulder = from.shoulder + (to.shoulder - from.shoulder) * u;
    a.elbow    = from.elbow    + (to.elbow    - from.elbow)    * u;
    a.wrist    = from.wrist    + (to.wrist    - from.wrist)    * u;
    return a;
}
constexpr float COBRA_STRIKE_MS = 240.0f; // fast strike AND fast retract
constexpr float COBRA_PAUSE_MS = 3000.0f;
constexpr uint8_t GIMME_FIVE_STRIKES = 1; // one snap then home
const JointAngles COBRA_COIL = {90.0f, 52.0f, 168.0f, 22.0f};
const JointAngles COBRA_STRIKE = {90.0f, 138.0f, 92.0f, 88.0f};
const JointAngles PEND_EXTEND = {90.0f, 152.0f, 100.0f, 90.0f};
const JointAngles PEND_BOTTOM = {90.0f, 150.0f, 142.0f, 92.0f};
// Stop begins here (inertia until these), then brake to stable home.
const JointAngles PEND_STOP_START = {90.0f, 110.0f, 115.0f, 90.0f};
const JointAngles PEND_MID = {90.0f, 100.0f, 105.0f, 90.0f};
const JointAngles PEND_HOME = {90.0f, 90.0f, 95.0f, 90.0f}; // elbow 95 hold
constexpr float PEND_DECEL_DPS = 55.0f; // 110→100 / 115→105
constexpr float PEND_STOP_DPS = 22.0f;  // 100→90 / 105→95 full stop
constexpr float EX_REHAB_DPS = 52.0f;   // rehab pace — matched to GOTO_DPS band
constexpr float EX_LEG_MIN_MS = 180.0f;  // floor only (was 2800 — caused fake pauses)
constexpr float EX_LEG_MAX_MS = 1800.0f;
constexpr float EX_FLOOR_MIN_Z = 15.0f; // tip must stay above floor (mm)
constexpr uint8_t EX_REPS = 6;
constexpr uint8_t EX_KIND_BICEP = 0;
constexpr uint8_t EX_KIND_LATERAL = 1;
constexpr uint8_t EX_KIND_ELBOW = 2;

// Photo refs (2026-08-25) — matched to simulator Three.js chain (ud/fd/td).
// Bicep: sh135 fixed, elbow+wrist curl (V tip-down → W tip-up).
// Bicep: shoulder + elbow locked; wrist curls tip down ↔ tip up.
static const JointAngles EX_BC_DOWN = {90.0f, 120.0f, 170.0f, 180.0f};
static const JointAngles EX_BC_UP   = {90.0f, 120.0f, 170.0f,  25.0f};
// Lateral raise — ONLY user photo refs (docs/refs/lateral-*.png).
// Both photos = same L: sh 90 / el 180. Diff is wrist tip only.
//   tip OUT  → wr 90   {90, 90, 180, 90}
//   tip DOWN → wr 180  {90, 90, 180, 180}
// Shoulder + elbow LOCKED. Do NOT invent mid-waypoints / shoulder lead.
static const JointAngles EX_LAT_OUT  = {90.0f, 90.0f, 180.0f,  90.0f};
static const JointAngles EX_LAT_DOWN = {90.0f, 90.0f, 180.0f, 180.0f};
static const uint8_t EX_LAT_SEQ[] = {0, 1, 0}; // out → down → out
constexpr uint8_t EX_LAT_PEAK = 1;
// Elbow flex: shoulder locked at 0° (horizontal LEFT).
// Direct extend ↔ C-fold so elbow+wrist move together (fluid rehab).
static const JointAngles EX_EF_EXT  = {90.0f, 0.0f, 95.0f, 90.0f};
static const JointAngles EX_EF_PEAK = {90.0f, 0.0f, 180.0f, 180.0f};

static const uint8_t EX_BC_SEQ[] = {0, 1, 0};
static const uint8_t EX_EL_SEQ[] = {0, 1, 0}; // 0=ext, 1=peak — one continuous fold
// Last rep: ext→peak→ext→peak→HTL-4→HTL-5 (wp 2=HTL4, 3=HTL5)
static const uint8_t EX_EL_SEQ_LAST[] = {0, 1, 0, 1, 2, 3};

float exerciseTipZ(const JointAngles& a) {
    float x, y, z;
    fk_solve(a, x, y, z);
    return z;
}

JointAngles lerpAngles(const JointAngles& from, const JointAngles& to, float p) {
    JointAngles a;
    a.base     = from.base     + (to.base     - from.base)     * p;
    a.shoulder = from.shoulder + (to.shoulder - from.shoulder) * p;
    a.elbow    = from.elbow    + (to.elbow    - from.elbow)    * p;
    a.wrist    = from.wrist    + (to.wrist    - from.wrist)    * p;
    return a;
}

// If eased lerp dips below floor, back off u (binary search).
JointAngles safeExerciseLerp(const JointAngles& from, const JointAngles& to, float u) {
    float p = easeInOutCubic(u);  // S-curved progress — zero vel at leg endpoints
    JointAngles a = lerpAngles(from, to, p);
    if (exerciseTipZ(a) >= EX_FLOOR_MIN_Z) return a;

    float u_lo = 0.0f;
    float u_hi = u;
    for (uint8_t i = 0; i < 10; i++) {
        float u_mid = (u_lo + u_hi) * 0.5f;
        JointAngles mid = lerpAngles(from, to, easeInOutCubic(u_mid));
        if (exerciseTipZ(mid) >= EX_FLOOR_MIN_Z) u_lo = u_mid;
        else u_hi = u_mid;
    }
    return lerpAngles(from, to, easeInOutCubic(u_lo));
}
} // namespace

ProtocolRunner::ProtocolRunner(WritePwmCallback pwm_cb)
    : _write_pwm(pwm_cb),
      _mode(Mode::IDLE),
      _chain_after_home(Mode::IDLE),
      _chain_after_goto(Mode::IDLE),
      _home_phase(0),
      _goto_dps(25.0f),
      _goto_leg_ms(500.0f),
      _anim_t(0.0f),
      _phase_start_ms(0),
      _ex_kind(0),
      _ex_seq_i(0),
      _ex_rep(0),
      _ex_reps_target(EX_REPS),
      _ex_hold(0),
      _ex_gated(0),
      _cobra_max(0),
      _ex_leg_ms(2000.0f),
      _pending_pipeline(false),
      _pipe_x(0.0f),
      _pipe_y(0.0f),
      _pipe_z(0.0f),
      _pipe_pitch(0.0f),
      _orb_cx(150.0f),
      _orb_cz(180.0f),
      _orb_radius(32.0f),
      _orb_i(0),
      _orb_ready(false) {
    _cur_angles = {90.0f, 90.0f, 90.0f, 90.0f};
    _goto_target = _cur_angles;
    _pose_target = _cur_angles;
}

bool ProtocolRunner::isActive() const {
    return _mode != Mode::IDLE;
}

const char* ProtocolRunner::modeName() const {
    switch (_mode) {
        case Mode::SAFE_HOME: return "home";
        case Mode::GOTO_ANGLES: return "goto";
        case Mode::SNAKE: return "snake";
        case Mode::COBRA: return (_cobra_max == 0) ? "cobra" : "gimmefive";
        case Mode::ORBITAL: return "orbital";
        case Mode::HTL_RUN: return "htl";
        case Mode::EXERCISE:
            if (_ex_kind == EX_KIND_BICEP) return "bicep";
            if (_ex_kind == EX_KIND_LATERAL) return "lateral";
            return "elbowflex";
        default: return "idle";
    }
}

const JointAngles& ProtocolRunner::currentAngles() const {
    return _cur_angles;
}

void ProtocolRunner::applyAngles(const JointAngles& a) {
    _cur_angles = a;
    DeviceState::updateAngles(a);
    DeviceState::setMode(modeName());
    if (!_write_pwm) return;
    JointPwm pwm = angles_to_pwm(a);
    _write_pwm(joints::CH_BASE, pwm.base);
    _write_pwm(joints::CH_SHOULDER, pwm.shoulder);
    _write_pwm(joints::CH_ELBOW, pwm.elbow);
    _write_pwm(joints::CH_WRIST, pwm.wrist);
}

bool ProtocolRunner::stepToward(const JointAngles& target, uint32_t dt_ms, float max_deg_per_sec) {
    float max_step = max_deg_per_sec * (dt_ms / 1000.0f);
    JointAngles next = _cur_angles;

    auto stepJoint = [&](float& cur, float tgt) {
        float diff = tgt - cur;
        if (fabsf(diff) <= max_step) cur = tgt;
        else cur += (diff > 0.0f) ? max_step : -max_step;
    };

    stepJoint(next.base, target.base);
    stepJoint(next.shoulder, target.shoulder);
    stepJoint(next.elbow, target.elbow);
    stepJoint(next.wrist, target.wrist);
    if (nearAngles(next, target, 2.0f)) {
        applyAngles(target);
        return true;
    }
    applyAngles(next);
    return false;
}

void ProtocolRunner::beginSafeHome(Mode chain) {
    // Exact start = current commanded joints (PWM labels). No FK needed for home:
    // home is a joint hold, so the efficient path is joint-space step from here → home.
    _cur_angles = DeviceState::getAngles();
    _chain_after_home = chain;
    _home_phase = 0;
    _mode = Mode::SAFE_HOME;
    DeviceState::setMode("home");
    Serial.print(">>> protocol: home from b=");
    Serial.print(_cur_angles.base, 1);
    Serial.print(" sh="); Serial.print(_cur_angles.shoulder, 1);
    Serial.print(" el="); Serial.print(_cur_angles.elbow, 1);
    Serial.print(" wr="); Serial.println(_cur_angles.wrist, 1);
}

void ProtocolRunner::beginGoto(const JointAngles& target, Mode chain, float dps) {
    _cur_angles = DeviceState::getAngles();
    _goto_from = _cur_angles;
    _goto_target = target;
    _chain_after_goto = chain;
    _goto_dps = (dps < 8.0f) ? 8.0f : dps;
    float max_delta = fabsf(_goto_target.base - _goto_from.base);
    float d = fabsf(_goto_target.shoulder - _goto_from.shoulder);
    if (d > max_delta) max_delta = d;
    d = fabsf(_goto_target.elbow - _goto_from.elbow);
    if (d > max_delta) max_delta = d;
    d = fabsf(_goto_target.wrist - _goto_from.wrist);
    if (d > max_delta) max_delta = d;
    _goto_leg_ms = (max_delta / _goto_dps) * 1000.0f;
    if (_goto_leg_ms < 50.0f) _goto_leg_ms = 50.0f;
    _anim_t = 0.0f;
    _mode = Mode::GOTO_ANGLES;
    Serial.print(">>> protocol: goto synced @ ");
    Serial.print(_goto_dps, 0);
    Serial.println(" deg/s (limiting joint)");
}

void ProtocolRunner::beginSnake() {
    _anim_t = 0.0f;
    _mode = Mode::SNAKE;
    Serial.println(">>> protocol: snake");
}

void ProtocolRunner::beginCobra() {
    beginCobra(_cobra_max);
}

void ProtocolRunner::beginCobra(uint8_t max_strikes) {
    _cobra_max = max_strikes; // 0 = infinite loop
    _anim_t = 0.0f;
    _ex_rep = 0;
    _home_phase = 4; // wait 3s coiled before the first strike
    _mode = Mode::COBRA;
    if (_cobra_max == 0) {
        Serial.println(">>> protocol: cobra (loop until stop)");
    } else {
        Serial.println(">>> protocol: gimme five (1 strike -> home)");
    }
}

void ProtocolRunner::beginOrbital() {
    _anim_t = 0.0f;
    _orb_i = 0;
    if (!buildOrbitalPath()) {
        Serial.println(">>> orbital: path IK failed — abort");
        _mode = Mode::IDLE;
        DeviceState::setMode("idle");
        return;
    }
    _mode = Mode::ORBITAL;
    Serial.println(">>> protocol: orbital (96-pt joint path, slow)");
}

bool ProtocolRunner::buildOrbitalPath() {
    JointAngles prefer = _cur_angles;
    for (uint8_t i = 0; i < ORB_SAMPLES; i++) {
        float t = (2.0f * 3.14159265f * (float)i) / (float)ORB_SAMPLES;
        float x = _orb_cx;
        float y = _orb_radius * sinf(t);
        float z = _orb_cz + _orb_radius * cosf(t);
        JointAngles a;
        if (ik_solve(x, y, z, 0.0f, a, &prefer) != IkStatus::OK) {
            Serial.print(">>> orbital IK fail i=");
            Serial.println(i);
            _orb_ready = false;
            return false;
        }
        _orb_path[i] = a;
        prefer = a;
    }
    _orb_ready = true;
    return true;
}

void ProtocolRunner::onHomeComplete() {
    Mode chain = _chain_after_home;
    _chain_after_home = Mode::IDLE;
    if (chain == Mode::IDLE) {
        _mode = Mode::IDLE;
        DeviceState::setMode("idle");
        Serial.println(">>> protocol: home done");
        return;
    }
    if (chain == Mode::SNAKE) {
        beginSnake();
        return;
    }
    if (chain == Mode::COBRA) {
        beginGoto(COBRA_COIL, Mode::COBRA);
        return;
    }
    if (chain == Mode::ORBITAL) {
        _orb_cx = 150.0f;
        _orb_cz = 180.0f;
        _orb_radius = 32.0f;
        JointAngles start;
        if (ik_solve(_orb_cx, 0.0f, _orb_cz + _orb_radius, 0.0f, start, &_cur_angles) == IkStatus::OK) {
            beginGoto(start, Mode::ORBITAL_START, GOTO_DPS);
        } else {
            Serial.println(">>> orbital: start IK failed");
            _mode = Mode::IDLE;
            DeviceState::setMode("idle");
        }
        return;
    }
    if (chain == Mode::HTL) {
        beginHtlRun();
        return;
    }
    if (chain == Mode::PEND) {
        beginGoto(PEND_EXTEND, Mode::PEND_HOLD, GOTO_DPS);
        return;
    }
    if (chain == Mode::CPOSE) {
        // Locked by user on real arm + sim (manual deg boxes): open C.
        // Do NOT use Cartesian IK here — same tip has failed / confused paths before.
        beginGoto({90.0f, 55.0f, 155.0f, 150.0f}, Mode::IDLE, GOTO_DPS);
        return;
    }
    if (chain == Mode::TRANSPORT) {
        beginGoto({90.0f, 90.0f, 180.0f, 180.0f}, Mode::IDLE);
        return;
    }
    if (chain == Mode::POSE) {
        beginGoto(_pose_target, Mode::IDLE);
        return;
    }
    _mode = Mode::IDLE;
}

void ProtocolRunner::onGotoComplete() {
    Mode chain = _chain_after_goto;
    _chain_after_goto = Mode::IDLE;
    if (chain == Mode::COBRA) {
        beginCobra();
        return;
    }
    if (chain == Mode::ORBITAL_START) {
        beginOrbital();
        return;
    }
    if (chain == Mode::PEND_HOLD) {
        _anim_t = 0.0f;
        _mode = Mode::PEND_HOLD;
        Serial.println(">>> pendulum: hold 2s (elbow ready)");
        return;
    }
    if (chain == Mode::PEND_DOWN) {
        Serial.println(">>> pendulum: FAST up to 110/115 (inertia)");
        beginGoto(PEND_STOP_START, Mode::PEND_UP, PEND_UP_DPS);
        return;
    }
    if (chain == Mode::PEND_UP) {
        Serial.println(">>> pendulum: brake sh 110->100, el 115->105");
        beginGoto(PEND_MID, Mode::PEND_DECEL, PEND_DECEL_DPS);
        return;
    }
    if (chain == Mode::PEND_DECEL) {
        Serial.println(">>> pendulum: full stop sh 90, el 95");
        beginGoto(PEND_HOME, Mode::PEND_STOP, PEND_STOP_DPS);
        return;
    }
    if (chain == Mode::PEND_STOP) {
        _mode = Mode::IDLE;
        DeviceState::setMode("idle");
        Serial.println(">>> pendulum: done (stable home)");
        return;
    }
    _mode = Mode::IDLE;
    DeviceState::setMode("idle");
}

bool ProtocolRunner::startGoto(const JointAngles& target) {
    // Always safe-home first so joint moves never cut across weird poses.
    _cur_angles = DeviceState::getAngles();
    _pose_target = target;
    beginSafeHome(Mode::POSE);
    return true;
}

bool ProtocolRunner::start(const char* name) {
    if (!name || !name[0]) return false;

    if (strcmp(name, "stop") == 0) {
        stop();
        return true;
    }
    if (strcmp(name, "home") == 0) {
        beginSafeHome(Mode::IDLE);
        return true;
    }
    if (strcmp(name, "snake") == 0) {
        beginSafeHome(Mode::SNAKE);
        return true;
    }
    if (strcmp(name, "cobra") == 0) {
        _cobra_max = 0; // infinite loop
        beginSafeHome(Mode::COBRA);
        return true;
    }
    if (strcmp(name, "gimmefive") == 0 || strcmp(name, "gimme") == 0) {
        _cobra_max = GIMME_FIVE_STRIKES; // single strike then home
        beginSafeHome(Mode::COBRA);
        return true;
    }
    if (strcmp(name, "orbital") == 0) {
        beginSafeHome(Mode::ORBITAL);
        return true;
    }
    if (strcmp(name, "htl") == 0) {
        beginSafeHome(Mode::HTL);
        return true;
    }
    if (strcmp(name, "pendulum") == 0 || strcmp(name, "pend") == 0) {
        beginSafeHome(Mode::PEND);
        return true;
    }
    if (strcmp(name, "cpose") == 0 || strcmp(name, "c") == 0) {
        beginSafeHome(Mode::CPOSE);
        return true;
    }
    if (strcmp(name, "transport") == 0) {
        beginSafeHome(Mode::TRANSPORT);
        return true;
    }
    if (strcmp(name, "bicep") == 0 || strcmp(name, "bicepcurl") == 0) {
        beginExercise(EX_KIND_BICEP, EX_REPS);
        return true;
    }
    if (strcmp(name, "lateral") == 0 || strcmp(name, "raise") == 0) {
        beginExercise(EX_KIND_LATERAL, EX_REPS);
        return true;
    }
    if (strcmp(name, "elbowflex") == 0 || strcmp(name, "flexion") == 0 || strcmp(name, "elbow") == 0) {
        beginExercise(EX_KIND_ELBOW, EX_REPS);
        return true;
    }
    return false;
}

bool ProtocolRunner::startExercise(const char* name, uint8_t reps, bool gated) {
    if (reps < 1) reps = 1;
    if (reps > EX_REPS) reps = EX_REPS;
    if (strcmp(name, "bicep") == 0 || strcmp(name, "bicepcurl") == 0) {
        beginExercise(EX_KIND_BICEP, reps, gated);
        return true;
    }
    if (strcmp(name, "lateral") == 0 || strcmp(name, "raise") == 0) {
        beginExercise(EX_KIND_LATERAL, reps, gated);
        return true;
    }
    if (strcmp(name, "elbowflex") == 0 || strcmp(name, "flexion") == 0 || strcmp(name, "elbow") == 0) {
        beginExercise(EX_KIND_ELBOW, reps, gated);
        return true;
    }
    return false;
}

void ProtocolRunner::stop() {
    _mode = Mode::IDLE;
    _chain_after_home = Mode::IDLE;
    _chain_after_goto = Mode::IDLE;
    _pending_pipeline = false;
    _ex_hold = 0;
    DeviceState::clearExerciseProgress();
    DeviceState::setMode("idle");
    Serial.println(">>> protocol: stopped");
}

bool ProtocolRunner::takePendingPipeline(float& x, float& y, float& z, float& pitch_deg) {
    if (!_pending_pipeline) return false;
    _pending_pipeline = false;
    x = _pipe_x;
    y = _pipe_y;
    z = _pipe_z;
    pitch_deg = _pipe_pitch;
    return true;
}

void ProtocolRunner::updateSafeHome(uint32_t dt_ms) {
    const JointAngles home = {90.0f, 90.0f, 95.0f, 90.0f};

    if (nearAngles(_cur_angles, home, 2.0f)) {
        applyAngles(home);
        onHomeComplete();
        return;
    }

    // Direct joint-space path from wherever we are → home hold.
    // (Old 3-phase tuck looked weird mid-demo; Cartesian IK to home tip
    //  is worse because home has r≈0 base singularity.)
    if (stepToward(home, dt_ms, HOME_DPS)) {
        applyAngles(home);
        onHomeComplete();
    }
}

void ProtocolRunner::updateGoto(uint32_t dt_ms) {
    _anim_t += (float)dt_ms;
    float u = _anim_t / _goto_leg_ms;
    if (u > 1.0f) u = 1.0f;
    float p = easeInOutCubic(u);
    JointAngles a;
    a.base     = _goto_from.base     + (_goto_target.base     - _goto_from.base)     * p;
    a.shoulder = _goto_from.shoulder + (_goto_target.shoulder - _goto_from.shoulder) * p;
    a.elbow    = _goto_from.elbow    + (_goto_target.elbow    - _goto_from.elbow)    * p;
    a.wrist    = _goto_from.wrist    + (_goto_target.wrist    - _goto_from.wrist)    * p;
    applyAngles(a);
    if (u >= 1.0f) {
        applyAngles(_goto_target);
        _cur_angles = _goto_target;
        onGotoComplete();
    }
}

void ProtocolRunner::updateSnake(uint32_t dt_ms) {
    _anim_t += dt_ms * 0.0019f; // a bit faster
    JointAngles a;
    a.base = 90.0f + 20.0f * sinf(_anim_t * 0.5f);
    a.shoulder = 90.0f + 15.0f * sinf(_anim_t);
    a.elbow = 120.0f + 30.0f * sinf(_anim_t - 1.2f);
    a.wrist = 90.0f + 60.0f * sinf(_anim_t - 2.4f);
    stepToward(a, dt_ms, ANIM_DPS);
}

void ProtocolRunner::updateCobra(uint32_t dt_ms) {
    // Phases: 1=strike, 2=hold, 3=retract, 4=pause — then next strike or home after 5.
    _anim_t += (float)dt_ms;

    const JointAngles coil = COBRA_COIL;
    const JointAngles strike = COBRA_STRIKE;

    switch (_home_phase) {
        case 1: { // STRIKE — fast
            const float dur = COBRA_STRIKE_MS;
            float u = _anim_t / dur;
            if (u > 1.0f) u = 1.0f;
            float p = easeInOutCubic(u);
            JointAngles a;
            a.base = coil.base;
            a.shoulder = coil.shoulder + (strike.shoulder - coil.shoulder) * p;
            a.elbow = coil.elbow + (strike.elbow - coil.elbow) * p;
            a.wrist = coil.wrist + (strike.wrist - coil.wrist) * p;
            applyAngles(a);
            if (u >= 1.0f) {
                applyAngles(strike);
                _home_phase = 2;
                _anim_t = 0.0f;
            }
            break;
        }
        case 2: // brief bite hold
            applyAngles(strike);
            if (_anim_t >= 180.0f) {
                _home_phase = 3;
                _anim_t = 0.0f;
            }
            break;
        case 3: { // RETRACT — same duration/speed as strike
            const float dur = COBRA_STRIKE_MS;
            float u = _anim_t / dur;
            if (u > 1.0f) u = 1.0f;
            float p = easeInOutCubic(u);
            JointAngles a;
            a.base = strike.base;
            a.shoulder = strike.shoulder + (coil.shoulder - strike.shoulder) * p;
            a.elbow = strike.elbow + (coil.elbow - strike.elbow) * p;
            a.wrist = strike.wrist + (coil.wrist - strike.wrist) * p;
            applyAngles(a);
            if (u >= 1.0f) {
                applyAngles(coil);
                _ex_rep++;
                if (_cobra_max == 0) {
                    Serial.print(">>> cobra: strike #");
                    Serial.println(_ex_rep);
                    _home_phase = 4;
                    _anim_t = 0.0f;
                    Serial.println(">>> cobra: pause 3s");
                } else {
                    Serial.print(">>> gimme five: strike ");
                    Serial.print(_ex_rep);
                    Serial.print('/');
                    Serial.println(_cobra_max);
                    if (_ex_rep >= _cobra_max) {
                        Serial.println(">>> gimme five: done -> home");
                        beginSafeHome(Mode::IDLE);
                        return;
                    }
                    _home_phase = 4;
                    _anim_t = 0.0f;
                    Serial.println(">>> gimme five: pause 3s");
                }
            }
            break;
        }
        case 4:
            applyAngles(coil);
            if (_anim_t >= COBRA_PAUSE_MS) {
                _home_phase = 1;
                _anim_t = 0.0f;
                Serial.println((_cobra_max == 0) ? ">>> cobra: STRIKE" : ">>> gimme five: STRIKE");
            }
            break;
        default:
            _home_phase = 1;
            _anim_t = 0.0f;
            break;
    }
}

void ProtocolRunner::updateOrbital(uint32_t dt_ms) {
    if (!_orb_ready) {
        _mode = Mode::IDLE;
        return;
    }
    // Advance waypoint only when we actually arrive — never skip ahead.
    if (stepToward(_orb_path[_orb_i], dt_ms, ORB_DPS)) {
        _orb_i = (uint8_t)((_orb_i + 1) % ORB_SAMPLES);
    }
}

void ProtocolRunner::beginHtlRunRoute(const JointAngles* const* route, uint8_t n_segs) {
    _cur_angles = DeviceState::getAngles();
    _htl_start = _cur_angles;
    _htl_route = route;
    _htl_n_segs = n_segs;
    JointAngles from = _htl_start;
    float t = 0.0f;
    for (uint8_t i = 0; i < n_segs; i++) {
        const JointAngles& to = *route[i];
        float max_d = maxJointDelta(from, to);
        float ms = (max_d / HTL_DPS) * 1000.0f;
        if (ms < 50.0f) ms = 50.0f;
        _htl_seg_ms[i] = ms;
        t += ms;
        _htl_time_end[i] = t;
        from = to;
    }
    _htl_total_ms = t;
    _anim_t = 0.0f;
    _mode = Mode::HTL_RUN;
    DeviceState::setMode("htl");
}

void ProtocolRunner::beginHtlRun() {
    beginHtlRunRoute(HTL_WPS, 5);
    Serial.println(">>> htl: continuous (5 wp, synced, no stops)");
}

void ProtocolRunner::updateHtlRun(uint32_t dt_ms) {
    _anim_t += (float)dt_ms;
    const JointAngles& home = *_htl_route[_htl_n_segs - 1];
    if (_anim_t >= _htl_total_ms) {
        applyAngles(home);
        _cur_angles = home;
        _mode = Mode::IDLE;
        DeviceState::setMode("idle");
        Serial.println(">>> htl: done (home)");
        return;
    }
    uint8_t seg = 0;
    while (seg < _htl_n_segs - 1 && _anim_t >= _htl_time_end[seg]) seg++;
    float seg_t0 = (seg == 0) ? 0.0f : _htl_time_end[seg - 1];
    float u = (_anim_t - seg_t0) / _htl_seg_ms[seg];
    if (u > 1.0f) u = 1.0f;
    JointAngles from = (seg == 0) ? _htl_start : *_htl_route[seg - 1];
    const JointAngles& to = *_htl_route[seg];
    applyAngles(lerpAnglesLinear(from, to, u));
}

void ProtocolRunner::updatePendHold(uint32_t dt_ms) {
    applyAngles(PEND_EXTEND);
    _anim_t += (float)dt_ms;
    if (_anim_t >= 2000.0f) {
        Serial.println(">>> pendulum: DOWN");
        beginGoto(PEND_BOTTOM, Mode::PEND_DOWN, PEND_DOWN_DPS);
    }
}

const JointAngles& ProtocolRunner::exerciseWaypoint(uint8_t kind, uint8_t wp) const {
    if (kind == EX_KIND_BICEP) {
        if (wp == 0) return EX_BC_DOWN;
        return EX_BC_UP;
    }
    if (kind == EX_KIND_LATERAL) {
        if (wp == 0) return EX_LAT_OUT;
        return EX_LAT_DOWN;
    }
    if (wp == 0) return EX_EF_EXT;
    if (wp == 1) return EX_EF_PEAK;
    if (wp == 2) return HTL_WP4;
    return HTL_WP5;
}

uint8_t ProtocolRunner::exerciseStep(uint8_t kind, uint8_t seq_i) const {
    if (kind == EX_KIND_BICEP) return EX_BC_SEQ[seq_i];
    if (kind == EX_KIND_LATERAL) return EX_LAT_SEQ[seq_i];
    if (kind == EX_KIND_ELBOW && _ex_rep == _ex_reps_target - 1) {
        return EX_EL_SEQ_LAST[seq_i];
    }
    return EX_EL_SEQ[seq_i];
}

uint8_t ProtocolRunner::exerciseSeqLen(uint8_t kind) const {
    if (kind == EX_KIND_BICEP) return (uint8_t)(sizeof(EX_BC_SEQ));
    if (kind == EX_KIND_LATERAL) return (uint8_t)(sizeof(EX_LAT_SEQ));
    if (kind == EX_KIND_ELBOW && _ex_rep == _ex_reps_target - 1) {
        return (uint8_t)(sizeof(EX_EL_SEQ_LAST));
    }
    return (uint8_t)(sizeof(EX_EL_SEQ));
}

uint8_t ProtocolRunner::exercisePeakWp(uint8_t kind) const {
    if (kind == EX_KIND_BICEP) return 1;
    if (kind == EX_KIND_LATERAL) return EX_LAT_PEAK;
    return 1;
}

bool ProtocolRunner::exerciseStepIsPeak(uint8_t kind, uint8_t seq_i) const {
    return exerciseStep(kind, seq_i) == exercisePeakWp(kind);
}

void ProtocolRunner::startExerciseLeg() {
    for (uint8_t guard = 0; guard < 12; guard++) {
        _ex_from = _cur_angles;
        _goto_target = exerciseWaypoint(_ex_kind, exerciseStep(_ex_kind, _ex_seq_i));
        float max_delta = fabsf(_goto_target.base - _ex_from.base);
        float d = fabsf(_goto_target.shoulder - _ex_from.shoulder);
        if (d > max_delta) max_delta = d;
        d = fabsf(_goto_target.elbow - _ex_from.elbow);
        if (d > max_delta) max_delta = d;
        d = fabsf(_goto_target.wrist - _ex_from.wrist);
        if (d > max_delta) max_delta = d;

        if (max_delta >= 0.5f) {
            float ms = (max_delta / EX_REHAB_DPS) * 1000.0f;
            if (ms < EX_LEG_MIN_MS) ms = EX_LEG_MIN_MS;
            if (ms > EX_LEG_MAX_MS) ms = EX_LEG_MAX_MS;
            _ex_leg_ms = ms;
            _anim_t = 0.0f;
            syncExerciseTelemetry();
            return;
        }

        // Already at this waypoint — skip without a timed pause (common at rep boundaries).
        _ex_seq_i++;
        if (_ex_seq_i >= exerciseSeqLen(_ex_kind)) {
            _ex_rep++;
            if (_ex_rep >= _ex_reps_target) {
                finishExercise();
                return;
            }
            _ex_seq_i = 0;
            if (_ex_gated) {
                _ex_hold = 1;
                Serial.print(">>> exercise: rep ");
                Serial.print(_ex_rep);
                Serial.print('/');
                Serial.println(_ex_reps_target);
                Serial.println(">>> exercise: hold — waiting for advance");
                syncExerciseTelemetry();
                return;
            }
            Serial.print(">>> exercise: rep ");
            Serial.print(_ex_rep + 1);
            Serial.print('/');
            Serial.println(_ex_reps_target);
            syncExerciseTelemetry();
        }
    }
    beginSafeHome(Mode::IDLE);
}

void ProtocolRunner::syncExerciseTelemetry() {
    if (_mode != Mode::EXERCISE) {
        DeviceState::clearExerciseProgress();
        return;
    }
    uint8_t steps = exerciseSeqLen(_ex_kind);
    if (steps == 0) steps = 1;
    if (_ex_hold) {
        // Between reps: ex_leg < 0 signals Python to wait for wearable rep_end.
        DeviceState::setExerciseProgress(_ex_rep, 0, steps, -1.0f, _ex_reps_target);
        return;
    }
    float leg = 0.0f;
    if (_ex_leg_ms > 0.0f) {
        leg = _anim_t / _ex_leg_ms;
        if (leg > 1.0f) leg = 1.0f;
    }
    DeviceState::setExerciseProgress(_ex_rep + 1, _ex_seq_i + 1, steps, leg, _ex_reps_target);
}

void ProtocolRunner::finishExercise() {
    _ex_hold = 0;
    DeviceState::clearExerciseProgress();
    Serial.println(">>> exercise: done -> home");
    beginSafeHome(Mode::IDLE);
}

void ProtocolRunner::exerciseAdvance() {
    if (_mode != Mode::EXERCISE || !_ex_hold) return;
    _ex_hold = 0;
    _ex_seq_i = 0;
    Serial.print(">>> exercise: advance rep ");
    Serial.print(_ex_rep + 1);
    Serial.print('/');
    Serial.println(_ex_reps_target);
    startExerciseLeg();
    syncExerciseTelemetry();
}

void ProtocolRunner::beginExercise(uint8_t kind, uint8_t reps, bool gated) {
    if (reps < 1) reps = 1;
    if (reps > EX_REPS) reps = EX_REPS;
    _ex_kind = kind;
    _ex_reps_target = reps;
    _ex_rep = 0;
    _ex_seq_i = 0;
    _ex_hold = 0;
    _ex_gated = gated ? 1 : 0;
    _cur_angles = DeviceState::getAngles();
    _mode = Mode::EXERCISE;
    DeviceState::setMode(modeName());
    startExerciseLeg();
    syncExerciseTelemetry();
    Serial.print(">>> exercise: ");
    if (kind == EX_KIND_BICEP) Serial.print("bicep curl");
    else if (kind == EX_KIND_LATERAL) Serial.print("lateral raise");
    else Serial.print("elbow flexion");
    Serial.print(" x");
    Serial.println(reps);
}

void ProtocolRunner::updateExercise(uint32_t dt_ms) {
    if (_ex_hold) return;

    _anim_t += (float)dt_ms;
    float u = _anim_t / _ex_leg_ms;
    if (u > 1.0f) u = 1.0f;

    JointAngles a = safeExerciseLerp(_ex_from, _goto_target, u);
    applyAngles(a);
    syncExerciseTelemetry();

    if (u < 1.0f) return;

    applyAngles(_goto_target);
    _cur_angles = _goto_target;

    _ex_seq_i++;
    if (_ex_seq_i >= exerciseSeqLen(_ex_kind)) {
        _ex_rep++;
        if (_ex_rep >= _ex_reps_target) {
            finishExercise();
            return;
        }
        _ex_seq_i = 0;
        if (_ex_gated) {
            _ex_hold = 1;
            Serial.print(">>> exercise: rep ");
            Serial.print(_ex_rep);
            Serial.print('/');
            Serial.println(_ex_reps_target);
            Serial.println(">>> exercise: hold — waiting for advance");
            syncExerciseTelemetry();
            return;
        }
        Serial.print(">>> exercise: rep ");
        Serial.print(_ex_rep + 1);
        Serial.print('/');
        Serial.println(_ex_reps_target);
        syncExerciseTelemetry();
    }
    startExerciseLeg();
}

void ProtocolRunner::update(uint32_t dt_ms, uint32_t /*now_ms*/) {
    if (_mode == Mode::IDLE) return;

    switch (_mode) {
        case Mode::SAFE_HOME: updateSafeHome(dt_ms); break;
        case Mode::GOTO_ANGLES: updateGoto(dt_ms); break;
        case Mode::SNAKE: updateSnake(dt_ms); break;
        case Mode::COBRA: updateCobra(dt_ms); break;
        case Mode::ORBITAL: updateOrbital(dt_ms); break;
        case Mode::PEND_HOLD: updatePendHold(dt_ms); break;
        case Mode::HTL_RUN: updateHtlRun(dt_ms); break;
        case Mode::EXERCISE: updateExercise(dt_ms); break;
        default: _mode = Mode::IDLE; break;
    }
}
