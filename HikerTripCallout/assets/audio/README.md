# Trail Callout audio assets

Drop the short local audio clips you want the app to use in this folder.

Recommended filenames:

- `heehee.mp3`
- `hoohoo.mp3`
- `shamone.mp3`
- `ow.mp3`

MP3, M4A, and WAV are all reasonable choices for short bundled clips. Keep each clip short and tightly trimmed so playback starts immediately after a detected event.

Once the files are present, wire them into `App.tsx` with `expo-audio` local asset imports and randomize playback across the available clips.

Only include recordings you have the right to use or distribute.