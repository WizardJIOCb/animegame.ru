import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
CHARACTER = ROOT / "public" / "assets" / "models" / "quaternius-characters" / "Superhero_Male_FullBody.gltf"
HOODIE = ROOT / "public" / "assets" / "models" / "clothing" / "hoodie-pink.glb"
OUTPUT = ROOT / "tools" / "blender" / "hoodie-fitting.blend"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_gltf(path: Path, collection_name: str):
    collection = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(collection)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    for obj in imported:
        for old_collection in obj.users_collection:
            old_collection.objects.unlink(obj)
        collection.objects.link(obj)
    return imported


def set_object_visibility(imported, *, transparent=False):
    for obj in imported:
        if obj.type == "MESH":
            obj.show_name = False
            if transparent:
                for slot in obj.material_slots:
                    mat = slot.material
                    if not mat:
                        continue
                    mat.use_nodes = True
                    bsdf = mat.node_tree.nodes.get("Principled BSDF") or next(
                        node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED"
                    )
                    bsdf.inputs["Alpha"].default_value = 0.42
                    mat.blend_method = "BLEND"
                    mat.show_transparent_back = True


def remove_import_helpers():
    for obj in list(bpy.context.scene.objects):
        helper_name = obj.name.lower()
        has_materials = bool(getattr(obj.data, "materials", []))
        if obj.type == "MESH" and obj.parent is None and not has_materials and (
            "icosphere" in helper_name or "икосфера" in helper_name
        ):
            bpy.data.objects.remove(obj, do_unlink=True)


def pose_game_idle(armature):
    if armature is None or armature.type != "ARMATURE":
        return
    armature.name = f"{armature.name}_game_idle"
    rotations = {
        "upperarm_l": (0, 0.08, -1.18),
        "lowerarm_l": (0.16, 0, -0.08),
        "hand_l": (-0.08, 0, -0.02),
        "upperarm_r": (0, -0.08, 1.18),
        "lowerarm_r": (0.16, 0, 0.08),
        "hand_r": (-0.08, 0, 0.02),
    }
    for bone_name, (rx, ry, rz) in rotations.items():
        bone = armature.pose.bones.get(bone_name)
        if bone is None:
            continue
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.x += rx
        bone.rotation_euler.y += ry
        bone.rotation_euler.z += rz


def add_camera(name, location, rotation, ortho_scale):
    bpy.ops.object.camera_add(location=location, rotation=rotation)
    camera = bpy.context.object
    camera.name = name
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    return camera


def add_lighting():
    bpy.ops.object.light_add(type="AREA", location=(0, -4, 4.5))
    key = bpy.context.object
    key.name = "Key softbox"
    key.data.energy = 520
    key.data.size = 5.0

    bpy.ops.object.light_add(type="POINT", location=(-2.5, 1.5, 2.2))
    fill = bpy.context.object
    fill.name = "Pink rim fill"
    fill.data.energy = 75
    fill.data.color = (1.0, 0.55, 0.85)


def create_scene():
    clear_scene()
    character_objects = import_gltf(CHARACTER, "Quaternius character")
    hoodie_objects = import_gltf(HOODIE, "Pink hoodie v6")
    set_object_visibility(character_objects)
    set_object_visibility(hoodie_objects)
    remove_import_helpers()

    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            pose_game_idle(obj)

    add_lighting()
    bpy.context.scene.camera = add_camera(
        "Front fit camera",
        (0, -5.4, 1.18),
        (math.radians(82), 0, 0),
        2.0,
    )
    add_camera("Back fit camera", (0, 5.4, 1.18), (math.radians(82), 0, math.radians(180)), 2.0)
    add_camera("Side fit camera", (5.4, 0, 1.18), (math.radians(82), 0, math.radians(90)), 2.0)

    bpy.context.scene.render.resolution_x = 900
    bpy.context.scene.render.resolution_y = 1200
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    print(f"Saved {OUTPUT}")


if __name__ == "__main__":
    create_scene()
