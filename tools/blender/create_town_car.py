import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public" / "assets" / "models" / "custom" / "town-car.glb"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def make_material(name, color, roughness=0.65, metallic=0.0, emission=None, emission_strength=0.0):
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF") or next(
        node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"
    )
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic

    if emission is not None:
        emission_input = principled.inputs.get("Emission Color") or principled.inputs.get("Emission")
        strength_input = principled.inputs.get("Emission Strength")
        if emission_input is not None:
            emission_input.default_value = emission
        if strength_input is not None:
            strength_input.default_value = emission_strength

    return material


def attach_material(obj, material):
    obj.data.materials.append(material)


def parent_keep_transform(obj, parent):
    world_matrix = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world_matrix


def add_beveled_box(name, location, dimensions, material, root, bevel=0.04, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_mesh"
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    if bevel > 0:
        modifier = obj.modifiers.new(name="Friendly low-poly bevel", type="BEVEL")
        modifier.width = min(bevel, min(dimensions) * 0.42)
        modifier.segments = 2
        modifier.affect = "EDGES"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)

    attach_material(obj, material)
    parent_keep_transform(obj, root)
    return obj


def add_ellipsoid(name, location, dimensions, material, root):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=12,
        ring_count=6,
        radius=0.5,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_mesh"
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    attach_material(obj, material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    parent_keep_transform(obj, root)
    return obj


def add_side_window(name, x, yz_points, material, root):
    thickness = 0.026
    x_inner = x - math.copysign(thickness, x)
    vertices = [(x, y, z) for y, z in yz_points] + [(x_inner, y, z) for y, z in yz_points]
    faces = [
        (0, 1, 2, 3),
        (7, 6, 5, 4),
        (0, 4, 5, 1),
        (1, 5, 6, 2),
        (2, 6, 7, 3),
        (3, 7, 4, 0),
    ]
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    attach_material(obj, material)
    parent_keep_transform(obj, root)
    return obj


def add_wheel(name, location, tire_material, hub_material, root, outward_sign):
    pivot = bpy.data.objects.new(name, None)
    pivot.empty_display_type = "CIRCLE"
    pivot.empty_display_size = 0.34
    pivot.location = location
    pivot.parent = root
    bpy.context.collection.objects.link(pivot)

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=12,
        radius=0.34,
        depth=0.20,
        location=location,
        rotation=(0.0, math.pi / 2.0, 0.0),
    )
    tire = bpy.context.object
    tire.name = f"{name}_Tire"
    tire.data.name = f"{tire.name}_mesh"
    bevel = tire.modifiers.new(name="Tire edge bevel", type="BEVEL")
    bevel.width = 0.025
    bevel.segments = 1
    bevel.affect = "EDGES"
    bpy.context.view_layer.objects.active = tire
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    attach_material(tire, tire_material)
    for polygon in tire.data.polygons:
        polygon.use_smooth = True
    parent_keep_transform(tire, pivot)

    hub_x = location[0] + outward_sign * 0.106
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=12,
        radius=0.16,
        depth=0.025,
        location=(hub_x, location[1], location[2]),
        rotation=(0.0, math.pi / 2.0, 0.0),
    )
    hub = bpy.context.object
    hub.name = f"{name}_Hubcap"
    hub.data.name = f"{hub.name}_mesh"
    attach_material(hub, hub_material)
    for polygon in hub.data.polygons:
        polygon.use_smooth = True
    parent_keep_transform(hub, pivot)

    add_ellipsoid(
        f"{name}_HubDot",
        (hub_x + outward_sign * 0.017, location[1], location[2]),
        (0.035, 0.12, 0.12),
        tire_material,
        pivot,
    )
    return pivot


def join_meshes(objects, name):
    objects = [obj for obj in objects if obj is not None and obj.type == "MESH"]
    if not objects:
        return None
    if len(objects) == 1:
        objects[0].name = name
        objects[0].data.name = f"{name}_mesh"
        return objects[0]

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.data.name = f"{name}_mesh"
    return joined


def optimize_draw_calls(root):
    # Keep four wheel pivots independent, but combine each tire with its center dot.
    for pivot in [child for child in root.children if child.name.startswith("Wheel_")]:
        tire_parts = [
            child
            for child in pivot.children
            if child.type == "MESH" and child.data.materials and child.data.materials[0].name == "CarTire"
        ]
        join_meshes(tire_parts, f"{pivot.name}_Tire")

    # Static pieces are merged by material. This preserves repainting and light
    # toggles while avoiding dozens of draw calls for every duplicated car.
    # Bake transforms first so sloped glass panels retain their exact world shape.
    for obj in [child for child in root.children if child.type == "MESH"]:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    merged_names = {
        "CarPaint": "TownCar_PaintedBody",
        "CarDarkTrim": "TownCar_DarkTrim",
        "CarHubcap": "TownCar_MetalDetails",
        "CarHeadlight": "TownCar_Headlights",
        "CarLicensePlate": "TownCar_LicensePlates",
        "CarGlass": "TownCar_Windows",
        "CarTailLight": "TownCar_TailLights",
    }
    for material_name, merged_name in merged_names.items():
        direct_meshes = [child for child in root.children if child.type == "MESH"]
        material_group = [
            obj
            for obj in direct_meshes
            if obj.data.materials
            and obj.data.materials[0].name == material_name
        ]
        join_meshes(material_group, merged_name)


def build_car():
    clear_scene()

    root = bpy.data.objects.new("TownCar", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.5
    bpy.context.collection.objects.link(root)

    # CarPaint is deliberately shared by every painted body panel so the client
    # can recolor the complete vehicle by changing a single material.
    car_paint = make_material("CarPaint", (0.94, 0.20, 0.43, 1.0), roughness=0.38, metallic=0.10)
    dark_trim = make_material("CarDarkTrim", (0.025, 0.035, 0.055, 1.0), roughness=0.48, metallic=0.12)
    glass = make_material("CarGlass", (0.055, 0.20, 0.30, 1.0), roughness=0.20, metallic=0.18)
    tire = make_material("CarTire", (0.012, 0.016, 0.023, 1.0), roughness=0.92)
    hub = make_material("CarHubcap", (0.62, 0.70, 0.78, 1.0), roughness=0.30, metallic=0.78)
    headlight = make_material(
        "CarHeadlight",
        (1.0, 0.82, 0.42, 1.0),
        roughness=0.22,
        emission=(1.0, 0.56, 0.16, 1.0),
        emission_strength=1.5,
    )
    tail_light = make_material(
        "CarTailLight",
        (0.82, 0.025, 0.045, 1.0),
        roughness=0.28,
        emission=(1.0, 0.01, 0.02, 1.0),
        emission_strength=0.7,
    )
    plate = make_material("CarLicensePlate", (0.82, 0.90, 0.94, 1.0), roughness=0.58, metallic=0.05)

    # Blender uses Z-up. The car nose points toward -Y here; Blender's glTF
    # conversion maps that direction to local +Z in the exported Y-up model.
    add_beveled_box("Body_Main", (0.0, 0.0, 0.60), (1.70, 3.28, 0.62), car_paint, root, bevel=0.14)
    add_beveled_box("Body_Underside", (0.0, 0.02, 0.31), (1.42, 2.82, 0.20), dark_trim, root, bevel=0.06)
    add_beveled_box("Hood", (0.0, -1.05, 0.92), (1.56, 1.17, 0.28), car_paint, root, bevel=0.10)
    add_beveled_box("Trunk", (0.0, 1.18, 0.91), (1.54, 0.72, 0.28), car_paint, root, bevel=0.09)
    add_beveled_box("Roof", (0.0, 0.23, 1.42), (1.34, 1.20, 0.16), car_paint, root, bevel=0.08)

    # Large dark windows and chunky painted pillars give a friendly anime-car silhouette.
    add_beveled_box(
        "Windshield",
        (0.0, -0.505, 1.155),
        (1.32, 0.045, 0.58),
        glass,
        root,
        bevel=0.025,
        rotation=(-0.56, 0.0, 0.0),
    )
    add_beveled_box(
        "RearWindow",
        (0.0, 0.865, 1.145),
        (1.28, 0.045, 0.52),
        glass,
        root,
        bevel=0.025,
        rotation=(0.58, 0.0, 0.0),
    )

    front_window = [(-0.53, 0.92), (0.12, 0.92), (0.12, 1.34), (-0.29, 1.34)]
    rear_window = [(0.28, 0.92), (0.94, 0.92), (0.67, 1.34), (0.28, 1.34)]
    for side_name, x in (("L", -0.721), ("R", 0.721)):
        add_side_window(f"Window_{side_name}_Front", x, front_window, glass, root)
        add_side_window(f"Window_{side_name}_Rear", x, rear_window, glass, root)
        add_beveled_box(f"Pillar_{side_name}_B", (x, 0.20, 1.14), (0.10, 0.13, 0.50), car_paint, root, bevel=0.025)
        add_beveled_box(f"DoorHandle_{side_name}_Front", (x + math.copysign(0.018, x), -0.08, 0.91), (0.035, 0.22, 0.055), hub, root, bevel=0.015)
        add_beveled_box(f"DoorHandle_{side_name}_Rear", (x + math.copysign(0.018, x), 0.57, 0.91), (0.035, 0.22, 0.055), hub, root, bevel=0.015)
        add_beveled_box(f"SideMirror_{side_name}", (x + math.copysign(0.075, x), -0.42, 1.09), (0.14, 0.20, 0.12), car_paint, root, bevel=0.045)

    # Four independently pivoted wheels, ready for rotation/steering in the client.
    add_wheel("Wheel_FL", (-0.79, -1.12, 0.34), tire, hub, root, outward_sign=-1)
    add_wheel("Wheel_FR", (0.79, -1.12, 0.34), tire, hub, root, outward_sign=1)
    add_wheel("Wheel_RL", (-0.79, 1.10, 0.34), tire, hub, root, outward_sign=-1)
    add_wheel("Wheel_RR", (0.79, 1.10, 0.34), tire, hub, root, outward_sign=1)

    add_beveled_box("Bumper_Front", (0.0, -1.74, 0.43), (1.54, 0.16, 0.16), dark_trim, root, bevel=0.055)
    add_beveled_box("Bumper_Rear", (0.0, 1.70, 0.43), (1.54, 0.16, 0.16), dark_trim, root, bevel=0.055)
    add_beveled_box("Grille", (0.0, -1.676, 0.62), (0.68, 0.035, 0.18), dark_trim, root, bevel=0.045)
    for x in (-0.19, 0.0, 0.19):
        add_beveled_box(f"GrilleBar_{x:+.2f}", (x, -1.699, 0.62), (0.035, 0.025, 0.13), hub, root, bevel=0.008)

    # Oversized lights are intentional: they read like a friendly face at game-camera distance.
    for side_name, x in (("L", -0.54), ("R", 0.54)):
        add_ellipsoid(f"Headlight_{side_name}", (x, -1.665, 0.79), (0.38, 0.10, 0.23), headlight, root)
        add_beveled_box(f"TailLight_{side_name}", (x, 1.635, 0.75), (0.30, 0.06, 0.18), tail_light, root, bevel=0.045)

    add_beveled_box("LicensePlate_Front", (0.0, -1.832, 0.42), (0.42, 0.025, 0.13), plate, root, bevel=0.018)
    add_beveled_box("LicensePlate_Rear", (0.0, 1.792, 0.54), (0.42, 0.025, 0.13), plate, root, bevel=0.018)

    optimize_draw_calls(root)

    return root


def export_car(root):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)

    bpy.context.view_layer.objects.active = root
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=False,
        export_materials="EXPORT",
        export_yup=True,
    )
    print(f"Exported {OUTPUT}")


def main():
    root = build_car()
    export_car(root)


if __name__ == "__main__":
    main()
