# Trail Callout

A small Expo/React Native prototype for hikers. It watches the phone accelerometer for a stumble-and-impact pattern and plays alternating **“Hee hee!”** and **“Hoo hoo!”** system-generated vocal callouts.

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

Scan the QR code with Expo Go. Accelerometer testing requires a physical device; simulators and web browsers are not suitable for realistic testing.

## How detection works

The app samples the accelerometer every 50 ms and looks for two stages:

1. A brief low-acceleration or destabilizing drop.
2. A sharp acceleration impact inside a short time window.

After a detection, a 4.5-second cooldown helps prevent repeat triggers from the same motion. Three sensitivity presets adjust the thresholds and allowed time window.

## Calibration

1. Secure the phone in the same pocket, armband, or backpack position you will use while hiking.
2. Start with **Medium / Balanced**.
3. Test controlled stumble-like movements without falling or dropping the phone.
4. Use **Low** if normal walking or running causes false triggers.
5. Use **High** only if genuine test motions are consistently missed.

## Safety limitations

This is a novelty prototype, not a medical device, fall detector, or emergency alert system. Accelerometer-only heuristics can miss incidents and can trigger during jumping, running, climbing, or a dropped phone. Do not rely on it for personal safety.

## Main dependencies

- Expo SDK 57
- `expo-sensors` for accelerometer data
- `expo-speech` for the original system-generated callouts
