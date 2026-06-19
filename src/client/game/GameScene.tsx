import { Html, OrbitControls, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
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

const floorSize = 16;
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

function getItem(catalog: CatalogItem[], itemId?: string) {
  if (!itemId) {
    return undefined;
  }

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
    && !id.includes("water")
    && !id.includes("terrain")
    && !id.includes("platform")
    && !id.includes("deck")
    && !id.includes("lawn");
}

function makeBlockers(home: HomeState, catalog: CatalogItem[]) {
  return home.placedItems.flatMap((placed): Blocker[] => {
    const item = getItem(catalog, placed.itemId);
    if (!item || !blocksPath(item)) {
      return [];
    }

    const baseSize = item.size ?? [0.9, 0.9, 0.9];
    const itemScale = placed.scale ?? 1;
    const size: [number, number, number] = [baseSize[0] * itemScale, baseSize[1] * itemScale, baseSize[2] * itemScale];
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
  texture.repeat.set(kind === "floor" ? 5.6 : 1.4, kind === "floor" ? 5.6 : 1.4);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = kind === "floor" ? 4 : 8;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

function makePlacementTileTexture(id: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  if (id.includes("grass") || id.includes("lawn")) {
    context.fillStyle = color;
    context.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i += 1) {
      const x = (i * 41) % 256;
      const y = (i * 97) % 256;
      const shade = i % 3 === 0 ? "rgba(255,255,255,0.12)" : i % 3 === 1 ? "rgba(0,0,0,0.12)" : "rgba(134,239,172,0.18)";
      context.strokeStyle = shade;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, y + 3);
      context.lineTo(x + Math.sin(i) * 3, y - 3);
      context.stroke();
    }
  } else {
    context.fillStyle = "#a8652d";
    context.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 38) {
      const plankColor = y % 76 === 0 ? "#c98a45" : "#9f612f";
      context.fillStyle = plankColor;
      context.fillRect(0, y, 256, 36);
      context.strokeStyle = "rgba(30,18,8,0.78)";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(0, y + 36);
      context.lineTo(256, y + 36);
      context.stroke();
      for (let x = (y / 38) % 2 === 0 ? 0 : 64; x < 256; x += 92) {
        context.strokeStyle = "rgba(30,18,8,0.55)";
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y + 36);
        context.stroke();
      }
      for (let g = 0; g < 4; g += 1) {
        context.strokeStyle = "rgba(255,242,196,0.12)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(8, y + 8 + g * 6);
        context.lineTo(248, y + 8 + g * 6 + Math.sin(y + g) * 1.5);
        context.stroke();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.2, 2.2);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
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
    const center = box.getCenter(new THREE.Vector3());
    clone.position.set(-center.x, -box.min.y, -center.z);
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

type OutfitPalette = {
  main: string;
  accent: string;
  trim: string;
  pattern: "soft" | "neon" | "sakura" | "stars" | "scanline" | "waves" | "school" | "sparkle" | "armor" | "cloud";
};

function outfitColors(item?: CatalogItem): OutfitPalette {
  const id = item?.id ?? "";
  if (id.includes("black") || id.includes("night")) {
    return { main: "#111827", accent: "#7c3aed", trim: "#e5e7eb", pattern: id.includes("night") ? "stars" : "neon" };
  }
  if (id.includes("sakura") || id.includes("pink") || id.includes("idol")) {
    return { main: "#f9a8d4", accent: "#ec4899", trim: "#fff1f2", pattern: id.includes("idol") ? "sparkle" : id.includes("sakura") ? "sakura" : "soft" };
  }
  if (id.includes("cyber") || id.includes("neo")) {
    return { main: "#1f2937", accent: "#22d3ee", trim: "#a78bfa", pattern: id.includes("neo") ? "armor" : "scanline" };
  }
  if (id.includes("kimono") || id.includes("summer")) {
    return { main: "#7dd3fc", accent: "#f59e0b", trim: "#fef3c7", pattern: "waves" };
  }
  if (id.includes("school") || id.includes("blue")) {
    return { main: "#2563eb", accent: "#f8fafc", trim: "#111827", pattern: "school" };
  }
  if (id.includes("cloud") || id.includes("silver")) {
    return { main: "#dbeafe", accent: "#38bdf8", trim: "#ffffff", pattern: "cloud" };
  }
  if (id.includes("star") || id.includes("moon")) {
    return { main: "#312e81", accent: "#facc15", trim: "#e0e7ff", pattern: "stars" };
  }
  return { main: item?.color ?? "#ec4899", accent: "#ffffff", trim: "#111827", pattern: "soft" };
}

function colorToRgb(color: THREE.Color) {
  return {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255)
  };
}

function blendChannel(base: number, overlay: number, amount: number) {
  return Math.round(base * (1 - amount) + overlay * amount);
}

function patternAmount(pattern: OutfitPalette["pattern"], x: number, y: number, width: number, height: number) {
  const nx = x / width;
  const ny = y / height;
  const wave = Math.sin((nx * 18 + ny * 11) * Math.PI);

  if (pattern === "neon") {
    return (x + y) % 46 < 5 || (x - y + 2048) % 58 < 4 ? 0.62 : 0;
  }
  if (pattern === "sakura") {
    const petal = ((x * 7 + y * 13) % 149) < 9 || ((x * 11 - y * 5 + 3000) % 173) < 7;
    return petal ? 0.5 : wave > 0.78 ? 0.22 : 0;
  }
  if (pattern === "stars" || pattern === "sparkle") {
    const star = ((x * 19 + y * 31) % 211) < 6 || ((x * 29 - y * 17 + 4000) % 257) < 5;
    return star ? 0.72 : Math.max(0, wave - 0.82) * 0.28;
  }
  if (pattern === "scanline") {
    return y % 18 < 3 || x % 64 < 4 ? 0.5 : 0;
  }
  if (pattern === "waves") {
    return Math.sin(nx * Math.PI * 24 + Math.sin(ny * Math.PI * 8) * 1.8) > 0.72 ? 0.48 : 0;
  }
  if (pattern === "school") {
    return x % 74 < 5 || y % 58 < 4 ? 0.58 : 0;
  }
  if (pattern === "armor") {
    return x % 88 < 5 || y % 72 < 5 || Math.abs(((x + y) % 96) - 48) < 3 ? 0.56 : 0;
  }
  if (pattern === "cloud") {
    return Math.sin(nx * Math.PI * 16) + Math.cos(ny * Math.PI * 12) > 1.25 ? 0.42 : 0;
  }
  return ((x * 5 + y * 3) % 97) < 6 ? 0.32 : 0;
}

function makeClothCanvasTexture(item?: CatalogItem, scale = 1) {
  const colors = outfitColors(item);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const main = new THREE.Color(colors.main);
  const accent = new THREE.Color(colors.accent);
  const trim = new THREE.Color(colors.trim);
  const dark = main.clone().offsetHSL(0, 0.04, -0.18).getStyle();
  const light = main.clone().offsetHSL(0.01, -0.06, 0.16).getStyle();

  context.fillStyle = main.getStyle();
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,0.08)";
  for (let y = 0; y < canvas.height; y += 16) {
    context.fillRect(0, y, canvas.width, 4);
  }

  if (colors.pattern === "neon" || colors.pattern === "scanline" || colors.pattern === "armor") {
    context.fillStyle = dark;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = accent.getStyle();
    context.lineWidth = 3;
    for (let x = -canvas.width; x < canvas.width * 2; x += 42) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + 96, canvas.height);
      context.stroke();
    }
    context.strokeStyle = trim.getStyle();
    context.lineWidth = 1.5;
    for (let y = 24; y < canvas.height; y += 44) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y + 12);
      context.stroke();
    }
  } else if (colors.pattern === "sakura") {
    context.fillStyle = light;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 46; i += 1) {
      const x = (i * 47) % canvas.width;
      const y = (i * 83) % canvas.height;
      context.fillStyle = i % 3 === 0 ? accent.getStyle() : trim.getStyle();
      context.beginPath();
      context.ellipse(x, y, 5 + (i % 4), 2.5, i * 0.7, 0, Math.PI * 2);
      context.fill();
    }
  } else if (colors.pattern === "stars" || colors.pattern === "sparkle") {
    context.fillStyle = dark;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 70; i += 1) {
      const x = (i * 61) % canvas.width;
      const y = (i * 97) % canvas.height;
      const size = i % 5 === 0 ? 4 : 2;
      context.fillStyle = i % 4 === 0 ? trim.getStyle() : accent.getStyle();
      context.fillRect(x - size / 2, y, size, 1.5);
      context.fillRect(x, y - size / 2, 1.5, size);
    }
  } else if (colors.pattern === "waves" || colors.pattern === "cloud") {
    context.fillStyle = main.getStyle();
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = accent.getStyle();
    context.lineWidth = 4;
    for (let y = 18; y < canvas.height; y += 32) {
      context.beginPath();
      for (let x = 0; x <= canvas.width; x += 8) {
        const nextY = y + Math.sin((x + y) * 0.05) * 8;
        if (x === 0) {
          context.moveTo(x, nextY);
        } else {
          context.lineTo(x, nextY);
        }
      }
      context.stroke();
    }
    context.strokeStyle = trim.getStyle();
    context.lineWidth = 1.5;
    for (let y = 30; y < canvas.height; y += 48) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y - 18);
      context.stroke();
    }
  } else if (colors.pattern === "school") {
    context.fillStyle = main.getStyle();
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = trim.getStyle();
    context.lineWidth = 5;
    for (let x = 24; x < canvas.width; x += 64) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    context.strokeStyle = accent.getStyle();
    context.lineWidth = 3;
    for (let y = 30; y < canvas.height; y += 58) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
  } else {
    context.fillStyle = light;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = accent.getStyle();
    for (let i = 0; i < 36; i += 1) {
      const x = (i * 41) % canvas.width;
      const y = (i * 73) % canvas.height;
      context.beginPath();
      context.arc(x, y, 3 + (i % 3), 0, Math.PI * 2);
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(scale, scale);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

type OutfitDecalKind = "top" | "bottom" | "skirt" | "sleeve";

function roundedRectPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function makeOutfitDecalTexture(item: CatalogItem | undefined, kind: OutfitDecalKind) {
  const cloth = makeClothCanvasTexture(item, kind === "sleeve" ? 1.1 : 1.7);
  const source = cloth.image as HTMLCanvasElement;
  const colors = outfitColors(item);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  if (kind === "top") {
    roundedRectPath(context, 48, 24, 160, 190, 28);
    context.moveTo(96, 24);
    context.arc(128, 28, 34, 0, Math.PI, false);
  } else if (kind === "bottom") {
    roundedRectPath(context, 44, 32, 168, 170, 22);
    context.clearRect(115, 128, 26, 92);
  } else if (kind === "skirt") {
    context.beginPath();
    context.moveTo(76, 42);
    context.lineTo(180, 42);
    context.lineTo(220, 218);
    context.lineTo(36, 218);
    context.closePath();
  } else {
    roundedRectPath(context, 82, 20, 92, 214, 42);
  }
  context.clip();
  context.drawImage(source, 0, 0);

  context.globalCompositeOperation = "source-atop";
  context.strokeStyle = colors.trim;
  context.lineWidth = kind === "sleeve" ? 8 : 5;
  if (kind === "top") {
    context.beginPath();
    context.moveTo(58, 58);
    context.lineTo(198, 58);
    context.stroke();
    context.beginPath();
    context.moveTo(128, 68);
    context.lineTo(128, 208);
    context.strokeStyle = colors.accent;
    context.stroke();
  } else if (kind === "bottom") {
    context.beginPath();
    context.moveTo(52, 52);
    context.lineTo(204, 52);
    context.stroke();
    context.strokeStyle = colors.accent;
    context.beginPath();
    context.moveTo(128, 84);
    context.lineTo(128, 204);
    context.stroke();
  } else if (kind === "skirt") {
    for (let x = 72; x <= 184; x += 28) {
      context.beginPath();
      context.moveTo(x, 54);
      context.lineTo(x + (x < 128 ? -18 : 18), 214);
      context.stroke();
    }
  } else {
    context.beginPath();
    context.moveTo(88, 38);
    context.lineTo(168, 38);
    context.stroke();
  }
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function poseCharacterBones(
  bones: Record<string, THREE.Bone>,
  initialRotations: Record<string, THREE.Euler>,
  time: number,
  moving: boolean
) {
  const phase = Math.sin(time);
  const counterPhase = Math.sin(time + Math.PI);
  const idle = Math.sin(time) * 0.035;
  const leftArmDown = -1.18;
  const rightArmDown = 1.18;

  const setBone = (name: string, x = 0, y = 0, z = 0) => {
    const bone = bones[name];
    const initial = initialRotations[name];
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
}

function applyPaintedClothingMaterial(material: THREE.MeshStandardMaterial, style?: string) {
  if (style !== "pink-street-top") {
    return;
  }

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vClothingPosition;
${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvClothingPosition = position;"
    );
    shader.fragmentShader = `varying vec3 vClothingPosition;
float clothingBand(float value, float start, float end, float softness) {
  return smoothstep(start, start + softness, value) * (1.0 - smoothstep(end - softness, end, value));
}
${shader.fragmentShader}`.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
vec3 p = vClothingPosition;
float ax = abs(p.x);
float ay = abs(p.y);
float topZ = clothingBand(p.z, 0.925, 1.405, 0.035);
float torsoWidth = 1.0 - smoothstep(0.220, 0.315, ax);
float torsoDepth = 1.0 - smoothstep(0.105, 0.190, ay);
float topMask = clamp(topZ * torsoWidth * torsoDepth, 0.0, 1.0);
float front = smoothstep(-0.020, -0.130, p.y);
float neckCut = smoothstep(1.285, 1.390, p.z) * (1.0 - smoothstep(0.055, 0.145, ax)) * front;
topMask *= 1.0 - neckCut;
float sidePanel = smoothstep(0.145, 0.245, ax);
float weave = sin(p.x * 190.0) * 0.025 + sin(p.z * 230.0) * 0.018 + sin((p.x + p.z) * 90.0) * 0.012;
vec3 pink = vec3(0.95, 0.08, 0.42) + weave;
vec3 dark = vec3(0.035, 0.018, 0.035) + weave * 0.35;
vec3 fabric = mix(pink, dark, sidePanel);
float lowerRib = clothingBand(p.z, 0.925, 0.985, 0.012);
float upperRib = clothingBand(p.z, 1.365, 1.405, 0.010) * (1.0 - neckCut);
fabric = mix(fabric, vec3(0.045, 0.016, 0.040), clamp(lowerRib + upperRib, 0.0, 1.0));
float chestStripe = clothingBand(p.z, 1.150, 1.175, 0.006) * front * (1.0 - smoothstep(0.125, 0.165, ax));
fabric = mix(fabric, vec3(1.0, 0.62, 0.86), chestStripe);
float centerMark = clothingBand(p.z, 1.060, 1.110, 0.010) * front * (1.0 - smoothstep(0.060, 0.110, ax));
fabric = mix(fabric, vec3(0.98, 0.70, 0.92), centerMark);
diffuseColor.rgb = mix(diffuseColor.rgb, fabric, topMask);
`
    );
  };
  material.customProgramCacheKey = () => `painted-clothing:${style}`;
  material.needsUpdate = true;
}

function prepareClonedSkinnedScene(scene: THREE.Object3D) {
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = false;
      node.frustumCulled = false;
      node.material = Array.isArray(node.material)
        ? node.material.map((material) => material.clone())
        : node.material.clone();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          for (const texture of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
            if (texture) {
              texture.anisotropy = 8;
              texture.magFilter = THREE.LinearFilter;
              texture.minFilter = THREE.LinearMipmapLinearFilter;
              texture.needsUpdate = true;
            }
          }
          material.roughness = Math.max(material.roughness, 0.48);
          material.needsUpdate = true;
        }
      }
    }
  });
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
  const trim = new THREE.Color(colors.trim);
  const mainRgb = colorToRgb(main);
  const accentRgb = colorToRgb(accent);
  const trimRgb = colorToRgb(trim);
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
    const pixel = i / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;

    if (alpha > 0 && luminance < 104) {
      const shade = THREE.MathUtils.clamp(luminance / 102, 0.26, 1);
      const target = luminance < 48 ? mainRgb : accentRgb;
      let nextR = Math.round(target.r * shade);
      let nextG = Math.round(target.g * shade);
      let nextB = Math.round(target.b * shade);
      const amount = patternAmount(colors.pattern, x, y, width, height);
      if (amount > 0) {
        const overlay = amount > 0.55 ? trimRgb : accentRgb;
        nextR = blendChannel(nextR, overlay.r, amount);
        nextG = blendChannel(nextG, overlay.g, amount);
        nextB = blendChannel(nextB, overlay.b, amount);
      }
      if (x % 128 < 2 || y % 128 < 2) {
        nextR = blendChannel(nextR, trimRgb.r, 0.18);
        nextG = blendChannel(nextG, trimRgb.g, 0.18);
        nextB = blendChannel(nextB, trimRgb.b, 0.18);
      }
      data[i] = nextR;
      data[i + 1] = nextG;
      data[i + 2] = nextB;
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

function outfitShape(item?: CatalogItem) {
  const id = item?.id ?? "";
  return {
    dress: id.includes("dress") || id.includes("kimono") || id.includes("idol"),
    hoodie: id.includes("hoodie"),
    jacket: id.includes("jacket") || id.includes("cyber"),
    armor: id.includes("armor") || id.includes("neo"),
    shoes: id.includes("sneakers") || id.includes("boots"),
    hat: id.includes("hat") || id.includes("cap"),
    scarf: id.includes("scarf"),
    hair: id.includes("hair"),
    wings: id.includes("wings"),
    mask: id.includes("mask")
  };
}

function OutfitOverlay({ outfit, character }: { outfit?: CatalogItem; character: CatalogItem }) {
  const clothTexture = useMemo(() => makeClothCanvasTexture(outfit, 1.45), [outfit?.id]);
  const topTexture = useMemo(() => makeOutfitDecalTexture(outfit, "top"), [outfit?.id]);
  const bottomTexture = useMemo(() => makeOutfitDecalTexture(outfit, "bottom"), [outfit?.id]);
  const skirtTexture = useMemo(() => makeOutfitDecalTexture(outfit, "skirt"), [outfit?.id]);
  const sleeveTexture = useMemo(() => makeOutfitDecalTexture(outfit, "sleeve"), [outfit?.id]);
  if (!outfit) {
    return null;
  }

  const shape = outfitShape(outfit);
  const colors = outfitColors(outfit);
  const characterId = character.id.toLowerCase();
  const isMale = characterId.endsWith("-male") || characterId.includes("superhero-male");
  const torsoY = isMale ? 1.03 : 1.0;
  const torsoWidth = isMale ? 0.62 : 0.52;
  const torsoHeight = shape.dress || shape.hoodie || shape.jacket ? 0.66 : 0.56;
  const frontZ = -0.292;
  const backZ = 0.205;
  const decalMaterial = {
    color: "#ffffff",
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    roughness: shape.armor ? 0.38 : 0.72,
    metalness: shape.armor ? 0.18 : 0.02
  };
  const isAccessoryOnly = shape.shoes || shape.hat || shape.hair || shape.mask || shape.wings || shape.scarf;
  const showExperimentalClothingDecals = false;

  return (
    <group renderOrder={8}>
      {showExperimentalClothingDecals && !isAccessoryOnly ? (
        <>
          <mesh castShadow position={[0, torsoY, frontZ]}>
            <planeGeometry args={[torsoWidth, torsoHeight]} />
            <meshStandardMaterial {...decalMaterial} map={topTexture} />
          </mesh>
          <mesh castShadow position={[0, torsoY, backZ]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[torsoWidth * 0.95, torsoHeight * 0.94]} />
            <meshStandardMaterial {...decalMaterial} map={topTexture} />
          </mesh>
          {(shape.hoodie || shape.jacket || shape.dress || shape.armor) ? (
            <>
              <mesh castShadow position={[-0.34, 0.98, -0.15]} rotation={[0.04, 0.08, -0.22]}>
                <planeGeometry args={[0.18, shape.dress ? 0.58 : 0.5]} />
                <meshStandardMaterial {...decalMaterial} map={sleeveTexture} />
              </mesh>
              <mesh castShadow position={[0.34, 0.98, -0.15]} rotation={[0.04, -0.08, 0.22]}>
                <planeGeometry args={[0.18, shape.dress ? 0.58 : 0.5]} />
                <meshStandardMaterial {...decalMaterial} map={sleeveTexture} />
              </mesh>
            </>
          ) : null}
          {shape.dress ? (
            <>
              <mesh castShadow position={[0, 0.66, frontZ - 0.006]}>
                <planeGeometry args={[isMale ? 0.56 : 0.64, isMale ? 0.32 : 0.38]} />
                <meshStandardMaterial {...decalMaterial} map={skirtTexture} />
              </mesh>
              <mesh castShadow position={[0, 0.66, backZ + 0.006]} rotation={[0, Math.PI, 0]}>
                <planeGeometry args={[isMale ? 0.52 : 0.6, isMale ? 0.3 : 0.35]} />
                <meshStandardMaterial {...decalMaterial} map={skirtTexture} />
              </mesh>
            </>
          ) : (
            <>
              <mesh castShadow position={[0, 0.64, frontZ - 0.006]}>
                <planeGeometry args={[isMale ? 0.48 : 0.44, 0.28]} />
                <meshStandardMaterial {...decalMaterial} map={bottomTexture} />
              </mesh>
              <mesh castShadow position={[0, 0.64, backZ + 0.006]} rotation={[0, Math.PI, 0]}>
                <planeGeometry args={[isMale ? 0.46 : 0.42, 0.26]} />
                <meshStandardMaterial {...decalMaterial} map={bottomTexture} />
              </mesh>
            </>
          )}
          {shape.hoodie ? (
            <mesh castShadow position={[0, 1.32, 0.085]} rotation={[0.35, 0, 0]} scale={[1.15, 0.7, 0.78]}>
              <torusGeometry args={[0.22, 0.055, 10, 24]} />
              <meshStandardMaterial color={colors.main} roughness={0.8} />
            </mesh>
          ) : null}
          {shape.jacket ? (
            <mesh castShadow position={[0, 1.02, frontZ - 0.012]}>
              <planeGeometry args={[0.11, 0.55]} />
              <meshStandardMaterial {...decalMaterial} color={colors.accent} emissive={colors.accent} emissiveIntensity={0.18} />
            </mesh>
          ) : null}
          {shape.armor ? (
            <>
              <mesh castShadow position={[0, 1.08, frontZ - 0.014]}>
                <planeGeometry args={[0.42, 0.36]} />
                <meshStandardMaterial {...decalMaterial} color={colors.main} metalness={0.35} roughness={0.36} />
              </mesh>
              <mesh castShadow position={[0, 1.09, frontZ - 0.02]}>
                <planeGeometry args={[0.08, 0.42]} />
                <meshStandardMaterial {...decalMaterial} color={colors.accent} emissive={colors.accent} emissiveIntensity={0.35} />
              </mesh>
            </>
          ) : null}
        </>
      ) : null}
      {shape.scarf ? (
        <mesh castShadow position={[0, 1.32, -0.02]} rotation={[Math.PI / 2, 0, 0]} scale={[1.12, 0.8, 1]}>
          <torusGeometry args={[0.23, 0.035, 8, 28]} />
          <meshStandardMaterial map={clothTexture} color="#ffffff" roughness={0.78} />
        </mesh>
      ) : null}
      {shape.shoes ? (
        <>
          <mesh castShadow position={[-0.12, 0.045, -0.05]} scale={[1, 0.48, 1.55]}>
            <capsuleGeometry args={[0.065, 0.14, 6, 10]} />
            <meshStandardMaterial map={clothTexture} color="#ffffff" roughness={0.55} />
          </mesh>
          <mesh castShadow position={[0.12, 0.045, -0.05]} scale={[1, 0.48, 1.55]}>
            <capsuleGeometry args={[0.065, 0.14, 6, 10]} />
            <meshStandardMaterial map={clothTexture} color="#ffffff" roughness={0.55} />
          </mesh>
        </>
      ) : null}
      {shape.hat ? (
        <>
          <mesh castShadow position={[0, 1.68, 0]} scale={[1, 0.34, 1]}>
            <sphereGeometry args={[0.21, 24, 12]} />
            <meshStandardMaterial map={clothTexture} color="#ffffff" roughness={0.7} />
          </mesh>
          <mesh castShadow position={[0, 1.62, -0.19]} scale={[1.2, 0.16, 0.45]}>
            <boxGeometry args={[0.24, 0.05, 0.18]} />
            <meshStandardMaterial color={colors.accent} roughness={0.7} />
          </mesh>
        </>
      ) : null}
      {shape.wings ? (
        <>
          <mesh castShadow position={[-0.32, 1.2, 0.22]} rotation={[0.12, 0.45, 0.55]}>
            <coneGeometry args={[0.16, 0.62, 4]} />
            <meshStandardMaterial color={colors.trim} emissive={colors.accent} emissiveIntensity={0.25} transparent opacity={0.78} />
          </mesh>
          <mesh castShadow position={[0.32, 1.2, 0.22]} rotation={[0.12, -0.45, -0.55]}>
            <coneGeometry args={[0.16, 0.62, 4]} />
            <meshStandardMaterial color={colors.trim} emissive={colors.accent} emissiveIntensity={0.25} transparent opacity={0.78} />
          </mesh>
        </>
      ) : null}
    </group>
  );
}

function CharacterModel({ item, moving, outfit }: { item: CatalogItem; moving: boolean; outfit?: CatalogItem }) {
  const gltf = useGLTF(item.modelUrl ?? "");
  const bones = useRef<Record<string, THREE.Bone>>({});
  const initialRotations = useRef<Record<string, THREE.Euler>>({});
  const time = useRef(0);
  const scene = useMemo(() => {
    bones.current = {};
    initialRotations.current = {};
    const clone = cloneSkeleton(gltf.scene);
    prepareClonedSkinnedScene(clone);
    clone.traverse((node) => {
      if (node instanceof THREE.Bone) {
        bones.current[node.name] = node;
        initialRotations.current[node.name] = node.rotation.clone();
      } else if (node instanceof THREE.Mesh) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.normalMap = null;
            material.roughnessMap = null;
            material.normalScale.set(0, 0);
            material.roughness = 0.9;
            material.metalness = 0;
            if (outfit?.clothingPaintStyle && node.name.toLowerCase().includes("superhero")) {
              applyPaintedClothingMaterial(material, outfit.clothingPaintStyle);
            }
            material.needsUpdate = true;
          }
        }
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
    poseCharacterBones(bones.current, initialRotations.current, time.current, moving);
  });

  return (
    <>
      <primitive object={scene} scale={item.modelScale ?? 1} />
      {outfit?.clothingModelUrl && !outfit.clothingPaintStyle ? (
        <Suspense fallback={null}>
          <SkinnedOutfitModel outfit={outfit} moving={moving} />
        </Suspense>
      ) : (
        <OutfitOverlay outfit={outfit} character={item} />
      )}
    </>
  );
}

function SkinnedOutfitModel({ outfit, moving }: { outfit: CatalogItem; moving: boolean }) {
  const gltf = useGLTF(outfit.clothingModelUrl ?? "");
  const bones = useRef<Record<string, THREE.Bone>>({});
  const initialRotations = useRef<Record<string, THREE.Euler>>({});
  const time = useRef(0);
  const scene = useMemo(() => {
    const clone = cloneSkeleton(gltf.scene);
    prepareClonedSkinnedScene(clone);
    clone.traverse((node) => {
      if (node instanceof THREE.Bone) {
        bones.current[node.name] = node;
        initialRotations.current[node.name] = node.rotation.clone();
      }
    });
    clone.updateMatrixWorld(true);
    return clone;
  }, [gltf.scene]);

  useFrame((_, delta) => {
    time.current += delta * (moving ? 8.5 : 1.4);
    poseCharacterBones(bones.current, initialRotations.current, time.current, moving);
  });

  return <primitive object={scene} scale={outfit.clothingModelScale ?? 1} />;
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

function petPalette(item: CatalogItem) {
  const id = item.id;
  if (id.includes("shiba")) {
    return { body: "#d97706", accent: "#fff7ed", dark: "#1f2937", glow: "#f59e0b", kind: "dog" };
  }
  if (id.includes("cat")) {
    return { body: "#f5f5f4", accent: "#fbcfe8", dark: "#111827", glow: "#38bdf8", kind: "cat" };
  }
  if (id.includes("bunny")) {
    return { body: "#f8fafc", accent: "#f9a8d4", dark: "#334155", glow: "#f0abfc", kind: "bunny" };
  }
  if (id.includes("fox")) {
    return { body: "#f97316", accent: "#ffedd5", dark: "#1f2937", glow: "#facc15", kind: "fox" };
  }
  if (id.includes("dragon")) {
    return { body: "#22c55e", accent: "#facc15", dark: "#14532d", glow: "#86efac", kind: "dragon" };
  }
  if (id.includes("owl")) {
    return { body: "#92400e", accent: "#fde68a", dark: "#111827", glow: "#fbbf24", kind: "owl" };
  }
  if (id.includes("panda")) {
    return { body: "#f8fafc", accent: "#111827", dark: "#111827", glow: "#a7f3d0", kind: "panda" };
  }
  if (id.includes("slime")) {
    return { body: "#34d399", accent: "#a7f3d0", dark: "#064e3b", glow: "#d9f99d", kind: "slime" };
  }
  if (id.includes("robot")) {
    return { body: "#94a3b8", accent: "#22d3ee", dark: "#0f172a", glow: "#67e8f9", kind: "robot" };
  }
  if (id.includes("star")) {
    return { body: "#facc15", accent: "#fde68a", dark: "#7c2d12", glow: "#fef08a", kind: "star" };
  }
  return { body: item.color, accent: "#ffffff", dark: "#111827", glow: "#f0abfc", kind: "dog" };
}

function shortestAngleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function stablePetSeed(item?: CatalogItem) {
  const id = item?.id ?? "pet";
  return [...id].reduce((seed, char) => seed + char.charCodeAt(0), 0);
}

function initialPetPosition(ownerPosition: THREE.Vector3, seed: number) {
  const angle = seed * 0.71;
  return new THREE.Vector3(
    THREE.MathUtils.clamp(ownerPosition.x + Math.cos(angle) * 0.72, -walkLimit, walkLimit),
    0.01,
    THREE.MathUtils.clamp(ownerPosition.z + Math.sin(angle) * 0.72, -walkLimit, walkLimit)
  );
}

function clampWorldPetTarget(target: THREE.Vector3) {
  target.x = THREE.MathUtils.clamp(target.x, -walkLimit, walkLimit);
  target.z = THREE.MathUtils.clamp(target.z, -walkLimit, walkLimit);
  target.y = 0;
  return target;
}

function PetCompanion({
  item,
  ownerMoving,
  ownerPosition,
  ownerRotation
}: {
  item?: CatalogItem;
  ownerMoving: boolean;
  ownerPosition: THREE.Vector3;
  ownerRotation: number;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const frontLeft = useRef<THREE.Group>(null);
  const frontRight = useRef<THREE.Group>(null);
  const backLeft = useRef<THREE.Group>(null);
  const backRight = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const wingLeft = useRef<THREE.Group>(null);
  const wingRight = useRef<THREE.Group>(null);
  const time = useRef(0);
  const behaviorTime = useRef(0);
  const targetPosition = useRef(new THREE.Vector3());
  const nextWanderAt = useRef(0);
  const seed = useMemo(() => stablePetSeed(item), [item?.id]);
  const initialPosition = useMemo(() => initialPetPosition(ownerPosition, seed), [seed]);

  useEffect(() => {
    targetPosition.current.copy(initialPosition);
    nextWanderAt.current = behaviorTime.current + 2.5 + (seed % 4) * 0.45;
  }, [initialPosition, seed]);

  useFrame((_, delta) => {
    if (!root.current) {
      return;
    }

    behaviorTime.current += delta;
    const current = root.current.position;
    const ownerDistance = Math.hypot(current.x - ownerPosition.x, current.z - ownerPosition.z);
    const targetDistance = Math.hypot(current.x - targetPosition.current.x, current.z - targetPosition.current.z);
    const shouldCatchUp = ownerMoving || ownerDistance > 1.35;

    if (shouldCatchUp) {
      const forward = new THREE.Vector2(Math.sin(ownerRotation), Math.cos(ownerRotation));
      const right = new THREE.Vector2(Math.cos(ownerRotation), -Math.sin(ownerRotation));
      const side = seed % 2 === 0 ? 1 : -1;
      const sway = Math.sin(behaviorTime.current * 0.8 + seed) * 0.16;
      targetPosition.current.set(
        ownerPosition.x + right.x * (0.48 * side + sway) - forward.x * 0.72,
        0,
        ownerPosition.z + right.y * (0.48 * side + sway) - forward.y * 0.72
      );
      clampWorldPetTarget(targetPosition.current);
      nextWanderAt.current = behaviorTime.current + 2.2 + (seed % 3) * 0.45;
    } else if (targetDistance < 0.08 && behaviorTime.current >= nextWanderAt.current) {
      const angle = behaviorTime.current * 0.9 + seed * 0.37;
      const radius = 0.48 + (seed % 5) * 0.06 + Math.sin(time.current * 0.9 + seed) * 0.08;
      targetPosition.current.set(
        ownerPosition.x + Math.cos(angle) * radius,
        0,
        ownerPosition.z + Math.sin(angle) * radius
      );
      clampWorldPetTarget(targetPosition.current);
      nextWanderAt.current = behaviorTime.current + 3.2 + (seed % 5) * 0.55;
    }

    const beforeX = current.x;
    const beforeZ = current.z;
    const toTarget = targetPosition.current.clone().sub(current);
    toTarget.y = 0;
    const distanceToTarget = toTarget.length();
    const speed = shouldCatchUp ? 2.15 : 0.72;
    if (distanceToTarget > 0.025) {
      current.add(toTarget.normalize().multiplyScalar(Math.min(distanceToTarget, delta * speed)));
    }

    const petMoving = Math.hypot(current.x - beforeX, current.z - beforeZ) > 0.0015;
    time.current += delta * (petMoving ? 8.5 : 2.2);
    const phase = Math.sin(time.current);
    const counter = Math.sin(time.current + Math.PI);
    current.y = (petMoving ? Math.abs(phase) * 0.045 : Math.sin(time.current) * 0.012) + 0.01;

    const velocityX = current.x - beforeX;
    const velocityZ = current.z - beforeZ;
    if (Math.hypot(velocityX, velocityZ) > 0.002) {
      const visualForwardOffset = Math.PI;
      const targetYaw = Math.atan2(velocityX, velocityZ) + visualForwardOffset;
      root.current.rotation.y += shortestAngleDelta(root.current.rotation.y, targetYaw) * Math.min(1, delta * 8);
    }
    root.current.rotation.z = petMoving ? phase * 0.055 : Math.sin(time.current) * 0.018;
    if (body.current) {
      body.current.rotation.x = petMoving ? Math.sin(time.current * 0.5) * 0.05 : Math.sin(time.current) * 0.025;
    }
    if (frontLeft.current) frontLeft.current.rotation.x = phase * 0.55;
    if (frontRight.current) frontRight.current.rotation.x = counter * 0.55;
    if (backLeft.current) backLeft.current.rotation.x = counter * 0.55;
    if (backRight.current) backRight.current.rotation.x = phase * 0.55;
    if (tail.current) tail.current.rotation.y = Math.sin(time.current * 1.8) * (petMoving ? 0.45 : 0.22);
    if (wingLeft.current) wingLeft.current.rotation.z = -0.55 - Math.abs(phase) * 0.45;
    if (wingRight.current) wingRight.current.rotation.z = 0.55 + Math.abs(phase) * 0.45;
  });

  if (!item) {
    return null;
  }

  const palette = petPalette(item);
  const isBunny = palette.kind === "bunny";
  const isFox = palette.kind === "fox";
  const isCat = palette.kind === "cat";
  const isPanda = palette.kind === "panda";

  if (palette.kind === "slime") {
    return (
      <group ref={root} position={initialPosition} scale={0.88}>
        <mesh castShadow position={[0, 0.18, 0]}>
          <sphereGeometry args={[0.24, 28, 18]} />
          <meshStandardMaterial color={palette.body} roughness={0.35} metalness={0.02} transparent opacity={0.86} />
        </mesh>
        <mesh castShadow position={[0, 0.36, -0.03]} scale={[1, 0.45, 1]}>
          <sphereGeometry args={[0.18, 24, 12]} />
          <meshStandardMaterial color={palette.accent} roughness={0.28} transparent opacity={0.65} />
        </mesh>
        <mesh position={[-0.07, 0.24, -0.19]}><sphereGeometry args={[0.025, 10, 10]} /><meshStandardMaterial color={palette.dark} /></mesh>
        <mesh position={[0.07, 0.24, -0.19]}><sphereGeometry args={[0.025, 10, 10]} /><meshStandardMaterial color={palette.dark} /></mesh>
        <pointLight color={palette.glow} intensity={0.8} distance={1.2} position={[0, 0.35, 0]} />
      </group>
    );
  }

  if (palette.kind === "robot") {
    return (
      <group ref={root} position={initialPosition} scale={0.82}>
        <group ref={body}>
          <mesh castShadow position={[0, 0.24, 0]}><boxGeometry args={[0.34, 0.3, 0.28]} /><meshStandardMaterial color={palette.body} roughness={0.42} metalness={0.28} /></mesh>
          <mesh castShadow position={[0, 0.48, -0.03]}><boxGeometry args={[0.28, 0.2, 0.22]} /><meshStandardMaterial color={palette.body} roughness={0.35} metalness={0.32} /></mesh>
          <mesh position={[-0.06, 0.5, -0.15]}><boxGeometry args={[0.05, 0.035, 0.015]} /><meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.8} /></mesh>
          <mesh position={[0.06, 0.5, -0.15]}><boxGeometry args={[0.05, 0.035, 0.015]} /><meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.8} /></mesh>
          <mesh castShadow position={[0, 0.65, 0]}><cylinderGeometry args={[0.012, 0.012, 0.14, 8]} /><meshStandardMaterial color={palette.dark} /></mesh>
          <mesh castShadow position={[0, 0.73, 0]}><sphereGeometry args={[0.035, 12, 12]} /><meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.65} /></mesh>
        </group>
        {((
          [
            [-0.12, 0.06, -0.08, frontLeft],
            [0.12, 0.06, -0.08, frontRight],
            [-0.12, 0.06, 0.1, backLeft],
            [0.12, 0.06, 0.1, backRight]
          ] as Array<[number, number, number, RefObject<THREE.Group | null>]>
        )).map(([x, y, z, ref], index) => (
          <group key={index} ref={ref} position={[x, y, z]}>
            <mesh castShadow><cylinderGeometry args={[0.035, 0.035, 0.12, 8]} /><meshStandardMaterial color={palette.dark} roughness={0.5} metalness={0.25} /></mesh>
          </group>
        ))}
      </group>
    );
  }

  if (palette.kind === "star") {
    return (
      <group ref={root} position={initialPosition} scale={0.74}>
        <mesh castShadow>
          <sphereGeometry args={[0.18, 18, 18]} />
          <meshStandardMaterial color={palette.body} emissive={palette.glow} emissiveIntensity={0.28} roughness={0.38} />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <mesh key={index} castShadow rotation={[0, 0, (index / 6) * Math.PI * 2]} position={[Math.cos((index / 6) * Math.PI * 2) * 0.18, Math.sin((index / 6) * Math.PI * 2) * 0.18, 0]}>
            <coneGeometry args={[0.07, 0.22, 5]} />
            <meshStandardMaterial color={index % 2 ? palette.accent : palette.body} emissive={palette.glow} emissiveIntensity={0.18} roughness={0.42} />
          </mesh>
        ))}
        <pointLight color={palette.glow} intensity={0.95} distance={1.4} />
      </group>
    );
  }

  if (palette.kind === "owl" || palette.kind === "dragon") {
    return (
      <group ref={root} position={initialPosition} scale={0.78}>
        <group ref={body}>
          <mesh castShadow position={[0, 0.27, 0]}><sphereGeometry args={[0.22, 20, 16]} /><meshStandardMaterial color={palette.body} roughness={0.58} /></mesh>
          <mesh castShadow position={[0, 0.5, -0.03]}><sphereGeometry args={[0.18, 20, 14]} /><meshStandardMaterial color={palette.kind === "dragon" ? palette.body : palette.accent} roughness={0.55} /></mesh>
          <group ref={wingLeft} position={[-0.2, 0.32, 0.02]} rotation={[0, 0, -0.65]}><mesh castShadow><coneGeometry args={[0.1, 0.34, 4]} /><meshStandardMaterial color={palette.kind === "dragon" ? palette.dark : palette.body} roughness={0.56} /></mesh></group>
          <group ref={wingRight} position={[0.2, 0.32, 0.02]} rotation={[0, 0, 0.65]}><mesh castShadow><coneGeometry args={[0.1, 0.34, 4]} /><meshStandardMaterial color={palette.kind === "dragon" ? palette.dark : palette.body} roughness={0.56} /></mesh></group>
          <mesh position={[-0.06, 0.52, -0.16]}><sphereGeometry args={[0.035, 10, 10]} /><meshStandardMaterial color={palette.dark} /></mesh>
          <mesh position={[0.06, 0.52, -0.16]}><sphereGeometry args={[0.035, 10, 10]} /><meshStandardMaterial color={palette.dark} /></mesh>
          <mesh castShadow position={[0, 0.47, -0.2]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.045, 0.08, 4]} /><meshStandardMaterial color={palette.accent} roughness={0.5} /></mesh>
          {palette.kind === "dragon" ? <group ref={tail} position={[0, 0.24, 0.22]} rotation={[1.15, 0, 0]}><mesh castShadow><coneGeometry args={[0.065, 0.38, 8]} /><meshStandardMaterial color={palette.body} roughness={0.55} /></mesh></group> : null}
        </group>
      </group>
    );
  }

  return (
    <group ref={root} position={initialPosition} scale={isBunny ? 0.76 : 0.82}>
      <group ref={body}>
        <mesh castShadow position={[0, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <capsuleGeometry args={[0.16, 0.32, 8, 16]} />
          <meshStandardMaterial color={palette.body} roughness={0.58} />
        </mesh>
        <mesh castShadow position={[0, 0.43, -0.25]} scale={isFox ? [1, 0.9, 1.08] : [1, 1, 1]}>
          <sphereGeometry args={[0.17, 20, 16]} />
          <meshStandardMaterial color={palette.body} roughness={0.58} />
        </mesh>
        <mesh castShadow position={[0, 0.38, -0.37]} scale={[1.1, 0.82, 0.65]}>
          <sphereGeometry args={[0.09, 14, 10]} />
          <meshStandardMaterial color={palette.accent} roughness={0.6} />
        </mesh>
        <mesh position={[-0.06, 0.46, -0.39]}><sphereGeometry args={[0.022, 10, 10]} /><meshStandardMaterial color={palette.dark} /></mesh>
        <mesh position={[0.06, 0.46, -0.39]}><sphereGeometry args={[0.022, 10, 10]} /><meshStandardMaterial color={palette.dark} /></mesh>
        {(isBunny ? [-0.08, 0.08] : [-0.1, 0.1]).map((x, index) => (
          <mesh key={index} castShadow position={[x, isBunny ? 0.68 : 0.56, -0.23]} rotation={[isBunny ? 0.15 : 0.5, 0, x < 0 ? -0.22 : 0.22]}>
            {isBunny ? <capsuleGeometry args={[0.045, 0.26, 6, 10]} /> : <coneGeometry args={[isCat ? 0.065 : 0.075, isCat ? 0.15 : 0.18, 4]} />}
            <meshStandardMaterial color={isPanda ? palette.accent : palette.body} roughness={0.58} />
          </mesh>
        ))}
        <group ref={tail} position={[0, 0.28, 0.29]} rotation={[1.15, 0, 0]}>
          <mesh castShadow scale={isFox ? [1.35, 1.35, 1.35] : [1, 1, 1]}>
            {isBunny ? <sphereGeometry args={[0.08, 14, 10]} /> : <capsuleGeometry args={[0.045, isFox ? 0.34 : 0.22, 6, 10]} />}
            <meshStandardMaterial color={isFox ? palette.accent : palette.body} roughness={0.58} />
          </mesh>
        </group>
      </group>
      {((
        [
          [-0.1, -0.13, frontLeft],
          [0.1, -0.13, frontRight],
          [-0.1, 0.13, backLeft],
          [0.1, 0.13, backRight]
        ] as Array<[number, number, RefObject<THREE.Group | null>]>
      )).map(([x, z, ref], index) => (
        <group key={index} ref={ref} position={[x, 0.1, z]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.035, 0.14, 4, 8]} />
            <meshStandardMaterial color={isPanda && index < 2 ? palette.accent : palette.body} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Player({
  username,
  color,
  position,
  isSelf = false,
  pet,
  character,
  outfit,
  moving = false,
  rotation = 0
}: {
  username: string;
  color: string;
  position: THREE.Vector3;
  isSelf?: boolean;
  pet?: CatalogItem;
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
      if (body.current) {
        body.current.position.y = playerVisualYOffset;
        body.current.rotation.y += shortestAngleDelta(body.current.rotation.y, rotation) * Math.min(1, delta * 9);
        body.current.rotation.z = actuallyMoving ? Math.sin(bob.current) * 0.035 : 0;
      }
    }
  });

  return (
    <>
      <group ref={group} position={initialPosition.current}>
        <group ref={body} position={[0, playerVisualYOffset, 0]} rotation={[0, initialRotation.current, 0]}>
          {character?.modelUrl ? (
            <Suspense fallback={<ProceduralPlayerBody color={color} isSelf={isSelf} />}>
              <CharacterModel item={character} moving={isActuallyMoving} outfit={outfit} />
            </Suspense>
          ) : (
            <ProceduralPlayerBody color={color} isSelf={isSelf} />
          )}
        </group>
        <Html center position={[0, 1.95, 0]} distanceFactor={7}>
          <div className="name-tag">{username}</div>
        </Html>
      </group>
      <PetCompanion item={pet} ownerMoving={isActuallyMoving} ownerPosition={position} ownerRotation={rotation} />
    </>
  );
}

function PlacedObject({
  instanceId,
  item,
  x,
  z,
  rotation,
  itemScale,
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
  itemScale: number;
  selected: boolean;
  buildMode: boolean;
  onInteract: (item: CatalogItem, x: number, z: number, size: [number, number, number]) => void;
  onSelect: (instanceId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const baseSize = item.size ?? [0.9, 0.9, 0.9];
  const size: [number, number, number] = [baseSize[0] * itemScale, baseSize[1] * itemScale, baseSize[2] * itemScale];
  const isTerrainTile = item.id.includes("terrain") || item.id.includes("platform") || item.id.includes("deck") || item.id.includes("lawn") || item.id.includes("grass");
  const isBuildWall = item.id.includes("build-wall");
  const isBuildDoor = item.id.includes("build-door");
  const isRug = item.id.includes("rug") || item.id.includes("floor") || isTerrainTile;
  const isLamp = item.id.includes("lamp") || item.id.includes("neon");
  const isPlant = item.id.includes("plant") || item.id.includes("bonsai");
  const terrainTexture = useMemo(() => isTerrainTile ? makePlacementTileTexture(item.id, item.color) : null, [isTerrainTile, item.id, item.color]);

  useEffect(() => () => terrainTexture?.dispose(), [terrainTexture]);

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
      ) : isBuildDoor ? (
        <>
          <mesh castShadow receiveShadow position={[-size[0] * 0.42, 0, 0]}>
            <boxGeometry args={[0.18, size[1], size[2]]} />
            <meshStandardMaterial color="#5b3418" roughness={0.78} />
          </mesh>
          <mesh castShadow receiveShadow position={[size[0] * 0.42, 0, 0]}>
            <boxGeometry args={[0.18, size[1], size[2]]} />
            <meshStandardMaterial color="#5b3418" roughness={0.78} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, size[1] * 0.42, 0]}>
            <boxGeometry args={[size[0], 0.2, size[2]]} />
            <meshStandardMaterial color="#5b3418" roughness={0.78} />
          </mesh>
          <mesh castShadow receiveShadow position={[size[0] * 0.18, -size[1] * 0.08, -size[2] * 0.12]} rotation={[0, -0.35, 0]}>
            <boxGeometry args={[size[0] * 0.46, size[1] * 0.72, 0.055]} />
            <meshStandardMaterial color={item.color} roughness={0.82} />
          </mesh>
        </>
      ) : isBuildWall ? (
        <>
          <mesh castShadow receiveShadow>
            <boxGeometry args={size} />
            <meshStandardMaterial color={item.color} roughness={0.82} />
          </mesh>
          <mesh position={[0, size[1] * 0.38, -size[2] / 2 - 0.01]}>
            <boxGeometry args={[size[0] * 0.96, 0.035, 0.035]} />
            <meshStandardMaterial color="#ffffff" roughness={0.9} opacity={0.24} transparent />
          </mesh>
        </>
      ) : isRug ? (
        <mesh receiveShadow position={[0, -size[1] / 2 + 0.04, 0]}>
          <boxGeometry args={size} />
          <meshStandardMaterial color={isTerrainTile ? "#ffffff" : item.color} map={terrainTexture ?? undefined} roughness={isTerrainTile ? 0.96 : 0.9} />
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
      <gridHelper args={[floorSize, 16, "#ffffff", "#ffffff"]} position={[0, 0.015, 0]} raycast={() => null} visible={false} />
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
            itemScale={placed.scale ?? 1}
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
        pet={pet}
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
          pet={player.pet}
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
