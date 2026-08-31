#include "Planner.h"
#include <math.h>

Planner::Planner() : _is_moving(false), _state(STATE_IDLE) {
    _target = {0, 0, 0};
    _intermediate_target = {0, 0, 0};
}

float Planner::getRadius(const Point3D& p) const {
    return sqrt(p.x * p.x + p.y * p.y);
}

void Planner::moveTo(const Point3D& current, const Point3D& target, bool is_loaded) {
    _target = target;
    _is_moving = true;

    float dx = target.x - current.x;
    float dy = target.y - current.y;
    float dz = target.z - current.z;
    float dist = sqrt(dx*dx + dy*dy + dz*dz);

    // Heuristic for HTL (C-Curve): if loaded and distance is large (> 50mm)
    if (is_loaded && dist > 50.0f) {
        _state = STATE_TUCKING;
        
        // Target for TUCKING: safe radius (e.g., 60mm), current angle, high Z (e.g., 200mm)
        float current_r = getRadius(current);
        float current_theta = atan2(current.y, current.x);
        
        // If already tucked, skip tucking
        if (current_r <= 65.0f && current.z >= 180.0f) {
            _state = STATE_ROTATING;
            _intermediate_target = current; // advance to next state on next tick
        } else {
            float safe_r = 60.0f;
            float safe_z = 200.0f;
            _intermediate_target.x = safe_r * cos(current_theta);
            _intermediate_target.y = safe_r * sin(current_theta);
            _intermediate_target.z = safe_z;
        }
    } else {
        _state = STATE_LINEAR;
        _intermediate_target = _target;
    }
}

bool Planner::isMoving() const {
    return _is_moving;
}

void Planner::advanceState(const Point3D& current) {
    if (_state == STATE_TUCKING) {
        _state = STATE_ROTATING;
        // Target for ROTATING: same safe radius and Z, but target's angle
        float target_theta = atan2(_target.y, _target.x);
        float safe_r = 60.0f;
        float safe_z = 200.0f;
        _intermediate_target.x = safe_r * cos(target_theta);
        _intermediate_target.y = safe_r * sin(target_theta);
        _intermediate_target.z = safe_z;
    } else if (_state == STATE_ROTATING) {
        _state = STATE_EXTENDING;
        _intermediate_target = _target; // Final leg
    } else if (_state == STATE_EXTENDING || _state == STATE_LINEAR) {
        _state = STATE_IDLE;
        _is_moving = false;
    }
}

Point3D Planner::getNextWaypoint(const Point3D& current, float step_size_mm) {
    if (!_is_moving) {
        return current;
    }

    float dx = _intermediate_target.x - current.x;
    float dy = _intermediate_target.y - current.y;
    float dz = _intermediate_target.z - current.z;
    float distance = sqrt(dx*dx + dy*dy + dz*dz);
    
    // If we've reached the intermediate target, advance the state machine
    if (distance <= step_size_mm) {
        advanceState(current);
        if (!_is_moving) {
            return _target;
        }
        // Recalculate diff for new intermediate target
        dx = _intermediate_target.x - current.x;
        dy = _intermediate_target.y - current.y;
        dz = _intermediate_target.z - current.z;
        distance = sqrt(dx*dx + dy*dy + dz*dz);
        
        if (distance <= step_size_mm) {
             return current; // Avoid dividing by zero if new target is extremely close
        }
    }
    
    // Interpolate towards the intermediate target
    float ratio = step_size_mm / distance;
    
    Point3D next;
    next.x = current.x + dx * ratio;
    next.y = current.y + dy * ratio;
    next.z = current.z + dz * ratio;
    
    return next;
}
