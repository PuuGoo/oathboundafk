# PROTOTYPE - NOT FOR PRODUCTION
"""Render một pose từ source .blend, không sửa source/GLB: -- hero [clip]."""
from pathlib import Path
import sys
import bpy
args=sys.argv[sys.argv.index('--')+1:]
hero=args[0]; clip=args[1] if len(args)>1 else 'idle'
root=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(root/'assets-source'/hero/(hero+'.blend')))
scene=bpy.context.scene
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
for track in rig.animation_data.nla_tracks: track.mute=track.name!=clip
scene.frame_set({'idle':0,'run':9,'basic':12,'active':36,'ultimate':51,'death':72,'hit':5}[clip])
scene.render.engine='CYCLES'; scene.cycles.samples=8; scene.cycles.device='CPU'
scene.render.threads_mode='FIXED'; scene.render.threads=2
scene.render.resolution_x=360; scene.render.resolution_y=420; scene.render.resolution_percentage=100
if clip=='death': scene.camera.data.ortho_scale=4.8
out=root/'production/qa/evidence/roster3d'/hero
out.mkdir(parents=True,exist_ok=True)
scene.render.filepath=str(out/(clip+'.png'))
bpy.ops.render.render(write_still=True)
print('POSE_RENDERED',hero,clip,scene.render.filepath,flush=True)
