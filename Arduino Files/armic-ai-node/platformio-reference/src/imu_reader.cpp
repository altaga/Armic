#include "imu_reader.h"

#include <M5Core2.h>

static constexpr float kConvertGToMs2 = 9.80665f;
static constexpr float kMaxAcceptedG = 2.0f;

bool imuInit() {
    if (M5.IMU.Init() != 0) {
        return false;
    }
    M5.IMU.SetAccelFsr(MPU6886::AFS_2G);
    return true;
}

bool imuRead(float out[6]) {
    float ax, ay, az;
    float gx, gy, gz;

    M5.IMU.getAccelData(&ax, &ay, &az);
    M5.IMU.getGyroData(&gx, &gy, &gz);

    if (ax > kMaxAcceptedG) ax = kMaxAcceptedG;
    if (ax < -kMaxAcceptedG) ax = -kMaxAcceptedG;
    if (ay > kMaxAcceptedG) ay = kMaxAcceptedG;
    if (ay < -kMaxAcceptedG) ay = -kMaxAcceptedG;
    if (az > kMaxAcceptedG) az = kMaxAcceptedG;
    if (az < -kMaxAcceptedG) az = -kMaxAcceptedG;

    out[0] = ax * kConvertGToMs2;
    out[1] = ay * kConvertGToMs2;
    out[2] = az * kConvertGToMs2;
    out[3] = gx;
    out[4] = gy;
    out[5] = gz;
    return true;
}
