import bpy, math, sys
exec(open('/home/skyllion/PilarDoc/build_pilar.py').read().replace('bpy.ops.export_scene.gltf(','(lambda **k: None)('))
for n in ("Romanico","Gotico","Interior","Capilla","Retablo","BombsFall","Ceiling","Bombs"):
    if n in COLL: COLL[n].hide_render=True
sc=bpy.context.scene
for e in ('BLENDER_WORKBENCH',):
    sc.render.engine=e
sc.display.shading.light='STUDIO'; sc.display.shading.color_type='MATERIAL'; sc.display.shading.show_shadows=True
sc.render.resolution_x=900; sc.render.resolution_y=600
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam
views={'ebro':((230,170,25),(0,0,40)),'plaza':((-60,-190,8),(10,0,45)),'air':((140,-160,130),(0,0,30))}
for k,(p,tg) in views.items():
    cam.location=p
    d=[tg[i]-p[i] for i in range(3)]
    import mathutils
    cam.rotation_euler=mathutils.Vector(d).to_track_quat('-Z','Y').to_euler()
    cam.data.lens=28
    sc.render.filepath=f'/home/skyllion/PilarDoc/build/prev_{k}.png'; bpy.ops.render.render(write_still=True)
