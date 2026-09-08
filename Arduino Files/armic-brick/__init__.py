# SPDX-FileCopyrightText: Armic project
#
# SPDX-License-Identifier: MPL-2.0
"""Armic — reusable control layer for the 4DOF rehab arm.

This Brick is the MPU-side API for the arm. It owns no motion logic: inverse
kinematics, trajectory planning, S-curve profiling, joint limits, the e-stop and
the 100 Hz control loop all live in the MCU firmware (``sketch/``), because
Linux is not a real-time OS and safety must not depend on this process being
alive. Everything here is command dispatch, telemetry fan-out and calibration
bookkeeping.

CALIBRATION MODEL
    ``calibration.json`` next to this file is the single source of truth. The
    firmware's ``joints::`` variables are runtime-mutable and get pushed from
    here at boot; the browser fetches the same values over ``/api/calibration``
    so the simulator's own tables cannot drift out of sync.

    Edits are STAGED. ``stage()`` mutates only a working copy — nothing reaches
    the arm or the file. ``commit()`` pushes to firmware, reads back to confirm,
    and only then persists. So the file can never claim calibration the arm is
    not actually using, and a bad session is always recoverable with
    ``restore_defaults()``.

TELEMETRY CONTRACT
    The MCU sends ``notify("state", mode, values)`` at 20 Hz. ``values`` is a
    flat list of floats whose order is fixed by ``DeviceState.cpp`` — see
    ``_STATE_FIELDS``. Keep the two in lockstep.
"""

import json
import os
import threading
import time

from arduino.app_utils import Bridge, Logger, brick

logger = Logger("armic")

# Index order of the float vector sent by DeviceState::maybeEmitTelemetry.
# MUST match sketch/DeviceState.cpp exactly.
_STATE_FIELDS = (
    "base", "shoulder", "elbow", "wrist",
    "pwm_base", "pwm_shoulder", "pwm_elbow", "pwm_wrist",
    "strain_shoulder", "strain_elbow", "strain_wrist",
    "manipulability", "watts", "payload", "claw", "loaded",
    "ex_rep", "ex_step", "ex_steps", "ex_leg", "ex_total",
)

PROTOCOLS = (
    "home", "cpose", "transport", "snake", "cobra",
    "gimmefive", "orbital", "htl", "pendulum",
)
EXERCISES = ("bicep", "lateral", "elbowflex")

# Channel order — the index IS the PCA9685 channel.
JOINT_NAMES = ("base", "shoulder", "elbow", "wrist", "gripper")

# Payload order for cal_set / cal_get. MUST match sketch.ino.
_CAL_KEYS = ("pwm_min", "pwm_mid", "pwm_max", "ang_min", "ang_max", "dir", "offset")

# ---------------------------------------------------------------------------
# PROJECT DEFAULTS — the measured calibration of this specific arm.
# Mirrored in sketch/kinematics.cpp; keep the two in sync. "Restore defaults"
# returns to exactly these numbers, so a bad calibration session never needs a
# firmware rebuild to recover from.
#
# For the gripper, ang_* are percent-open bounds and dir/offset are unused.
# ---------------------------------------------------------------------------
DEFAULT_CALIBRATION = {
    "base":     {"pwm_min": 100, "pwm_mid": 300, "pwm_max": 500,
                 "ang_min": 0.0,  "ang_max": 180.0, "dir":  1, "offset": 0.0},
    "shoulder": {"pwm_min":  90, "pwm_mid": 290, "pwm_max": 490,
                 "ang_min": 0.0,  "ang_max": 180.0, "dir": -1, "offset": 0.0},
    # Elbow is restricted to [90,180] by design: 90 deg is straight, and below
    # it the forearm would fold forward past alignment with the upper arm.
    "elbow":    {"pwm_min": 100, "pwm_mid": 300, "pwm_max": 500,
                 "ang_min": 90.0, "ang_max": 180.0, "dir":  1, "offset": 0.0},
    "wrist":    {"pwm_min": 100, "pwm_mid": 300, "pwm_max": 500,
                 "ang_min": 0.0,  "ang_max": 180.0, "dir": -1, "offset": 0.0},
    "gripper":  {"pwm_min": 236, "pwm_mid": 338, "pwm_max": 440,
                 "ang_min": 0.0,  "ang_max": 100.0, "dir":  1, "offset": 0.0},
}

_HERE = os.path.dirname(os.path.abspath(__file__))
CAL_PATH = os.path.join(_HERE, "calibration.json")
GRIPPER_STATE_PATH = os.path.join(_HERE, "gripper_state.json")
LEGACY_LIMITS_PATH = os.path.join(_HERE, "limits.json")

# Absolute envelope, mirrored from config.h. Kept here only to fail fast with a
# clear message; the firmware enforces it regardless of what we send.
PWM_FLOOR_HARD = 50
PWM_CEIL_HARD = 600


def _env_bool(name, default=False):
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_float(name, default):
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning(f"{name}={raw!r} is not a number, using {default}")
        return default


def _env_int(name, default):
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw, 0)  # base 0 so "0x40" works
    except ValueError:
        logger.warning(f"{name}={raw!r} is not an integer, using {default}")
        return default


@brick
class Armic:
    """Command, telemetry and calibration API for the arm.

    Commands return True on success and False if the firmware declined (for
    example a Cartesian target sent while a protocol is running). A False return
    is a normal outcome, not an error.
    """

    def __init__(self):
        self.pca_addr = _env_int("ARMIC_PCA9685_ADDR", 0x40)
        self.dry_run_default = _env_bool("ARMIC_DRY_RUN_DEFAULT", True)
        self.payload_default = _env_float("ARMIC_PAYLOAD_KG_DEFAULT", 0.0)
        self.park_on_start = _env_bool("ARMIC_PARK_ON_START", True)
        self.log_state = _env_bool("ARMIC_LOG_STATE", False)

        self._subscribers = []
        self._lock = threading.Lock()
        self._last_state = None
        self._alive = False
        self._bridge_ping_ok = False
        self._pca_present = False
        self._last_heartbeat_ok_at = 0.0
        self._last_state_at = 0.0

        self.calibration = self._load_calibration()   # committed, on-arm values
        self._staged = None                           # working copy, or None

    # ---- lifecycle ---------------------------------------------------------
    def start(self):
        Bridge.provide("state", self._on_state)

        if not self._healthcheck():
            logger.warning(
                "Arm firmware did not answer. Commands will fail until the MCU "
                "is up — check `arduino-app-cli monitor`."
            )
            return

        # Push calibration BEFORE anything can move, so the first motion already
        # uses the stored mapping rather than the compiled-in defaults.
        self._push_calibration()
        if self._verify_calibration() and not os.path.exists(CAL_PATH):
            self._save_calibration()
            logger.info(f"wrote default calibration to {CAL_PATH}")

        self.dry_run(self.dry_run_default)
        if self.payload_default:
            self.payload(self.payload_default)
        saved_claw = self._load_gripper_state()
        if self.park_on_start:
            self._call("home_park")
        if saved_claw is not None:
            self.gripper(saved_claw)
            logger.info(f"restored claw to {saved_claw:.0f}%")
        self._alive = True
        logger.info(
            f"Armic ready (dry_run={self.dry_run_default}, "
            f"payload={self.payload_default} kg, heartbeat 2Hz)"
        )

    def stop(self):
        try:
            self.estop()
        except Exception as exc:
            logger.warning(f"estop during shutdown failed: {exc}")

    def loop(self):
        """Heartbeat for the firmware watchdog.

        The MCU halts motion if it hears nothing from us for WATCHDOG_MS, which
        is what makes the arm safe if this process is killed mid-motion. That
        only works if we actually beat — otherwise ordinary quiet between user
        commands looks identical to a crash, and every protocol longer than the
        timeout gets cut short.
        """
        if not self._alive:
            time.sleep(1.0)
            return
        try:
            Bridge.call("heartbeat")
            self._last_heartbeat_ok_at = time.monotonic()
        except Exception as exc:
            logger.warning(f"heartbeat failed ({type(exc).__name__}): {exc}")
            time.sleep(1.0)
            return
        time.sleep(0.5)

    def _healthcheck(self):
        try:
            reply = Bridge.call("ping", "armic")
        except Exception as exc:
            logger.warning(f"MCU ping failed ({type(exc).__name__}): {exc}")
            self._bridge_ping_ok = False
            return False
        self._bridge_ping_ok = True
        logger.info(f"MCU ping -> {reply!r}")
        try:
            self._pca_present = bool(Bridge.call("i2c_probe", self.pca_addr))
            if self._pca_present:
                logger.info(f"PCA9685 present at 0x{self.pca_addr:02X}")
            else:
                logger.warning(
                    f"PCA9685 NOT responding at 0x{self.pca_addr:02X} — the arm "
                    "will not move. Check the driver's logic power and I2C wiring."
                )
        except Exception as exc:
            self._pca_present = False
            logger.warning(f"i2c probe failed: {exc}")
        return True

    def bridge_sanity(self) -> dict:
        """Router Bridge / MCU link health for the dashboard."""
        now = time.monotonic()
        if not self._bridge_ping_ok:
            return {
                "status": "err",
                "detail": "MCU ping failed",
                "ping": False,
                "telemetry_age_s": None,
                "heartbeat_age_s": None,
                "pca_present": self._pca_present,
            }
        if not self._alive:
            return {
                "status": "warn",
                "detail": "Bridge starting",
                "ping": True,
                "telemetry_age_s": None,
                "heartbeat_age_s": None,
                "pca_present": self._pca_present,
            }

        state_age = now - self._last_state_at if self._last_state_at else None
        hb_age = now - self._last_heartbeat_ok_at if self._last_heartbeat_ok_at else None
        issues: list[str] = []
        status = "ok"

        if state_age is None or state_age > 2.5:
            status = "err" if state_age is None or state_age > 8.0 else "warn"
            issues.append("telemetry stale" if state_age else "no telemetry")
        if hb_age is None or hb_age > 3.0:
            if hb_age is None or hb_age > 10.0:
                status = "err"
            elif status != "err":
                status = "warn"
            issues.append("heartbeat stale" if hb_age else "no heartbeat")
        if not self._pca_present:
            if status == "ok":
                status = "warn"
            issues.append("PCA9685 missing")

        if status == "ok":
            detail = "MCU linked · telemetry live"
        else:
            detail = " · ".join(issues)

        return {
            "status": status,
            "detail": detail,
            "ping": True,
            "telemetry_age_s": round(state_age, 2) if state_age is not None else None,
            "heartbeat_age_s": round(hb_age, 2) if hb_age is not None else None,
            "pca_present": self._pca_present,
        }

    # ---- calibration store -------------------------------------------------
    def _load_calibration(self):
        cal = {n: dict(v) for n, v in DEFAULT_CALIBRATION.items()}

        path = CAL_PATH
        if not os.path.exists(path) and os.path.exists(LEGACY_LIMITS_PATH):
            # One-time migration from the older limits.json, which had no
            # dir/offset and used a different key order.
            logger.info("migrating legacy limits.json into calibration")
            path = LEGACY_LIMITS_PATH
        if not os.path.exists(path):
            logger.info("no calibration.json yet — using project defaults")
            return cal

        try:
            with open(path, "r") as fh:
                stored = json.load(fh)
        except (OSError, ValueError) as exc:
            logger.warning(f"{path} unreadable ({exc}) — using project defaults")
            return cal

        for name in JOINT_NAMES:
            entry = stored.get(name)
            if not isinstance(entry, dict):
                continue
            for key in _CAL_KEYS:
                if key not in entry:
                    continue
                try:
                    cal[name][key] = float(entry[key])
                except (TypeError, ValueError):
                    logger.warning(f"{name}.{key} is not a number — kept default")
        logger.info(f"loaded calibration from {path}")
        return cal

    def _save_calibration(self):
        try:
            with open(CAL_PATH, "w") as fh:
                json.dump(self.calibration, fh, indent=2, sort_keys=True)
                fh.write("\n")
            return True
        except OSError as exc:
            logger.warning(f"could not persist calibration.json: {exc}")
            return False

    def _load_gripper_state(self):
        if not os.path.exists(GRIPPER_STATE_PATH):
            return None
        try:
            with open(GRIPPER_STATE_PATH, "r") as fh:
                data = json.load(fh)
            pct = float(data.get("pct", data.get("claw", 100.0)))
        except (OSError, ValueError, TypeError) as exc:
            logger.warning(f"{GRIPPER_STATE_PATH} unreadable ({exc}) — using default claw")
            return None
        return max(0.0, min(100.0, pct))

    def _save_gripper_state(self, pct):
        pct = max(0.0, min(100.0, float(pct)))
        try:
            with open(GRIPPER_STATE_PATH, "w") as fh:
                json.dump({"pct": pct}, fh, indent=2, sort_keys=True)
                fh.write("\n")
            return True
        except OSError as exc:
            logger.warning(f"could not persist gripper_state.json: {exc}")
            return False

    def _push_calibration(self):
        """Send every channel's calibration to the firmware."""
        rejected = []
        for ch, name in enumerate(JOINT_NAMES):
            v = self.calibration[name]
            if not self._call("cal_set", ch, [float(v[k]) for k in _CAL_KEYS]):
                rejected.append(name)
        if rejected:
            logger.warning(f"firmware rejected calibration for: {', '.join(rejected)}")
        else:
            logger.info(f"calibration pushed for {len(JOINT_NAMES)} channels")
        return rejected

    def firmware_calibration(self):
        """Read calibration back from the MCU — the authoritative view."""
        out = {}
        for ch, name in enumerate(JOINT_NAMES):
            v = self._call("cal_get", ch)
            if isinstance(v, (list, tuple)) and len(v) >= len(_CAL_KEYS):
                out[name] = dict(zip(_CAL_KEYS, [float(x) for x in v]))
        return out

    def _verify_calibration(self):
        """Confirm the firmware actually holds what we think it does."""
        actual = self.firmware_calibration()
        if not actual:
            logger.warning("could not read calibration back from the MCU")
            return False
        drift = []
        for name in JOINT_NAMES:
            want, got = self.calibration.get(name), actual.get(name)
            if not got:
                drift.append(f"{name}: no reply")
                continue
            for key in _CAL_KEYS:
                if name == "gripper" and key in ("dir", "offset"):
                    continue        # not stored for the gripper
                if abs(float(want[key]) - float(got[key])) > 0.01:
                    drift.append(f"{name}.{key} stored={want[key]} firmware={got[key]}")
        if drift:
            logger.warning("calibration mismatch -> " + "; ".join(drift))
            return False
        logger.info("calibration verified against firmware")
        return True

    # ---- calibration API (staging) -----------------------------------------
    def get_calibration(self):
        """Committed calibration — what the arm is actually using."""
        return {n: dict(v) for n, v in self.calibration.items()}

    def get_staged(self):
        """Working copy if there are uncommitted edits, else None."""
        if self._staged is None:
            return None
        return {n: dict(v) for n, v in self._staged.items()}

    def is_dirty(self):
        return self._staged is not None

    def stage(self, joint, **fields):
        """Edit the working copy only. Nothing is sent to the arm or saved.

            arm.stage("shoulder", pwm_mid=295, dir=-1)
        """
        if joint not in DEFAULT_CALIBRATION:
            logger.warning(f"unknown joint {joint!r}")
            return False
        unknown = set(fields) - set(_CAL_KEYS)
        if unknown:
            logger.warning(f"unknown calibration keys: {', '.join(sorted(unknown))}")
            return False

        if self._staged is None:
            self._staged = {n: dict(v) for n, v in self.calibration.items()}

        for key, value in fields.items():
            try:
                self._staged[joint][key] = float(value)
            except (TypeError, ValueError):
                logger.warning(f"{joint}.{key}={value!r} is not a number")
                return False

        ok, why = self._validate(joint, self._staged[joint])
        if not ok:
            logger.warning(f"staged {joint} is invalid: {why}")
        return True

    def _validate(self, joint, v):
        """Local pre-check so the UI can show a reason before committing.

        The firmware validates again and is the real authority.
        """
        try:
            pmin, pmid, pmax = float(v["pwm_min"]), float(v["pwm_mid"]), float(v["pwm_max"])
            amin, amax = float(v["ang_min"]), float(v["ang_max"])
            d, off = float(v["dir"]), float(v["offset"])
        except (KeyError, TypeError, ValueError) as exc:
            return False, f"missing or non-numeric field: {exc}"

        if not (PWM_FLOOR_HARD <= pmin < pmid < pmax <= PWM_CEIL_HARD):
            return False, (f"need {PWM_FLOOR_HARD} <= pwm_min < pwm_mid < pwm_max "
                           f"<= {PWM_CEIL_HARD}, got {pmin}/{pmid}/{pmax}")
        ceil = 100.0 if joint == "gripper" else 180.0
        if not (0.0 <= amin < amax <= ceil):
            return False, f"need 0 <= ang_min < ang_max <= {ceil}, got {amin}..{amax}"
        if joint != "gripper":
            if d not in (1.0, -1.0):
                return False, f"dir must be +1 or -1, got {d}"
            if abs(off) > 30.0:
                return False, f"|offset| must be <= 30, got {off}"
        return True, ""

    def commit(self):
        """Push the working copy, verify it landed, then persist.

        Returns (ok, message). Nothing is written to disk unless the firmware
        confirms the values, so calibration.json can never describe a mapping
        the arm is not using.
        """
        if self._staged is None:
            return True, "nothing to commit"

        for joint, v in self._staged.items():
            ok, why = self._validate(joint, v)
            if not ok:
                return False, f"{joint}: {why}"

        previous = self.calibration
        self.calibration = self._staged
        rejected = self._push_calibration()
        if rejected:
            # Roll back both our copy and the arm.
            self.calibration = previous
            self._push_calibration()
            return False, f"firmware rejected: {', '.join(rejected)}"
        if not self._verify_calibration():
            self.calibration = previous
            self._push_calibration()
            return False, "read-back mismatch, rolled back"

        self._staged = None
        self._save_calibration()
        logger.info("calibration committed and saved")
        return True, "saved"

    def revert(self):
        """Discard uncommitted edits."""
        self._staged = None
        logger.info("staged calibration discarded")
        return True

    def restore_defaults(self):
        """Return to the project defaults (this arm's measured values)."""
        self._staged = {n: dict(v) for n, v in DEFAULT_CALIBRATION.items()}
        logger.info("project defaults staged — commit to apply")
        return True

    # ---- bench tools -------------------------------------------------------
    # These hit the hardware immediately and never touch stored calibration.
    def pwm_write(self, channel, value):
        """Raw PWM write, full 0-4095. Refused while dry run is on.

        Deliberately bypasses the per-channel clamp: discovering that a joint's
        real range differs from the stored one is the point of calibrating.
        """
        return bool(self._call("pwm_write_raw", int(channel), int(value)))

    def sweep(self, channel, start, end, ms=2000):
        """Ease a channel from one raw PWM value to another. Non-blocking."""
        return bool(self._call("pwm_sweep", int(channel), int(start), int(end), int(ms)))

    def sweep_active(self):
        return bool(self._call("sweep_active"))

    def release_channel(self, channel):
        """Cut torque to one channel so the joint can be moved by hand."""
        self._call("release_channel", int(channel))
        return True

    # ---- telemetry ---------------------------------------------------------
    def _on_state(self, mode, values):
        try:
            state = {"mode": str(mode)}
            for i, key in enumerate(_STATE_FIELDS):
                state[key] = float(values[i]) if i < len(values) else 0.0
            state["loaded"] = bool(state["loaded"])
        except Exception as exc:
            logger.warning(f"malformed state payload: {exc}")
            return

        self._last_state = state
        self._last_state_at = time.monotonic()
        if self.log_state:
            logger.info(self.state_line(state))

        with self._lock:
            subs = list(self._subscribers)
        for fn in subs:
            try:
                fn(state)
            except Exception as exc:
                logger.warning(f"state subscriber raised: {exc}")

    def on_state(self, callback):
        """Register a callable invoked with the state dict at ~20 Hz."""
        with self._lock:
            self._subscribers.append(callback)

    @property
    def last_state(self):
        return self._last_state

    @staticmethod
    def state_line(s):
        """Render the legacy ``STATE ...`` text line.

        The existing browser code (``telemetry.js``) parses this exact format,
        so it is reproduced byte-for-byte rather than replaced with JSON.
        """
        return (
            f"STATE mode={s['mode']}"
            f" b={s['base']:.1f},{s['shoulder']:.1f},{s['elbow']:.1f},{s['wrist']:.1f}"
            f" pwm={int(s['pwm_base'])},{int(s['pwm_shoulder'])},"
            f"{int(s['pwm_elbow'])},{int(s['pwm_wrist'])}"
            f" strain={s['strain_shoulder']:.1f},{s['strain_elbow']:.1f},"
            f"{s['strain_wrist']:.1f}"
            f" w={s['manipulability']:.3f}"
            f" watts={s['watts']:.2f}"
            f" payload={s['payload']:.2f}"
            f" claw={s['claw']:.0f}"
            f" loaded={1 if s['loaded'] else 0}"
            f" ex_rep={int(s.get('ex_rep', 0))}"
            f" ex_step={int(s.get('ex_step', 0))}"
            f" ex_steps={int(s.get('ex_steps', 0))}"
            f" ex_leg={float(s.get('ex_leg', 0)):.2f}"
            f" ex_total={int(s.get('ex_total', 0))}"
        )

    # ---- commands ----------------------------------------------------------
    def _call(self, name, *args):
        try:
            return Bridge.call(name, *args)
        except Exception as exc:
            logger.warning(f"{name}{args} failed ({type(exc).__name__}): {exc}")
            return False

    def protocol(self, name):
        """Run a named motion protocol. See PROTOCOLS."""
        return bool(self._call("protocol_start", str(name)))

    def exercise(self, name, reps=6, *, gated=False):
        """Run a named rehab exercise with 1–6 reps, then home.

        When gated=True (rehab routes), the arm pauses between reps until
        exercise_advance() is called after wearable rep_end.
        """
        reps = max(1, min(6, int(reps)))
        return bool(self._call(
            "exercise_start", str(name), float(reps), float(1 if gated else 0)
        ))

    def exercise_advance(self):
        """Continue to the next rep after a between-rep hold."""
        return bool(self._call("exercise_advance"))

    def joints(self, base, shoulder, elbow, wrist):
        """Move to explicit joint angles in degrees.

        The firmware clamps each joint; the elbow cannot go below its calibrated
        ang_min no matter what is requested here.
        """
        return bool(self._call(
            "protocol_joints", float(base), float(shoulder),
            float(elbow), float(wrist),
        ))

    def target(self, x, y, z, pitch=90.0):
        """Move the tool tip to a Cartesian point (mm), solved by on-board IK."""
        return bool(self._call(
            "pipeline_target", float(x), float(y), float(z), float(pitch),
        ))

    def gripper(self, pct):
        """Set the claw: 0 = closed, 50 = mid, 100 = open. S-curved on the MCU."""
        pct = max(0.0, min(100.0, float(pct)))
        self._call("gripper_set", pct)
        self._save_gripper_state(pct)
        return True

    def payload(self, kg):
        """Declare the carried mass, used for torque derating."""
        self._call("payload_set", float(kg))
        return True

    def park(self):
        """Return to the stable home pose (90/90/95/90, claw open)."""
        self._call("home_park")
        self._save_gripper_state(100.0)
        return True

    def halt(self):
        """Stop protocols and the Cartesian pipeline, holding position."""
        self._call("protocol_stop")
        return True

    def estop(self):
        """Emergency stop: halt, cancel the gripper, force dry-run off, park."""
        self._call("protocol_estop")
        return True

    def release(self):
        """Cut torque to every channel (high-Z). The arm will fall limp."""
        self._call("release_all")
        return True

    def dry_run(self, on):
        """Gate the PWM writes. Everything else still runs — a movement lab."""
        self._call("dry_run_set", bool(on))
        return True

    def is_dry_run(self):
        return bool(self._call("get_dry_run"))
