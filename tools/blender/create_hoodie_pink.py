from pathlib import Path

import bmesh
import bpy


ROOT = Path(__file__).resolve().parents[2]
BASE_MODEL = ROOT / "public" / "assets" / "models" / "quaternius-characters" / "Superhero_Male_FullBody.gltf"
OUTPUT = ROOT / "public" / "assets" / "models" / "clothing" / "hoodie-pink.glb"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def make_mat(name, color, roughness=0.72, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def import_base():
    bpy.ops.import_scene.gltf(filepath=str(BASE_MODEL))
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    body = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH" and "SuperHero_Male" in obj.name)
    return armature, body


def face_center(face):
    center = face.calc_center_median()
    return center.x, center.y, center.z


def keep_hoodie_face(face):
    x, y, z = face_center(face)
    ax = abs(x)

    # Blender import uses Z as character height and Y as depth.
    torso = 0.66 <= z <= 1.34 and ax <= 0.49
    shoulder_cap = 1.16 <= z <= 1.43 and 0.40 < ax <= 0.62
    sleeve = 1.02 <= z <= 1.40 and 0.46 < ax <= 0.91 and abs(y) <= 0.17

    # Keep the neck open so the hoodie does not cover the face/chin.
    neck_hole = z > 1.25 and ax < 0.18 and y < -0.04
    hand_zone = ax > 0.84 and z < 1.17
    return (torso or shoulder_cap or sleeve) and not neck_hole and not hand_zone


def trim_mesh_to_hoodie(obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    delete_faces = [face for face in bm.faces if not keep_hoodie_face(face)]
    bmesh.ops.delete(bm, geom=delete_faces, context="FACES_ONLY")
    bm.verts.ensure_lookup_table()
    loose_verts = [vert for vert in bm.verts if not vert.link_faces]
    bmesh.ops.delete(bm, geom=loose_verts, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def inflate_mesh(obj, amount=0.026):
    mesh = obj.data
    mesh.update()
    for vertex in mesh.vertices:
        vertex.co += vertex.normal * amount
    mesh.update()


def make_hoodie_body(armature, body):
    hoodie = body.copy()
    hoodie.data = body.data.copy()
    hoodie.animation_data_clear()
    hoodie.name = "hoodie_pink_fitted_body"
    hoodie.data.name = "hoodie_pink_fitted_body_mesh"
    bpy.context.collection.objects.link(hoodie)

    trim_mesh_to_hoodie(hoodie)
    inflate_mesh(hoodie)

    fabric = make_mat("hoodie_pink_soft_fabric", (1.0, 0.29, 0.58, 1.0), 0.82)
    hoodie.data.materials.clear()
    hoodie.data.materials.append(fabric)
    for polygon in hoodie.data.polygons:
        polygon.material_index = 0

    for modifier in hoodie.modifiers:
        if modifier.type == "ARMATURE":
            modifier.object = armature
    hoodie.parent = armature
    return hoodie


def add_weighted_cube(name, material, armature, location, scale, weights):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for group_name, weight in weights.items():
        group = obj.vertex_groups.new(name=group_name)
        group.add([vertex.index for vertex in obj.data.vertices], weight, "ADD")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = armature
    obj.parent = armature
    return obj


def add_hood_details(armature):
    rib = make_mat("hoodie_pink_rib_and_pocket", (0.63, 0.06, 0.26, 1.0), 0.86)
    trim = make_mat("hoodie_white_drawcord", (1.0, 0.9, 0.95, 1.0), 0.7)

    add_weighted_cube(
        "hoodie_pink_waist_band",
        rib,
        armature,
        (0, -0.002, 0.72),
        (0.36, 0.18, 0.035),
        {"pelvis": 0.45, "spine_01": 0.55},
    )
    add_weighted_cube(
        "hoodie_pink_front_pocket",
        rib,
        armature,
        (0, -0.155, 0.88),
        (0.23, 0.014, 0.095),
        {"spine_01": 0.55, "spine_02": 0.45},
    )

    for x in (-0.045, 0.045):
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.007, depth=0.20, location=(x, -0.17, 1.14), rotation=(0.08, 0, 0))
        obj = bpy.context.object
        obj.name = "hoodie_pink_drawcord"
        obj.data.materials.append(trim)
        group = obj.vertex_groups.new(name="spine_03")
        group.add([vertex.index for vertex in obj.data.vertices], 1.0, "ADD")
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = armature
        obj.parent = armature


def export_hoodie(armature, hoodie):
    for obj in list(bpy.context.scene.objects):
        if obj == armature or obj == hoodie or obj.name.startswith("hoodie_pink_"):
            obj.select_set(True)
        else:
            obj.select_set(False)

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
    armature, body = import_base()
    hoodie = make_hoodie_body(armature, body)
    add_hood_details(armature)
    export_hoodie(armature, hoodie)


if __name__ == "__main__":
    create_hoodie()
