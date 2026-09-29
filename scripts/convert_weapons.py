"""Normalizes the Sketchfab weapon GLBs in assets_src/ into assets_src/build/weapons/*.raw.glb.

Run with Blender's Python module (pip install bpy==5.0.1, Python 3.11):
    python scripts/convert_weapons.py [id ...]

Every source model arrives in its own scale, axis layout and pivot (one is even a
skinned prop with its own armature). The game attaches weapons to a hand as rigid
children using one convention (see makeWeapon() in src/game/rigs.ts): blade/shaft along
+Z, cutting edge (or the flat face, for a shuriken) toward +Y, the gripping point at the
origin, sized in the game's world units. Each SPEC below says where the source's tip,
edge and grip are; this script bakes the transform into the mesh, drops unused parts,
and shrinks textures (they only ever cover a few dozen pixels on screen).
Mesh compression happens afterwards in scripts/optimize_models.mjs, which writes the
files the game loads (public/models/weapons/).
"""
import os
import sys
import tempfile
import zipfile

import bpy
import bmesh  # only importable once bpy is loaded
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_point_line

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets_src')
OUT = os.path.join(ROOT, 'assets_src', 'build', 'weapons')
TEX_SIZE = 512

# Vectors are in glTF/three.js axes (Y up), as seen when loading the source file.
#   keep:  node-name substrings to keep (None = all); keep_largest: only the biggest mesh
#   axis:  node-name substrings whose vertices define the blade axis (None = all kept)
#   tip:   rough direction from grip to tip - resolves the principal axis' sign
#   edge:  direction the cutting edge faces ('sagitta' = the convex side of a curved blade)
#   grip:  where the hand holds it, as a fraction of the length from the butt
#   length: target length along the blade axis, in game units
# Optional:
#   axis_vec:  force the +Z axis (else the mesh's principal axis)
#   grip_mat:  put the origin at the centroid of this material's faces instead of `grip`
#   size_on:   'edge' to scale by the extent along +Y instead of along the axis
#   colors:    material name -> (r, g, b, metalness, roughness), for untextured sources
#   strip_string: delete a bow's baked-in straight string (the game draws a live one)
#   src may also be a .blend (objects picked with `keep`)
SPECS = {
    'katana': dict(src='katana.glb', tip=(0, 0, 1), edge='sagitta', grip=0.2, length=1.7),
    'ekatana': dict(src='KATANA INIMIGO.glb', tip=(0.55, 0.36, 0.75), edge='sagitta', grip=0.18, length=1.6),
    'greatsword': dict(src='ESPADA GIGANTE.glb', tip=(-0.5, -0.54, -0.675), edge=(0.862, -0.241, -0.446), grip=0.1, length=2.3),
    'bo': dict(src='bo_staff.glb', tip=(1, 0, 0), edge=(0, 1, 0), grip=0.41, length=2.7),
    # the sickle alone - the chain and weight are drawn by the game (see updateChain)
    'kama': dict(src='kusarigama__capcom_hack_n_slash_inspired_asset.glb', keep_largest=True, tip=(0, 1, 0), edge=(-1, 0, 0), grip=0.15, length=0.8),
    # ring + handle + blade define the axis; the explosive tag and its string hang off it
    'kunai': dict(src='exposive_kunai.glb', axis=['pTorus1', 'pCylinder1', 'pCube1'], tip=(0.25, -0.5, -0.8), edge=(1, 0, 0), grip=0.3, length=0.62, axis_len=True),
    'shuriken': dict(src='shuriken ESTRELA.glb', tip=(1, 0, 0), edge=(0, 0, 1), grip=0.5, length=0.42),
    # Enemy archer's longbow (untextured, stringless source - the game strings it, see
    # clipRig's bow string): limbs up (+Y), shooting toward +Z, the origin on the grip
    # wrap so the left hand holds it there
    'bow': dict(src='BOW AND ARROW/BLEND FILE/bow and arow.blend', zip='arco e flecha inimigo 1.zip', keep=['Cube'],
                axis_vec=(1, 0, 0), tip=(1, 0, 0), edge=(0, 1, 0), grip_mat='Material.002', size_on='edge', length=1.55, strip_string=True,
                colors={'Material': (0.92, 0.88, 0.78, 0.0, 0.8), 'Material.001': (0.16, 0.07, 0.05, 0.1, 0.45), 'Material.002': (0.42, 0.12, 0.08, 0.0, 0.7)}),
    # origin at the nock, so it sits on the drawing hand / string
    'arrow': dict(src='BOW AND ARROW/BLEND FILE/bow and arow.blend', zip='arco e flecha inimigo 1.zip', keep=['Cylinder.001'],
                  tip=(1, 0, 0), edge=(0, 1, 0), grip=0.0, length=1.0,
                  colors={'Material.003': (0.72, 0.72, 0.74, 0.9, 0.3), 'Material.004': (0.62, 0.48, 0.3, 0.0, 0.75)}),
}

# three.js (x, y, z) -> Blender (x, -z, y)
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def to_three(v):
    return Vector((v.x, v.z, -v.y))


def principal_axis(pts):
    c = sum(pts, Vector()) / len(pts)
    m = [[0.0] * 3 for _ in range(3)]
    for p in pts:
        d = p - c
        for i in range(3):
            for j in range(3):
                m[i][j] += d[i] * d[j]
    v = Vector((1, 0.7, 0.3))
    for _ in range(100):
        v = Vector((sum(m[0][j] * v[j] for j in range(3)), sum(m[1][j] * v[j] for j in range(3)), sum(m[2][j] * v[j] for j in range(3)))).normalized()
    return c, v


def match(name, subs):
    return subs is None or any(s in name for s in subs)


def unlit_to_pbr(mat):
    """KHR_materials_unlit imports as an emission-style graph that would render flat and
    ignore the scene's lights - rebuild it as a plain lit metal."""
    nt = mat.node_tree
    img = next((n.image for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image), None)
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Metallic'].default_value = 0.85
    bsdf.inputs['Roughness'].default_value = 0.32
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    if img:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])


def recolor(mat, rgb):
    r, g, b, metal, rough = rgb
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (r, g, b, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])


def strip_string(obj):
    # the string is the thin run of faces hugging the straight line between the two limb
    # tips; the limbs themselves only meet that line at the very ends (kept, as loops)
    pts = [to_three(v.co) for v in obj.data.vertices]
    top = max(pts, key=lambda p: p.y)
    bot = min(pts, key=lambda p: p.y)
    half = (top.y - bot.y) / 2
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    doomed = []
    for f in bm.faces:
        ok = True
        for v in f.verts:
            p = to_three(v.co)
            q, _ = intersect_point_line(p, top, bot)
            if (p - q).length > 0.012 or abs(p.y) > half * 0.93:
                ok = False
                break
        if ok:
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    print(f'  stripped {len(doomed)} string faces')


def convert(wid, spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src = os.path.join(SRC, spec['src'])
    if spec.get('zip'):
        tmp = tempfile.mkdtemp(prefix='weapon_')
        with zipfile.ZipFile(os.path.join(SRC, spec['zip'])) as z:
            z.extractall(tmp)
        src = os.path.join(tmp, spec['src'])
    if src.endswith('.blend'):
        bpy.ops.wm.open_mainfile(filepath=src)
    else:
        bpy.ops.import_scene.gltf(filepath=src)

    # bake skinning (the katana is a rigged prop) and every parent transform into the
    # mesh data itself, then drop everything that isn't a kept mesh
    # (the importer adds an Icosphere mesh as the armature's bone display shape)
    shapes = {pb.custom_shape for a in bpy.data.objects if a.type == 'ARMATURE' for pb in a.pose.bones}
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o not in shapes]
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            if mod.type == 'ARMATURE':
                bpy.ops.object.select_all(action='DESELECT')
                o.select_set(True)
                bpy.ops.object.modifier_apply(modifier=mod.name)
    def chain(o):
        return o.name + (' ' + chain(o.parent) if o.parent else '')
    names = {o: chain(o) for o in meshes}
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    keep = [o for o in meshes if match(names[o], spec.get('keep'))]
    if spec.get('keep_largest'):
        keep = [max(keep, key=lambda o: len(o.data.vertices))]
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in keep:
        o.select_set(True)
    bpy.context.view_layer.objects.active = keep[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    axis_objs = [o for o in keep if match(names[o], spec.get('axis'))] or keep
    pts = [to_three(v.co) for o in axis_objs for v in o.data.vertices]
    all_pts = [to_three(v.co) for o in keep for v in o.data.vertices]
    c, a = principal_axis(pts)
    if spec.get('axis_vec'):
        a = Vector(spec['axis_vec']).normalized()
    if a.dot(Vector(spec['tip'])) < 0:
        a = -a
    ref = pts if spec.get('axis_len') else all_pts
    ts = [(p - c).dot(a) for p in ref]
    lo, hi = min(ts), max(ts)
    butt = c + a * lo
    length = hi - lo

    if spec['edge'] == 'sagitta':
        # a curved blade bulges toward its edge: compare the blade's middle to the chord
        # between points near the guard and near the tip
        def centroid(f0, f1):
            sel = [p for p, t in zip(pts, ts) if lo + f0 * length <= t <= lo + f1 * length]
            return sum(sel, Vector()) / len(sel)
        mid = centroid(0.6, 0.68)
        chord = (centroid(0.38, 0.44) + centroid(0.9, 0.97)) / 2
        e = mid - chord
    else:
        e = Vector(spec['edge'])
    e = (e - a * e.dot(a)).normalized()
    side = a.cross(e)  # completes a right-handed (side, edge, axis) = (X, Y, Z) frame

    # rows = where each source axis lands: X <- side, Y <- edge, Z <- axis
    rot = Matrix((side, e, a)).to_4x4()
    if spec.get('size_on') == 'edge':
        es = [p.dot(e) for p in all_pts]
        s = spec['length'] / (max(es) - min(es))
    else:
        s = spec['length'] / length
    grip = butt + a * (spec['grip'] * length) if 'grip' in spec else c
    if spec.get('grip_mat'):
        sel = []
        for o in keep:
            idx = [i for i, m in enumerate(o.data.materials) if m and m.name == spec['grip_mat']]
            for poly in o.data.polygons:
                if poly.material_index in idx:
                    sel.extend(to_three(o.data.vertices[vi].co) for vi in poly.vertices)
        if sel:
            grip = sum(sel, Vector()) / len(sel)
    m_three = Matrix.Scale(s, 4) @ rot @ Matrix.Translation(-grip)
    m_blender = C @ m_three @ C.inverted()

    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = wid
    obj.data.transform(m_blender)
    obj.data.update()
    if spec.get('strip_string'):
        strip_string(obj)

    for mat in obj.data.materials:
        if mat and spec.get('colors', {}).get(mat.name):
            recolor(mat, spec['colors'][mat.name])
        elif mat and mat.node_tree and not any(n.type == 'BSDF_PRINCIPLED' for n in mat.node_tree.nodes):
            unlit_to_pbr(mat)
        if mat:
            mat.use_backface_culling = False
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > TEX_SIZE:
            k = TEX_SIZE / max(w, h)
            img.scale(max(1, round(w * k)), max(1, round(h * k)))
            # the exporter writes a packed image's original bytes, not its edited pixels
            if img.packed_file:
                img.pack()

    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, wid + '.raw.glb')
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_image_format='WEBP',
        export_image_quality=85,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_yup=True,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f'weapon {wid}: {len(obj.data.polygons)} polys, source length {length:.3f} -> {spec["length"]}, wrote {out}')


ids = [a for a in sys.argv[1:] if a in SPECS] or list(SPECS)
for wid in ids:
    convert(wid, SPECS[wid])
