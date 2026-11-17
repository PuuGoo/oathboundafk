# PROTOTYPE - NOT FOR PRODUCTION
"""Dựng sân đấu 3D cho một theme.

Chạy: 'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe' --background \
  --threads 2 --python-exit-code 1 --python tools/build-arena.py -- temple

Sân nằm trong mặt phẳng XZ, tâm ở gốc, bán kính 100 đơn vị, Y là pháp tuyến sàn.
Hai clip: `idle` 4 s (loop, lửa và hạt trôi) và `pulse` 1,65 s (vòng sáng lan khi
tung tuyệt kỹ). Hình học sinh cục bộ, không tải texture hay mesh ngoài.
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
SPECS = json.loads((ROOT / 'tools/arena-themes.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser()
parser.add_argument('arena', choices=[s['id'] for s in SPECS])
parser.add_argument('--no-preview', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
A = next(s for s in SPECS if s['id'] == args.arena)
OUT = ROOT / 'public/assets/arenas'
SOURCE = ROOT / 'assets-source/arenas' / A['id']
EVIDENCE = ROOT / 'production/qa/evidence/arena3d' / A['id']
for folder in (OUT, SOURCE, EVIDENCE):
    folder.mkdir(parents=True, exist_ok=True)

RADIUS = 100.0
DURATIONS = {'idle': 4.0, 'pulse': 1.65}
FPS = 60
TAU = math.tau
GLOW = float(A.get('glow', .45))
RNG = random.Random(int(hashlib.sha256(A['id'].encode()).hexdigest()[:8], 16))

# Vật thể tĩnh (sàn, viền, bệ) và vật thể động (lửa, hạt, vòng sáng).
STATIC = []
ANIMATED = []


def srgb(value):
    channels = []
    for i in (0, 2, 4):
        raw = int(value[i:i + 2], 16) / 255
        channels.append(((raw + .055) / 1.055) ** 2.4 if raw > .04045 else raw / 12.92)
    return tuple(channels)


MATERIALS = {}


def material(name, color, metal, rough, glow=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    node = m.node_tree.nodes.get('Principled BSDF')
    rgba = (*srgb(color), 1)
    node.inputs['Base Color'].default_value = rgba
    node.inputs['Metallic'].default_value = metal
    node.inputs['Roughness'].default_value = rough
    if glow:
        node.inputs['Emission Color'].default_value = rgba
        node.inputs['Emission Strength'].default_value = glow
    m.diffuse_color = rgba
    MATERIALS[name] = m
    return m


def build_materials():
    material('arena_floor', A['floor'], .25, .62)
    material('arena_trim', A['secondary'], .55, .38)
    material('arena_prop', A['primary'], .2, .55)
    material('arena_glow', A['accent'], .1, .25, 1.6 + GLOW * 3)
    material('arena_ember', A['accent'], .0, .3, 2.6)


def to_blender(loc, rotation=False):
    """Hệ tác giả (Y-up, -Z là hướng camera) -> hệ Blender (Z-up, +Y là hướng camera).

    Blender xuất glTF với `export_yup=True`, biến (x, y, z) thành (x, z, -y).
    Mọi toạ độ/góc trong file này viết theo hệ tác giả, nên phải đổi trước khi dựng
    hình — nếu không đài lửa và cột sẽ nằm ngang dưới sàn thay vì đứng trên sàn.
    """
    x, y, z = loc
    if rotation:
        # Xoay quanh trục đứng: Blender Z thay cho trục Y của tác giả, cùng dấu.
        return (x, -z, y)
    return (x, -z, y)


def to_blender_extent(vec):
    """Kích thước là độ lớn, không phải hướng: chỉ đổi trục, không đổi dấu."""
    x, y, z = vec
    return (x, z, y)


def finish(obj, name, mat, smooth=True):
    obj.name = name
    obj.data.materials.append(MATERIALS[mat])
    for poly in obj.data.polygons:
        poly.use_smooth = smooth
    return obj


def cyl(name, radius, depth, mat, loc=(0, 0, 0), role=None, **params):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=depth, location=to_blender(loc))
    obj = finish(bpy.context.object, name, mat)
    obj.rotation_mode = 'XYZ'
    register(obj, role, loc, **params)
    return obj


def torus(name, radius, minor, mat, loc=(0, 0, 0), role=None, **params):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=minor,
                                     major_segments=64, minor_segments=6, location=to_blender(loc))
    obj = finish(bpy.context.object, name, mat)
    obj.rotation_mode = 'XYZ'
    register(obj, role, loc, **params)
    return obj


def box(name, size, mat, loc=(0, 0, 0), rotation=(0, 0, 0), role=None, **params):
    bpy.ops.mesh.primitive_cube_add(size=1, location=to_blender(loc))
    obj = finish(bpy.context.object, name, mat, smooth=False)
    obj.scale = to_blender_extent(size)
    obj.rotation_euler = to_blender(loc=rotation, rotation=True)
    bpy.context.view_layer.objects.active = obj
    # Nướng cả scale lẫn rotation vào mesh: hình khối phải giữ hướng đã tác giả.
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.rotation_euler = (0, 0, 0)
    register(obj, role, loc, **params)
    return obj


def ico(name, radius, mat, loc=(0, 0, 0), role=None, subdiv=1, **params):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, subdivisions=subdiv, location=to_blender(loc))
    obj = finish(bpy.context.object, name, mat)
    obj.rotation_mode = 'XYZ'
    register(obj, role, loc, **params)
    return obj


def register(obj, role, loc, **params):
    """Ghi lại vị trí theo hệ Y-up của tác giả, không phải hệ Z-up của Blender."""
    obj.rotation_mode = 'XYZ'
    record = {'obj': obj, 'role': role, 'base': tuple(loc), **params}
    (ANIMATED if role else STATIC).append(record)
    return obj


def build_floor():
    """Sàn đá nhiều lớp: đĩa chính, bậc trong và vành đáy dày để có bóng đổ."""
    cyl('Arena base', RADIUS, 10, 'arena_floor', (0, -6, 0))
    cyl('Arena surface', RADIUS * .99, 4, 'arena_floor', (0, 0, 0))
    cyl('Arena inner dais', RADIUS * .46, 2.4, 'arena_floor', (0, 2, 0))
    torus('Outer rim', RADIUS * .985, 2.6, 'arena_trim', (0, 1, 0))
    for index, factor in enumerate((.38, .52, .68, .86)):
        torus(f'Inlay ring {index + 1}', RADIUS * factor, 1.1 + index * .15,
              'arena_glow' if index % 2 == 0 else 'arena_trim', (0, 2.05 + (index % 2) * .2, 0))
    for index in range(12):
        angle = index / 12 * TAU
        mid = RADIUS * .62
        box(f'Spoke {index + 1}', (RADIUS * .42, .9, 2.4), 'arena_trim',
            (math.cos(angle) * mid, 2.2, math.sin(angle) * mid),
            (0, -angle, 0))
    for index in range(8):
        angle = index / 8 * TAU + TAU / 16
        box(f'Sigil bar {index + 1}', (16, 1.2, 2.2), 'arena_glow',
            (math.cos(angle) * 26, 2.6, math.sin(angle) * 26), (0, -angle, 0))
    torus('Dais crown', RADIUS * .46, 1.6, 'arena_trim', (0, 3.2, 0))


def build_rim():
    """Vành ngoài: trụ thấp quanh sân, chỉ cao ở nửa xa để không che nhân vật."""
    for index in range(24):
        angle = index / 24 * TAU
        far = math.sin(angle) < -.15
        height = 9 + RNG.random() * 4 if far else 3.4 + RNG.random()
        box(f'Rim block {index + 1}', (7, height, 7), 'arena_prop',
            (math.cos(angle) * RADIUS * 1.02, height / 2 - 2, math.sin(angle) * RADIUS * 1.02),
            (0, -angle + math.pi / 8, 0))


def build_props():
    """Cột và chậu lửa đặt ở nửa xa (z âm) để luôn nằm sau nhân vật."""
    for index in range(5):
        angle = math.pi * (1.06 + .19 * index)
        x, z = math.cos(angle) * RADIUS * 1.12, math.sin(angle) * RADIUS * 1.12
        cyl(f'Pillar shaft {index + 1}', 5.5, 46, 'arena_prop', (x, 20, z))
        cyl(f'Pillar base {index + 1}', 8.5, 6, 'arena_trim', (x, 0, z))
        cyl(f'Pillar capital {index + 1}', 8, 5, 'arena_trim', (x, 43, z))
        bowl = ico(f'Brazier {index + 1}', 5.2, 'arena_glow', (x, 50, z),
                   role='flame', phase=RNG.random() * TAU, rate=1.0 + RNG.random() * .8)
        bowl.scale = (1, .7, 1)
        ico(f'Flame {index + 1}', 3.4, 'arena_ember', (x, 54, z), role='flame',
            phase=RNG.random() * TAU, rate=1.4 + RNG.random(), rise=3.0)
    for index in range(7):
        angle = -0.9 + index * .3
        x, z = math.cos(angle) * RADIUS * .74, math.sin(angle) * RADIUS * .74
        cyl(f'Banner pole {index + 1}', .8, 30 + RNG.random() * 12, 'arena_trim',
            (x, 14, z))
        box(f'Banner cloth {index + 1}', (7, 12, .6), 'arena_trim',
            (x + 3.4, 24, z), (0, 0, 0), role='banner',
            phase=RNG.random() * TAU, sway=.03 + RNG.random() * .03)


def build_backdrop():
    """Tường thành xa và hai tháp canh: tạo chiều sâu phía sau nhân vật.

    Cùng material với sàn/viền/ánh sáng nên `join_static()` gộp luôn vào các mesh
    tĩnh sẵn có: hậu cảnh không thêm draw call nào.
    """
    wall_radius = RADIUS * 1.34
    for index in range(11):
        theta = -1.05 + index * .21
        x, z = wall_radius * math.sin(theta), -wall_radius * math.cos(theta)
        # Cao độ chọn theo phép chiếu thật: đỉnh tường nằm trong khung, không bị cắt.
        height = 20 + 12 * max(0.0, math.cos(theta * 1.15))
        box(f'Back wall {index + 1}', (26, height, 14), 'arena_prop',
            (x, height / 2 - 4, z), (0, -theta, 0))
        box(f'Wall cap {index + 1}', (30, 4, 18), 'arena_trim',
            (x, height - 2, z), (0, -theta, 0))
        if index % 2 == 0:
            box(f'Wall window {index + 1}', (9, height * .34, 2.4), 'arena_glow',
                (x, height * .55, z + 8), (0, -theta, 0))
        for slot in range(3):
            box(f'Wall merlon {index + 1}-{slot + 1}', (4, 4, 4), 'arena_trim',
                (x + (slot - 1) * 8 * math.cos(theta), height + 1, z), (0, -theta, 0))
    for side in (-1, 1):
        theta = side * 1.22
        x, z = wall_radius * 1.02 * math.sin(theta), -wall_radius * 1.02 * math.cos(theta)
        cyl(f'Back tower {side}', 11, 26, 'arena_trim', (x, 13, z))
        cyl(f'Tower crown {side}', 13, 5, 'arena_trim', (x, 27, z))
        ico(f'Tower light {side}', 4, 'arena_glow', (x, 31, z))
    gate = torus('Back gate', 12, 1.4, 'arena_glow', (0, 12, -wall_radius + 3))
    gate.rotation_euler = (math.pi / 2, 0, 0)


def build_atmosphere():
    """Hạt sáng trôi và vòng sáng trung tâm: chuyển động nhẹ khi đứng yên."""
    for index in range(16):
        angle = RNG.random() * TAU
        ring_radius = RADIUS * (.3 + RNG.random() * .7)
        ico(f'Mote {index + 1}', .9 + RNG.random() * 1.2, 'arena_glow',
            (math.cos(angle) * ring_radius, 8 + RNG.random() * 40, math.sin(angle) * ring_radius),
            role='mote', phase=RNG.random() * TAU, drift=.35 + RNG.random() * .5,
            rise=4 + RNG.random() * 8, orbit=ring_radius)
    torus('Pulse ring', RADIUS * .5, 1.4, 'arena_glow', (0, 3.4, 0), role='pulse')
    torus('Idle halo', RADIUS * .99, 1.0, 'arena_glow', (0, 1.2, 0), role='halo')


def transform(record, u, clip):
    role = record['role']
    phase = record.get('phase', 0.0)
    # Idle là chuyển động qua lại mềm: cùng pose và vận tốc bằng 0 ở hai đầu.
    # Tần số riêng của từng vật thể vẫn dùng được mà không nhảy khi loop về 0.
    t = (1 - math.cos(u * TAU)) * .5 if clip == 'idle' else u
    if role == 'flame':
        flicker = .78 + .22 * math.sin(t * TAU * record.get('rate', 1.0) * 2 + phase)
        if clip == 'pulse':
            flicker *= 1 + .35 * math.sin(min(1, t * 1.6) * math.pi)
        scale = flicker
        rise = math.sin(t * TAU * 1.4 + phase) * record.get('rise', 0) * .12
        loc = (record['base'][0], record['base'][1] + rise, record['base'][2])
        return loc, (0, t * TAU * .3 + phase, 0), (scale, scale * (1 + .12 * math.sin(t * TAU * 3 + phase)), scale)
    if role == 'banner':
        angle = record.get('sway', .04)
        sway = math.sin(t * TAU * 1.2 + phase) * angle
        return record['base'], (0, sway * 2, sway), (1, 1, 1)
    if role == 'mote':
        drift = record.get('drift', .4)
        angle = phase + t * TAU * drift
        radius = record.get('orbit', RADIUS * .6)
        height = record['base'][1] + math.sin(t * TAU * (.5 + drift) + phase) * record.get('rise', 5)
        loc = (math.cos(angle) * radius, height, math.sin(angle) * radius)
        return loc, (t * TAU * .6, t * TAU * .4 + phase, 0), (1, 1, 1)
    if role == 'pulse':
        # Chỉ hiện trong clip pulse: lan từ tâm ra vành rồi tắt.
        if clip != 'pulse':
            return record['base'], (0, 0, 0), (0.001, 0.001, 0.001)
        grow = .2 + min(1.0, t * 1.25) * 1.9
        fade = max(0.0, 1 - t * 1.1)
        return record['base'], (0, 0, 0), (grow, max(0.001, fade), grow)
    if role == 'halo':
        spin = t * TAU * .12
        return record['base'], (0, spin, 0), (1, 1, 1)
    return record['base'], (0, 0, 0), (1, 1, 1)


def animate():
    for record in ANIMATED:
        obj = record['obj']
        obj.animation_data_create()
        for clip, duration in DURATIONS.items():
            action = bpy.data.actions.new(f'{clip}:{obj.name}')
            action.use_fake_user = True
            obj.animation_data.action = action
            steps = 24 if clip == 'idle' else 16
            for index in range(steps + 1):
                u = index / steps
                loc, rot, scale = transform(record, u, clip)
                obj.location = to_blender(loc)
                obj.rotation_euler = to_blender(loc=rot, rotation=True)
                obj.scale = to_blender_extent(scale)
                frame = round(u * duration * FPS)
                for path in ('location', 'rotation_euler', 'scale'):
                    obj.keyframe_insert(path, frame=frame)
            track = obj.animation_data.nla_tracks.new()
            track.name = clip
            track.strips.new(clip, 0, action)
            obj.animation_data.action = None
        for track in obj.animation_data.nla_tracks:
            track.mute = False
        # Đưa về pose idle ở frame 0 để .blend mở ra là thấy sân đúng.
        idle_loc, idle_rot, idle_scale = transform(record, 0.0, 'idle')
        obj.location = to_blender(idle_loc)
        obj.rotation_euler = to_blender(loc=idle_rot, rotation=True)
        obj.scale = to_blender_extent(idle_scale)


def join_static():
    """Gộp mọi mesh tĩnh cùng material thành một mesh: 110 draw call -> vài draw call.

    Vật thể động giữ riêng vì mỗi cái có track NLA độc lập.
    """
    groups = {}
    for record in STATIC:
        obj = record['obj']
        key = obj.data.materials[0].name if obj.data.materials else 'none'
        groups.setdefault(key, []).append(obj)
    merged = []
    for key, objects in groups.items():
        if len(objects) < 2:
            merged.extend(objects)
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        active = objects[0]
        bpy.context.view_layer.objects.active = active
        bpy.ops.object.join()
        active.name = f'Arena static {key}'
        merged.append(active)
    STATIC.clear()
    for obj in merged:
        STATIC.append({'obj': obj, 'role': None, 'base': tuple(obj.location)})


def studio():
    """Camera nghiêng 42° để đĩa sàn chiếu thành ellipse, đèn theo bảng màu theme."""
    scene = bpy.context.scene
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes['Background']
    background.inputs[0].default_value = (*srgb(A['secondary']), 1)
    background.inputs[1].default_value = .35
    key = bpy.data.lights.new('Key', 'SUN')
    key.energy = 3.2
    key.color = srgb(A['primary'])
    key_object = bpy.data.objects.new('Key', key)
    bpy.context.collection.objects.link(key_object)
    key_object.rotation_euler = (math.radians(52), 0, math.radians(35))
    fill = bpy.data.lights.new('Fill', 'AREA')
    fill.energy = 2200
    fill.size = 180
    fill.color = srgb(A['accent'])
    fill_object = bpy.data.objects.new('Fill', fill)
    bpy.context.collection.objects.link(fill_object)
    fill_object.location = to_blender((0, 90, -110))
    fill_object.rotation_euler = (math.radians(52), 0, 0)
    data = bpy.data.cameras.new('Preview camera')
    camera = bpy.data.objects.new('Preview camera', data)
    bpy.context.collection.objects.link(camera)
    elevation = math.radians(42)
    distance = 460
    camera.location = to_blender((0, math.sin(elevation) * distance, math.cos(elevation) * distance))
    camera.rotation_euler = (math.radians(90) - elevation, 0, 0)
    data.type = 'ORTHO'
    data.ortho_scale = RADIUS * 2.5
    scene.camera = camera
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    scene.render.resolution_x = 420
    scene.render.resolution_y = 380
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
        scene.frame_set(round(duration * .4 * FPS))
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
    build_floor()
    build_rim()
    build_props()
    build_backdrop()
    build_atmosphere()
    join_static()
    animate()
    studio()
    root = bpy.data.objects.new('arena_root', None)
    bpy.context.collection.objects.link(root)
    for record in STATIC + ANIMATED:
        record['obj'].parent = root
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / (A['id'] + '.blend')), compress=True)
    bpy.ops.object.select_all(action='DESELECT')
    for record in STATIC + ANIMATED:
        record['obj'].select_set(True)
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(OUT / (A['id'] + '.glb')), export_format='GLB',
                              use_selection=True, export_animations=True,
                              export_yup=True, export_force_sampling=True,
                              export_animation_mode='NLA_TRACKS', export_extras=True,
                              export_cameras=False, export_lights=False)
    blob = (OUT / (A['id'] + '.glb')).read_bytes()
    size = int.from_bytes(blob[12:16], 'little')
    gltf = json.loads(blob[20:20 + size])
    actual = []
    for animation in gltf['animations']:
        accessors = [gltf['accessors'][x['input']] for x in animation['samplers']]
        start = min(x['min'][0] for x in accessors)
        end = max(x['max'][0] for x in accessors)
        assert abs(start) < 1e-6, (animation['name'], start)
        assert abs(end - DURATIONS[animation['name']]) < 1e-5, (animation['name'], end)
        actual.append({'name': animation['name'], 'seconds': round(end, 6),
                       'channels': len(animation['channels'])})
    assert {entry['name'] for entry in actual} == set(DURATIONS), [e['name'] for e in actual]
    assert not gltf.get('images'), 'No texture downloads'
    vertices = sum(len(mesh.vertices) for mesh in bpy.data.meshes)
    triangles = sum(len(poly.vertices) - 2 for mesh in bpy.data.meshes for poly in mesh.polygons)
    report = {
        'id': A['id'], 'theme': A['theme'], 'name': A['name'], 'radius': RADIUS,
        'source': f"assets-source/arenas/{A['id']}/{A['id']}.blend", 'asset': A['id'] + '.glb',
        'generator': 'tools/build-arena.py', 'blender': bpy.app.version_string,
        'origin': 'Locally generated geometry and keyed object transforms; no downloaded meshes or textures.',
        'note': A['note'],
        'rights': 'New geometry does not establish rights to referenced designs.',
        'coordinates': {'up': 'Y', 'floorPlane': 'XZ', 'center': 'Arena center at origin'},
        'animations': actual,
        'runtimeContract': 'Background presentation only. Simulation owns positions; runtime scales the disc to the drawn arena ellipse.',
        'limitations': ['Procedural study, not a human-approved art pass.',
                        'Fog, bloom and colour grading are applied at runtime, not baked.'],
        'metrics': {'glbBytes': len(blob), 'glbSha256': hashlib.sha256(blob).hexdigest(),
                    'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    'specSha256': hashlib.sha256((ROOT / 'tools/arena-themes.json').read_bytes()).hexdigest(),
                    'staticObjects': len(STATIC), 'animatedObjects': len(ANIMATED),
                    'vertices': vertices, 'triangles': triangles,
                    'meshes': len(gltf['meshes']), 'materials': len(gltf.get('materials', []))},
    }
    (OUT / (A['id'] + '.provenance.json')).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    (EVIDENCE / 'export.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('ARENA_EXPORT', json.dumps({'id': A['id'], **report['metrics'],
                                      'clips': [entry['name'] for entry in actual]}), flush=True)
    if not args.no_preview:
        previews()
