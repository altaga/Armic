#pragma once

#include <stdint.h>
#include "kinematics.h"

typedef void (*WritePwmCallback)(uint8_t channel, uint16_t pwm);

// Joint-space and IK demo protocols — all math runs on the ESP32.
class ProtocolRunner {
public:
    explicit ProtocolRunner(WritePwmCallback pwm_cb);

    bool start(const char* name);
    bool startExercise(const char* name, uint8_t reps, bool gated = false);
    bool startGoto(const JointAngles& target);
    void exerciseAdvance();
    void stop();
    bool isActive() const;
    const char* modeName() const;
    const JointAngles& currentAngles() const;

    void update(uint32_t dt_ms, uint32_t now_ms);

    /** After home, run Cartesian pipeline (e.g. C pose via IK). */
    bool takePendingPipeline(float& x, float& y, float& z, float& pitch_deg);

private:
    enum class Mode {
        IDLE,
        SAFE_HOME,
        GOTO_ANGLES,
        SNAKE,
        COBRA,
        ORBITAL,
        HTL_RUN,     // active: one continuous pass through all HTL waypoints
        // Chain markers (never assigned to _mode directly):
        HTL,
        PEND,
        PEND_HOLD,   // hold extended for 2s
        PEND_DOWN,   // elbow dump
        PEND_UP,     // fast inertia until stop-start (sh 110 / el 115)
        PEND_DECEL,  // first brake: toward home
        PEND_STOP,   // final brake to stable home (sh 90 / el 95), full stop
        ORBITAL_START, // after goto circle entry point
        POSE,       // after home → goto _pose_target
        CPOSE,      // after home → C pose joints
        TRANSPORT,  // after home → transport joints
        EXERCISE,   // active: photo-ref waypoints × reps → stable home
    };

    WritePwmCallback _write_pwm;
    Mode _mode;
    Mode _chain_after_home;
    Mode _chain_after_goto;

    JointAngles _cur_angles;
    JointAngles _goto_from;
    JointAngles _goto_target;
    JointAngles _pose_target;
    uint8_t _home_phase;
    float _goto_dps;
    float _goto_leg_ms;

    static constexpr uint8_t HTL_SEGS_MAX = 5;
    JointAngles _htl_start;
    const JointAngles* const* _htl_route;
    uint8_t _htl_n_segs;
    float _htl_seg_ms[HTL_SEGS_MAX];
    float _htl_time_end[HTL_SEGS_MAX];
    float _htl_total_ms;

    float _anim_t;
    uint32_t _phase_start_ms;

    uint8_t _ex_kind;   // 0=bicep, 1=lateral, 2=elbow flexion
    uint8_t _ex_seq_i;  // index into step sequence
    uint8_t _ex_rep;
    uint8_t _ex_reps_target;
    uint8_t _ex_hold;   // 1 = between reps, waiting advance (gated routes only)
    uint8_t _ex_gated;  // 1 = pause between reps for wearable/MQTT
    uint8_t _cobra_max; // 0 = cobra loop forever; 1 = gimme five
    JointAngles _ex_from; // start of current synced leg
    float _ex_leg_ms;   // duration of current synced leg

    bool _pending_pipeline;
    float _pipe_x;
    float _pipe_y;
    float _pipe_z;
    float _pipe_pitch;

    float _orb_cx;
    float _orb_cz;
    float _orb_radius;
    static constexpr uint8_t ORB_SAMPLES = 96;
    JointAngles _orb_path[ORB_SAMPLES];
    uint8_t _orb_i;
    bool _orb_ready;

    bool buildOrbitalPath();

    void applyAngles(const JointAngles& a);
    bool stepToward(const JointAngles& target, uint32_t dt_ms, float max_deg_per_sec = 45.0f);
    void beginSafeHome(Mode chain = Mode::IDLE);
    void beginGoto(const JointAngles& target, Mode chain = Mode::IDLE, float dps = 55.0f);
    void beginSnake();
    void beginCobra();
    void beginCobra(uint8_t max_strikes); // 0 = infinite loop
    void beginOrbital();
    void beginExercise(uint8_t kind, uint8_t reps, bool gated = false);
    void finishExercise();
    void startExerciseLeg();
    const JointAngles& exerciseWaypoint(uint8_t kind, uint8_t wp) const;
    uint8_t exerciseStep(uint8_t kind, uint8_t seq_i) const;
    uint8_t exerciseSeqLen(uint8_t kind) const;
    bool exerciseStepIsPeak(uint8_t kind, uint8_t seq_i) const;
    uint8_t exercisePeakWp(uint8_t kind) const;
    void syncExerciseTelemetry();
    void updateSafeHome(uint32_t dt_ms);
    void updateGoto(uint32_t dt_ms);
    void updateSnake(uint32_t dt_ms);
    void updateCobra(uint32_t dt_ms);
    void updateOrbital(uint32_t dt_ms);
    void updatePendHold(uint32_t dt_ms);
    void beginHtlRun();
    void beginHtlRunRoute(const JointAngles* const* route, uint8_t n_segs);
    void updateHtlRun(uint32_t dt_ms);
    void updateExercise(uint32_t dt_ms);
    void onHomeComplete();
    void onGotoComplete();
};
