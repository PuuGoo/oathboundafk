<!-- PROTOTYPE - NOT FOR PRODUCTION -->
# Belinda realtime 3D

Original task: **BELINDA-3D-001** introduced a locally generated, animated GLB for Belinda in the active `SpriteBattleCanvas` path. The subsequent [roster expansion](roster-3d.md) now uses one shared backend for all 22 Oathbound identities, retaining Belinda's assets and spell meshes. This remains a live WebGL render composited into Canvas2D, not a rendered sprite sheet or a replacement combat engine. The original task verification below is historical; the roster document records current integration checks and visual-review limits.

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

The shared roster backend now lazily queues each encountered hero's model. The original sprite is drawn during loading, on asset failure, on unavailable/lost WebGL or on a rendering exception. A failed asset is not retried every frame and does not disable the other loaded heroes. Unmount disposes the renderer, materials, geometry, skeletons and mixer bindings; a model finishing after unmount is immediately disposed. Battle restart now releases per-instance state and cached models to bound memory across roster changes.

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

## Spell meshes — BELINDA-3D-VFX-002

Belinda's basic, active and ultimate now use runtime Three meshes in the **active** `SpriteBattleCanvas`, not Canvas2D drawings renamed as 3D. This task does not rebuild or modify the Blender asset, damage coefficients, cooldowns, cast timing, save data or other hero kits.

- Basic: a faceted light orb with an orbit ring and small mesh trail travels from the animated staff gem toward the locked opponent's torso between the engine's release/contact timestamps.
- Active: three differently tilted torus rings, a brighter orb and a mesh trail use the same staff-to-recipient delivery. Floor rings stay behind bodies; the airborne payload is above bodies and below HUD bars.
- Ultimate: layered floor rings and target-local tapered columns, orbit rings, a faceted core and scattered shards respond to **actual damage events**. Four existing engine hit groups remain at 650/850/1050/1250 ms. A cast reaching a scheduled contact does not itself create a hit burst. AoE recipients each receive their own actual-outcome feedback.
- Cast cancellation continues to remove matching cast choreography. Already landed feedback can fade normally; the VFX never schedules damage, retargets to a different identity or invents an offensive passive.

### Renderer, fallback and resource boundaries

`belindaSpell3d.ts` supplies pure phase/projection sampling plus a fixed reusable pool of torus, icosahedron, cylinder and octahedron meshes. Four geometries and three materials are shared across all effects, with no event-owned GPU resources. Presentation tuning is grouped in `SPELL_STYLE`, independent of combat tuning. LOW reduces ring/shard counts. Reduced motion removes spin and the delivery arc and reduces column height/detail, while keeping actual hit information.

The existing character backend lends its **single** WebGL renderer and fixed 384×448 drawing buffer to a separate orthographic battlefield spell scene. The body camera and spell camera are distinct; screen-space recipient anchors come from the same battlefield projection as sprites. Staff origin follows the animated `hand.R` bone using the exported gem's rest position. Successful rendering IDs alone suppress their corresponding old Canvas2D effect in that pass. Loading, failed model/WebGL initialization or a failed spell pass keep the original 2D fallback. A failed spell pass is not retried each frame. If a batch fails midway, already composited IDs remain suppressed and untouched IDs keep fallback.

The existing total effect cap still applies. Unmount disposes the spell pool alongside character resources; battle reset clears instance/staff anchors. Pause and x2 consume only the supplied simulation/presentation clocks. `canvas.dataset.belindaSpells` reports actual effect IDs, cast IDs, recipients, hit indices and whether the 3D pass handled them; it cannot trigger an action.

### Verification record

- Final full suite: **250/250 passed**, zero failures/skips, including 11 new spell tests. These cover phase sampling, real four-group engine outcomes, cancellation filtering, target identity/projection, pause/x2, LOW/reduced geometry, transactional fallback, finite mesh transforms and exact-once geometry/material disposal. TypeScript, the unchanged 22-sprite hash/dimension gate and production build passed.
- Final production browser: normal and LOW + reduced motion each retained eight frames (opening, basic, active, four separately observed ultimate hit indices, x2). All four ultimate hit groups contained actual target IDs and successfully drawn 3D impacts. Both runs preserved identical paused battlefield pixels and character state over 650 ms. No uncaught runtime exceptions; only existing favicon 404s were reported.
- Separate blocked-GLB run retained `spells-fallback-sprite.png` during an active cast, with the old sprite/effects visible and no effect marked rendered3d. The model and all served JS/CSS bytes matched the local build hashes before each observation.
- Inspected normal basic/active and ultimate captures plus LOW ultimate and active-cast fallback. Narrow gold/cyan columns replace the original overexposed white version, but crowded effects still overlap. The basic screenshot can occur after its brief flight due to native pause/capture latency; its name is not proof of a particular subframe. No human smooth-motion/art approval is inferred from screenshots.

The local observer now writes `spells-*` screenshots/reports, preserving the earlier character-only evidence. It waits for real rendered basic/active delivery and each actual ultimate hit index, pauses through native UI commands, then captures the actual production-build battlefield. Fallback blocks the GLB and captures an active spell with no 3D effect suppression. A fresh disposable browser profile and synthetic save remain mandatory.

First visual iteration exposed overbright white columns hiding recipients. Material lighting/blending and column width were corrected, then observed again. This is a bounded procedural VFX implementation, not human art sign-off or a measured minimum-device GPU/memory result. Crowded AoE geometry and existing hero effects can still overlap. Ground and front compositing does not provide full cross-renderer 3D depth occlusion against sprite bodies. The shared fixed-resolution buffer may soften effects on larger screens.
