"""Builds the mocap characters (public/models/ronin.glb, archer.glb) from the Mixamo
exports in assets_src/.

Run with Blender's Python module (pip install bpy==5.0.1, Python 3.11):
    python scripts/convert_characters.py ronin|archer [--all] [--only a,b] [--out path.glb]

Imports the rigged character FBX, then every selected animation FBX (all downloaded
from Mixamo for this same character, so bone names and rest poses match 1:1 - no
retargeting), attaches each one as a named action on the character's own armature and
exports a single GLB. --all exports every clip in the pack (for previewing); the default
exports only the clips the game uses (the *_CLIPS tables below). Texture/mesh compression happens
afterwards in scripts/optimize_models.mjs, which writes the file the game loads.

Clips from other skeletons (RONIN_RETARGET below - same Mixamo bone names, but a different
rest pose, scale and up axis) are retargeted onto the character's own skeleton here, so
the game only ever plays clips authored for this one skeleton.

Each GLB carries a decimated copy of the body (<Name>LOD) skinned to the same skeleton,
for enemies (up to 9 samurai and 4 archers on screen); the archer ships only that one.
"""
import os
import sys
import zipfile
import tempfile

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# game clip name -> file in the Mixamo pack
RONIN_CLIPS = {
    'idle': 'great sword idle.fbx',
    'walk': 'great sword walk.fbx',
    'run': 'great sword run (2).fbx',
    'jump': 'great sword jump (2).fbx',
    'guard': 'great sword blocking (2).fbx',
    'block1': 'great sword blocking.fbx',
    'block2': 'great sword blocking (3).fbx',
    'hit1': 'great sword impact.fbx',
    'hit2': 'great sword impact (2).fbx',
    'hit3': 'great sword impact (3).fbx',
    'death': 'two handed sword death.fbx',
    'slash1': 'great sword slash.fbx',
    'slash2': 'great sword slash (3).fbx',
    'slash3': 'great sword slash (4).fbx',
    'attack': 'great sword attack.fbx',
    'spin': 'great sword high spin attack.fbx',
    'cast': 'spell cast.fbx',
    'kick1': 'great sword kick.fbx',
    'kick2': 'great sword kick (2).fbx',
    'jumpAttack': 'great sword jump attack.fbx',
    'slideAttack': 'great sword slide attack.fbx',
    'powerUp': 'great sword power up.fbx',
    'draw': 'draw a great sword 2.fbx',
    'strafeL': 'great sword strafe.fbx',
    'strafeR': 'great sword strafe (2).fbx',
    'walkBack': 'great sword walk (2).fbx',
    'death2': 'two handed sword death (2).fbx',
}

# game clip name -> (source FBX in assets_src/, action name inside it)
RONIN_RETARGET = {
    'fightIdle': ('movimentos de luta.fbx', 'Armature|Fighting_Idle'),
    'jab': ('movimentos de luta.fbx', 'Armature|Punch_Jab'),
    'cross': ('movimentos de luta.fbx', 'Armature|Punch_Cross'),
    'jabL': ('movimentos de luta.fbx', 'Armature|Fighting_Left_Jab'),
    'jabR': ('movimentos de luta.fbx', 'Armature|Fighting_Right_Jab'),
    'eSwordAttack': ('inimigo com espada.fbx', 'Armature|Sword_Attack'),
    'eSwordSlash': ('inimigo com espada.fbx', 'Armature|Sword_Regular_C'),
}

# Pro Longbow pack, downloaded for the archer itself. Locomotion keeps the Rōnin's names
# so the same clip controller drives both.
ARCHER_CLIPS = {
    'idle': 'standing idle 01.fbx',
    'walk': 'standing walk forward.fbx',
    'run': 'standing run forward.fbx',
    'walkBack': 'standing walk back.fbx',
    'strafeL': 'standing walk left.fbx',
    'strafeR': 'standing walk right.fbx',
    'draw': 'standing draw arrow.fbx',
    'aim': 'standing aim overdraw.fbx',
    'release': 'standing aim recoil.fbx',
    'hit1': 'standing react small from front.fbx',
    'hit2': 'standing react small from headshot.fbx',
    'death': 'standing death backward 01.fbx',
    'death2': 'standing death forward 01.fbx',
    'dodgeL': 'standing dodge left.fbx',
    'dodgeR': 'standing dodge right.fbx',
    'kick': 'standing melee kick.fbx',
}

RONIN_PACK = 'Great Sword Pack (1) samurai.zip'


def from_ronin(*names):
    """Retarget entries reusing the Rōnin's clips (its Great Sword pack, inside its zip, or
    its own retarget sources) for another Mixamo-rigged character."""
    out = {}
    for n in names:
        out[n] = (RONIN_PACK + '::' + RONIN_CLIPS[n], None) if n in RONIN_CLIPS else RONIN_RETARGET[n]
    return out


# The second enemy samurai fights exactly like the Rōnin copy, so it gets the same clips
# (its own upload only carried a longbow pack).
SAMURAI2_RETARGET = from_ronin(
    'idle', 'walk', 'run', 'walkBack', 'strafeL', 'strafeR', 'guard', 'hit1', 'hit2', 'hit3',
    'death', 'death2', 'attack', 'slash2', 'eSwordSlash', 'eSwordAttack')

# The giant (boss) came without animation: the Rōnin's heavy two-handed moves suit its
# great sword - overhead smash, wide sweep, leaping slam - plus a roar for its entrance.
GIANT_RETARGET = from_ronin(
    'idle', 'walk', 'run', 'walkBack', 'strafeL', 'strafeR', 'hit1', 'hit2', 'hit3',
    'death', 'death2', 'attack', 'slash1', 'slash2', 'jumpAttack', 'powerUp')

# tex: max size of the base color / of the other maps. Enemy-only models keep base color
# sharp but halve the normal/roughness/metal maps - they never fill the screen, and four
# characters' worth of 1K maps adds up in a phone's GPU memory.
CHARACTERS = {
    'ronin': dict(name='Ronin', pack=RONIN_PACK, fbx='samurai+armor+3d+model (2).fbx',
                  clips=RONIN_CLIPS, retarget=RONIN_RETARGET, full=True, lod_ratio=0.22, tex=(1024, 1024)),
    'archer': dict(name='Archer', pack='inimigo 1 arqueiro pronto.zip', fbx='inimigo 1 atualizado.fbx',
                   clips=ARCHER_CLIPS, retarget={}, full=False, lod_ratio=0.24, tex=(1024, 512)),
    'samurai2': dict(name='Samurai2', pack='inimigo 2 samurai pronto.zip', fbx='inimigo 2 atualizado.fbx',
                     clips={}, retarget=SAMURAI2_RETARGET, full=False, lod_ratio=0.24, tex=(1024, 512)),
    'giant': dict(name='Giant', pack=None, fbx='chefe grande atualizado pronto.fbx',
                  clips={}, retarget=GIANT_RETARGET, full=False, lod_ratio=0.34, tex=(1024, 512)),
}


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith('--') else True
    return default


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, use_anim=True)
    return [o for o in bpy.data.objects if o not in before]


def rebuild_material(mat, images):
    """The FBX importer wires this pack's maps wrongly (roughness into Specular, the base
    color's alpha into Alpha) - rebuild a plain metal/rough PBR graph glTF understands."""
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    def tex(img, non_color):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
        return n

    nt.links.new(tex(images['base'], False).outputs['Color'], bsdf.inputs['Base Color'])
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tex(images['normal'], True).outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    # glTF packs roughness (G) and metallic (B) into one texture; the exporter builds that
    # packed image itself from two separate greyscale maps routed through Separate Color.
    for key, socket, channel in (('rough', 'Roughness', 'Green'), ('metal', 'Metallic', 'Blue')):
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(tex(images[key], True).outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs[channel], bsdf.inputs[socket])
    mat.use_backface_culling = True


def quat_of(m):
    return m.to_3x3().normalized().to_quaternion()


def body_frame(pos):
    """Rotation whose columns are the character's (left, up, forward) axes in world
    space, from joint positions - independent of either skeleton's bone-axis layout."""
    up = (pos['HeadTop_End'] - pos['Hips']).normalized()
    left = pos['LeftUpLeg'] - pos['RightUpLeg']
    left = (left - up * left.dot(up)).normalized()
    fwd = left.cross(up)
    return Matrix((left, up, fwd)).transposed().to_quaternion()


def rest_positions(obj):
    return {b.name.split(':')[-1].replace('mixamorig', ''): obj.matrix_world @ b.head_local for b in obj.data.bones}


def retarget(arm, src_path, clips):
    """Retargets actions from another Mixamo-named skeleton onto `arm`.

    The two skeletons share bone names but not rest pose (theirs is an A-pose lying along
    world -X at 1/100 scale; ours a standing T-pose), so copying local rotations would be
    meaningless. Per bone, instead: take the source's WORLD rotation delta from its own rest
    pose, re-express it in our world frame (Y, from each rig's left/up/forward axes), and
    apply it on top of our rest pose pre-aligned to the source's rest pose (A, the
    minimal swing turning our bone's rest direction onto theirs). At the source's rest
    pose that reproduces its A-pose on our rig; any other frame follows the same deltas.
    Hips translation is scaled by the two rigs' leg-length ratio."""
    new = import_fbx(src_path)
    src = next(o for o in new if o.type == 'ARMATURE')
    own_action = src.animation_data.action if src.animation_data else None
    src_fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    bpy.context.scene.render.fps = 30
    bpy.context.scene.render.fps_base = 1

    def key(name):
        return name.split(':')[-1].replace('mixamorig', '')

    sbones = {key(b.name): b for b in src.pose.bones}
    ps, pt = rest_positions(src), rest_positions(arm)
    yq = body_frame(pt) @ body_frame(ps).inverted()
    leg = lambda p: (p['LeftUpLeg'] - p['LeftLeg']).length + (p['LeftLeg'] - p['LeftFoot']).length
    k = leg(pt) / leg(ps)

    r_obj = quat_of(arm.matrix_world)
    m_obj_inv = arm.matrix_world.inverted()
    order = [pb for pb in arm.pose.bones]  # pose.bones is already parent-before-child
    t_rest_world = {pb.name: quat_of(arm.matrix_world @ pb.bone.matrix_local) for pb in order}
    s_rest_world = {n: quat_of(src.matrix_world @ b.bone.matrix_local) for n, b in sbones.items()}

    def rest_dir(obj, bone):
        if not bone.children:
            return None
        return ((obj.matrix_world @ bone.children[0].head_local) - (obj.matrix_world @ bone.head_local)).normalized()

    align = {}
    for pb in order:
        sb = sbones.get(key(pb.name))
        dt = rest_dir(arm, pb.bone)
        ds = rest_dir(src, sb.bone) if sb else None
        if dt is not None and ds is not None:
            align[pb.name] = dt.rotation_difference(yq @ ds)
        else:
            align[pb.name] = align.get(pb.parent.name, Quaternion()) if pb.parent else Quaternion()

    for game_name, action_name in clips.items():
        act = bpy.data.actions[action_name] if action_name else own_action
        src.animation_data.action = act
        if act.slots:
            src.animation_data.action_slot = act.slots[0]
        f0, f1 = round(act.frame_range[0]), round(act.frame_range[1])
        out = bpy.data.actions.new(game_name)
        out.use_fake_user = True
        arm.animation_data.action = out
        prev = {}
        for f in range(f0, f1 + 1):
            bpy.context.scene.frame_set(f)
            fk = 1 + (f - f0) * 30.0 / src_fps
            world = {}
            for pb in order:
                sb = sbones.get(key(pb.name))
                if sb:
                    s_now = quat_of(src.matrix_world @ sb.matrix)
                    w = yq @ s_now @ s_rest_world[key(pb.name)].inverted() @ yq.inverted() @ align[pb.name] @ t_rest_world[pb.name]
                elif pb.parent:
                    w = world[pb.parent.name] @ t_rest_world[pb.parent.name].inverted() @ t_rest_world[pb.name]
                else:
                    w = t_rest_world[pb.name]
                world[pb.name] = w
                w_arm = r_obj.inverted() @ w
                r_rest = pb.bone.matrix_local.to_quaternion()
                if pb.parent:
                    wp_arm = r_obj.inverted() @ world[pb.parent.name]
                    rp_rest = pb.parent.bone.matrix_local.to_quaternion()
                    basis = (r_rest.inverted() @ rp_rest @ wp_arm.inverted()) @ w_arm
                else:
                    basis = r_rest.inverted() @ w_arm
                    p_src = (src.matrix_world @ sb.matrix).translation
                    p_arm = m_obj_inv @ ((yq.to_matrix() @ p_src) * k)
                    pb.location = r_rest.inverted() @ (p_arm - pb.bone.head_local)
                    pb.keyframe_insert('location', frame=fk)
                if pb.name in prev and prev[pb.name].dot(basis) < 0:
                    basis.negate()
                prev[pb.name] = basis
                pb.rotation_mode = 'QUATERNION'
                pb.rotation_quaternion = basis
                pb.keyframe_insert('rotation_quaternion', frame=fk)
        arm.animation_data.action = None
        push_clip(arm, game_name, out)
        print('retargeted', game_name, 'from', action_name, f'{f1 - f0 + 1} frames @ {src_fps}fps')

    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)


def push_clip(arm, name, act):
    act.name = name
    act.use_fake_user = True
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(act.frame_range[0]), act)
    if hasattr(strip, 'action_slot') and act.slots:
        strip.action_slot = act.slots[0]
    track.mute = True


def make_lod(body, name, ratio):
    lod = body.copy()
    lod.data = body.data.copy()
    lod.name = name + 'LOD'
    body.users_collection[0].objects.link(lod)
    dec = lod.modifiers.new('Decimate', 'DECIMATE')
    dec.ratio = ratio
    dec.use_collapse_triangulate = True
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = lod
    lod.select_set(True)
    bpy.ops.object.modifier_move_to_index(modifier='Decimate', index=0)
    bpy.ops.object.modifier_apply(modifier='Decimate')
    print('lod polys', len(lod.data.polygons), 'of', len(body.data.polygons))
    return lod


def main():
    which = next((a for a in sys.argv[1:] if a in CHARACTERS), 'ronin')
    spec = CHARACTERS[which]
    out_path = arg('--out', os.path.join(ROOT, 'assets_src', 'build', which + '.raw.glb'))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    export_all = bool(arg('--all', False))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30

    tmp = tempfile.mkdtemp(prefix='character_')
    if spec['pack']:
        with zipfile.ZipFile(os.path.join(ROOT, 'assets_src', spec['pack'])) as z:
            z.extractall(tmp)
        objs = import_fbx(os.path.join(tmp, spec['fbx']))
    else:
        objs = import_fbx(os.path.join(ROOT, 'assets_src', spec['fbx']))
    arm = next(o for o in objs if o.type == 'ARMATURE')
    body = next(o for o in objs if o.type == 'MESH')
    arm.name = spec['name']
    body.name = spec['name'] + 'Body'

    # This Mixamo "with skin" export stores its rest pose lying on its back and stands the
    # character up only through a one-frame bind action - while every animation FBX's own
    # rest pose is that standing bind pose (measured: identical to within 3mm/0.2 deg). Clip
    # rotations are relative to the rest pose, so played on the lying rest they'd arrive
    # rotated 90 deg. Bake the bind pose into the mesh and make it the armature's rest pose,
    # so the character and every clip share one rest pose.
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    mod = next(m for m in body.modifiers if m.type == 'ARMATURE')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    body.select_set(False)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    if arm.animation_data and arm.animation_data.action:
        stale = arm.animation_data.action
        arm.animation_data.action = None
        bpy.data.actions.remove(stale)
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm

    by_path = {}
    for img in bpy.data.images:
        p = img.filepath.lower()
        if 'basecolor' in p:
            by_path.setdefault('base', img)
        elif 'normal' in p:
            by_path['normal'] = img
        elif 'roughness' in p:
            by_path['rough'] = img
        elif 'metallic' in p:
            by_path['metal'] = img
    for key, img in by_path.items():
        cap = spec['tex'][0] if key == 'base' else spec['tex'][1]
        if img.size[0] > cap:
            img.scale(cap, cap)
            # the exporter writes a packed image's original bytes, not its edited pixels
            img.pack()
    for m in body.data.materials:
        rebuild_material(m, by_path)
        m.name = spec['name']

    if export_all:
        files = sorted(f for f in os.listdir(tmp) if f.endswith('.fbx') and f != spec['fbx'])
        clips = {os.path.splitext(f)[0]: f for f in files}
    else:
        clips = spec['clips']
    only = arg('--only')
    if only:
        keep = only.split(',')
        clips = {k: v for k, v in clips.items() if k in keep}

    if not export_all:
        make_lod(body, spec['name'], spec['lod_ratio'])
        if not spec['full']:
            bpy.data.objects.remove(body, do_unlink=True)

    arm.animation_data_create()
    for name, fname in clips.items():
        new = import_fbx(os.path.join(tmp, fname))
        src = next(o for o in new if o.type == 'ARMATURE')
        act = src.animation_data.action
        push_clip(arm, name, act)
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        print('clip', name, act.frame_range[:])

    retarget_clips = {} if export_all else spec['retarget']
    if only:
        retarget_clips = {k: v for k, v in retarget_clips.items() if k in keep}
    by_file = {}
    for name, (fname, action_name) in retarget_clips.items():
        by_file.setdefault(fname, {})[name] = action_name
    for fname, group in by_file.items():
        if '::' in fname:
            # a clip inside a zipped Mixamo pack
            zname, member = fname.split('::')
            with zipfile.ZipFile(os.path.join(ROOT, 'assets_src', zname)) as z:
                z.extract(member, tmp)
            retarget(arm, os.path.join(tmp, member), group)
        else:
            retarget(arm, os.path.join(ROOT, 'assets_src', fname), group)
    bpy.context.scene.render.fps = 30

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_image_format='WEBP',
        export_image_quality=88,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_def_bones=False,
        export_skins=True,
        export_morph=False,
        export_apply=False,
        export_yup=True,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
    )
    print('wrote', out_path)


main()
