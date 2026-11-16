# PROTOTYPE - NOT FOR PRODUCTION
"""Dựng hiệu ứng kỹ năng 3D cho một tướng trong Blender.

Chạy: 'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe' --background \
  --threads 2 --python-exit-code 1 --python tools/build-vfx.py -- belinda --no-preview

Mỗi tướng xuất một GLB riêng với bốn clip: basic .4s, active 1.15s, ultimate 1.65s,
impact .42s. Hình học, material và animation đều sinh cục bộ; không tải asset ngoài.
Hiệu ứng chỉ trình diễn: không áp damage, cooldown, energy hay điều khiển simulation.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import random
import sys
import bpy

ROOT = Path(__file__).resolve().parents[1]
SPECS = json.loads((ROOT / 'tools/hero-vfx.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser()
parser.add_argument('hero', choices=[s['id'] for s in SPECS])
parser.add_argument('--no-preview', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
S = next(s for s in SPECS if s['id'] == args.hero)
OUT = ROOT / 'public/assets/vfx'
SOURCE = ROOT / 'assets-source/vfx' / S['id']
EVIDENCE = ROOT / 'production/qa/evidence/vfx3d' / S['id']
for folder in (OUT, SOURCE, EVIDENCE):
    folder.mkdir(parents=True, exist_ok=True)

DURATIONS = {'basic': .4, 'active': 1.15, 'ultimate': 1.65, 'impact': .45}
FPS = 60
TAU = math.tau
# Ảnh hưởng theo clip: a = bắt đầu nhả, b = đỉnh, c = bắt đầu tan, lift = độ nâng hạt.
PROFILES = {
    'basic': dict(a=.10, b=.26, c=.62, twist=.85, push=.62, lift=.55),
    'active': dict(a=.22, b=.44, c=.74, twist=1.35, push=.82, lift=.85),
    'ultimate': dict(a=.26, b=.52, c=.88, twist=2.10, push=1.0, lift=1.0),
    'impact': dict(a=.02, b=.16, c=.48, twist=.55, push=1.0, lift=1.0),
}
INTENSITY = float(S.get('intensity', 1.0))
RNG = random.Random(int(hashlib.sha256(S['id'].encode()).hexdigest()[:8], 16))


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def ease(u):
    u = clamp(u)
    return u * u * (3 - 2 * u)


def peak(u, a, b, c):
    """0 → 1 trong [a, b], giữ tới c rồi tan dần về 0."""
    if u <= a:
        return 0.0
    if u <= b:
        return ease((u - a) / max(b - a, 1e-6))
    if u <= c:
        return 1.0
    return max(0.0, 1.0 - (u - c) / max(1.0 - c, 1e-6))


def srgb(value):
    channels = []
    for i in (0, 2, 4):
        raw = int(value[i:i + 2], 16) / 255
        channels.append(((raw + .055) / 1.055) ** 2.4 if raw > .04045 else raw / 12.92)
    return tuple(channels)


MATERIALS = {}
parts = []


def material(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    node = m.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (1, 1, 1, 1)
    node.inputs['Metallic'].default_value = 0.0
    node.inputs['Roughness'].default_value = .35
    node.inputs['Emission Color'].default_value = (*srgb(color), 1)
    node.inputs['Emission Strength'].default_value = strength * INTENSITY
    node.inputs['Alpha'].default_value = 1.0
    m.diffuse_color = (*srgb(color), 1)
    MATERIALS[name] = m
    return m


def build_materials():
    # Tên material được runtime đọc để gán hệ số mờ riêng cho từng lớp.
    material('vfx_core', S['primary'], 5.5)
    material('vfx_glow', S['accent'], 7.5)
    material('vfx_alt', S['secondary'], 4.5)
    material('vfx_halo', S['primary'], 1.2)


def finish(obj, name, mat, smooth=True):
    obj.name = name
    obj.data.materials.append(MATERIALS[mat])
    for poly in obj.data.polygons:
        poly.use_smooth = smooth
    return obj


class Part:
    """Một mảnh hiệu ứng: hình học tĩnh + hàm biến đổi theo thời lượng clip."""

    def __init__(self, obj, role, base=(0, 0, 0), tilt=0.0, phase=0.0, spread=1.0,
                 twist=1.0, bulk=1.0, delay=0.0, reach=1.0, rise=1.0):
        self.obj = obj
        self.role = role
        self.base = base
        self.tilt = tilt
        self.phase = phase
        self.spread = spread
        self.twist = twist
        self.bulk = bulk
        self.delay = delay
        self.reach = reach
        self.rise = rise


def register(obj, role, **params):
    obj.rotation_mode = 'ZYX'
    parts.append(Part(obj, role, **params))
    return obj


def torus(name, radius, minor, mat, segments=48, tilt=0.0, role='ring', **params):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=minor,
                                     major_segments=segments, minor_segments=6,
                                     location=(0, 0, 0))
    return register(finish(bpy.context.object, name, mat), role, tilt=tilt, **params)


def ico(name, radius, mat, role='core', subdiv=1, **params):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, subdivisions=subdiv, location=(0, 0, 0))
    return register(finish(bpy.context.object, name, mat), role, **params)


def cone(name, r1, r2, depth, mat, role='spike', axis='Z', **params):
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=r1, radius2=r2, depth=depth, location=(0, 0, 0))
    obj = finish(bpy.context.object, name, mat)
    if axis == 'X':
        obj.rotation_mode = 'XYZ'
        obj.rotation_euler = (0, math.pi / 2, 0)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return register(obj, role, **params)


def box(name, size, mat, role='spoke', **params):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = finish(bpy.context.object, name, mat, smooth=False)
    obj.scale = size
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return register(obj, role, **params)


def crescent(name, radius, width, mat, **params):
    """Lưỡi liềm mảnh trong mặt phẳng X-Z, hướng về camera."""
    inner, outer, steps = radius * (1 - width), radius, 24
    verts, faces = [], []
    for i in range(steps + 1):
        angle = math.pi * (-.52 + 1.04 * i / steps)
        taper = math.cos((angle / (math.pi * .52)) * math.pi / 2) ** .7
        verts.append((math.cos(angle) * outer, 0, math.sin(angle) * outer))
        verts.append((math.cos(angle) * inner * taper, 0, math.sin(angle) * inner * taper))
    for i in range(steps):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish(obj, name, mat)
    return register(obj, 'arc', **params)


def transform(part, u, clip):
    p = PROFILES[clip]
    a, b, c = p['a'], p['b'], p['c']
    t = clamp((u - part.delay) / max(1e-6, 1 - part.delay))
    spin = part.phase + TAU * part.twist * p['twist'] * (t ** .85)
    grow = ease(clamp(t / max(b, 1e-6)))
    fade = 1.0 - clamp((t - c) / max(1e-6, 1 - c)) * .55
    role = part.role
    if role == 'ring':
        scale = part.bulk * (.16 + .95 * grow) * fade
        return part.base, (part.tilt, 0, spin), (scale, scale, scale)
    if role == 'orbit':
        dist = part.spread * (.45 + .75 * grow)
        loc = (part.base[0] + math.cos(spin) * dist, part.base[1] + math.sin(spin) * dist,
               part.base[2] + math.sin(spin * 1.7) * .04)
        scale = part.bulk * peak(t, a, b, c) * fade
        return loc, (part.tilt, 0, spin * .4), (scale, scale, scale)
    if role == 'spoke':
        out = part.spread * p['push'] * grow
        loc = (part.base[0] + math.cos(spin) * out, part.base[1] + math.sin(spin) * out, part.base[2])
        scale = part.bulk * peak(t, a, b, c) * fade
        return loc, (part.tilt, 0, spin), (scale, scale, scale)
    if role == 'mote':
        dist = part.spread * p['push'] * grow
        loc = (part.base[0] + math.cos(spin) * dist, part.base[1] + math.sin(spin) * dist,
               part.base[2] + part.rise * p['lift'] * grow)
        scale = part.bulk * peak(t, a, b, c) * fade
        return loc, (spin * .5, spin, 0), (scale, scale, scale)
    if role == 'spike':
        out = part.spread * p['push'] * grow
        loc = (part.base[0] + math.cos(spin) * out, part.base[1] + math.sin(spin) * out,
               part.base[2] + math.sin(spin * .7) * .06)
        scale = part.bulk * peak(t, a, b, c) * fade
        return loc, (part.tilt, spin * .6, spin), (scale * .6, scale * .6, scale)
    if role == 'arc':
        sweep = math.sin(clamp((t - a) / max(c - a, 1e-6)) * math.pi * .5)
        loc = (part.base[0] + part.spread * (sweep - .5) * 1.35, part.base[1],
               part.base[2] + part.reach * sweep * .35)
        scale = part.bulk * peak(t, a, b, c) * fade
        return loc, (0, part.tilt + spin * .35, part.phase), (scale, scale, scale)
    if role == 'beam':
        scale = part.bulk * peak(t, a, b, c) * fade
        length = part.reach * ease(clamp((t - a) / max(b - a, 1e-6)))
        return part.base, (0, 0, spin * .3), (scale, scale, max(1e-4, length))
    if role == 'lance':
        # Hình học đã xoay sang trục X: kéo dài theo X, không theo Z.
        scale = part.bulk * peak(t, a, b, c) * fade
        length = part.reach * ease(clamp((t - a) / max(b - a, 1e-6)))
        return part.base, (0, 0, spin * .3), (max(1e-4, length), scale, scale)
    if role == 'dart':
        out = part.spread * p['push'] * grow
        loc = (part.base[0] + out, part.base[1] + math.sin(spin) * .08,
               part.base[2] + math.cos(spin) * .08)
        scale = part.bulk * peak(t, a, b, c) * fade
        return loc, (0, spin * .2, 0), (scale, scale * .5, scale * .5)
    if role == 'column':
        scale = part.bulk * peak(t, a, c, c) * fade
        length = part.reach * ease(clamp(t / max(b, 1e-6)))
        return part.base, (0, 0, spin * .25), (scale, scale, max(1e-4, length))
    if role == 'core':
        pulse = .78 + .30 * math.sin(t * math.pi * 2.6 + part.phase)
        scale = part.bulk * peak(t, a * .5, b, c) * pulse * INTENSITY
        return part.base, (spin * .9, spin * .55, spin), (scale, scale, scale)
    scale = part.bulk * peak(t, a, b, c) * fade
    return part.base, (part.tilt, 0, spin), (scale, scale, scale)


def animate():
    """Mỗi object có bốn NLA track trùng tên clip; exporter gộp thành bốn animation."""
    for part in parts:
        obj = part.obj
        obj.animation_data_create()
        for clip, duration in DURATIONS.items():
            action = bpy.data.actions.new(f'{clip}:{obj.name}')
            action.use_fake_user = True
            obj.animation_data.action = action
            steps = 10
            for i in range(steps + 1):
                u = i / steps
                loc, rot, scale = transform(part, u, clip)
                obj.location = loc
                obj.rotation_euler = rot
                obj.scale = scale
                frame = round(u * duration * FPS)
                for path in ('location', 'rotation_euler', 'scale'):
                    obj.keyframe_insert(path, frame=frame)
            track = obj.animation_data.nla_tracks.new()
            track.name = clip
            track.strips.new(clip, 0, action)
            obj.animation_data.action = None
        for track in obj.animation_data.nla_tracks:
            track.mute = False


# ---------------------------------------------------------------- families
def rings(count, radii, tilts, mats, minor=.014, delay=0.0):
    for i in range(count):
        torus(f'Sigil ring {i + 1}', radii[i % len(radii)], minor, mats[i % len(mats)],
              tilt=tilts[i % len(tilts)], twist=1 + i * .35, delay=delay)


def motes(count, spread, size, mat, rise=.5, delay=.1):
    for i in range(count):
        ico(f'Mote {i + 1}', size * (.6 + RNG.random() * .8), mat, role='mote',
            phase=RNG.random() * TAU, spread=spread * (.55 + RNG.random() * .55),
            rise=rise * (.6 + RNG.random() * .8), delay=delay + i / count * .18)


def spikes(count, spread, length, mat, size=.05, delay=.05):
    for i in range(count):
        angle = i / count * TAU + RNG.random() * .2
        cone(f'Spike {i + 1}', size, 0.0, length, mat, role='spike',
             phase=angle, spread=spread * (.8 + RNG.random() * .4), delay=delay)


def build_sigil():
    """Vòng triệu hồi: nhiều vành xoay, nan chữ, lõi sao và hạt sáng bay lên."""
    rings(3 + RNG.randint(0, 1), [.55, .8, 1.0, 1.18], [1.16, 1.30, 1.06, 1.24],
          ['vfx_core', 'vfx_glow', 'vfx_alt'], minor=.016)
    torus('Aura ring', .46, .012, 'vfx_glow', tilt=.34, twist=-1.6)
    for i in range(6):
        box(f'Rune bar {i + 1}', (.02, .01, .16), 'vfx_core', role='orbit',
            phase=i / 6 * TAU, spread=.72, tilt=1.2, twist=.9)
    ico('Core star', .16, 'vfx_glow', role='core')
    ico('Core shell', .26, 'vfx_halo', role='core', subdiv=0, phase=1.2)
    motes(10, 1.0, .05, 'vfx_alt', rise=.55)
    cone('Light column', .34, .05, 1.0, 'vfx_halo', role='column', base=(0, 0, .5),
         reach=1.5, twist=.6)


def build_strike():
    """Chém: ba lưỡi liềm quét qua mục tiêu, mảnh vụn và tia chớp va chạm."""
    # Số lưỡi liềm và bán kính lấy từ seed của tướng: hai tướng cùng họ vẫn khác tay.
    blades = 2 + RNG.randint(0, 2)
    for i in range(blades):
        crescent(f'Crescent {i + 1}', (.78 + i * .13) * (.92 + RNG.random() * .2), .14 + RNG.random() * .06,
                 'vfx_core' if i % 2 == 0 else 'vfx_glow', phase=-.7 + i * .12,
                 spread=.2, tilt=-.25 + i * .18, reach=.25, delay=i * .04)
    torus('Impact ring', .45 + RNG.random() * .2, .012, 'vfx_alt', tilt=1.3, twist=1.4, delay=.05)
    spikes(8 + RNG.randint(0, 4), .8, .34, 'vfx_glow', size=.035, delay=.06)
    ico('Edge flare', .1, 'vfx_core', role='core', base=(.35, 0, .1))


def build_lance():
    """Thương/giáo: mũi lao dài, dải xoắn quanh trục và vòng nổ ở điểm chạm."""
    cone('Lance shaft', .05, .012, 1.5, 'vfx_core', role='beam', base=(0, 0, .1),
         reach=1.5, twist=.4)
    cone('Lance tip', .11, 0.0, .34 + RNG.random() * .2, 'vfx_glow', role='beam', base=(0, 0, .92),
         reach=1.7, twist=.4, delay=.02)
    for i in range(2 + RNG.randint(0, 2)):
        torus(f'Spiral {i + 1}', .18 + RNG.random() * .08, .009, 'vfx_alt', role='orbit', spread=.16,
              tilt=.2, phase=i / 3 * TAU, twist=2.4)
    rings(1 + RNG.randint(0, 2), [.42 + RNG.random() * .1, .6], [1.24, 1.34],
          ['vfx_glow', 'vfx_alt'], minor=.012, delay=.08)
    spikes(6 + RNG.randint(0, 4), .7, .3, 'vfx_glow', size=.03, delay=.1)


def build_volley():
    """Loạt tên: nhiều mũi bay theo vòng cung, có vệt và vòng va chạm."""
    arrows = 4 + RNG.randint(0, 3)
    for i in range(arrows):
        cone(f'Arrow {i + 1}', .075, 0.0, .75, 'vfx_core', role='spike',
             phase=-.9 + i * .45, spread=.5 + i * .06 + RNG.random() * .1, delay=i * .03)
        box(f'Arrow trail {i + 1}', (.03, .03, .5), 'vfx_alt', role='spoke',
            phase=-.9 + i * .45, spread=.7, delay=i * .03)
    rings(2, [.62 + RNG.random() * .1, .9], [1.3, 1.18], ['vfx_glow', 'vfx_alt'], minor=.02, delay=.06)
    torus('Volley arc', .74, .016, 'vfx_glow', tilt=.42, twist=1.6, delay=.04)
    spikes(8 + RNG.randint(0, 4), .9, .38, 'vfx_glow', size=.04, delay=.07)
    motes(8 + RNG.randint(0, 3), .9, .06, 'vfx_glow', rise=.5)


def build_bloom():
    """Thánh quang: cánh hoa nở, cột sáng và hạt chữa trị bay lên."""
    petals = 6 + RNG.randint(0, 4)
    for i in range(petals):
        ico(f'Petal {i + 1}', .13, 'vfx_core' if i % 2 else 'vfx_glow', role='orbit',
            phase=i / petals * TAU, spread=.55 + RNG.random() * .18, tilt=.1, twist=.4)
    cone('Pillar', .3, .16, 1.4, 'vfx_halo', role='column', base=(0, 0, .7),
         reach=1.4 + RNG.random() * .5, twist=.5)
    torus('Grace ring', .7 + RNG.random() * .2, .016, 'vfx_glow', tilt=1.28, twist=1.2)
    motes(9 + RNG.randint(0, 5), .95, .05, 'vfx_core', rise=.7, delay=.08)
    ico('Heart light', .14, 'vfx_glow', role='core', base=(0, 0, .35))


def build_storm():
    """Bão/hắc ám: tia chớp tỏa, cầu lệch tâm và vành xung kích nghiêng."""
    bolts = 9 + RNG.randint(0, 4)
    for i in range(bolts):
        cone(f'Bolt {i + 1}', .052, .004, .72 + RNG.random() * .18, 'vfx_glow', role='spike',
             phase=i / bolts * TAU + RNG.random() * .3, spread=.9 + RNG.random() * .25,
             delay=.04 + (i % 3) * .03)
    torus('Shock ring', .84, .026, 'vfx_alt', tilt=1.22, twist=1.8)
    torus('Upper ring', .56, .018, 'vfx_glow', tilt=.9, twist=-2.2, delay=.05)
    torus('Inner ring', .34, .012, 'vfx_core', tilt=.6, twist=2.6, delay=.02)
    ico('Void core', .22, 'vfx_core', role='core')
    spikes(10, 1.15, .42, 'vfx_alt', size=.045, delay=.09)
    motes(10, 1.05, .06, 'vfx_glow', rise=.5, delay=.12)


def build_gunfire():
    """Súng: chớp đầu nòng, vệt đạn xuyên và vành xung kích nhỏ."""
    cone('Muzzle blast', .34, .04, .7, 'vfx_glow', role='lance', axis='X',
         reach=1.8, twist=.2)
    cone('Muzzle flare', .2, 0.0, .5, 'vfx_core', role='lance', axis='X',
         base=(0, 0, .12), reach=1.4, twist=-.3, delay=.01)
    tracers = 5 + RNG.randint(0, 4)
    for i in range(tracers):
        cone(f'Tracer {i + 1}', .05, .006, .85 + RNG.random() * .2, 'vfx_core', role='dart', axis='X',
             phase=-.5 + i * .16, spread=.45 + i * .06 + RNG.random() * .08, delay=i * .015, twist=1.4)
    rings(2, [.55, .78], [1.32, 1.2], ['vfx_glow', 'vfx_alt'], minor=.016, delay=.04)
    spikes(10, .85, .34, 'vfx_glow', size=.036, delay=.05)
    motes(8, .8, .05, 'vfx_alt', rise=.4, delay=.1)


FAMILIES = {'sigil': build_sigil, 'strike': build_strike, 'lance': build_lance,
            'volley': build_volley, 'bloom': build_bloom, 'storm': build_storm,
            'gunfire': build_gunfire}


def studio():
    scene = bpy.context.scene
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (.02, .03, .06, 1)
    bg.inputs[1].default_value = .35
    data = bpy.data.cameras.new('Preview camera')
    cam = bpy.data.objects.new('Preview camera', data)
    bpy.context.collection.objects.link(cam)
    cam.location = (0, -6.5, 0)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    data.type = 'ORTHO'
    data.ortho_scale = 3.1
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 12
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    scene.render.resolution_x = 340
    scene.render.resolution_y = 340
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.render.fps = FPS
    scene.frame_start = 0


def previews():
    scene = bpy.context.scene
    for clip, duration in DURATIONS.items():
        for obj in bpy.data.objects:
            if obj.animation_data:
                for track in obj.animation_data.nla_tracks:
                    track.mute = track.name != clip
        scene.frame_set(round(duration * .55 * FPS))
        scene.render.filepath = str(EVIDENCE / f'{clip}.png')
        bpy.ops.render.render(write_still=True)
    for obj in bpy.data.objects:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:
                track.mute = False
    scene.frame_set(0)


if __name__ == '__main__':
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    build_materials()
    FAMILIES[S['family']]()
    animate()
    studio()
    root = bpy.data.objects.new('vfx_root', None)
    bpy.context.collection.objects.link(root)
    for part in parts:
        part.obj.parent = root
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / (S['id'] + '.blend')), compress=True)
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.obj.select_set(True)
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(OUT / (S['id'] + '.glb')), export_format='GLB',
                              use_selection=True, export_animations=True,
                              export_yup=True, export_force_sampling=True,
                              export_animation_mode='NLA_TRACKS', export_extras=True,
                              export_cameras=False, export_lights=False)
    blob = (OUT / (S['id'] + '.glb')).read_bytes()
    size = int.from_bytes(blob[12:16], 'little')
    gltf = json.loads(blob[20:20 + size])
    actual = []
    for anim in gltf['animations']:
        accessors = [gltf['accessors'][x['input']] for x in anim['samplers']]
        start = min(x['min'][0] for x in accessors)
        end = max(x['max'][0] for x in accessors)
        assert abs(start) < 1e-6 and abs(end - DURATIONS[anim['name']]) < 1e-6, (anim['name'], start, end)
        actual.append({'name': anim['name'], 'seconds': round(end, 6), 'channels': len(anim['channels'])})
    assert {a['name'] for a in actual} == set(DURATIONS), [a['name'] for a in actual]
    assert not gltf.get('images'), 'No external textures'
    vertices = sum(len(mesh.vertices) for mesh in bpy.data.meshes)
    triangles = sum(len(p.vertices) - 2 for mesh in bpy.data.meshes for p in mesh.polygons)
    report = {
        'id': S['id'], 'heroId': S['heroId'], 'name': S['name'], 'family': S['family'],
        'source': f"assets-source/vfx/{S['id']}/{S['id']}.blend", 'asset': S['id'] + '.glb',
        'generator': 'tools/build-vfx.py', 'blender': bpy.app.version_string,
        'origin': 'Locally generated emissive geometry and keyed object transforms; no downloaded meshes or textures.',
        'note': S['note'],
        'rights': 'New geometry does not establish rights to referenced character identities/designs.',
        'coordinates': {'up': 'Y', 'front': 'Z', 'origin': 'Effect center; hero models anchor feet separately.'},
        'animations': actual,
        'runtimeContract': 'Presentation only. The simulation owns cast timing, damage and cooldown; this asset only decides shape over time.',
        'limitations': ['Procedural stylized study, not a human-approved effect design.',
                        'Opacity, tint intensity and world placement are set at runtime, not baked.'],
        'metrics': {'glbBytes': len(blob), 'glbSha256': hashlib.sha256(blob).hexdigest(),
                    'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    'specSha256': hashlib.sha256((ROOT / 'tools/hero-vfx.json').read_bytes()).hexdigest(),
                    'objects': len(parts), 'vertices': vertices, 'triangles': triangles,
                    'meshes': len(gltf['meshes']), 'materials': len(gltf.get('materials', []))},
    }
    (OUT / (S['id'] + '.provenance.json')).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    (EVIDENCE / 'export.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('VFX_EXPORT', json.dumps({'id': S['id'], **report['metrics'],
                                    'clips': [a['name'] for a in actual]}), flush=True)
    if not args.no_preview:
        previews()
