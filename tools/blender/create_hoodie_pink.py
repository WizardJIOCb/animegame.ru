import math
import os
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
        if obj.type == "MESH" and obj.name != "hoodie_placeholder":
            obj.select_set(True)
        else:
            obj.select_set(False)
    bpy.ops.object.delete()
    return armature


def make_mat(name, color, roughness=0.78, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def add_armature_modifier(obj, armature):
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = armature
    obj.parent = armature


def ensure_groups(obj, names):
    return {name: obj.vertex_groups.new(name=name) for name in names}


def build_tube_mesh(name, rings, segments, material, armature, weight_fn, seam_front=False):
    verts = []
    faces = []
    for ring in rings:
        z = ring["z"]
        rx = ring["rx"]
        ry = ring["ry"]
        cy = ring.get("cy", 0.0)
        for i in range(segments):
            angle = (i / segments) * math.tau
            x = math.cos(angle) * rx
            y = cy + math.sin(angle) * ry
            # Flatten the front a little so the hoodie reads less like a barrel.
            if seam_front and y < cy - ry * 0.62:
                y = cy - ry * 0.72
            verts.append((x, y, z))

    for r in range(len(rings) - 1):
        for i in range(segments):
            a = r * segments + i
            b = r * segments + (i + 1) % segments
            c = (r + 1) * segments + (i + 1) % segments
            d = (r + 1) * segments + i
            faces.append((a, b, c, d))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)

    groups = ensure_groups(obj, [
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
        "Head",
    ])
    for index, co in enumerate(verts):
        for group_name, weight in weight_fn(co).items():
            if weight > 0:
                groups[group_name].add([index], weight, "ADD")
    add_armature_modifier(obj, armature)
    return obj


def torso_weights(co):
    x, _, z = co
    weights = {}
    if z < 0.86:
        weights["pelvis"] = 0.45
        weights["spine_01"] = 0.55
    elif z < 1.05:
        weights["spine_01"] = 0.45
        weights["spine_02"] = 0.55
    elif z < 1.24:
        weights["spine_02"] = 0.45
        weights["spine_03"] = 0.55
    else:
        weights["spine_03"] = 0.72
        weights["clavicle_l" if x < 0 else "clavicle_r"] = 0.28
    return weights


def sleeve_weights(side):
    upper = f"upperarm_{side}"
    lower = f"lowerarm_{side}"
    clavicle = f"clavicle_{side}"

    def weights(co):
        x, _, _ = co
        t = min(1.0, max(0.0, (abs(x) - 0.34) / 0.54))
        if t < 0.32:
            return {clavicle: 0.25, upper: 0.75}
        if t < 0.72:
            return {upper: 0.8, lower: 0.2}
        return {upper: 0.25, lower: 0.75}

    return weights


def build_sleeve(name, side, material, armature):
    sign = -1 if side == "l" else 1
    segments = 16
    rings = []
    for j in range(7):
        t = j / 6
        x = sign * (0.34 + t * 0.54)
        z = 1.28 - t * 0.02
        rx = 0.092 - t * 0.024
        ry = 0.105 - t * 0.026
        ring = []
        for i in range(segments):
            angle = (i / segments) * math.tau
            ring.append((x, math.sin(angle) * ry, z + math.cos(angle) * rx))
        rings.append(ring)

    verts = [co for ring in rings for co in ring]
    faces = []
    for r in range(len(rings) - 1):
        for i in range(segments):
            a = r * segments + i
            b = r * segments + (i + 1) % segments
            c = (r + 1) * segments + (i + 1) % segments
            d = (r + 1) * segments + i
            faces.append((a, b, c, d))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    groups = ensure_groups(obj, [f"clavicle_{side}", f"upperarm_{side}", f"lowerarm_{side}"])
    for index, co in enumerate(verts):
        for group_name, weight in sleeve_weights(side)(co).items():
            groups[group_name].add([index], weight, "ADD")
    add_armature_modifier(obj, armature)
    return obj


def build_box_panel(name, verts, faces, material, armature, weights):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    groups = ensure_groups(obj, list(weights.keys()))
    for index in range(len(verts)):
        for group_name, weight in weights.items():
            groups[group_name].add([index], weight, "ADD")
    add_armature_modifier(obj, armature)
    return obj


def create_uv_grid(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.03)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)


def create_hoodie():
    clear_scene()
    armature = import_rig()

    fabric = make_mat("hoodie_pink_fabric", (1.0, 0.28, 0.58, 1.0), 0.84)
    dark_fabric = make_mat("hoodie_pink_shadow_fabric", (0.46, 0.04, 0.18, 1.0), 0.88)
    trim = make_mat("hoodie_white_trim", (1.0, 0.92, 0.96, 1.0), 0.7)
    cord = make_mat("hoodie_drawcord", (0.98, 0.92, 0.86, 1.0), 0.55)

    torso_rings = [
        {"z": 0.72, "rx": 0.31, "ry": 0.17},
        {"z": 0.86, "rx": 0.34, "ry": 0.18},
        {"z": 1.02, "rx": 0.39, "ry": 0.19},
        {"z": 1.18, "rx": 0.43, "ry": 0.19},
        {"z": 1.32, "rx": 0.48, "ry": 0.18},
    ]
    body = build_tube_mesh("hoodie_pink_body", torso_rings, 32, fabric, armature, torso_weights, seam_front=True)
    create_uv_grid(body)

    left_sleeve = build_sleeve("hoodie_pink_sleeve_l", "l", fabric, armature)
    right_sleeve = build_sleeve("hoodie_pink_sleeve_r", "r", fabric, armature)
    create_uv_grid(left_sleeve)
    create_uv_grid(right_sleeve)

    # Hood as a soft half collar behind the head/neck.
    hood_rings = [
        {"z": 1.27, "rx": 0.26, "ry": 0.11, "cy": 0.13},
        {"z": 1.39, "rx": 0.31, "ry": 0.14, "cy": 0.12},
        {"z": 1.52, "rx": 0.25, "ry": 0.13, "cy": 0.12},
    ]
    hood = build_tube_mesh("hoodie_pink_hood", hood_rings, 24, fabric, armature, lambda co: {"spine_03": 0.45, "Head": 0.55})
    hood.scale.y = 0.82
    create_uv_grid(hood)

    # Waist and sleeve cuffs.
    cuff_rings = [
        {"z": 0.69, "rx": 0.32, "ry": 0.175},
        {"z": 0.735, "rx": 0.315, "ry": 0.172},
    ]
    waist = build_tube_mesh("hoodie_pink_waist_rib", cuff_rings, 32, dark_fabric, armature, torso_weights, seam_front=True)
    create_uv_grid(waist)

    pocket_verts = [
        (-0.19, -0.182, 0.82),
        (0.19, -0.182, 0.82),
        (0.23, -0.19, 0.98),
        (-0.23, -0.19, 0.98),
        (-0.12, -0.202, 0.86),
        (0.12, -0.202, 0.86),
        (0.15, -0.208, 0.95),
        (-0.15, -0.208, 0.95),
    ]
    pocket_faces = [(0, 1, 2, 3), (4, 5, 6, 7)]
    pocket = build_box_panel("hoodie_pink_kangaroo_pocket", pocket_verts, pocket_faces, dark_fabric, armature, {"spine_01": 0.45, "spine_02": 0.55})
    create_uv_grid(pocket)

    # Draw cords.
    for x in (-0.055, 0.055):
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.009, depth=0.24, location=(x, -0.212, 1.19), rotation=(0.12, 0, 0))
        obj = bpy.context.object
        obj.name = "hoodie_pink_drawcord"
        obj.data.materials.append(cord)
        groups = ensure_groups(obj, ["spine_03"])
        for vertex in obj.data.vertices:
            groups["spine_03"].add([vertex.index], 1.0, "ADD")
        add_armature_modifier(obj, armature)

    # Small white collar rim.
    collar_rings = [
        {"z": 1.28, "rx": 0.25, "ry": 0.095},
        {"z": 1.31, "rx": 0.265, "ry": 0.105},
    ]
    collar = build_tube_mesh("hoodie_pink_collar_trim", collar_rings, 32, trim, armature, lambda co: {"spine_03": 0.85, "Head": 0.15}, seam_front=True)
    create_uv_grid(collar)

    for obj in bpy.context.scene.objects:
        obj.select_set(obj == armature or obj.type == "MESH")
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


if __name__ == "__main__":
    create_hoodie()
