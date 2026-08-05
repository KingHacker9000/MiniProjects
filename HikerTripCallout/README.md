# Trail Callout

A small Expo/React Native prototype for hikers. It uses fused device-motion data to detect both:

- **Hard trips:** a brief loss of support or destabilizing motion followed by an impact.
- **Slips / slides:** a smaller acceleration burst combined with rapid rotation and a wobble, counter-rotation, or recovery.

Each detected event plays alternating **“Hee hee!”** and **“Hoo hoo!”** system-generated vocal callouts.

The repository does **not** include Michael Jackson recordings or a cloned voice. Replace the callout implementation only with audio you created or have permission to distribute.

## Run it

Requirements:

- Node.js 22.13 or newer
- Expo Go on a physical Android or iPhone

```bash
cd HikerTripCallout
npm install
npx expo start
```

Scan the QR code with Expo Go. Motion testing requires a physical device; simulators and web browsers are not suitable for realistic calibration.

## Why DeviceMotion instead of gyro alone?

`DeviceMotion` gives the app synchronized access to:

- acceleration with gravity,
- linear acceleration with gravity removed, and
- fused rotation rate in degrees per second.

Gyroscope data alone can detect a phone turning, but cannot distinguish a hiking slip from deliberately rotating the phone. The detector therefore requires multiple signals inside a short time window.

## Detection pipeline

The app samples device motion every 40 ms.

### Hard trip

1. Detect low total acceleration, a destabilizing burst, or a direct impact.
2. Look for a strong impact and jerk inside the profile's time window.
3. Confirm using additional acceleration or rotation evidence.

### Slip / slide

1. Detect a linear-acceleration or jerk burst.
2. Require rapid rotation.
3. Accumulate a meaningful angular excursion.
4. Confirm using recovery or counter-rotation, which resembles a person correcting their balance.

A 3.2-second cooldown prevents one stumble from producing several callouts. The app waits 1.4 seconds after activation before arming so picking up the phone does not immediately trigger it.

## Sensitivity

- **Low:** best for running, scrambling, or a phone that moves slightly in its mount.
- **Medium:** recommended starting point.
- **High:** intended for smaller slips and slides, with a greater risk of false triggers.

## Calibration

1. Secure the phone snugly against your body in the exact pocket, armband, waist belt, or chest mount you will use.
2. Start with **Medium / Balanced**.
3. Walk normally, climb a few steps, and make ordinary phone movements. These should not trigger.
4. Safely simulate a foot skid and quick balance correction without actually falling.
5. Choose **High** if small test slides are missed.
6. Choose **Low** if running, jumping, or scrambling causes false triggers.

A loose phone bouncing in a backpack is not suitable: the phone's movement can be indistinguishable from the hiker slipping.

## Current limitations

- Thresholds are heuristic and need real-world data from different users, phones, carrying positions, and terrain.
- The app does not know whether the phone moved with the person's torso or moved independently.
- Foreground Expo sensor monitoring is not a replacement for a native background safety service.
- Small slides are inherently harder to classify than falls, so sensitivity and false-positive rate trade off against each other.

This is a novelty prototype, not a medical device, fall detector, or emergency alert system. Do not rely on it for personal safety.

## Main dependencies

- Expo SDK 57
- `expo-sensors` / `DeviceMotion` for fused acceleration and rotation data
- `expo-speech` for the original system-generated callouts
