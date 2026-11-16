# PROTOTYPE - NOT FOR PRODUCTION
"""Build an original stylized Belinda-inspired articulated study; no downloaded meshes.
Run: blender --background --python tools/build-belinda.py
All geometry, rig weights and clips are generated locally and remain editable.
"""
from pathlib import Path
import bpy
import math
import json
import hashlib
from mathutils import Vector, Euler

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets-source/belinda'
OUT = ROOT / 'public/assets/models'
EVIDENCE = ROOT / 'production/qa/evidence/belinda3d'
for folder in (SOURCE, OUT, EVIDENCE):
    folder.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
bpy.context.scene.render.fps = 60
bpy.context.scene.render.fps_base = 1
bpy.context.scene.frame_start = 0

materials = {}
def mat(name, color, metallic=0, roughness=.45, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    materials[name] = m
    return m
mat('Porcelain silk', (.87,.84,.73), 0,.58)
mat('Ivory highlights', (1,.96,.84), 0,.32)
mat('Antique gold', (.67,.35,.065), .7,.29)
mat('Gold light', (1,.65,.17), .65,.25)
mat('Deep navy lining', (.025,.055,.10), .12,.58)
mat('Blonde hair', (.72,.40,.105), .15,.39)
mat('Hair light', (.97,.70,.29), .16,.36)
mat('Skin', (.91,.61,.43), 0,.6)
mat('Skin shadow', (.62,.29,.21), 0,.65)
mat('Eye white', (.94,.94,.89), 0,.35)
mat('Iris', (.045,.32,.48), .2,.25)
mat('Pupil', (.009,.014,.023), 0,.4)
mat('Lips', (.45,.095,.11), 0,.48)
mat('Azure crystal', (.025,.52,.95), .45,.2,1.2)
mat('Gem light', (.42,.9,1), .2,.15,1.8)

# Each mesh part receives one rigid bone weight, then joins a single skinned mesh.
parts = []
def finish(obj, name, material, bone='spine', smooth=True):
    obj.name = name
    obj.data.materials.append(materials[material])
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    parts.append(obj)
    return obj

def sphere(name, loc, scale, material, bone='spine', segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    o = bpy.context.object
    o.scale = scale
    return finish(o, name, material, bone)

def link(name, a, b, radius, material, bone, radius2=None, vertices=16):
    a,b = Vector(a),Vector(b)
    delta=b-a
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
        radius2=radius if radius2 is None else radius2, depth=delta.length, location=(a+b)/2)
    o=bpy.context.object
    o.rotation_euler=delta.to_track_quat('Z','Y').to_euler()
    return finish(o,name,material,bone)

def curve(name, points, radius, material, bone='spine', sharp=False):
    c=bpy.data.curves.new(name, 'CURVE'); c.dimensions='3D'; c.resolution_u=8
    c.bevel_depth=radius; c.bevel_resolution=2
    s=c.splines.new('BEZIER'); s.bezier_points.add(len(points)-1)
    for p,co in zip(s.bezier_points,points):
        p.co=co; p.handle_left_type='VECTOR' if sharp else 'AUTO'; p.handle_right_type='VECTOR' if sharp else 'AUTO'
    o=bpy.data.objects.new(name,c); bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active=o; o.select_set(True)
    bpy.ops.object.convert(target='MESH'); o=bpy.context.object
    o.select_set(False)
    return finish(o,name,material,bone)

def lathe(name, rows, material, bone='spine', n=40, pleat=0):
    vs=[]; fs=[]
    for z,rx,ry in rows:
        for j in range(n):
            angle=2*math.pi*j/n
            fold=1+pleat*math.cos(angle*10)
            vs.append((rx*math.cos(angle)*fold, ry*math.sin(angle)*fold,z))
    for i in range(len(rows)-1):
        for j in range(n):
            a=i*n+j; b=i*n+(j+1)%n
            fs.append((a,b,b+n,a+n))
    fs.append(tuple(reversed(range(n))))
    fs.append(tuple((len(rows)-1)*n+j for j in range(n)))
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(vs,[],fs); mesh.update()
    o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o)
    return finish(o,name,material,bone)

# Coordinates: Blender Z up, -Y front; glTF exporter maps this to +Y up/+Z front.
lathe('Corset waist', [(1.32,.20,.14),(1.45,.205,.15),(1.65,.27,.18),(1.87,.285,.18)], 'Ivory highlights')
lathe('Layered navy underskirt',[(.13,.30,.23),(.4,.29,.22),(.8,.22,.16),(1.35,.16,.11)],'Deep navy lining','skirt',pleat=.035)
lathe('Flowing ivory bell skirt',[(.16,.46,.33),(.22,.47,.34),(.55,.39,.29),(1.0,.26,.20),(1.35,.21,.15)],'Porcelain silk','skirt',pleat=.045)
lathe('Golden skirt hem',[(.16,.465,.335),(.20,.48,.347),(.245,.465,.337)],'Antique gold','skirt',pleat=.045)
lathe('Gown belt',[(1.34,.222,.164),(1.39,.225,.165),(1.43,.216,.16)],'Antique gold','hips')
# Front long split gold lines and central tabard read at small game size.
for sign in (-1,1):
    curve('Swept gold front embroidery',[(sign*.17,-.143,1.37),(sign*.18,-.206,1.04),(sign*.29,-.285,.56),(sign*.40,-.305,.23)],.012,'Gold light','skirt')
    curve('Corset gold seam',[(sign*.18,-.133,1.40),(sign*.16,-.175,1.61),(sign*.22,-.159,1.83)],.010,'Antique gold')
    sphere('Boot', (sign*.16,-.045,.12),(.105,.17,.12),'Ivory highlights','leg.'+('L' if sign<0 else 'R'))
    link('Boot gold toe', (sign*.16,-.18,.085),(sign*.16,-.23,.085),.065,'Antique gold','leg.'+('L' if sign<0 else 'R'))
# Gold breastplate filigree and blue jewel.
for sign in (-1,1):
    curve('Winged chest motif',[(0,-.192,1.76),(sign*.09,-.196,1.81),(sign*.21,-.17,1.84)],.019,'Gold light')
    curve('Leaf chest lower',[(0,-.20,1.74),(sign*.07,-.204,1.67),(sign*.15,-.181,1.74)],.012,'Antique gold')
sphere('Chest azure jewel',(0,-.207,1.76),(.042,.025,.06),'Azure crystal')
link('Neck',(0,0,1.89),(0,0,2.04),.092,'Skin','head')
lathe('High gold collar',[(1.88,.12,.11),(1.94,.105,.10),(1.97,.105,.10)],'Antique gold','head',n=24)
# Arms: shaped upper/lower limbs, separate gloved hands; rig handles articulation.
for sign,side in ((-1,'L'),(1,'R')):
    shoulder=(sign*.285,0,1.88); elbow=(sign*.44,-.015,1.58); wrist=(sign*.49,-.105,1.30)
    link('Upper arm '+side,shoulder,elbow,.085,'Skin','upper.'+side,radius2=.065)
    link('Gloved forearm '+side,elbow,wrist,.073,'Ivory highlights','fore.'+side,radius2=.048)
    sphere('Hand '+side,(sign*.50,-.115,1.255),(.055,.052,.082),'Skin','hand.'+side)
    sphere('Sculpted shoulder armour '+side,(sign*.285,.005,1.865),(.14,.15,.095),'Antique gold','upper.'+side)
    sphere('Ivory shoulder crest '+side,(sign*.29,-.015,1.91),(.12,.135,.057),'Ivory highlights','upper.'+side)
    link('Glove rim '+side,(sign*.44,-.015,1.58),(sign*.448,-.028,1.55),.079,'Antique gold','fore.'+side)
    curve('Glove gold line '+side,[(sign*.45,-.080,1.54),(sign*.48,-.15,1.40),(sign*.49,-.15,1.33)],.009,'Gold light','fore.'+side)
    sphere('Earring '+side,(sign*.18,-.018,2.11),(.027,.027,.06),'Azure crystal','head')
# Head, ears, individual facial features, swept fringe and strand groups.
sphere('Head',(0,-.01,2.18),(.185,.155,.235),'Skin','head',32,20)
sphere('Chin',(0,-.055,2.045),(.115,.101,.105),'Skin','head')
for sign in (-1,1):
    sphere('Ear',(sign*.177,-.007,2.16),(.035,.032,.061),'Skin','head')
    sphere('Eye almond',(sign*.071,-.151,2.20),(.052,.017,.032),'Eye white','head')
    sphere('Iris',(sign*.070,-.168,2.201),(.024,.009,.026),'Iris','head')
    sphere('Pupil',(sign*.070,-.176,2.20),(.011,.005,.017),'Pupil','head')
    sphere('Eye catchlight',(sign*.065,-.181,2.212),(.007,.003,.008),'Eye white','head',12,8)
    curve('Upper eyelid',[(sign*.022,-.168,2.214),(sign*.069,-.174,2.232),(sign*.120,-.151,2.216)],.007,'Pupil','head')
    curve('Brow',[(sign*.025,-.155,2.26),(sign*.073,-.157,2.275),(sign*.118,-.137,2.26)],.009,'Blonde hair','head')
sphere('Nose bridge',(0,-.159,2.153),(.023,.024,.055),'Skin','head')
sphere('Nose tip',(0,-.18,2.132),(.029,.027,.023),'Skin','head')
curve('Upper lip',[(-.04,-.154,2.079),(-.015,-.168,2.084),(0,-.169,2.079),(.018,-.167,2.084),(.04,-.154,2.079)],.006,'Lips','head')
curve('Lower lip',[(-.031,-.158,2.073),(0,-.17,2.066),(.031,-.158,2.073)],.007,'Lips','head')
sphere('Hair cap',(0,.018,2.29),(.20,.17,.18),'Blonde hair','head',28,16)
# Back hair locks extend below waist, with alternating light strands.
for i in range(9):
    angle=math.pi*.05+math.pi*.90*i/8
    x=.18*math.cos(angle); y=.065+.10*math.sin(angle)
    endx=x*1.65
    curve('Long layered back hair',[(x,y,2.36),(x*1.10,y+.04,2.12),(x*1.25,y+.05,1.82),(endx,.10,1.45),(endx*.9,.055,1.35)],.044,'Hair light' if i%3==0 else 'Blonde hair','hair')
for sign in (-1,1):
    curve('Face framing curl',[(sign*.10,-.11,2.37),(sign*.18,-.09,2.28),(sign*.20,-.07,2.02),(sign*.24,-.10,1.83),(sign*.20,-.12,1.72)],.036,'Hair light','head')
    curve('Swept fringe',[(sign*.025,-.10,2.40),(sign*.08,-.15,2.36),(sign*.15,-.13,2.30),(sign*.18,-.10,2.25)],.038,'Hair light','head')
# Crown diadem follows head, no bitmap textures.
curve('Crown band',[(-.19,-.055,2.36),(-.12,-.15,2.38),(0,-.18,2.40),(.12,-.15,2.38),(.19,-.055,2.36)],.022,'Antique gold','head')
for i in range(-2,3):
    x=i*.065; top=2.54+(2-abs(i))*.047
    curve('Crown pointed filigree',[(x-.032,-.15,2.39),(x,-.14,top),(x+.032,-.15,2.39)],.013,'Gold light','head',sharp=True)
sphere('Crown blue jewel',(0,-.17,2.50),(.036,.021,.062),'Azure crystal','head',16,12)
# Staff rests in right hand. Long narrow shaft, sun ring and eight tipped rays.
SX=.51; SY=-.12
link('Sun staff shaft',(SX,SY,.09),(SX,SY,2.45),.018,'Antique gold','hand.R',vertices=16)
for z in (.17,.68,1.24,2.18,2.35):
    sphere('Staff collar',(SX,SY,z),(.034,.034,.047),'Gold light','hand.R',16,8)
curve('Sun ring',[(SX+.18*math.cos(2*math.pi*i/16),SY,2.59+.18*math.sin(2*math.pi*i/16)) for i in range(17)],.021,'Gold light','hand.R')
for i in range(8):
    a=i*math.pi/4
    p=(SX+.19*math.cos(a),SY,2.59+.19*math.sin(a))
    q=(SX+.28*math.cos(a),SY,2.59+.28*math.sin(a))
    link('Sun ray',p,q,.027,'Antique gold','hand.R',radius2=.003,vertices=8)
sphere('Staff central sapphire',(SX,SY,2.59),(.105,.055,.133),'Azure crystal','hand.R',16,12)
sphere('Staff glint',(SX-.025,SY-.05,2.625),(.023,.012,.035),'Gem light','hand.R',12,8)

# Armature: editable named skeleton and 100% explicit weights (rigid stylization).
bpy.ops.object.select_all(action='DESELECT')
arm_data=bpy.data.armatures.new('Belinda articulated rig')
rig=bpy.data.objects.new('BelindaRig',arm_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bones={
 'root':((0,0,0),(0,0,.3),None),
 'hips':((0,0,1.30),(0,0,1.50),'root'),
 'spine':((0,0,1.50),(0,0,1.91),'hips'),
 'head':((0,0,1.96),(0,0,2.38),'spine'),
 'hair':((0,.10,2.31),(0,.12,1.50),'head'),
 'skirt':((0,0,1.30),(0,0,.35),'hips'),
 'leg.L':((-.16,0,.95),(-.16,0,.10),'hips'),
 'leg.R':((.16,0,.95),(.16,0,.10),'hips'),
}
for sign,side in ((-1,'L'),(1,'R')):
    bones['upper.'+side]=((sign*.285,0,1.88),(sign*.44,-.015,1.58),'spine')
    bones['fore.'+side]=((sign*.44,-.015,1.58),(sign*.49,-.105,1.30),'upper.'+side)
    bones['hand.'+side]=((sign*.49,-.105,1.30),(sign*.50,-.115,1.22),'fore.'+side)
for name,(a,b,parent) in bones.items():
    bone=arm_data.edit_bones.new(name); bone.head=a; bone.tail=b
    if parent: bone.parent=arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front=True
for p in rig.pose.bones: p.rotation_mode='XYZ'
bpy.ops.object.select_all(action='DESELECT')
for p in parts: p.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join()
mesh=bpy.context.object; mesh.name='Belinda tailored mesh'
mod=mesh.modifiers.new('Belinda bone deformation','ARMATURE'); mod.object=rig
mesh.parent=rig

# Keyed poses in local bone radians, authored for exact engine durations.
def pose(frame, rotations=None, root_z=0, root_rotation=(0,0,0)):
    rotations=rotations or {}
    for b in rig.pose.bones:
        r=rotations.get(b.name,(0,0,0))
        if b.name.startswith(('upper.','fore.')):
            # Authored limb shorthand: X extends forward, Z lifts outward.
            # Conjugate WORLD axes into each slanted rest-bone basis; directly
            # writing Euler local axes otherwise sends both arms behind body.
            rest=b.bone.matrix_local.to_3x3()
            world=Euler((-r[0],-r[2],r[1]),'XYZ').to_matrix()
            b.rotation_euler=(rest.inverted() @ world @ rest).to_euler('XYZ')
        else:
            b.rotation_euler=r
        b.location=(0,0,0)
    # Root bone points up: local Y corresponds to world Z.
    rig.pose.bones['root'].location.y=root_z
    rig.pose.bones['root'].rotation_euler=root_rotation
    # Keep a falling figure resting on the battlefield plane, never under it.
    # Dynamic per-key height compensation is baked, not a runtime gameplay move.
    if abs(root_rotation[2]) > .2:
        bpy.context.view_layer.update()
        evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        lowest=min((evaluated.matrix_world @ v.co).z for v in evaluated.data.vertices)
        if lowest < 0:
            rig.pose.bones['root'].location.y -= lowest
    for b in rig.pose.bones:
        b.keyframe_insert('rotation_euler', frame=frame, group=b.name)
        b.keyframe_insert('location', frame=frame, group=b.name)

def animate(name, duration, poses):
    if rig.animation_data:
        for track in rig.animation_data.nla_tracks:
            track.mute=True
    action=bpy.data.actions.new(name); rig.animation_data_create(); rig.animation_data.action=action
    for t,rot,z,rootrot in poses:
        pose(round(t*60),rot,z,rootrot)
    track=rig.animation_data.nla_tracks.new(); track.name=name
    strip=track.strips.new(name,0,action); strip.name=name
    rig.animation_data.action=None
    return action
I=(0,0,0)
clips=[]
clips.append(animate('idle',2,[(0,{},0,I),(1,{'spine':(.015,0,-.018),'head':(-.015,0,.018),'hair':(.025,0,.02),'fore.L':(.03,0,-.05)},.012,I),(2,{},0,I)]))
clips.append(animate('run',.6,[(0,{'spine':(.08,0,0),'leg.L':(.35,0,0),'leg.R':(-.35,0,0),'upper.L':(-.22,0,.08),'hair':(-.08,0,.07),'skirt':(.06,0,.035)},.015,I),(.15,{'spine':(.08,0,.035),'leg.L':(0,0,0),'leg.R':(0,0,0),'upper.L':(0,0,.05),'hair':(-.13,0,0)},.05,I),(.3,{'spine':(.08,0,0),'leg.L':(-.35,0,0),'leg.R':(.35,0,0),'upper.L':(.22,0,.08),'hair':(-.08,0,-.07),'skirt':(-.06,0,-.035)},.015,I),(.45,{'spine':(.08,0,-.035),'hair':(-.13,0,0)},.05,I),(.6,{'spine':(.08,0,0),'leg.L':(.35,0,0),'leg.R':(-.35,0,0),'upper.L':(-.22,0,.08),'hair':(-.08,0,.07),'skirt':(.06,0,.035)},.015,I)]))
clips.append(animate('basic',.4,[(0,{},0,I),(.1,{'spine':(0,.12,-.12),'upper.R':(-.18,0,.35),'fore.R':(.35,0,0),'head':(0,0,.12),'upper.L':(0,0,-.15)},0,I),(.2,{'spine':(.10,-.08,.12),'upper.R':(.65,0,.10),'fore.R':(.12,0,0),'upper.L':(.15,0,-.3),'hair':(-.05,0,-.10)},.01,I),(.3,{'upper.R':(.25,0,.05),'spine':(.03,0,.03)},0,I),(.4,{},0,I)]))
clips.append(animate('active',1.15,[(0,{},0,I),(.3,{'spine':(-.06,0,-.12),'upper.R':(-.3,0,.6),'fore.R':(.6,0,0),'upper.L':(.2,0,-.7),'fore.L':(.5,0,0),'head':(-.05,0,.1)},.015,I),(.6,{'spine':(.09,0,.08),'upper.R':(.55,0,.1),'upper.L':(.65,0,-.25),'fore.L':(.2,0,0),'hair':(-.1,0,.06)},.025,I),(.85,{'upper.R':(.35,0,.05),'upper.L':(.45,0,-.2),'head':(0,0,-.07)},.01,I),(1.15,{},0,I)]))
ultimate_poses=[(0,{},0,I),(.25,{'upper.L':(.1,0,-.55),'upper.R':(-.15,0,.4),'fore.R':(.4,0,0),'head':(-.05,0,0)},.015,I),(.45,{'spine':(-.09,0,0),'upper.R':(-.4,0,1.05),'fore.R':(.7,0,0),'upper.L':(.3,0,-1.0),'fore.L':(.6,0,0),'head':(-.10,0,0),'hair':(.08,0,.07)},.08,I)]
for i,t in enumerate((.65,.85,1.05,1.25)):
    ultimate_poses.append((t,{'spine':(.02,0,(-1 if i%2 else 1)*.065),'upper.R':(-.20,0,.8),'fore.R':(.6,0,0),'upper.L':(.65,0,-.8),'fore.L':(.25,0,0),'head':(.02,0,.03),'hair':(-.09,0,(-1 if i%2 else 1)*.08),'skirt':(.02,0,.03)},.09,I))
    if i<3:
        ultimate_poses.append((t+.10,{'spine':(-.06,0,0),'upper.R':(-.35,0,1.0),'fore.R':(.7,0,0),'upper.L':(.45,0,-1.0),'fore.L':(.5,0,0),'head':(-.05,0,0),'hair':(.03,0,0)},.11,I))
ultimate_poses += [(1.45,{'upper.R':(-.15,0,.45),'upper.L':(.2,0,-.5),'hair':(.05,0,0)},.04,I),(1.65,{},0,I)]
clips.append(animate('ultimate',1.65,ultimate_poses))
clips.append(animate('hit',.3,[(0,{},0,I),(.08,{'spine':(-.15,0,-.12),'head':(-.12,0,.10),'upper.L':(.15,0,-.25),'hair':(.13,0,.1)},-.025,I),(.3,{},0,I)]))
clips.append(animate('death',1.2,[(0,{},0,I),(.25,{'spine':(.20,0,.20),'head':(.2,0,0),'upper.R':(.25,0,.25),'upper.L':(.1,0,-.2)},-.08,I),(.65,{'spine':(.35,0,.30),'head':(.25,0,-.1),'upper.R':(.4,0,.4),'upper.L':(.3,0,-.5),'skirt':(.1,0,.1),'hair':(-.1,0,0)},-.48,(0,0,.35)),(1.2,{'spine':(.3,0,.15),'head':(.2,0,-.1),'upper.R':(.4,0,.4),'upper.L':(.3,0,-.5),'hair':(-.1,0,0)},-.28,(0,0,1.38))]))
# NLA tracks are mutually exclusive at runtime. In .blend leave idle alone enabled.
for tr in rig.animation_data.nla_tracks: tr.mute=tr.name!='idle'
bpy.context.scene.frame_set(1)

# Studio preview setup is excluded from GLB export.
scene=bpy.context.scene
scene.world.color=(.045,.055,.085)
world=scene.world; world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.055,.075,.12,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.45

def area(name,loc,power,color,size):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.color=color; data.shape='DISK'; data.size=size
    o=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(o); o.location=loc
    o.rotation_euler=(Vector((0,0,1.5))-o.location).to_track_quat('-Z','Y').to_euler()
area('Warm key',(3,-4,5),550,(1,.87,.68),4)
area('Cool fill',(-3,-2,3),350,(.55,.75,1),3)
area('Hair rim',(1,3,4),650,(1,.75,.35),3)
cam_data=bpy.data.cameras.new('Preview camera'); camera=bpy.data.objects.new('Preview camera',cam_data); bpy.context.collection.objects.link(camera)
camera.location=(3.6,-7.5,3.0); camera.rotation_euler=(Vector((0,0,1.40))-camera.location).to_track_quat('-Z','Y').to_euler(); cam_data.type='ORTHO'; cam_data.ortho_scale=3.6
scene.camera=camera; scene.render.engine='CYCLES'; scene.cycles.samples=16
scene.render.resolution_x=700; scene.render.resolution_y=820; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
scene.view_settings.view_transform='AgX'
# Save standalone source, then export only model and armature; no studio lights/camera.
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'belinda.blend'))
bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active=rig
for tr in rig.animation_data.nla_tracks: tr.mute=False
export_props=bpy.ops.export_scene.gltf.get_rna_type().properties
kwargs=dict(filepath=str(OUT/'belinda.glb'),export_format='GLB',use_selection=True,export_animations=True,export_skins=True,export_yup=True,export_force_sampling=True)
if 'export_animation_mode' in export_props: kwargs['export_animation_mode']='NLA_TRACKS'
bpy.ops.export_scene.gltf(**kwargs)
for tr in rig.animation_data.nla_tracks: tr.mute=tr.name!='idle'
scene.frame_set(1); scene.render.filepath=str(EVIDENCE/'model-idle.png'); bpy.ops.render.render(write_still=True)
for tr in rig.animation_data.nla_tracks: tr.mute=tr.name!='ultimate'
scene.frame_set(39); scene.render.filepath=str(EVIDENCE/'model-ultimate.png'); bpy.ops.render.render(write_still=True)
for clip_name, preview_frame in (('basic',12),('active',36),('death',72)):
    for tr in rig.animation_data.nla_tracks: tr.mute=tr.name!=clip_name
    scene.frame_set(preview_frame)
    if clip_name=='death':
        # Wide retained inspection view: corpse extends left of its foot anchor.
        cam_data.ortho_scale=4.8
        camera.location=(2.6,-7.5,3.0)
        camera.rotation_euler=(Vector((-.6,0,1.15))-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(EVIDENCE/f'model-{clip_name}.png'); bpy.ops.render.render(write_still=True)
for tr in rig.animation_data.nla_tracks: tr.mute=tr.name!='idle'
scene.frame_set(1)
# Actual GLB inspection avoids claiming exporter output from Blender action names alone.
blob=(OUT/'belinda.glb').read_bytes(); size=int.from_bytes(blob[12:16],'little'); gltf=json.loads(blob[20:20+size])
actual=[]
for anim in gltf.get('animations',[]):
    times=[gltf['accessors'][s['input']] for s in anim['samplers']]
    actual.append({'name':anim.get('name'),'durationSeconds':round(max(a['max'][0] for a in times)-min(a['min'][0] for a in times),6),'channels':len(anim['channels'])})
expected_durations={'idle':2,'run':.6,'basic':.4,'active':1.15,'ultimate':1.65,'hit':.3,'death':1.2}
assert {a['name'] for a in actual} == set(expected_durations), 'Missing/renamed GLB clips'
for anim in gltf['animations']:
    start=min(gltf['accessors'][s['input']]['min'][0] for s in anim['samplers'])
    end=max(gltf['accessors'][s['input']]['max'][0] for s in anim['samplers'])
    assert abs(start)<1e-6, f'Nonzero clip timestamp origin: {anim["name"]}: {start}'
    assert abs(end-expected_durations[anim['name']])<1e-6, f'Unexpected duration: {anim["name"]}: {end}'
provenance={
 'asset':'belinda.glb','source':'assets-source/belinda/belinda.blend','generator':'tools/build-belinda.py',
 'created':'2026-11-16','blender':bpy.app.version_string,
 'origin':'Locally generated original stylized geometry, materials, rigid-weight armature and keyed actions; no downloaded model, textures, or official mesh.',
 'visualReference':'Existing project Belinda sprite: blonde hair, crown, white/gold gown, sun staff and blue jewel. Reference character identity is not asserted to be original or licensed by this mesh generation.',
 'rights':'Generated geometry is new; underlying referenced character identity/design rights are not established here. No claim of official authorization or studio-quality likeness.',
 'coordinates':{'up':'+Y','front':'+Z','feetOrigin':True,'restHeightApprox':2.87},
 'rig':{'bones':len(bones),'weighting':'Rigid 100%-per-part vertex bone weights; no cloth simulation, facial blendshapes, IK or hand finger rig.'},
 'animations':actual,
 'milestones':{'basic':{'release':.1,'contacts':[.2]},'active':{'release':.3,'contacts':[.6]},'ultimate':{'release':.45,'contacts':[.65,.85,1.05,1.25]}},
 'runtimeContract':'Animations present engine events only. Scrub clip local time from engine timeline; never drive damage from animation callbacks. Clamp death at last frame. Idle/run loop. Hit pauses under control.',
 'limitations':['First stylized procedural character study, not a sculpted commercial asset or official likeness.','Rigid skin weights produce joint intersections under extreme poses; gown and long hair are separate rigid bone-driven meshes, not simulated cloth.','No actual locomotion stride beneath full skirt beyond alternating boots; no authored facial animation.','No embedded target VFX or damage logic; existing game effects remain authoritative.'],
 'metrics':{'glbBytes':len(blob),'glbSha256':hashlib.sha256(blob).hexdigest(),'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'verticesBlender':len(mesh.data.vertices),'trianglesBlender':sum(len(p.vertices)-2 for p in mesh.data.polygons),'gltfMeshes':len(gltf.get('meshes',[])),'gltfPrimitives':sum(len(m['primitives']) for m in gltf.get('meshes',[]))},
 'previewCameraSuggestion':{'position':[3,1.9,6],'lookAt':[0,1.4,0],'orthographicVerticalSpan':3.6},
}
(OUT/'belinda.provenance.json').write_text(json.dumps(provenance,indent=2)+'\n',encoding='utf-8')
print('BELINDA_EXPORT_REPORT',json.dumps(provenance['metrics']),json.dumps(actual))
