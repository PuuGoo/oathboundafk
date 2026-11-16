# PROTOTYPE - NOT FOR PRODUCTION
"""Dựng từng tướng trong Blender: --background --threads 2 --python tools/build-heroes.py -- lucius.
Hình học mới, material và rig chỉnh sửa được; không tải mesh hoặc texture bên ngoài.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import sys
import bpy
from mathutils import Vector, Euler

ROOT = Path(__file__).resolve().parents[1]
SPECS = json.loads((ROOT / 'tools/hero-models.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser()
parser.add_argument('hero', choices=[s['id'] for s in SPECS])
parser.add_argument('--preview-only', action='store_true')
parser.add_argument('--no-preview', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
S = next(s for s in SPECS if s['id'] == args.hero)
SOURCE = ROOT / 'assets-source' / S['id']
OUT = ROOT / 'public/assets/models'
EVIDENCE = ROOT / 'production/qa/evidence/roster3d' / S['id']
for folder in (SOURCE, OUT, EVIDENCE):
    folder.mkdir(parents=True, exist_ok=True)
DURATIONS = {'idle': 2, 'run': .6, 'basic': .4, 'active': 1.15, 'ultimate': 1.65, 'hit': .3, 'death': 1.2}

# Tất cả tướng dùng Blender Z-up/-Y front và xuất glTF Y-up/+Z front.
def rgb(value):
    # Màu nguồn sRGB -> shader linear; tránh trắng bệt khi chiếu sáng.
    return tuple(((int(value[i:i+2],16)/255+.055)/1.055)**2.4 if int(value[i:i+2],16)/255>.04045 else int(value[i:i+2],16)/255/12.92 for i in (0,2,4))

materials = {}
parts = []
raw = False
factor = .68 if S['body']=='rider' else .78 if S['body']=='princess' else .88 if S['body']=='merchant' else 1
width = 1.45 if S['body'] in ('heavy','round') else 1
lift = .72 if S['body']=='rider' else 0

def point(p):
    return Vector(p) if raw else Vector((p[0]*factor*width, p[1]*factor, p[2]*factor+lift))

def material(name, color, metal=0, rough=.52, glow=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*rgb(color),1); m.use_nodes=True
    node=m.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value=m.diffuse_color
    node.inputs['Metallic'].default_value=metal; node.inputs['Roughness'].default_value=rough
    if glow:
        node.inputs['Emission Color'].default_value=m.diffuse_color
        node.inputs['Emission Strength'].default_value=glow
    materials[name]=m

def finish(obj, name, mat, bone='spine', smooth=True):
    obj.name=name; obj.data.materials.append(materials[mat])
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    vg=obj.vertex_groups.new(name=bone); vg.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    for poly in obj.data.polygons: poly.use_smooth=smooth
    parts.append(obj)
    return obj

def sphere(name,p,scale,mat,bone='spine',segments=16,rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=point(p))
    o=bpy.context.object; o.scale=scale if raw else (scale[0]*factor*width,scale[1]*factor,scale[2]*factor)
    return finish(o,name,mat,bone)

def link(name,a,b,r,mat,bone='spine',r2=None,n=12):
    a,b=point(a),point(b); d=b-a; f=1 if raw else factor
    bpy.ops.mesh.primitive_cone_add(vertices=n,radius1=r*f,radius2=(r if r2 is None else r2)*f,depth=d.length,location=(a+b)/2)
    o=bpy.context.object; o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    return finish(o,name,mat,bone)

def box(name,p,scale,mat,bone='spine',rotation=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1,location=point(p))
    o=bpy.context.object; o.scale=scale if raw else (scale[0]*factor*width,scale[1]*factor,scale[2]*factor)
    o.rotation_euler=rotation
    return finish(o,name,mat,bone,False)

def curve(name,points,r,mat,bone='spine',sharp=False):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.resolution_u=5
    c.bevel_depth=r*(1 if raw else factor); c.bevel_resolution=1
    sp=c.splines.new('BEZIER'); sp.bezier_points.add(len(points)-1)
    for b,p in zip(sp.bezier_points,points):
        b.co=point(p); b.handle_left_type='VECTOR' if sharp else 'AUTO'; b.handle_right_type=b.handle_left_type
    o=bpy.data.objects.new(name,c); bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.object,name,mat,bone)

def ring(name,p,rx,rz,mat,bone='spine',radius=.018):
    return curve(name,[(p[0]+rx*math.cos(i*math.tau/20),p[1],p[2]+rz*math.sin(i*math.tau/20)) for i in range(21)],radius,mat,bone)

def lathe(name,rows,mat,bone='hips',pleat=.025):
    n=28; vs=[]; fs=[]
    for z,rx,ry in rows:
        for j in range(n):
            a=j*math.tau/n; f=1+pleat*math.cos(a*8)
            vs.append(point((rx*math.cos(a)*f,ry*math.sin(a)*f,z)))
    for i in range(len(rows)-1):
        for j in range(n):
            a=i*n+j; b=i*n+(j+1)%n; fs.append((a,b,b+n,a+n))
    fs += [tuple(reversed(range(n))),tuple((len(rows)-1)*n+j for j in range(n))]
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(vs,[],fs); mesh.update()
    o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o)
    return finish(o,name,mat,bone)

def panel(name,points,mat,bone='cape'):
    # Vải có bề dày thật thay vì một mặt mất khi nhìn từ sau.
    vs=[point(p) for p in points]+[point((p[0],p[1]+.025,p[2])) for p in points]
    n=len(points); fs=[tuple(range(n)),tuple(reversed(range(n,n*2)))]
    fs += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(vs,[],fs); mesh.update()
    o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o)
    return finish(o,name,mat,bone,False)

def blade(side='R',short=False,mat='steel'):
    sign=1 if side=='R' else -1; x=sign*.51; bone='hand.'+side
    link('Wrapped sword grip',(x,-.12,1.15),(x,-.12,1.40),.032,'leather',bone)
    link('Swept crossguard',(x-.14,-.12,1.41),(x+.14,-.12,1.41),.023,'trim',bone)
    length=.55 if short else 1.0
    panel('Faceted blade',[(x-.055,-.13,1.43),(x+.055,-.13,1.43),(x+.035,-.13,1.43+length*.78),(x,-.13,1.43+length),(x-.035,-.13,1.43+length*.78)],mat,bone)
    link('Blade center ridge',(x,-.145,1.44),(x,-.145,1.43+length),.009,'trim',bone,r2=.001)

def shield(side='L',large=False):
    sign=1 if side=='R' else -1; x=sign*.63; y=-.22; z=1.20; b='fore.'+side
    w=.35 if large else .29; h=.66 if large else .58
    pts=[(x-w,y,z+h*.72),(x,y,z+h),(x+w,y,z+h*.72),(x+w,y,z-h*.45),(x,y,z-h),(x-w,y,z-h*.45)]
    panel('Tower shield',pts,'trim',b)
    panel('Shield enamel',[(x+(p[0]-x)*.84,y-.035,z+(p[2]-z)*.87) for p in pts],'primary',b)
    curve('Raised shield cross',[(x-.16,y-.065,z+.1),(x+.16,y-.065,z+.1)],.025,'trim',b)
    curve('Shield spine',[(x,y-.066,z-.35),(x,y-.066,z+.42)],.028,'trim',b)
    sphere('Shield center jewel',(x,y-.08,z+.12),(.07,.025,.09),'gem',b)

def bottle(p,bone='spine',mat='gem'):
    sphere('Potion bottle',p,(.065,.055,.09),mat,bone,12,8)
    link('Bottle stopper',(p[0],p[1],p[2]+.075),(p[0],p[1],p[2]+.13),.024,'trim',bone)

def book(p,bone='hand.L'):
    box('Book leather cover',p,(.42,.28,.065),'secondary',bone)
    box('Ivory book pages',(p[0],p[1],p[2]+.045),(.39,.25,.045),'ivory',bone)
    curve('Book spine',[(p[0],p[1]-.13,p[2]+.07),(p[0],p[1]+.13,p[2]+.07)],.014,'trim',bone)
    for sign in (-1,1):
        for j in range(3):
            curve('Scripture lines',[(p[0]+sign*.04,p[1]-.075+j*.065,p[2]+.072),(p[0]+sign*.16,p[1]-.075+j*.065,p[2]+.072)],.004,'leather',bone)

def build_humanoid():
    female=S.get('female',False); body=S['body']
    lathe('Tailored torso',[(1.22,.21,.145),(1.42,.19 if female else .23,.15),(1.68,.27,.18),(1.88,.29,.17)],'primary','spine')
    if body=='round': sphere('Round tavern apron',(0,-.035,1.37),(.34,.24,.43),'secondary','spine')
    if body in ('robe','dress','princess'):
        lathe('Pleated outer robe',[(.12,.43,.31),(.22,.44,.32),(.7,.34,.25),(1.3,.20,.14)],'primary','skirt',.055)
        lathe('Contrasting hem',[(.12,.44,.32),(.19,.45,.33),(.23,.44,.32)],'trim','skirt',.055)
        panel('Long front panel',[(-.12,-.16,1.32),(.12,-.16,1.32),(.23,-.32,.25),(-.23,-.32,.25)],'secondary','skirt')
    elif body in ('coat','suit','merchant'):
        for sign in (-1,1):
            panel('Split coat tails',[(sign*.08,.1,1.43),(sign*.24,.06,1.43),(sign*.34,.18,.52),(sign*.09,.23,.60)],'primary','cape')
            panel('Lapel',[(sign*.04,-.184,1.87),(sign*.24,-.17,1.86),(sign*.12,-.19,1.56)],'secondary','spine')
    if S.get('cape'):
        panel('Flowing mantle',[(-.28,.17,1.89),(.28,.17,1.89),(.45,.30,.52),(.2,.32,.40),(0,.33,.48),(-.3,.31,.40),(-.45,.30,.52)],'secondary','cape')
        curve('Mantle hem',[(-.43,.29,.53),(-.2,.32,.44),(0,.33,.50),(.2,.32,.44),(.43,.29,.53)],.012,'trim','cape')
    lathe('Belt',[(1.26,.233,.164),(1.34,.234,.165)],'leather','hips',0)
    box('Belt buckle',(0,-.175,1.30),(.11,.035,.09),'trim','hips')
    for sign,side in ((-1,'L'),(1,'R')):
        hip=(sign*.15,0,1.24); knee=(sign*.18,-.015,.67); ankle=(sign*.18,0,.17)
        if body=='rider': hip=(sign*.23,0,1.24); knee=(sign*.40,-.18,.68); ankle=(sign*.43,-.05,.18)
        link('Trouser thigh '+side,hip,knee,.105,'secondary','leg.'+side,r2=.085)
        link('Boot greave '+side,knee,ankle,.088,'primary' if body in ('armor','heavy','rider') else 'leather','shin.'+side,r2=.067)
        sphere('Boot toe '+side,(ankle[0],-.08,.105),(.093,.18,.105),'leather','shin.'+side)
        if body in ('armor','heavy','rider'):
            sphere('Knee plate '+side,(knee[0],-.085,knee[2]),(.113,.055,.105),'steel','shin.'+side)
        shoulder=(sign*.285,0,1.88); elbow=(sign*.44,-.015,1.58); wrist=(sign*.49,-.105,1.30)
        if S['id']=='thane' and side=='L':
            link('Empty left sleeve',shoulder,(sign*.40,.01,1.42),.10,'secondary','upper.L',r2=.035)
            continue
        link('Upper arm '+side,shoulder,elbow,.082,'primary','upper.'+side,r2=.065)
        link('Forearm '+side,elbow,wrist,.068,'secondary','fore.'+side,r2=.046)
        sphere('Hand '+side,(sign*.50,-.115,1.255),(.055,.05,.08),'skin','hand.'+side)
        link('Wrist trim '+side,(sign*.48,-.09,1.36),(sign*.49,-.10,1.32),.059,'trim','fore.'+side)
        if body in ('armor','heavy','rider'):
            sphere('Pauldron '+side,(sign*.30,0,1.87),(.16,.17,.11),'trim','upper.'+side)
            sphere('Pauldron inset '+side,(sign*.30,-.025,1.91),(.13,.15,.065),'primary','upper.'+side)
    link('Neck',(0,0,1.88),(0,0,2.05),.087,'skin','head')
    sphere('Head',(0,-.01,2.18),(.175,.15,.225),'skin','head',24,16)
    sphere('Chin',(0,-.047,2.045),(.105,.095,.08),'skin','head')
    for sign in (-1,1):
        sphere('Ear',(sign*.17,0,2.16),(.034,.03,.055),'skin','head')
        sphere('Eye',(sign*.069,-.148,2.20),(.046,.014,.025),'ivory','head')
        sphere('Iris',(sign*.068,-.161,2.20),(.02,.008,.023),'iris','head')
        sphere('Pupil',(sign*.068,-.168,2.20),(.009,.004,.014),'dark','head',12,8)
        curve('Eyebrow',[(sign*.025,-.151,2.256),(sign*.07,-.156,2.268),(sign*.115,-.138,2.252)],.009,'hair','head')
    sphere('Nose',(0,-.165,2.135),(.025,.035,.04),'skin','head')
    curve('Mouth',[(-.035,-.147,2.075),(0,-.16,2.068),(.035,-.147,2.075)],.006,'leather','head')
    sphere('Hair cap',(0,.015,2.29),(.185,.16,.16),'hair','head',20,12)
    for sign in (-1,1):
        curve('Swept fringe',[(sign*.025,-.1,2.42),(sign*.09,-.15,2.35),(sign*.165,-.09,2.25)],.036,'hair','head')
    hair=S['hair']
    if hair in ('long','pony'):
        for i in range(7 if hair=='long' else 4):
            x=(i-3)*.045 if hair=='long' else (i-1.5)*.035
            curve('Long hair lock',[(x,.10,2.35),(x*1.3,.17,2.09),(x*1.7,.18,1.79),(x*1.6,.12,1.43)],.035,'hair','hair')
    if hair=='pigtails':
        for sign in (-1,1):
            curve('Pigtail',[(sign*.16,.02,2.30),(sign*.29,.04,2.20),(sign*.33,.01,1.91)],.065,'hair','hair')
            sphere('Hair ribbon',(sign*.20,-.02,2.25),(.08,.04,.055),'secondary','head')
    if hair=='bun': sphere('Hair bun',(0,.16,2.31),(.12,.09,.12),'hair','head')
    if hair=='beard':
        for i in range(-2,3):
            curve('Beard braid',[(i*.038,-.11,2.08),(i*.04,-.15,1.97),(i*.027,-.13,1.85+abs(i)*.03)],.035,'hair','head')
    if S['id']=='oscar':
        for sign in (-1,1): curve('Moustache',[(0,-.178,2.10),(sign*.04,-.169,2.095),(sign*.065,-.15,2.11)],.012,'hair','head')
    head=S['head']
    if head in ('crown','circlet','crest','rose','horns'):
        curve('Diadem',[(-.18,-.045,2.36),(-.10,-.14,2.38),(0,-.17,2.39),(.10,-.14,2.38),(.18,-.045,2.36)],.02,'trim','head')
        if head=='crown':
            for i in range(-2,3):
                x=i*.065; curve('Crown point',[(x-.03,-.13,2.39),(x,-.13,2.53-abs(i)*.025),(x+.03,-.13,2.39)],.014,'trim','head',True)
        if head=='crest': curve('Crimson crest',[(0,.15,2.37),(0,.04,2.63),(0,-.10,2.56)],.075,'secondary','head')
        if head=='horns':
            for sign in (-1,1): curve('Occult horn',[(sign*.15,.02,2.37),(sign*.24,.04,2.54),(sign*.20,-.01,2.64)],.035,'trim','head')
    if head=='helmet':
        sphere('Helm dome',(0,.015,2.30),(.205,.18,.18),'steel','head')
        for sign in (-1,1): box('Cheek guard',(sign*.17,-.055,2.17),(.06,.13,.19),'primary','head')
    if head in ('hat','cap'):
        sphere('Hat brim',(0,-.005,2.37),(.33 if head=='hat' else .23,.27,.035),'leather' if head=='hat' else 'primary','head')
        link('Hat crown',(0,.015,2.38),(0,.015,2.54),.16,'primary','head',r2=.14)
        if head=='hat': link('Hat band',(0,.015,2.39),(0,.015,2.43),.163,'secondary','head')
    if head=='goggles':
        for sign in (-1,1): ring('Brass goggles',(sign*.075,-.15,2.34),.055,.043,'trim','head',.014)
    if head=='hood':
        for sign in (-1,1): curve('Hood rim',[(0,.005,2.49),(sign*.17,-.03,2.41),(sign*.215,-.07,2.16),(sign*.16,-.03,1.97)],.06,'ivory','head')
        sphere('Hood back',(0,.08,2.27),(.22,.15,.24),'primary','head')
    if head=='maid':
        for i in range(-3,4): sphere('Maid headband ruffle',(i*.05,-.025,2.43-abs(i)*.017),(.045,.055,.04),'ivory','head',12,8)
        panel('White apron',[(-.15,-.17,1.43),(.15,-.17,1.43),(.29,-.30,.34),(-.29,-.30,.34)],'ivory','skirt')
    if head=='mitre':
        panel('Mitre', [(-.18,0,2.33),(.18,0,2.33),(.15,0,2.61),(0,0,2.78),(-.15,0,2.61)],'ivory','head')
        curve('Mitre gold cross',[(0,-.015,2.38),(0,-.015,2.66)],.018,'trim','head')
        curve('Mitre gold bar',[(-.08,-.015,2.55),(.08,-.015,2.55)],.018,'trim','head')
    if head=='halo':
        ring('Sacred halo',(0,.13,2.34),.38,.38,'trim','head',.024)
        if S['id']=='eluard-awakened': ring('Astral outer halo',(0,.17,2.34),.46,.46,'gem','head',.012)
    if head=='rose' or S['id']=='sonja':
        for z,x in ((2.40,-.15),(1.82,.21),(1.34,0)):
            sphere('Rose center',(x,-.18,z),(.043,.024,.044),'secondary','head' if z>2 else 'spine')
            for i in range(5):
                a=i*math.tau/5; sphere('Rose petal',(x+math.cos(a)*.04,-.18,z+math.sin(a)*.04),(.04,.023,.036),'secondary','head' if z>2 else 'spine',12,8)
    if body in ('armor','heavy','rider'):
        for sign in (-1,1): curve('Breastplate trim',[(sign*.04,-.185,1.70),(sign*.16,-.185,1.82),(sign*.23,-.16,1.81)],.018,'trim')
        sphere('Chest emblem',(0,-.20,1.74),(.05,.022,.065),'gem')
    if body=='suit':
        panel('White shirt',[(-.12,-.183,1.87),(.12,-.183,1.87),(.07,-.18,1.40),(-.07,-.18,1.40)],'ivory','spine')
        for sign in (-1,1): sphere('Bow tie',(sign*.045,-.205,1.84),(.052,.027,.028),'secondary','spine')
    for z in (1.47,1.59,1.70): sphere('Tailoring button',(0,-.19,z),(.012,.012,.012),'trim','spine',8,6)

def build_props():
    w=S['weapon']; x=.51; y=-.12; b='hand.R'
    if w in ('sword','sword-shield','dual-blades','knives','wind-blade','rapier'):
        blade('R',w in ('dual-blades','knives'),'gem' if w=='wind-blade' else 'steel')
        if w in ('dual-blades','knives'): blade('L',True)
        if w=='sword-shield': shield()
        if w=='rapier': ring('Rapier basket',(x,y,1.40),.12,.10,'trim',b)
        if w=='wind-blade':
            for sign in (-1,1): curve('Flowing scarf',[(sign*.06,.07,1.98),(sign*.28,.26,1.82),(sign*.55,.37,1.50),(sign*.64,.32,1.62)],.055,'secondary','cape')
    elif w=='dual-shields': shield('L',True); shield('R',True)
    elif w in ('staff','scepter','dark-staff','crosier','broom','lance'):
        top=2.54 if w!='lance' else 3.0
        link('Weapon shaft',(x,y,.12),(x,y,top),.023,'leather' if w in ('staff','broom') else 'trim',b)
        if w=='lance':
            link('Lance steel tip',(x,y,2.80),(x,y,3.28),.095,'steel',b,r2=0)
            panel('Crimson lance pennant',[(x,y,2.83),(x+.38,y,2.64),(x+.15,y,2.48),(x,y,2.56)],'secondary',b)
        elif w=='broom':
            for i in range(-4,5): link('Broom bristle',(x+i*.022,y,.12),(x+i*.008,y,.48),.018,'trim',b)
            sphere('Tea tray',(-.51,-.17,1.27),(.23,.19,.02),'steel','hand.L')
            sphere('Teacup',(-.51,-.17,1.32),(.06,.06,.055),'ivory','hand.L')
        elif w=='crosier':
            ring('Crosier crook',(x+.07,y,2.65),.14,.16,'trim',b,.026)
            book((-.51,-.15,1.28))
            for sign in (-1,1): panel('Red stole',[(sign*.09,-.17,1.89),(sign*.17,-.17,1.89),(sign*.22,-.30,.35),(sign*.12,-.30,.35)],'secondary','skirt')
        else:
            sphere('Staff gem',(x,y,top+.05),(.085,.06,.12),'gem',b)
            for sign in (-1,1): curve('Staff fork',[(x,y,top-.15),(x+sign*.13,y,top+.03),(x+sign*.09,y,top+.18)],.017,'trim',b)
    elif w in ('pistols','shotgun','crossbow'):
        for sign in ((-1,1) if w=='pistols' else (1,)):
            xx=sign*.51; bone='hand.'+('R' if sign==1 else 'L'); length=.40 if w=='pistols' else .68
            box('Gun grip',(xx,-.13,1.23),(.06,.09,.18),'leather',bone,(-.2,0,0))
            for dx in ((-.026,.026) if w=='shotgun' else (0,)):
                link('Gun barrel',(xx+dx,-.11,1.38),(xx+dx,-.11-length,1.38),.025,'steel',bone)
                link('Muzzle rim',(xx+dx,-.10-length,1.38),(xx+dx,-.13-length,1.38),.031,'trim',bone)
            box('Gun receiver',(xx,-.18,1.35),(.085,.24,.08),'trim',bone)
        if w=='crossbow':
            curve('Crossbow limbs',[(.22,-.4,1.38),(.38,-.47,1.38),(.51,-.42,1.38),(.65,-.47,1.38),(.81,-.4,1.38)],.022,'trim',b)
            panel('Coffin backpack',[(-.24,.25,.8),(.24,.25,.8),(.30,.25,1.85),(.18,.25,2.02),(-.18,.25,2.02),(-.30,.25,1.85)],'leather','spine')
            curve('Coffin cross',[(0,.29,1.03),(0,.29,1.85)],.026,'trim')
            curve('Coffin crossbar',[(-.17,.29,1.60),(.17,.29,1.60)],.025,'trim')
        for i in range(6):
            z=1.78-i*.065; xx=-.19+i*.06; link('Bandolier cartridge',(xx,-.20,z),(xx,-.20,z+.075),.018,'trim')
    elif w=='bow':
        curve('Gilded longbow',[(-.5,-.11,.58),(-.63,-.2,.85),(-.72,-.2,1.30),(-.63,-.2,1.83),(-.5,-.11,2.04)],.035,'trim','hand.L')
        curve('Bow string',[(-.5,-.11,.58),(-.48,-.11,1.30),(-.5,-.11,2.04)],.004,'ivory','hand.L',True)
        link('Quiver',(.12,.23,1.25),(.25,.25,1.96),.10,'leather','spine')
        for i in range(4):
            xx=.17+i*.035; link('Arrow',(xx,.26,1.7),(xx+.08,.28,2.20),.008,'trim','spine')
            sphere('Arrow fletching',(xx+.07,.28,2.13),(.025,.015,.065),'ivory','spine',8,6)
    elif w=='tankard':
        link('Tankard body',(x,-.17,1.16),(x,-.17,1.43),.12,'leather',b)
        for z in (1.18,1.40): link('Tankard hoop',(x,-.17,z),(x,-.17,z+.025),.125,'steel',b)
        ring('Tankard handle',(x+.15,-.17,1.30),.08,.10,'trim',b)
        sphere('Back keg',(0,.29,1.40),(.30,.27,.43),'leather','spine')
        for z in (1.12,1.67): link('Keg band',(0,.29,z),(0,.29,z+.055),.26,'steel','spine')
    elif w in ('orb','hourglass','tome'):
        if w=='tome': book((-.51,-.15,1.28))
        sphere('Arcane focus',(.51,-.15,1.51),(.12,.10,.12),'gem',b)
        ring('Focus orbit',(.51,-.15,1.51),.19,.17,'trim',b,.012)
        if w=='hourglass':
            for z in (1.12,1.62): box('Hourglass frame',(-.51,-.15,z),(.28,.22,.045),'trim','hand.L')
            link('Hourglass upper',(-.51,-.15,1.39),(-.51,-.15,1.60),.012,'gem','hand.L',r2=.10)
            link('Hourglass lower',(-.51,-.15,1.14),(-.51,-.15,1.37),.10,'gem','hand.L',r2=.012)
            for sign in (-1,1): link('Hourglass post',(-.51+sign*.12,-.15,1.14),(-.51+sign*.12,-.15,1.60),.012,'trim','hand.L')
            for i in range(3): box('Fate card',(-.36+i*.17,.28,2.02),(.12,.018,.20),'ivory','spine',(0,0,(i-1)*.3))
        if w=='tome':
            sphere('Eye familiar',(.29,.16,2.48),(.12,.08,.09),'gem','head')
            sphere('Familiar pupil',(.29,.078,2.48),(.025,.012,.065),'dark','head')
    if S['id']=='rowan':
        box('Merchant pack',(0,.24,1.43),(.48,.28,.60),'leather')
        for xx in (-.19,0,.19): bottle((xx,.41,1.58))
        sphere('Duck body',(-.24,.22,1.95),(.13,.12,.11),'ivory')
        sphere('Duck head',(-.24,.16,2.08),(.065,.065,.065),'ivory')
        link('Duck beak',(-.24,.11,2.07),(-.24,.01,2.07),.036,'trim',r2=.018)
        sphere('Duck eye',(-.28,.10,2.10),(.012,.01,.012),'dark',segments=8,rings=6)
    if S['id']=='peggy':
        link('Royal scroll',(-.55,-.13,1.15),(-.55,-.13,1.49),.065,'ivory','hand.L')
        for z in (1.15,1.49): sphere('Scroll roll',(-.55,-.13,z),(.09,.08,.025),'trim','hand.L')

horse_bones={}
def build_horse():
    global raw
    raw=True
    sphere('Horse barrel',(0,.08,1.12),(.37,.69,.37),'horse','root',24,14)
    link('Horse neck',(0,-.48,1.21),(0,-.70,1.83),.20,'horse','mount.neck',r2=.14)
    sphere('Horse head',(0,-.79,1.85),(.17,.28,.17),'horse','mount.neck')
    sphere('Horse muzzle',(0,-1.00,1.76),(.14,.16,.12),'leather','mount.neck')
    for sign in (-1,1):
        link('Horse ear',(sign*.11,-.70,1.96),(sign*.13,-.69,2.18),.052,'horse','mount.neck',r2=.007)
        sphere('Horse eye',(sign*.15,-.85,1.89),(.017,.027,.024),'dark','mount.neck')
        for yy,label in ((-.40,'front'),(.52,'back')):
            name=f'mount.{label}.{sign}'; a=(sign*.25,yy,1.10); knee=(sign*.26,yy-.06,.56); foot=(sign*.26,yy,.11)
            horse_bones[name]=(a,knee,'root'); horse_bones[name+'.shin']=(knee,foot,name)
            link('Horse upper leg',a,knee,.085,'horse',name,r2=.055)
            link('Horse lower leg',knee,foot,.053,'horse',name+'.shin',r2=.04)
            sphere('Hoof',(foot[0],foot[1]-.045,.065),(.077,.12,.065),'dark',name+'.shin')
    horse_bones['mount.neck']=((0,-.48,1.21),(0,-.70,1.83),'root')
    horse_bones['mount.tail']=((0,.65,1.25),(0,1.0,.65),'root')
    curve('Horse tail',[(0,.65,1.25),(0,.90,1.14),(.08,1.03,.79),(.12,.99,.47)],.075,'hair','mount.tail')
    curve('Horse mane',[(0,-.59,1.92),(0,-.43,1.64),(0,-.27,1.30)],.08,'hair','mount.neck')
    for sign in (-1,1):
        panel('Crimson saddlecloth',[(sign*.35,-.36,1.37),(sign*.36,.49,1.37),(sign*.40,.42,.83),(sign*.40,-.26,.91)],'secondary','root')
        curve('Bridle',[(sign*.15,-1.0,1.77),(sign*.19,-.77,1.91),(sign*.15,-.67,1.93)],.016,'trim','mount.neck')
    sphere('Saddle',(0,.08,1.43),(.27,.31,.10),'leather','root')
    raw=False

def setup_rig():
    bones={'root':((0,0,0),(0,0,.3),None)}
    base={'hips':((0,0,1.28),(0,0,1.50),'root'),'spine':((0,0,1.50),(0,0,1.91),'hips'),
          'head':((0,0,1.96),(0,0,2.38),'spine'),'hair':((0,.10,2.31),(0,.12,1.50),'head'),
          'skirt':((0,0,1.30),(0,0,.35),'hips'),'cape':((0,.17,1.85),(0,.27,.70),'spine')}
    for sign,side in ((-1,'L'),(1,'R')):
        hip=(sign*.15,0,1.24); knee=(sign*.18,-.015,.67); ankle=(sign*.18,0,.17)
        if S['body']=='rider': hip=(sign*.23,0,1.24); knee=(sign*.40,-.18,.68); ankle=(sign*.43,-.05,.18)
        base['leg.'+side]=(hip,knee,'hips'); base['shin.'+side]=(knee,ankle,'leg.'+side)
        base['upper.'+side]=((sign*.285,0,1.88),(sign*.44,-.015,1.58),'spine')
        base['fore.'+side]=((sign*.44,-.015,1.58),(sign*.49,-.105,1.30),'upper.'+side)
        base['hand.'+side]=((sign*.49,-.105,1.30),(sign*.50,-.115,1.22),'fore.'+side)
    bones.update({k:(point(a),point(b),parent) for k,(a,b,parent) in base.items()}); bones.update(horse_bones)
    bpy.ops.object.select_all(action='DESELECT')
    data=bpy.data.armatures.new(S['name']+' articulated rig'); rig=bpy.data.objects.new(S['id']+'Rig',data)
    bpy.context.collection.objects.link(rig); rig.select_set(True); bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name,(a,b,parent) in bones.items():
        bone=data.edit_bones.new(name); bone.head=a; bone.tail=b
        if parent: bone.parent=data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT'); rig.show_in_front=True
    for b in rig.pose.bones: b.rotation_mode='XYZ'
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]; bpy.ops.object.join(); mesh=bpy.context.object
    mesh.name=S['id']+' tailored skinned mesh'; mesh['identity']=S['name']; mesh['signature']=S['signature']
    mod=mesh.modifiers.new('Explicit articulated weights','ARMATURE'); mod.object=rig; mesh.parent=rig
    return rig,mesh,bones

def animate(rig,mesh):
    def pose(t,rot=None,z=0,fall=0):
        for bone in rig.pose.bones:
            r=(rot or {}).get(bone.name,(0,0,0)); bone.location=(0,0,0)
            if bone.name.startswith(('upper.','fore.')):
                rest=bone.bone.matrix_local.to_3x3(); world=Euler((-r[0],-r[2],r[1]),'XYZ').to_matrix()
                bone.rotation_euler=(rest.inverted() @ world @ rest).to_euler('XYZ')
            else: bone.rotation_euler=r
        root=rig.pose.bones['root']; root.location.y=z; root.rotation_euler=(0,0,fall)
        if fall:
            bpy.context.view_layer.update(); evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            lowest=min((evaluated.matrix_world @ v.co).z for v in evaluated.data.vertices)
            if lowest<0: root.location.y-=lowest
        for b in rig.pose.bones:
            b.keyframe_insert('rotation_euler',frame=round(t*60),group=b.name)
            b.keyframe_insert('location',frame=round(t*60),group=b.name)
    def clip(name,poses):
        if rig.animation_data:
            for tr in rig.animation_data.nla_tracks: tr.mute=True
        action=bpy.data.actions.new(name); rig.animation_data_create(); rig.animation_data.action=action
        for item in poses: pose(*item)
        track=rig.animation_data.nla_tracks.new(); track.name=name
        strip=track.strips.new(name,0,action); strip.name=name; rig.animation_data.action=None
    clip('idle',[(0,{},0),(1,{'spine':(.012,0,.015),'head':(-.015,0,-.015),'hair':(.025,0,.015),'cape':(.02,0,0)},.012),(2,{},0)])
    gait=[]
    for t in (0,.15,.30,.45,.60):
        swing=math.cos(t/.6*math.tau); rot={'spine':(.06,0,.025*swing),'cape':(-.12,0,.04*swing),'hair':(-.08,0,.03*swing),'upper.L':(-.26*swing,0,-.07),'upper.R':(.18*swing,0,.06)}
        if S['body']=='rider':
            for sign in (-1,1):
                for label,direction in (('front',1),('back',-1)):
                    rot[f'mount.{label}.{sign}']=(.28*swing*sign*direction,0,0)
                    rot[f'mount.{label}.{sign}.shin']=(max(0,.38*swing*sign*direction),0,0)
            rot['mount.neck']=(.035*swing,0,0); rot['mount.tail']=(.1,0,.08*swing)
        else:
            rot.update({'leg.L':(.34*swing,0,0),'leg.R':(-.34*swing,0,0),'shin.L':(max(0,-.42*swing),0,0),'shin.R':(max(0,.42*swing),0,0)})
        gait.append((t,rot,.02+.025*abs(math.sin(t/.6*math.tau))))
    clip('run',gait)
    w=S['weapon']
    wind={'spine':(-.04,0,-.10),'upper.R':(-.25,0,.50),'fore.R':(.40,0,0),'upper.L':(.1,0,-.28),'head':(0,0,.07)}
    strike={'spine':(.08,0,.12),'upper.R':(.63,0,.10),'fore.R':(.12,0,0),'upper.L':(.24,0,-.23),'hair':(-.06,0,.05),'cape':(-.05,0,.05)}
    if w in ('sword','sword-shield','dual-blades','knives','wind-blade','rapier','lance'):
        wind.update({'upper.R':(-.24,0,.85),'spine':(-.04,0,-.20)})
        strike.update({'upper.R':(.85,0,-.12),'fore.R':(.18,0,.14),'spine':(.13,0,.18)})
    elif w in ('pistols','shotgun','crossbow','bow'):
        wind.update({'upper.R':(.45,0,.15),'fore.R':(.65,0,0),'upper.L':(.48,0,-.18)})
        strike.update({'upper.R':(.72,0,.03),'fore.R':(.10,0,0),'upper.L':(.72,0,-.08),'spine':(-.045,0,.04)})
    elif w=='dual-shields':
        wind.update({'upper.L':(.18,0,-.25),'fore.L':(.45,0,0)})
        strike.update({'upper.L':(.80,0,-.12),'fore.L':(.12,0,0),'upper.R':(.60,0,.12)})
    elif w=='tankard': strike.update({'upper.R':(.3,0,.35),'fore.R':(1.3,0,0),'head':(-.13,0,0)})
    clip('basic',[(0,{},0),(.1,wind,0),(.2,strike,.015),(.30,{'spine':(.02,0,.03),'upper.R':(.20,0,.10)},0),(.4,{},0)])
    power={**strike,'upper.L':(.65,0,-.42),'head':(-.025,0,0),'cape':(-.14,0,.08)}
    clip('active',[(0,{},0),(.30,wind,.01),(.60,power,.035),(.85,{**strike,'spine':(.02,0,.02)},.015),(1.15,{},0)])
    flourish={**wind,'upper.L':(.25,0,-.95),'upper.R':(-.2,0,.95),'fore.L':(.45,0,0),'fore.R':(.6,0,0),'head':(-.10,0,0)}
    if w in ('dual-shields','sword-shield'): flourish.update({'upper.L':(.55,0,-.65),'fore.L':(.55,0,0)})
    clip('ultimate',[(0,{},0),(.25,wind,.015),(.45,flourish,.05),(.85,power,.075),(1.10,{**power,'spine':(.02,0,-.08)},.05),(1.4,{'upper.R':(.15,0,.25),'upper.L':(.2,0,-.3)},.02),(1.65,{},0)])
    clip('hit',[(0,{},0),(.08,{'spine':(-.15,0,-.10),'head':(-.1,0,.06),'cape':(.12,0,0)},-.02),(.3,{},0)])
    clip('death',[(0,{},0),(.25,{'spine':(.18,0,.12),'head':(.15,0,0)},-.08),(.65,{'spine':(.22,0,.15),'head':(.2,0,0),'upper.L':(.3,0,-.35),'upper.R':(.35,0,.25)},-.25,.45),(1.2,{'spine':(.20,0,.10),'head':(.18,0,0),'upper.L':(.3,0,-.35),'upper.R':(.35,0,.25)},-.25,1.40)])
    for tr in rig.animation_data.nla_tracks: tr.mute=tr.name!='idle'
    bpy.context.scene.frame_set(0)

def studio():
    scene=bpy.context.scene; scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes['Background']; bg.inputs[0].default_value=(.055,.075,.12,1); bg.inputs[1].default_value=.5
    for name,loc,power,color in [('Warm key',(3,-4,5),500,(1,.88,.72)),('Cool fill',(-3,-2,3),330,(.65,.8,1)),('Rim',(1,3,4),550,(1,.8,.5))]:
        data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.color=color; data.size=4
        obj=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(obj); obj.location=loc
        obj.rotation_euler=(Vector((0,0,1.4))-obj.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Preview camera'); cam=bpy.data.objects.new('Preview camera',data); bpy.context.collection.objects.link(cam)
    cam.location=(3.6,-7.5,3.0); cam.rotation_euler=(Vector((0,0,1.35))-cam.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO'; data.ortho_scale=3.65; scene.camera=cam
    scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=8
    scene.render.threads_mode='FIXED'; scene.render.threads=2
    scene.render.resolution_x=360; scene.render.resolution_y=420; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'; scene.view_settings.view_transform='AgX'

def previews(rig):
    scene=bpy.context.scene
    for name,frame in [('idle',0),('basic',12),('ultimate',51),('death',72)]:
        for tr in rig.animation_data.nla_tracks: tr.mute=tr.name=='' or tr.name!=name
        scene.frame_set(frame)
        scene.camera.data.ortho_scale=4.8 if name=='death' else 3.65
        scene.render.filepath=str(EVIDENCE/f'{name}.png'); bpy.ops.render.render(write_still=True)
    for tr in rig.animation_data.nla_tracks: tr.mute=tr.name!='idle'
    scene.frame_set(0)

if args.preview_only:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/(S['id']+'.blend')))
    previews(next(o for o in bpy.data.objects if o.type=='ARMATURE'))
else:
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions): bpy.data.actions.remove(action)
    scene=bpy.context.scene; scene.render.fps=60; scene.render.fps_base=1; scene.frame_start=0
    for name,color,metal,rough,glow in [('primary',S['primary'],.35,.48,0),('secondary',S['secondary'],0,.65,0),('trim',S['trim'],.65,.32,0),('hair',S['hairColor'],0,.58,0),('gem',S['accent'],.25,.27,.5),('skin','dca784',0,.65,0),('ivory','eee9da',0,.55,0),('steel','b7c5cf',.7,.30,0),('leather','49362b',0,.65,0),('dark','181b27',0,.6,0),('iris','527a8e',0,.4,0),('horse','b9b1a6',0,.7,0)]:
        material(name,color,metal,rough,glow)
    build_humanoid(); build_props()
    if S['body']=='rider': build_horse()
    rig,mesh,bones=setup_rig(); animate(rig,mesh); studio()
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(S['id']+'.blend')),compress=True)
    bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active=rig
    for tr in rig.animation_data.nla_tracks: tr.mute=False
    bpy.ops.export_scene.gltf(filepath=str(OUT/(S['id']+'.glb')),export_format='GLB',use_selection=True,export_animations=True,export_skins=True,export_yup=True,export_force_sampling=True,export_animation_mode='NLA_TRACKS',export_extras=True)
    blob=(OUT/(S['id']+'.glb')).read_bytes(); size=int.from_bytes(blob[12:16],'little'); gltf=json.loads(blob[20:20+size])
    actual=[]
    for anim in gltf['animations']:
        accessors=[gltf['accessors'][s['input']] for s in anim['samplers']]
        start=min(a['min'][0] for a in accessors); end=max(a['max'][0] for a in accessors)
        assert abs(start)<1e-6 and abs(end-DURATIONS[anim['name']])<1e-6,(anim['name'],start,end)
        actual.append({'name':anim['name'],'seconds':round(end,6),'channels':len(anim['channels'])})
    assert {a['name'] for a in actual}==set(DURATIONS)
    assert len(gltf['skins'])==1 and not gltf.get('images')
    report={'id':S['id'],'heroId':S['heroId'],'name':S['name'],'source':f"assets-source/{S['id']}/{S['id']}.blend",'asset':S['id']+'.glb','generator':'tools/build-heroes.py','blender':bpy.app.version_string,
      'origin':'Locally generated stylized geometry, named rigid-weight armature and keyed actions; no downloaded meshes or textures.',
      'visualReference':'Existing project identity and sprite equipment, interpreted as a procedural 3D study.','signature':S['signature'],
      'rights':'New geometry does not establish rights to referenced character identities/designs. Not an official model or a sculpted production likeness.',
      'coordinates':{'up':'+Y','front':'+Z','feetOrigin':True},'rig':{'bones':len(bones),'weighting':'Rigid 100% per articulated part; no facial/cloth simulation or finger IK.'},
      'animations':actual,'runtimeContract':'Presentation only; first-squad casts use engine time. Other heroes use their existing presentation action lifetime. No combat callbacks or root-motion damage.',
      'limitations':['Procedural stylized study, not an exact replica or human-approved art.','Rigid joints/cloth may intersect in extreme poses.','Other heroes retain existing Canvas2D spell effects; these GLBs contain body/weapon animation only.'],
      'metrics':{'glbBytes':len(blob),'glbSha256':hashlib.sha256(blob).hexdigest(),'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'specSha256':hashlib.sha256((ROOT/'tools/hero-models.json').read_bytes()).hexdigest(),'vertices':len(mesh.data.vertices),'triangles':sum(len(p.vertices)-2 for p in mesh.data.polygons),'meshes':len(gltf['meshes']),'primitives':sum(len(m['primitives']) for m in gltf['meshes'])}}
    (OUT/(S['id']+'.provenance.json')).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    (EVIDENCE/'export.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print('HERO_EXPORT',json.dumps({'id':S['id'],**report['metrics']}),flush=True)
    if not args.no_preview: previews(rig)
