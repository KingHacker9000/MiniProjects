# Trail Callout

Trail Callout is an Expo/React Native field-testing prototype for hikers. It uses fused device motion data to detect both hard trips and smaller slips/slides, then plays a playful system-generated callout and optional haptic feedback.

The repository does **not** include Michael Jackson recordings or a cloned voice. Replace the callout implementation only with audio you created or have permission to distribute.

## What is included

- Fused `DeviceMotion` acceleration + rotation sensing at 25 Hz.
- Two event classes: hard trip and slip/slide.
- 2.5-second still calibration every time monitoring starts.
- Adaptive slip thresholds based on measured motion noise.
- Wear profiles for snug pocket, belt/chest mount, and backpack.
- Low, Medium, and High sensitivity presets.
- Confidence scoring for candidate events.
- Persistent local event history with peak force, body acceleration, rotation, confidence, and settings used.
- `Real event` / `False trigger` labels for field-testing feedback.
- Separate sound and haptic toggles.
- Safe simulation buttons for testing feedback without deliberately stumbling.
- Screen keep-awake while monitoring so sensor tests do not stop because the display sleeps.
- EAS development, preview/internal APK, and production build profiles.

## Install dependencies

```bash
cd HikerTripCallout
npm install
```

## Recommended development workflow

SDK 57 is set up for a project-specific Expo development build rather than relying on Expo Go.

```bash
npm install --global eas-cli
eas login
eas build:configure
eas build --platform android --profile development
```

Install the generated development APK on the phone, then start Metro:

```bash
npm start
```

Open the Trail Callout development client on the phone and connect to the development server.

## Standalone test APK

To make a build that runs without Metro:

```bash
eas build --platform android --profile preview
```

The `preview` profile produces an installable APK through EAS internal distribution.

## Calibration procedure

1. Put the phone in the exact position you plan to use.
2. Select the matching wear profile.
3. Start with Medium / Balanced sensitivity.
4. Turn monitoring on and stand still for 2.5 seconds.
5. If the app reports a noisy fit, secure the phone more tightly and restart monitoring.
6. Test normal walking, brisk walking, stairs, sitting, jogging, jumping, and phone handling before controlled slip-like movements.
7. Label every genuine sensor trigger as `Real event` or `False trigger` so thresholds can be tuned from field data.

## Safe field-test matrix

Do not deliberately fall. Use controlled movements near a railing or open flat area.

- Normal walk: 3-5 minutes; target 0 triggers.
- Brisk walk: 2 minutes; target 0 triggers.
- Stairs: one flight up and down; target 0 triggers.
- Sit/stand quickly: 10 repetitions; target 0 triggers.
- Jog: 1 minute; note false positives.
- Small hop: 5 repetitions; note false positives.
- Controlled shoe slide with immediate recovery: 10 repetitions; target increasing detection rate on High.
- Quick balance correction / torso catch: 10 repetitions; target detection on Medium/High.
- Deliberate phone handling while stationary: 10 repetitions; target 0 triggers when worn snugly.

## Important limitations

This is a novelty prototype, not a medical device, certified fall detector, or emergency service. Phone-only heuristics can miss genuine incidents and can produce false positives. The current JavaScript sensor monitor is intended for foreground testing. Reliable always-on/background detection would require a native background architecture and significantly more validation.
