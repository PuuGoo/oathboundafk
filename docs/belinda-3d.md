<!-- PROTOTYPE - NOT FOR PRODUCTION -->
# Belinda realtime 3D

Task: **BELINDA-3D-001**. Belinda alone uses a locally generated, animated GLB in the active `SpriteBattleCanvas` path. Other heroes remain source-sheet sprites. This is a live WebGL render composited into Canvas2D, not a rendered sprite sheet and not a replacement combat engine.

## Assets and rebuild

- `tools/build-belinda.py`: reproducible Blender authoring/export script.
- `assets-source/belinda/belinda.blend`: editable mesh, materials, armature and actions.
- `public/assets/models/belinda.glb`: self-contained runtime mesh and clips.
- `public/assets/models/belinda.provenance.json`: actual generation origin, geometry statistics, timings and limitations.

Run from the repository root in PowerShell:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" --background --python tools/build-belinda.py
```

The generator resolves all paths relative to its own repository location and writes the source/model/provenance plus Blender pose previews. No external model/texture downloads or new JavaScript dependencies are required. Existing Three.js supplies `GLTFLoader` and `SkeletonUtils.clone`.

## Presentation contract

The GLB uses +Y up, +Z front, feet at the origin. It contains seven named clips:

| Clip | Seconds | Runtime behavior |
|---|---:|---|
| idle | 2 | Loop; frozen neutral sample with reduced motion |
| run | 0.6 | Loop when the simulation is moving the unit |
| basic | 0.4 | Release 0.1; contact 0.2 |
| active | 1.15 | Release 0.3; contact 0.6 |
| ultimate | 1.65 | Release 0.45; contacts 0.65/0.85/1.05/1.25 |
| hit | 0.3 | Existing actual-damage hit reaction |
| death | 1.2 | Clamp at final pose |

`BattleSimulation` still owns all targeting, damage, energy, cooldowns, displacement and cast interruption. Animation time is sampled from `currentCast.startedAtMs` and the simulation clock plus its existing presentation accumulator. No animation callbacks apply damage. All four ultimate contacts retain the existing engine timings and quarter shares. No balance coefficients, hero IDs, sprite provenance or save schema are changed.

A single transparent offscreen renderer is shared within one mounted battle. Each instance ID has an independent skeleton/mixer. The live image is drawn at the existing floor anchor inside the normal depth-sorted body pass, before the existing spell/status/HUD layers. Enemy orientation mirrors the image around that anchor. Sprite recoil is not applied a second time to the model.

Isolation keeps its existing body replacement. Hard control freezes the last model pose; cancellation cannot replay a stale cast once control ends. Pause and battle speed use the same clocks as the active renderer. Existing target-local spell effects and hit reactions remain separate from the mesh.

## Failure behavior and lifetime

Only an encountered Belinda initiates loading. The original sprite is drawn during loading, on asset failure, on unavailable/lost WebGL or on a rendering exception. A failed load is not retried every frame. Unmount disposes the renderer, materials, geometry, skeletons and mixer bindings; a model finishing after unmount is immediately disposed. Battle restart releases per-instance state without reloading the shared model.

The read-only `canvas.dataset.belinda3d` reports readiness, actually drawn instance IDs, simulation time, pause/speed and Belinda cast/action state. It cannot issue combat actions.

## Visual scope and rights

This is a first stylized procedural character: blonde layered hair, gold crown, white/gold gown, blue-jewel sun staff and articulated actions. It is **not** an official mesh, a commercial character sculpt, a facial rig or a claim of studio-quality likeness. The rig uses rigid part weights; it has no simulated cloth/hair, facial blendshapes or finger IK. Underlying reference character/design rights are not established by generating new geometry. Existing sprite rights metadata is unchanged.

## Verification — 2026-11-16

- Full suite: **239/239 tests passed**, including nine new deterministic pose/lifetime/fallback regressions. TypeScript, the existing 22-sprite hash/dimension gate and production build passed. No new dependency or lockfile.
- Blender export: one skinned mesh, 14 bones, 14 material primitives, 15,532 authoring vertices / 30,256 triangles. GLB **1,262,632 bytes**; editable `.blend` **568,975 bytes**.
- Actual Three `GLTFLoader`/`AnimationMixer` asset check: seven clips with zero-based timestamps, 427 finite sampled poses; independent cloned skeletons; no external URI dependencies. This CPU check is not a GPU performance benchmark.
- Actual production-build browser: normal and LOW + reduced motion each retained four frames (opening, active, ultimate, x2), with the live Belinda instance reported as drawn. Canvas pixel capture and presentation state both remained unchanged while paused. The filename `*-idle.png` denotes the opening screenshot; the unit may already be using its run clip.
- Blocked GLB request: renderer reports `failed`, no 3D instance is drawn, and the existing Belinda sprite remains visible in the paused battlefield. This is a real network-failure fallback observation, not a claim that every hardware WebGL failure was reproduced.
- Separate natural frontline defeat run: retained `death-final.png`, with actual dead Belinda and the clamped horizontal model still drawn. The offscreen death crop widens without changing model world scale.
- Browser runs reported **zero uncaught runtime exceptions**. Existing `/favicon.ico` 404s remain; there were no failed model or sprite HTTP responses in the successful 3D runs. The deliberately blocked GLB in fallback mode is expected.
- Retained Blender previews were inspected; parent also inspected idle/ultimate/wide death and in-game normal opening/active/ultimate, LOW ultimate, sprite fallback and death. Distinct crown/hair/gown/staff and body poses are visible; crowded melee still causes normal overlap with sprites/effects and bars.

Evidence is retained locally in `production/qa/evidence/belinda3d/` with browser JSON reports containing served bundle/model SHA256s and screenshot hashes. `verify-runtime.cjs` launches a fresh disposable Chrome profile, creates only synthetic progress and uses native UI input. It never reads a normal browser profile. Run the production preview at port 3002, then `node production/qa/evidence/belinda3d/verify-runtime.cjs` (also `--accessible`, `--fallback`, `--death`).

Two earlier browser attempts rejected source/build GLB mismatch while asset iteration/build were incomplete. The next fixture lacked required numeric `gold`, so the game correctly loaded defaults and the observer timed out waiting for a manual ultimate while Auto was ON. The QA fixture was corrected without changing save-loading or combat code; final successful runs use level-12 synthetic heroes and Auto OFF. Old failure captures/reports are local diagnostic artifacts, not acceptance evidence.

Limits: hard-control freeze/cancellation, repeated identity lifetime and asynchronous teardown have deterministic unit/asset coverage, but enemy Belinda, simultaneous multiple Belindas, a deliberately induced live context loss, and every control/death timing were not exhaustively exercised through the browser. The stylized collapse briefly dips the boot soles about 0.08 model units below the nominal floor; rigid joints and staff/cloth intersections remain possible. No human art approval, smooth-motion quality verdict, minimum-device GPU/memory budget, audio quality or overall first-five completion is claimed.

Known existing build warnings remain visible: Vite future native-loader `__dirname` warning and chunks exceeding 500 kB. The new Three loader is lazy; its compressed/uncompressed bundle size is not a measured frame-time result.
