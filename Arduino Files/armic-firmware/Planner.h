#pragma once

#include <stdint.h>
#include <stdbool.h>

struct Point3D {
    float x;
    float y;
    float z;
};

enum PathState {
    STATE_IDLE,
    STATE_LINEAR,
    STATE_TUCKING,
    STATE_ROTATING,
    STATE_EXTENDING
};

class Planner {
public:
    Planner();

    // Sets the target destination. 
    // If is_loaded is true and distance is significant, uses C-Curve (HTL).
    void moveTo(const Point3D& current, const Point3D& target, bool is_loaded = false);

    // Checks if the planner has active waypoints to reach the target
    bool isMoving() const;

    // Gets the next waypoint to feed to the IK solver. 
    // This interpolates step-by-step towards the target.
    Point3D getNextWaypoint(const Point3D& current, float step_size_mm = 1.0f);

private:
    Point3D _target;
    Point3D _intermediate_target; // Used for multi-phase HTL routing
    PathState _state;
    bool _is_moving;
    
    float getRadius(const Point3D& p) const;
    void advanceState(const Point3D& current);
};
