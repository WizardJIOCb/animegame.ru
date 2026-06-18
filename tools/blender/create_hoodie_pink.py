import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
BASE_MODEL = ROOT / "public" / "assets" / "models" / "quaternius-characters" / "Superhero_Male_FullBody.gltf"
OUTPUT = ROOT / "public" / "assets" / "models" / "clothing" / "hoodie-pink.glb"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_rig():
    bpy.ops.import_scene.gltf(filepath=str(BASE_MODEL))
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH":
            obj.select_set(True)
        else:
            obj.select_set(False)
    bpy.ops.object.delete()
    return armature


def make_mat(name, color, roughness=0.78, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF") or next(
        node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED"
    )
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def add_armature(obj, armature):
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = armature
    obj.parent = armature


def add_groups(obj, names):
    return {name: obj.vertex_groups.new(name=name) for name in names}


def normalize_weights(weights):
    total = sum(weights.values())
    if total <= 0:
        return weights
    return {name: weight / total for name, weight in weights.items()}


def torso_weights(co):
    _, _, z = co
    if z < 0.83:
        return normalize_weights({"pelvis": 0.35, "spine_01": 0.65})
    if z < 1.02:
        return normalize_weights({"spine_01": 0.55, "spine_02": 0.45})
    if z < 1.22:
        return normalize_weights({"spine_02": 0.55, "spine_03": 0.45})
    return normalize_weights({
        "spine_02": 0.22,
        "spine_03": 0.78,
    })


def make_skinned_mesh(name, verts, faces, material, armature, weight_fn):
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)

    groups = add_groups(obj, [
        "pelvis",
        "spine_01",
        "spine_02",
        "spine_03",
        "clavicle_l",
        "clavicle_r",
        "upperarm_l",
        "upperarm_r",
        "lowerarm_l",
        "lowerarm_r",
    ])

    for index, co in enumerate(verts):
        for group_name, weight in weight_fn(co).items():
            if group_name in groups and weight > 0:
                groups[group_name].add([index], weight, "ADD")

    add_armature(obj, armature)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj


def build_torso(armature, material):
    segments = 40
    ring_specs = [
        (0.88, 0.260, 0.112, 0.000),
        (0.96, 0.292, 0.128, 0.000),
        (1.08, 0.326, 0.144, -0.002),
        (1.20, 0.356, 0.154, -0.004),
        (1.31, 0.388, 0.148, -0.006),
        (1.37, 0.310, 0.122, -0.010),
    ]
    verts = []
    for z, rx, ry, cy in ring_specs:
        for i in range(segments):
            angle = (i / segments) * math.tau
            x = math.cos(angle) * rx
            y = cy + math.sin(angle) * ry
            if y < cy - ry * 0.58:
                y -= 0.018
            verts.append((x, y, z))

    faces = []
    for r in range(len(ring_specs) - 1):
        for i in range(segments):
            faces.append((
                r * segments + i,
                r * segments + (i + 1) % segments,
                (r + 1) * segments + (i + 1) % segments,
                (r + 1) * segments + i,
            ))

    return make_skinned_mesh("hoodie_pink_smooth_body", verts, faces, material, armature, torso_weights)


def build_band(name, armature, material, z, rx, ry, height, weights):
    segments = 40
    verts = []
    for zz in (z - height / 2, z + height / 2):
        for i in range(segments):
            angle = (i / segments) * math.tau
            verts.append((math.cos(angle) * rx, math.sin(angle) * ry, zz))

    faces = []
    for i in range(segments):
        faces.append((i, (i + 1) % segments, segments + (i + 1) % segments, segments + i))
    return make_skinned_mesh(name, verts, faces, material, armature, lambda _: weights)


def build_flat_panel(name, armature, material, verts, faces, weights):
    return make_skinned_mesh(name, verts, faces, material, armature, lambda _: weights)


def build_shoulder_cap(armature, material, side):
    sign = -1 if side == "l" else 1
    verts = [
        (sign * 0.28, -0.135, 1.23),
        (sign * 0.43, -0.125, 1.22),
        (sign * 0.46, 0.070, 1.25),
        (sign * 0.31, 0.105, 1.28),
        (sign * 0.31, -0.115, 1.34),
        (sign * 0.48, -0.095, 1.33),
        (sign * 0.50, 0.055, 1.34),
        (sign * 0.34, 0.085, 1.37),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return build_flat_panel(
        f"hoodie_pink_shoulder_cap_{side}",
        armature,
        material,
        verts,
        faces,
        normalize_weights({"spine_03": 0.86, "spine_02": 0.14}),
    )


def build_front_texture_decals(armature, star_mat, stripe_mat):
    # Lightweight geometry decals: they behave like a stylized texture but stay inside the GLB.
    for index, x in enumerate([-0.18, -0.09, 0.09, 0.18]):
        z = 1.185 + (0.035 if index % 2 else 0)
        size = 0.028
        verts = [
            (x, -0.209, z + size),
            (x + size * 0.45, -0.211, z + size * 0.18),
            (x + size, -0.209, z),
            (x + size * 0.45, -0.211, z - size * 0.18),
            (x, -0.209, z - size),
            (x - size * 0.45, -0.211, z - size * 0.18),
            (x - size, -0.209, z),
            (x - size * 0.45, -0.211, z + size * 0.18),
        ]
        faces = [(0, 1, 2, 3, 4, 5, 6, 7)]
        build_flat_panel(
            f"hoodie_pink_star_{index}",
            armature,
            star_mat,
            verts,
            faces,
            normalize_weights({"spine_02": 0.35, "spine_03": 0.65}),
        )

    stripe_verts = [
        (-0.245, -0.207, 1.105),
        (0.245, -0.207, 1.105),
        (0.245, -0.209, 1.125),
        (-0.245, -0.209, 1.125),
    ]
    build_flat_panel(
        "hoodie_pink_chest_stripe",
        armature,
        stripe_mat,
        stripe_verts,
        [(0, 1, 2, 3)],
        normalize_weights({"spine_02": 0.45, "spine_03": 0.55}),
    )


def build_details(armature, rib, trim):
    build_band(
        "hoodie_pink_clean_waist_band",
        armature,
        rib,
        0.885,
        0.265,
        0.116,
        0.045,
        normalize_weights({"pelvis": 0.35, "spine_01": 0.65}),
    )

    pocket_verts = [
        (-0.18, -0.192, 0.945),
        (0.18, -0.192, 0.945),
        (0.205, -0.196, 1.055),
        (-0.205, -0.196, 1.055),
        (-0.09, -0.202, 0.975),
        (0.09, -0.202, 0.975),
        (0.11, -0.204, 1.035),
        (-0.11, -0.204, 1.035),
    ]
    pocket_faces = [(0, 1, 2, 3), (4, 5, 6, 7)]
    build_flat_panel(
        "hoodie_pink_kangaroo_pocket",
        armature,
        rib,
        pocket_verts,
        pocket_faces,
        normalize_weights({"spine_01": 0.45, "spine_02": 0.55}),
    )

    build_band(
        "hoodie_pink_soft_collar",
        armature,
        trim,
        1.355,
        0.185,
        0.082,
        0.025,
        normalize_weights({"spine_03": 0.9, "clavicle_l": 0.05, "clavicle_r": 0.05}),
    )

    for x in (-0.055, 0.055):
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.0065, depth=0.21, location=(x, -0.214, 1.18), rotation=(0.08, 0, 0))
        obj = bpy.context.object
        obj.name = "hoodie_pink_drawcord"
        obj.data.name = f"{obj.name}_mesh"
        obj.data.materials.append(trim)
        group = obj.vertex_groups.new(name="spine_03")
        group.add([vertex.index for vertex in obj.data.vertices], 1.0, "ADD")
        add_armature(obj, armature)
        bpy.ops.object.shade_smooth()


def export_hoodie(armature):
    for obj in list(bpy.context.scene.objects):
        obj.select_set(obj == armature or obj.name.startswith("hoodie_pink_"))

    bpy.context.view_layer.objects.active = armature
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=False,
    )
    print(f"Exported {OUTPUT}")


def create_hoodie():
    clear_scene()
    armature = import_rig()
    fabric = make_mat("hoodie_pink_smooth_fabric", (1.0, 0.31, 0.62, 1.0), 0.83)
    rib = make_mat("hoodie_pink_rib", (0.62, 0.05, 0.28, 1.0), 0.88)
    trim = make_mat("hoodie_white_trim", (0.96, 0.90, 0.95, 1.0), 0.7)
    star = make_mat("hoodie_pearl_star_print", (1.0, 0.92, 1.0, 1.0), 0.62)
    stripe = make_mat("hoodie_neon_chest_print", (0.96, 0.16, 0.58, 1.0), 0.7)

    build_torso(armature, fabric)
    build_front_texture_decals(armature, star, stripe)
    build_details(armature, rib, trim)
    export_hoodie(armature)


if __name__ == "__main__":
    create_hoodie()
