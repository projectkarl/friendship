# NEULI v0.4 Test Report

## PASS

- `avatar3d.js` JavaScript syntax check
- `app.js` JavaScript syntax check
- `functions/api/tts.js` JavaScript syntax check
- GLB magic/version/declared length
- JSON and BIN chunk boundary validation
- all bufferView ranges inside binary buffer
- standard glTF parser (`trimesh`) loads 17 geometries
- total geometry: 51,836 triangles
- skeleton: 9 joints
- required bones found: Hips, Spine, Chest, Neck, Head
- required facial targets found: Blink, Smile, A, I, U, E, O
- embedded PNG skin texture exists
- BodyMesh references glTF skin index 0
- UI has actual model QA panel
- runtime API name mismatch fixed: both `window.neuliAvatar` and `window.NEULI_AVATAR` point to the same controller
- TTS supports audio-only and audio + timestamped viseme data

## Environment limitation

A full screenshot-based WebGL smoke test was attempted with the container Chromium. The local Chromium environment could not initialize EGL/ANGLE/SwiftShader and timed out before a WebGL context became available. This is recorded as **not verified in this container**, not as a successful browser-render test.

The GLB itself was still independently parsed and structurally validated, and the HTTP/runtime files are testable without claiming GPU rendering passed.

## Fidelity limitation

The bundled model is a real 3D single-view reconstruction of the generated Haneul reference. It is not a multi-camera scan or manually sculpted film-quality digital human, so scan-grade identity fidelity at extreme side/back angles is not claimed.
