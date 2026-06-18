import { Html, OrbitControls, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CatalogItem, HomeState, PublicUser, RemotePlayer } from "../types";

type GameSceneProps = {
  user: PublicUser;
  home: HomeState;
  catalog: CatalogItem[];
  remotePlayers: RemotePlayer[];
  buildMode: boolean;
  selectedPlacedId: string;
  onMove: (position: { x: number; y: number; z: number; rotation?: number }) => void;
  onInteract: (itemId: string, action: string) => void;
  onSelectPlaced: (instanceId: string) => void;
  onBuildMove: (x: number, z: number) => void;
};

const floorSize = 9;
const walkLimit = floorSize / 2 - 0.45;
const walkStep = 0.45;
const gridCount = Math.round((walkLimit * 2) / walkStep) + 1;
const playerVisualYOffset = -0.025;

type Blocker = {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
};

type Cell = {
  x: number;
  z: number;
};

type PendingInteraction = {
  itemId: string;
  action: string;
} | null;

function getItem(catalog: CatalogItem[], itemId: string) {
  return catalog.find((item) => item.id === itemId);
}

function blocksPath(item: CatalogItem) {
  const id = item.id.toLowerCase();
  if (item.type !== "furniture" && item.type !== "outdoor") {
    return false;
  }

  return !id.includes("door")
    && !id.includes("rug")
    && !id.includes("floor")
    && !id.includes("grass")
    && !id.includes("flower")
    && !id.includes("path")
    && !id.includes("water");
}

function makeBlockers(home: HomeState, catalog: CatalogItem[]) {
  return home.placedItems.flatMap((placed): Blocker[] => {
    const item = getItem(catalog, placed.itemId);
    if (!item || !blocksPath(item)) {
      return [];
    }

    const size = item.size ?? [0.9, 0.9, 0.9];
    const cos = Math.abs(Math.cos(placed.rotation));
    const sin = Math.abs(Math.sin(placed.rotation));
    const halfX = (size[0] * cos + size[2] * sin) / 2 + 0.22;
    const halfZ = (size[0] * sin + size[2] * cos) / 2 + 0.22;
    return [{ x: placed.x, z: placed.z, halfX, halfZ }];
  });
}

function isPointWalkable(x: number, z: number, blockers: Blocker[]) {
  if (x < -walkLimit || x > walkLimit || z < -walkLimit || z > walkLimit) {
    return false;
  }

  return !blockers.some((blocker) => (
    Math.abs(x - blocker.x) <= blocker.halfX && Math.abs(z - blocker.z) <= blocker.halfZ
  ));
}

function cellKey(cell: Cell) {
  return `${cell.x}:${cell.z}`;
}

function cellToWorld(cell: Cell) {
  return new THREE.Vector3(-walkLimit + cell.x * walkStep, 0, -walkLimit + cell.z * walkStep);
}

function worldToCell(point: THREE.Vector3): Cell {
  return {
    x: THREE.MathUtils.clamp(Math.round((point.x + walkLimit) / walkStep), 0, gridCount - 1),
    z: THREE.MathUtils.clamp(Math.round((point.z + walkLimit) / walkStep), 0, gridCount - 1)
  };
}

function isCellWalkable(cell: Cell, blockers: Blocker[]) {
  const world = cellToWorld(cell);
  return isPointWalkable(world.x, world.z, blockers);
}

function nearestWalkableCell(cell: Cell, blockers: Blocker[]) {
  if (isCellWalkable(cell, blockers)) {
    return cell;
  }

  for (let radius = 1; radius < gridCount; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) {
          continue;
        }

        const next = { x: cell.x + dx, z: cell.z + dz };
        if (next.x >= 0 && next.x < gridCount && next.z >= 0 && next.z < gridCount && isCellWalkable(next, blockers)) {
          return next;
        }
      }
    }
  }

  return cell;
}

function findPath(start: THREE.Vector3, goal: THREE.Vector3, blockers: Blocker[]) {
  const startCell = nearestWalkableCell(worldToCell(start), blockers);
  const goalCell = nearestWalkableCell(worldToCell(goal), blockers);
  const startKey = cellKey(startCell);
  const goalKey = cellKey(goalCell);
  const open: Cell[] = [startCell];
  const cameFrom = new Map<string, string>();
  const cells = new Map<string, Cell>([[startKey, startCell], [goalKey, goalCell]]);
  const gScore = new Map<string, number>([[startKey, 0]]);
  const directions = [
    { x: 1, z: 0, cost: 1 },
    { x: -1, z: 0, cost: 1 },
    { x: 0, z: 1, cost: 1 },
    { x: 0, z: -1, cost: 1 },
    { x: 1, z: 1, cost: 1.4 },
    { x: 1, z: -1, cost: 1.4 },
    { x: -1, z: 1, cost: 1.4 },
    { x: -1, z: -1, cost: 1.4 }
  ];

  const heuristic = (cell: Cell) => Math.hypot(cell.x - goalCell.x, cell.z - goalCell.z);

  for (let guard = 0; open.length > 0 && guard < 900; guard += 1) {
    open.sort((a, b) => (
      (gScore.get(cellKey(a)) ?? Infinity) + heuristic(a)
      - ((gScore.get(cellKey(b)) ?? Infinity) + heuristic(b))
    ));
    const current = open.shift()!;
    const currentKey = cellKey(current);

    if (currentKey === goalKey) {
      const path = [goalCell];
      let cursor = goalKey;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!;
        path.push(cells.get(cursor)!);
      }
      return path.reverse().map(cellToWorld);
    }

    for (const direction of directions) {
      const next = { x: current.x + direction.x, z: current.z + direction.z };
      if (next.x < 0 || next.x >= gridCount || next.z < 0 || next.z >= gridCount) {
        continue;
      }

      if (!isCellWalkable(next, blockers)) {
        continue;
      }

      if (direction.x !== 0 && direction.z !== 0) {
        if (!isCellWalkable({ x: current.x + direction.x, z: current.z }, blockers) || !isCellWalkable({ x: current.x, z: current.z + direction.z }, blockers)) {
          continue;
        }
      }

      const nextKey = cellKey(next);
      cells.set(nextKey, next);
      const tentativeScore = (gScore.get(currentKey) ?? Infinity) + direction.cost;
      if (tentativeScore >= (gScore.get(nextKey) ?? Infinity)) {
        continue;
      }

      cameFrom.set(nextKey, currentKey);
      gScore.set(nextKey, tentativeScore);
      if (!open.some((cell) => cellKey(cell) === nextKey)) {
        open.push(next);
      }
    }
  }

  return [cellToWorld(goalCell)];
}

function appendUniqueWaypoint(path: THREE.Vector3[], waypoint: THREE.Vector3) {
  const last = path[path.length - 1];
  if (!last || last.distanceTo(waypoint) > 0.08) {
    return [...path, waypoint.clone()];
  }
  return path;
}

function CameraControls() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const touchPointers = useRef(new Map<number, { x: number; y: number }>());
  const touchPanRef = useRef<{ x: number; y: number } | null>(null);
  const keysRef = useRef(new Set<string>());

  function getFlatAxes() {
    const right = new THREE.Vector3();
    camera.matrixWorld.extractBasis(right, new THREE.Vector3(), new THREE.Vector3());
    right.y = 0;
    right.normalize();

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    return { right, forward };
  }

  function panFlat(move: THREE.Vector3) {
    if (move.lengthSq() === 0 || !controlsRef.current) {
      return;
    }

    camera.position.add(move);
    controlsRef.current.target.add(move);
    controlsRef.current.update();
  }

  useEffect(() => {
    const element = gl.domElement;
    const previousTouchAction = element.style.touchAction;
    element.style.touchAction = "none";

    function getTouchCentroid() {
      const points = [...touchPointers.current.values()];
      if (points.length < 2) {
        return null;
      }

      return points.reduce(
        (center, point) => ({
          x: center.x + point.x / points.length,
          y: center.y + point.y / points.length
        }),
        { x: 0, y: 0 }
      );
    }

    function panByScreenDelta(dx: number, dy: number, mode: "drag" | "touch") {
      const { right, forward } = getFlatAxes();
      const distance = camera.position.distanceTo(controlsRef.current?.target ?? new THREE.Vector3());
      const speed = Math.max(0.008, distance * 0.0018);
      const move = mode === "touch"
        ? right.multiplyScalar(dx * speed).add(forward.multiplyScalar(-dy * speed))
        : right.multiplyScalar(-dx * speed).add(forward.multiplyScalar(dy * speed));
      panFlat(move);
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.pointerType === "touch") {
        touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPointers.current.size >= 2) {
          event.preventDefault();
          touchPanRef.current = getTouchCentroid();
          element.setPointerCapture?.(event.pointerId);
        }
        return;
      }

      if (event.button !== 2) {
        return;
      }

      event.preventDefault();
      dragRef.current = { x: event.clientX, y: event.clientY };
      element.setPointerCapture?.(event.pointerId);
    }

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType === "touch") {
        if (!touchPointers.current.has(event.pointerId)) {
          return;
        }

        touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const centroid = getTouchCentroid();
        if (!centroid) {
          touchPanRef.current = null;
          return;
        }

        event.preventDefault();
        const last = touchPanRef.current ?? centroid;
        const dx = centroid.x - last.x;
        const dy = centroid.y - last.y;
        touchPanRef.current = centroid;
        panByScreenDelta(dx, dy, "touch");
        return;
      }

      const last = dragRef.current;
      if (!last) {
        return;
      }

      event.preventDefault();
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      dragRef.current = { x: event.clientX, y: event.clientY };

      panByScreenDelta(dx, dy, "drag");
    }

    function handlePointerUp(event: PointerEvent) {
      if (event.pointerType === "touch") {
        touchPointers.current.delete(event.pointerId);
        touchPanRef.current = getTouchCentroid();
        element.releasePointerCapture?.(event.pointerId);
        return;
      }

      if (event.button === 2) {
        dragRef.current = null;
        element.releasePointerCapture?.(event.pointerId);
      }
    }

    function cameraKey(event: KeyboardEvent) {
      const byCode: Record<string, string> = {
        KeyW: "w",
        KeyA: "a",
        KeyS: "s",
        KeyD: "d",
        ArrowUp: "arrowup",
        ArrowLeft: "arrowleft",
        ArrowDown: "arrowdown",
        ArrowRight: "arrowright"
      };
      return byCode[event.code] ?? event.key.toLowerCase();
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }

      const key = cameraKey(event);
      if (["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(key)) {
        event.preventDefault();
        keysRef.current.add(key);
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      keysRef.current.delete(cameraKey(event));
    }

    element.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      element.style.touchAction = previousTouchAction;
      element.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [camera, gl]);

  useFrame((_, delta) => {
    const keys = keysRef.current;
    let x = 0;
    let z = 0;

    if (keys.has("a") || keys.has("arrowleft")) {
      x -= 1;
    }
    if (keys.has("d") || keys.has("arrowright")) {
      x += 1;
    }
    if (keys.has("w") || keys.has("arrowup")) {
      z += 1;
    }
    if (keys.has("s") || keys.has("arrowdown")) {
      z -= 1;
    }

    if (x === 0 && z === 0) {
      return;
    }

    const { right, forward } = getFlatAxes();
    const move = right.multiplyScalar(x).add(forward.multiplyScalar(z));
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(delta * 4.2);
      panFlat(move);
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={false}
      panSpeed={0}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      }}
      maxPolarAngle={Math.PI / 2.25}
      minDistance={5.2}
      maxDistance={11}
    />
  );
}

function normalizePaintColor(color: string, kind: "floor" | "wall") {
  if (kind === "floor" && ["#252633", "#29333f", "#302b46"].includes(color.toLowerCase())) {
    return "#9b6a3c";
  }

  if (kind === "wall" && ["#303346", "#263849", "#3b3453"].includes(color.toLowerCase())) {
    return "#d8d1c3";
  }

  return color;
}

function makePaintTexture(color: string, kind: "floor" | "wall") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const base = new THREE.Color(normalizePaintColor(color, kind));
  const light = base.clone().offsetHSL(0.015, -0.05, 0.18).getStyle();
  const mid = base.clone().offsetHSL(0, -0.02, 0.06).getStyle();
  const dark = base.clone().offsetHSL(-0.01, 0.08, -0.18).getStyle();
  const line = base.clone().offsetHSL(0, 0.06, -0.28).getStyle();
  context.fillStyle = base.getStyle();
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (kind === "floor") {
    const plankHeight = 32;
    for (let y = 0; y < 256; y += plankHeight) {
      const offset = (y / plankHeight) % 2 === 0 ? 0 : 48;
      context.fillStyle = (y / plankHeight) % 3 === 0 ? light : (y / plankHeight) % 3 === 1 ? mid : base.getStyle();
      context.fillRect(0, y, 256, plankHeight);
      context.strokeStyle = line;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(256, y);
      context.stroke();
      for (let x = -offset; x < 256; x += 96) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y + plankHeight);
        context.stroke();
      }
      for (let grain = 0; grain < 6; grain += 1) {
        const gy = y + 6 + grain * 4;
        context.strokeStyle = grain % 2 === 0 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.12)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(8, gy);
        for (let x = 8; x <= 248; x += 24) {
          context.lineTo(x, gy + Math.sin((x + y + grain * 17) * 0.045) * 2.5);
        }
        context.stroke();
      }
    }
  } else {
    context.fillStyle = mid;
    context.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 1) {
      const shade = Math.sin((y / 256) * Math.PI * 2) * 0.018;
      context.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${Math.abs(shade)})`;
      context.fillRect(0, y, 256, 1);
    }
    for (let x = 0; x < 256; x += 4) {
      context.strokeStyle = x % 8 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.026)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, 256);
      context.stroke();
    }
    for (let i = 0; i < 700; i += 1) {
      const x = (i * 73) % 256;
      const y = (i * 151) % 256;
      const alpha = i % 2 === 0 ? 0.025 : 0.018;
      context.fillStyle = i % 2 === 0 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      context.fillRect(x, y, 1, 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === "floor" ? 3.2 : 1, kind === "floor" ? 3.2 : 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = kind === "floor" ? 4 : 8;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

function RuntimeModel({ item, size }: { item: CatalogItem; size: [number, number, number] }) {
  const gltf = useGLTF(item.modelUrl ?? "");
  const { scene, scale } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = false;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            for (const texture of [material.map, material.emissiveMap, material.roughnessMap, material.metalnessMap]) {
              if (texture) {
                texture.anisotropy = 8;
                texture.magFilter = THREE.LinearFilter;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.needsUpdate = true;
              }
            }
          }
        }
      }
    });
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const dimensions = box.getSize(new THREE.Vector3());
    const baseScale = item.modelScale ?? 1;
    const footprintScale = Math.min(
      dimensions.x > 0 ? size[0] / dimensions.x : baseScale,
      dimensions.z > 0 ? size[2] / dimensions.z : baseScale
    ) * baseScale;
    const uniformScale = THREE.MathUtils.clamp(footprintScale, 0.45, 3.4);
    return {
      scene: clone,
      scale: uniformScale
    };
  }, [gltf.scene, item.modelScale, size]);

  return (
    <primitive
      object={scene}
      position={[0, -size[1] / 2, 0]}
      scale={scale}
    />
  );
}

function ModelFallback({ item, size }: { item: CatalogItem; size: [number, number, number] }) {
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={item.color} roughness={0.55} metalness={0.04} opacity={0.55} transparent />
    </mesh>
  );
}

function outfitColors(item?: CatalogItem) {
  const id = item?.id ?? "";
  if (id.includes("black") || id.includes("night")) {
    return { main: "#111827", accent: "#7c3aed", trim: "#e5e7eb" };
  }
  if (id.includes("sakura") || id.includes("pink") || id.includes("idol")) {
    return { main: "#f9a8d4", accent: "#ec4899", trim: "#fff1f2" };
  }
  if (id.includes("cyber") || id.includes("neo")) {
    return { main: "#1f2937", accent: "#22d3ee", trim: "#a78bfa" };
  }
  if (id.includes("kimono") || id.includes("summer")) {
    return { main: "#7dd3fc", accent: "#f59e0b", trim: "#fef3c7" };
  }
  if (id.includes("school") || id.includes("blue")) {
    return { main: "#2563eb", accent: "#f8fafc", trim: "#111827" };
  }
  if (id.includes("cloud") || id.includes("silver")) {
    return { main: "#dbeafe", accent: "#38bdf8", trim: "#ffffff" };
  }
  if (id.includes("star") || id.includes("moon")) {
    return { main: "#312e81", accent: "#facc15", trim: "#e0e7ff" };
  }
  return { main: item?.color ?? "#ec4899", accent: "#ffffff", trim: "#111827" };
}

function makeOutfitTexture(source: THREE.Texture, item?: CatalogItem) {
  if (!item) {
    return source;
  }

  const image = source.image as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const width = Number(image.naturalWidth ?? image.width ?? 0);
  const height = Number(image.naturalHeight ?? image.height ?? 0);
  if (!width || !height) {
    return source;
  }

  const colors = outfitColors(item);
  const main = new THREE.Color(colors.main);
  const accent = new THREE.Color(colors.accent);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return source;
  }

  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;

    if (alpha > 0 && luminance < 92) {
      const shade = THREE.MathUtils.clamp(luminance / 96, 0.18, 0.95);
      const target = luminance < 42 ? main : accent;
      data[i] = Math.round(target.r * 255 * shade);
      data[i + 1] = Math.round(target.g * 255 * shade);
      data[i + 2] = Math.round(target.b * 255 * shade);
    }
  }

  context.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = source.colorSpace;
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.repeat.copy(source.repeat);
  texture.offset.copy(source.offset);
  texture.rotation = source.rotation;
  texture.center.copy(source.center);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = Math.max(source.anisotropy, 8);
  texture.needsUpdate = true;
  return texture;
}

function CharacterModel({ item, moving, outfit }: { item: CatalogItem; moving: boolean; outfit?: CatalogItem }) {
  const gltf = useGLTF(item.modelUrl ?? "");
  const bones = useRef<Record<string, THREE.Bone>>({});
  const initialRotations = useRef<Record<string, THREE.Euler>>({});
  const time = useRef(0);
  const scene = useMemo(() => {
    const clone = cloneSkeleton(gltf.scene);
    clone.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = false;
        node.material = Array.isArray(node.material)
          ? node.material.map((material) => material.clone())
          : node.material.clone();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            if (material.map && material.name.toLowerCase().includes("superhero")) {
              material.map = makeOutfitTexture(material.map, outfit);
            }
            material.normalMap = null;
            material.roughnessMap = null;
            material.normalScale.set(0, 0);
            material.roughness = 0.9;
            material.metalness = 0;
            material.needsUpdate = true;
          }
        }
      }
      if (node instanceof THREE.Bone) {
        bones.current[node.name] = node;
        initialRotations.current[node.name] = node.rotation.clone();
      }
    });
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    if (Number.isFinite(box.min.x) && Number.isFinite(box.min.y) && Number.isFinite(box.min.z)) {
      const center = box.getCenter(new THREE.Vector3());
      clone.position.x = -center.x;
      clone.position.y = -box.min.y;
      clone.position.z = -center.z;
    }
    return clone;
  }, [gltf.scene, outfit?.id]);

  useFrame((_, delta) => {
    time.current += delta * (moving ? 8.5 : 1.4);
    const phase = Math.sin(time.current);
    const counterPhase = Math.sin(time.current + Math.PI);
    const idle = Math.sin(time.current) * 0.035;
    const leftArmDown = -1.18;
    const rightArmDown = 1.18;

    const setBone = (name: string, x = 0, y = 0, z = 0) => {
      const bone = bones.current[name];
      const initial = initialRotations.current[name];
      if (!bone || !initial) {
        return;
      }
      bone.rotation.set(initial.x + x, initial.y + y, initial.z + z);
    };

    if (moving) {
      setBone("upperarm_l", phase * 0.24, 0.04, leftArmDown + phase * 0.05);
      setBone("lowerarm_l", 0.16 + Math.max(0, counterPhase) * 0.14, 0, -0.08);
      setBone("hand_l", -0.08, 0, -0.02);
      setBone("upperarm_r", counterPhase * 0.24, -0.04, rightArmDown + counterPhase * 0.05);
      setBone("lowerarm_r", 0.16 + Math.max(0, phase) * 0.14, 0, 0.08);
      setBone("hand_r", -0.08, 0, 0.02);
      setBone("thigh_l", counterPhase * 0.62, 0, 0);
      setBone("calf_l", Math.max(0, phase) * 0.52, 0, 0);
      setBone("foot_l", Math.max(0, phase) * -0.22, 0, 0);
      setBone("thigh_r", phase * 0.62, 0, 0);
      setBone("calf_r", Math.max(0, counterPhase) * 0.52, 0, 0);
      setBone("foot_r", Math.max(0, counterPhase) * -0.22, 0, 0);
      setBone("spine_01", 0.04, phase * 0.035, phase * 0.025);
    } else {
      setBone("upperarm_l", idle, 0.08, leftArmDown);
      setBone("lowerarm_l", 0.16, 0, -0.08);
      setBone("hand_l", -0.08, 0, -0.02);
      setBone("upperarm_r", idle, -0.08, rightArmDown);
      setBone("lowerarm_r", 0.16, 0, 0.08);
      setBone("hand_r", -0.08, 0, 0.02);
      setBone("spine_01", idle * 0.35, 0, 0);
      setBone("thigh_l");
      setBone("thigh_r");
      setBone("calf_l");
      setBone("calf_r");
      setBone("foot_l");
      setBone("foot_r");
    }
  });

  return <primitive object={scene} scale={item.modelScale ?? 1} />;
}

function ProceduralPlayerBody({ color, isSelf }: { color: string; isSelf: boolean }) {
  return (
    <>
      <mesh castShadow position={[0, 0.74, 0]}>
        <capsuleGeometry args={[0.28, 0.72, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.08} />
      </mesh>
      <mesh castShadow position={[0, 1.34, 0]}>
        <sphereGeometry args={[0.26, 24, 24]} />
        <meshStandardMaterial color="#ffe1c7" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0, 1.57, -0.03]}>
        <sphereGeometry args={[0.3, 24, 14]} />
        <meshStandardMaterial color={isSelf ? "#ff8ab3" : "#8b5cf6"} roughness={0.5} />
      </mesh>
      <mesh castShadow position={[-0.2, 1.58, 0.03]} rotation={[0.3, 0, -0.2]}>
        <coneGeometry args={[0.09, 0.25, 12]} />
        <meshStandardMaterial color={isSelf ? "#ff8ab3" : "#8b5cf6"} />
      </mesh>
      <mesh castShadow position={[0.2, 1.58, 0.03]} rotation={[0.3, 0, 0.2]}>
        <coneGeometry args={[0.09, 0.25, 12]} />
        <meshStandardMaterial color={isSelf ? "#ff8ab3" : "#8b5cf6"} />
      </mesh>
    </>
  );
}

function Player({
  username,
  color,
  position,
  isSelf = false,
  petColor,
  character,
  outfit,
  moving = false,
  rotation = 0
}: {
  username: string;
  color: string;
  position: THREE.Vector3;
  isSelf?: boolean;
  petColor?: string;
  character?: CatalogItem;
  outfit?: CatalogItem;
  moving?: boolean;
  rotation?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const bob = useRef(0);
  const initialPosition = useRef(position.clone());
  const initialRotation = useRef(rotation);
  const [isActuallyMoving, setIsActuallyMoving] = useState(moving);
  const movingRef = useRef(moving);

  useFrame((_, delta) => {
    if (group.current) {
      const distance = group.current.position.distanceTo(position);
      const actuallyMoving = moving || distance > 0.035;
      if (movingRef.current !== actuallyMoving) {
        movingRef.current = actuallyMoving;
        setIsActuallyMoving(actuallyMoving);
      }
      bob.current += delta * (actuallyMoving ? 9 : 1.8);
      const lerpSpeed = actuallyMoving ? 10 : 7;
      group.current.position.lerp(position, Math.min(1, delta * lerpSpeed));
      group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, rotation, Math.min(1, delta * 9));
      if (body.current) {
        body.current.position.y = playerVisualYOffset;
        body.current.rotation.z = actuallyMoving ? Math.sin(bob.current) * 0.035 : 0;
      }
    }
  });

  return (
    <group ref={group} position={initialPosition.current} rotation={[0, initialRotation.current, 0]}>
      <group ref={body} position={[0, playerVisualYOffset, 0]}>
        {character?.modelUrl ? (
          <Suspense fallback={<ProceduralPlayerBody color={color} isSelf={isSelf} />}>
            <CharacterModel item={character} moving={isActuallyMoving} outfit={outfit} />
          </Suspense>
        ) : (
          <ProceduralPlayerBody color={color} isSelf={isSelf} />
        )}
      </group>
      {petColor ? (
        <group position={[0.55, 0, 0.45]}>
          <mesh castShadow position={[0, 0.23, 0]}>
            <sphereGeometry args={[0.2, 18, 18]} />
            <meshStandardMaterial color={petColor} roughness={0.6} />
          </mesh>
          <mesh castShadow position={[0.12, 0.38, 0]}>
            <sphereGeometry args={[0.12, 16, 16]} />
            <meshStandardMaterial color={petColor} roughness={0.6} />
          </mesh>
        </group>
      ) : null}
      <Html center position={[0, 1.95, 0]} distanceFactor={7}>
        <div className="name-tag">{username}</div>
      </Html>
    </group>
  );
}

function PlacedObject({
  instanceId,
  item,
  x,
  z,
  rotation,
  selected,
  buildMode,
  onInteract,
  onSelect
}: {
  instanceId: string;
  item: CatalogItem;
  x: number;
  z: number;
  rotation: number;
  selected: boolean;
  buildMode: boolean;
  onInteract: (item: CatalogItem, x: number, z: number, size: [number, number, number]) => void;
  onSelect: (instanceId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const size = item.size ?? [0.9, 0.9, 0.9];
  const isRug = item.id.includes("rug") || item.id.includes("floor");
  const isLamp = item.id.includes("lamp") || item.id.includes("neon");
  const isPlant = item.id.includes("plant") || item.id.includes("bonsai");

  return (
    <group
      position={[x, size[1] / 2, z]}
      rotation={[0, rotation, 0]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation();
        if (buildMode) {
          onSelect(instanceId);
          return;
        }
        onInteract(item, x, z, size);
      }}
    >
      {selected ? (
        <mesh position={[0, 0.03 - size[1] / 2, 0]}>
          <boxGeometry args={[size[0] + 0.18, 0.05, size[2] + 0.18]} />
          <meshBasicMaterial color="#14b8a6" transparent opacity={0.42} />
        </mesh>
      ) : null}
      {item.modelUrl ? (
        <Suspense fallback={<ModelFallback item={item} size={size} />}>
          <RuntimeModel item={item} size={size} />
        </Suspense>
      ) : isRug ? (
        <mesh receiveShadow position={[0, -size[1] / 2 + 0.04, 0]}>
          <boxGeometry args={size} />
          <meshStandardMaterial color={item.color} roughness={0.9} />
        </mesh>
      ) : isLamp ? (
        <>
          <mesh castShadow position={[0, -0.2, 0]}>
            <cylinderGeometry args={[0.12, 0.18, size[1] * 0.8, 16]} />
            <meshStandardMaterial color="#27272a" roughness={0.45} />
          </mesh>
          <mesh castShadow position={[0, size[1] * 0.32, 0]}>
            <sphereGeometry args={[Math.max(size[0], size[2]) * 0.34, 24, 24]} />
            <meshStandardMaterial color={item.color} emissive={item.color} emissiveIntensity={0.6} />
          </mesh>
          <pointLight color={item.color} intensity={1.5} distance={3.2} position={[0, size[1] * 0.45, 0]} />
        </>
      ) : isPlant ? (
        <>
          <mesh castShadow position={[0, -0.25, 0]}>
            <cylinderGeometry args={[0.25, 0.32, 0.45, 16]} />
            <meshStandardMaterial color="#7c2d12" roughness={0.8} />
          </mesh>
          <mesh castShadow position={[0, 0.2, 0]}>
            <coneGeometry args={[0.45, 1.05, 18]} />
            <meshStandardMaterial color={item.color} roughness={0.7} />
          </mesh>
        </>
      ) : (
        <mesh castShadow receiveShadow>
          <boxGeometry args={size} />
          <meshStandardMaterial color={item.color} roughness={0.5} metalness={item.rarity === "legendary" ? 0.25 : 0.05} />
        </mesh>
      )}
      {hovered ? (
        <Html center position={[0, size[1] + 0.28, 0]}>
          <div className="object-tip">{item.emoji} {item.name}</div>
        </Html>
      ) : null}
    </group>
  );
}

function World({
  user,
  home,
  catalog,
  remotePlayers,
  buildMode,
  selectedPlacedId,
  onMove,
  onInteract,
  onSelectPlaced,
  onBuildMove
}: GameSceneProps) {
  const target = useRef(new THREE.Vector3(0, 0, 1.2));
  const selfPosition = useRef(new THREE.Vector3(0, 0, 1.2));
  const floorPointerDown = useRef<{
    x: number;
    y: number;
    button: number;
    pointerType: string;
    point: THREE.Vector3;
    longPressHandled: boolean;
  } | null>(null);
  const floorLongPressTimer = useRef<number | null>(null);
  const ignoreNextFloorClick = useRef(false);
  const pathQueue = useRef<THREE.Vector3[]>([]);
  const pendingInteraction = useRef<PendingInteraction>(null);
  const selfRotation = useRef(0);
  const walkingRef = useRef(false);
  const lastMoveSent = useRef(0);
  const [renderPosition, setRenderPosition] = useState(new THREE.Vector3(0, 0, 1.2));
  const [renderRotation, setRenderRotation] = useState(0);
  const [isWalking, setIsWalking] = useState(false);
  const outfit = getItem(catalog, user.avatar.outfit);
  const character = user.avatar.character ? getItem(catalog, user.avatar.character) : undefined;
  const pet = user.avatar.pet ? getItem(catalog, user.avatar.pet) : undefined;
  const blockers = useMemo(() => makeBlockers(home, catalog), [home, catalog]);

  const remoteVectors = useMemo(
    () =>
      remotePlayers.map((player) => ({
        ...player,
        vector: new THREE.Vector3(player.position.x, player.position.y, player.position.z),
        character: player.avatar?.character ? getItem(catalog, player.avatar.character) : undefined,
        outfit: player.avatar?.outfit ? getItem(catalog, player.avatar.outfit) : undefined,
        pet: player.avatar?.pet ? getItem(catalog, player.avatar.pet) : undefined
      })),
    [catalog, remotePlayers]
  );

  useEffect(() => () => clearFloorLongPress(), []);

  useFrame((_, delta) => {
    const waypoint = pathQueue.current[0];
    if (waypoint) {
      const direction = waypoint.clone().sub(selfPosition.current);
      direction.y = 0;
      const distance = direction.length();
      if (distance < 0.06) {
        selfPosition.current.copy(waypoint);
        pathQueue.current.shift();
      } else {
        selfRotation.current = Math.atan2(direction.x, direction.z);
        const step = Math.min(distance, delta * 2.35);
        selfPosition.current.add(direction.normalize().multiplyScalar(step));
        const now = performance.now();
        if (now - lastMoveSent.current > 120) {
          lastMoveSent.current = now;
          onMove({
            x: selfPosition.current.x,
            y: selfPosition.current.y,
            z: selfPosition.current.z,
            rotation: selfRotation.current
          });
        }
      }
    }

    const nextWalking = pathQueue.current.length > 0;
    if (walkingRef.current !== nextWalking) {
      walkingRef.current = nextWalking;
      setIsWalking(nextWalking);
      if (!nextWalking) {
        onMove({
          x: selfPosition.current.x,
          y: selfPosition.current.y,
          z: selfPosition.current.z,
          rotation: selfRotation.current
        });
        if (pendingInteraction.current) {
          const nextInteraction = pendingInteraction.current;
          pendingInteraction.current = null;
          onInteract(nextInteraction.itemId, nextInteraction.action);
        }
      }
    }

    setRenderPosition(selfPosition.current.clone());
    setRenderRotation(selfRotation.current);
  });

  function clearFloorLongPress() {
    if (floorLongPressTimer.current !== null) {
      window.clearTimeout(floorLongPressTimer.current);
      floorLongPressTimer.current = null;
    }
  }

  function rotateSelfToward(point: THREE.Vector3) {
    if (buildMode) {
      return;
    }

    const direction = point.clone().sub(selfPosition.current);
    direction.y = 0;
    if (direction.lengthSq() < 0.0001) {
      return;
    }

    pathQueue.current = [];
    pendingInteraction.current = null;
    walkingRef.current = false;
    setIsWalking(false);
    selfRotation.current = Math.atan2(direction.x, direction.z);
    setRenderRotation(selfRotation.current);
    onMove({
      x: selfPosition.current.x,
      y: selfPosition.current.y,
      z: selfPosition.current.z,
      rotation: selfRotation.current
    });
  }

  function walkToPoint(next: THREE.Vector3, interaction: PendingInteraction = null) {
    const path = findPath(selfPosition.current, next, blockers);
    const finalPoint = isPointWalkable(next.x, next.z, blockers)
      ? next
      : path[path.length - 1] ?? selfPosition.current;
    const waypoints = path.length > 1 ? path.slice(1) : [];
    const fullPath = appendUniqueWaypoint(waypoints, finalPoint);
    pendingInteraction.current = interaction;
    pathQueue.current = fullPath;
    target.current = finalPoint;
    walkingRef.current = fullPath.length > 0;
    setIsWalking(fullPath.length > 0);
    if (fullPath.length === 0) {
      onMove({ x: finalPoint.x, y: finalPoint.y, z: finalPoint.z, rotation: selfRotation.current });
      if (pendingInteraction.current) {
        const nextInteraction = pendingInteraction.current;
        pendingInteraction.current = null;
        onInteract(nextInteraction.itemId, nextInteraction.action);
      }
    }
  }

  function handleObjectInteract(item: CatalogItem, x: number, z: number, size: [number, number, number]) {
    const objectPosition = new THREE.Vector3(x, 0, z);
    const fromObjectToPlayer = selfPosition.current.clone().sub(objectPosition);
    fromObjectToPlayer.y = 0;
    if (fromObjectToPlayer.lengthSq() < 0.001) {
      fromObjectToPlayer.set(0, 0, 1);
    }
    fromObjectToPlayer.normalize();
    const distance = Math.max(size[0], size[2]) / 2 + 0.65;
    const next = objectPosition.add(fromObjectToPlayer.multiplyScalar(distance));
    next.x = THREE.MathUtils.clamp(next.x, -floorSize / 2 + 0.4, floorSize / 2 - 0.4);
    next.z = THREE.MathUtils.clamp(next.z, -floorSize / 2 + 0.4, floorSize / 2 - 0.4);
    walkToPoint(next, { itemId: item.id, action: item.type === "furniture" ? "use" : "look" });
  }

  function handleFloorPointerDown(event: ThreeEvent<PointerEvent>) {
    clearFloorLongPress();
    const start = {
      x: event.nativeEvent.clientX,
      y: event.nativeEvent.clientY,
      button: event.nativeEvent.button,
      pointerType: event.nativeEvent.pointerType,
      point: event.point.clone(),
      longPressHandled: false
    };
    floorPointerDown.current = start;

    if (start.pointerType !== "mouse" && !buildMode) {
      floorLongPressTimer.current = window.setTimeout(() => {
        if (floorPointerDown.current === start) {
          start.longPressHandled = true;
          rotateSelfToward(start.point);
        }
      }, 520);
    }
  }

  function handleFloorPointerMove(event: ThreeEvent<PointerEvent>) {
    const start = floorPointerDown.current;
    if (!start) {
      return;
    }

    const dragDistance = Math.hypot(event.nativeEvent.clientX - start.x, event.nativeEvent.clientY - start.y);
    if (dragDistance > 10) {
      clearFloorLongPress();
    }
  }

  function handleFloorPointerUp(event: ThreeEvent<PointerEvent>) {
    const start = floorPointerDown.current;
    if (!start || start.button !== 2) {
      return;
    }

    clearFloorLongPress();
    const dragDistance = Math.hypot(event.nativeEvent.clientX - start.x, event.nativeEvent.clientY - start.y);
    floorPointerDown.current = null;
    ignoreNextFloorClick.current = true;
    if (dragDistance <= 6) {
      rotateSelfToward(event.point);
    }
  }

  function handleFloorClick(event: ThreeEvent<MouseEvent>) {
    if (ignoreNextFloorClick.current) {
      ignoreNextFloorClick.current = false;
      return;
    }

    const start = floorPointerDown.current;
    if (!start) {
      return;
    }

    clearFloorLongPress();
    const dragDistance = start
      ? Math.hypot(event.nativeEvent.clientX - start.x, event.nativeEvent.clientY - start.y)
      : 0;
    floorPointerDown.current = null;

    if (dragDistance > 6 || start?.longPressHandled) {
      return;
    }

    const next = event.point.clone();
    next.x = THREE.MathUtils.clamp(next.x, -floorSize / 2 + 0.4, floorSize / 2 - 0.4);
    next.z = THREE.MathUtils.clamp(next.z, -floorSize / 2 + 0.4, floorSize / 2 - 0.4);
    next.y = 0;

    if (start?.button === 2) {
      rotateSelfToward(next);
      return;
    }

    if (buildMode) {
      if (selectedPlacedId) {
        onBuildMove(next.x, next.z);
      }
      return;
    }

    walkToPoint(next);
  }

  const floorColor = home.homeStyle?.floorColor ?? "#252633";
  const wallColor = home.homeStyle?.wallColor ?? "#303346";
  const floorTexture = useMemo(() => makePaintTexture(floorColor, "floor"), [floorColor]);
  const wallTexture = useMemo(() => makePaintTexture(wallColor, "wall"), [wallColor]);

  return (
    <>
      <color attach="background" args={["#14151c"]} />
      <fog attach="fog" args={["#14151c", 10, 22]} />
      <ambientLight intensity={0.72} />
      <directionalLight
        castShadow
        intensity={2.35}
        position={[3, 7, 5]}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={0.0008}
        shadow-normalBias={0.045}
      />
      <pointLight color="#f8b4d9" intensity={1.2} position={[-3.5, 3.5, -2.8]} />
      <Sparkles count={42} scale={[8, 2, 8]} size={1.7} speed={0.25} color="#ffd1e8" />
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={handleFloorPointerDown}
        onPointerMove={handleFloorPointerMove}
        onPointerUp={handleFloorPointerUp}
        onClick={handleFloorClick}
      >
        <planeGeometry args={[floorSize, floorSize]} />
        <meshStandardMaterial map={floorTexture} roughness={0.82} />
      </mesh>
      <gridHelper args={[floorSize, 9, "#ffffff", "#ffffff"]} position={[0, 0.015, 0]} raycast={() => null} visible={false} />
      <mesh receiveShadow position={[0, 1.25, -floorSize / 2]}>
        <boxGeometry args={[floorSize, 2.5, 0.18]} />
        <meshStandardMaterial map={wallTexture} roughness={0.75} />
      </mesh>
      <mesh receiveShadow position={[-floorSize / 2, 1.25, 0]}>
        <boxGeometry args={[0.18, 2.5, floorSize]} />
        <meshStandardMaterial map={wallTexture} roughness={0.75} />
      </mesh>
      {home.placedItems.map((placed) => {
        const item = getItem(catalog, placed.itemId);
        if (!item) {
          return null;
        }
        return (
          <PlacedObject
            key={placed.instanceId}
            instanceId={placed.instanceId}
            item={item}
            x={placed.x}
            z={placed.z}
            rotation={placed.rotation}
            selected={selectedPlacedId === placed.instanceId}
            buildMode={buildMode}
            onInteract={handleObjectInteract}
            onSelect={onSelectPlaced}
          />
        );
      })}
      <Player
        username={user.username}
        color={outfit?.color ?? "#ff8ab3"}
        position={renderPosition}
        isSelf
        petColor={pet?.color}
        character={character}
        outfit={outfit}
        moving={isWalking}
        rotation={renderRotation}
      />
      {remoteVectors.map((player) => (
        <Player
          key={player.id ?? player.username}
          username={player.username}
          color={player.outfit?.color ?? "#8b5cf6"}
          position={player.vector}
          petColor={player.pet?.color}
          character={player.character}
          outfit={player.outfit}
          rotation={player.position.rotation ?? 0}
        />
      ))}
      <CameraControls />
    </>
  );
}

export function GameScene(props: GameSceneProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [5.2, 5.1, 6.8], fov: 42 }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <World {...props} />
    </Canvas>
  );
}
