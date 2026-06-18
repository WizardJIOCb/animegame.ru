import { Html, OrbitControls, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";
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

function makePaintTexture(color: string, kind: "floor" | "wall") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const base = new THREE.Color(color);
  const light = base.clone().offsetHSL(0, -0.04, 0.14).getStyle();
  const dark = base.clone().offsetHSL(0, 0.04, -0.12).getStyle();
  context.fillStyle = base.getStyle();
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (kind === "floor") {
    context.strokeStyle = dark;
    context.lineWidth = 3;
    for (let x = 0; x <= 128; x += 32) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 128);
      context.stroke();
    }
    for (let y = 0; y <= 128; y += 32) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(128, y);
      context.stroke();
    }
    context.fillStyle = light;
    for (let y = 8; y < 128; y += 32) {
      for (let x = 8; x < 128; x += 32) {
        context.fillRect(x, y, 10, 10);
      }
    }
  } else {
    context.fillStyle = light;
    for (let x = -32; x < 160; x += 32) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + 18, 0);
      context.lineTo(x + 50, 128);
      context.lineTo(x + 32, 128);
      context.closePath();
      context.fill();
    }
    context.strokeStyle = dark;
    context.lineWidth = 2;
    for (let y = 24; y < 128; y += 32) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(128, y + 12);
      context.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === "floor" ? 6 : 3, kind === "floor" ? 6 : 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function RuntimeModel({ item, size }: { item: CatalogItem; size: [number, number, number] }) {
  const gltf = useGLTF(item.modelUrl ?? "");
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    return clone;
  }, [gltf.scene]);

  return (
    <primitive
      object={scene}
      position={[0, -size[1] / 2, 0]}
      scale={item.modelScale ?? 1}
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

function CharacterModel({ item }: { item: CatalogItem }) {
  const gltf = useGLTF(item.modelUrl ?? "");
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(clone);
    if (Number.isFinite(box.min.x) && Number.isFinite(box.min.y) && Number.isFinite(box.min.z)) {
      const center = box.getCenter(new THREE.Vector3());
      clone.position.set(-center.x, -box.min.y, -center.z);
    }
    return clone;
  }, [gltf.scene]);

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
  moving = false,
  rotation = 0
}: {
  username: string;
  color: string;
  position: THREE.Vector3;
  isSelf?: boolean;
  petColor?: string;
  character?: CatalogItem;
  moving?: boolean;
  rotation?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const bob = useRef(0);

  useFrame((_, delta) => {
    if (group.current) {
      const actuallyMoving = moving || group.current.position.distanceTo(position) > 0.04;
      bob.current += delta * (actuallyMoving ? 9 : 1.8);
      group.current.position.lerp(position, Math.min(1, delta * 7));
      group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, rotation, Math.min(1, delta * 9));
      if (body.current) {
        body.current.position.y = actuallyMoving ? Math.abs(Math.sin(bob.current)) * 0.07 : Math.sin(bob.current) * 0.014;
        body.current.rotation.z = actuallyMoving ? Math.sin(bob.current) * 0.035 : 0;
      }
    }
  });

  return (
    <group ref={group} position={position} rotation={[0, rotation, 0]}>
      <group ref={body}>
        {character?.modelUrl ? (
          <Suspense fallback={<ProceduralPlayerBody color={color} isSelf={isSelf} />}>
            <CharacterModel item={character} />
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
  onInteract: (itemId: string, action: string) => void;
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
        onInteract(item.id, item.type === "furniture" ? "use" : "look");
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
  const floorPointerDown = useRef<{ x: number; y: number } | null>(null);
  const pathQueue = useRef<THREE.Vector3[]>([]);
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
        vector: new THREE.Vector3(player.position.x, player.position.y, player.position.z)
      })),
    [remotePlayers]
  );

  useFrame((_, delta) => {
    const waypoint = pathQueue.current[0];
    if (waypoint) {
      const direction = waypoint.clone().sub(selfPosition.current);
      direction.y = 0;
      const distance = direction.length();
      if (distance < 0.06) {
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
      }
    }

    setRenderPosition(selfPosition.current.clone());
    setRenderRotation(selfRotation.current);
  });

  function handleFloorClick(event: ThreeEvent<MouseEvent>) {
    const start = floorPointerDown.current;
    const dragDistance = start
      ? Math.hypot(event.nativeEvent.clientX - start.x, event.nativeEvent.clientY - start.y)
      : 0;
    floorPointerDown.current = null;

    if (dragDistance > 6) {
      return;
    }

    const next = event.point.clone();
    next.x = THREE.MathUtils.clamp(next.x, -floorSize / 2 + 0.4, floorSize / 2 - 0.4);
    next.z = THREE.MathUtils.clamp(next.z, -floorSize / 2 + 0.4, floorSize / 2 - 0.4);
    next.y = 0;

    if (buildMode) {
      if (selectedPlacedId) {
        onBuildMove(next.x, next.z);
      }
      return;
    }

    const path = findPath(selfPosition.current, next, blockers);
    const finalPoint = isPointWalkable(next.x, next.z, blockers)
      ? next
      : path[path.length - 1] ?? selfPosition.current;
    const fullPath = appendUniqueWaypoint(path.slice(1), finalPoint);
    pathQueue.current = fullPath;
    target.current = finalPoint;
    if (fullPath.length === 0) {
      onMove({ x: finalPoint.x, y: finalPoint.y, z: finalPoint.z, rotation: selfRotation.current });
    }
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
      <directionalLight castShadow intensity={2.7} position={[3, 7, 5]} shadow-mapSize={[2048, 2048]} />
      <pointLight color="#f8b4d9" intensity={1.2} position={[-3.5, 3.5, -2.8]} />
      <Sparkles count={42} scale={[8, 2, 8]} size={1.7} speed={0.25} color="#ffd1e8" />
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(event) => {
          floorPointerDown.current = {
            x: event.nativeEvent.clientX,
            y: event.nativeEvent.clientY
          };
        }}
        onClick={handleFloorClick}
      >
        <planeGeometry args={[floorSize, floorSize]} />
        <meshStandardMaterial map={floorTexture} roughness={0.82} />
      </mesh>
      <gridHelper args={[floorSize, 9, "#3b82f6", "#3a3a48"]} position={[0, 0.015, 0]} />
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
            onInteract={onInteract}
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
        moving={isWalking}
        rotation={renderRotation}
      />
      {remoteVectors.map((player) => (
        <Player key={player.username} username={player.username} color="#8b5cf6" position={player.vector} rotation={player.position.rotation ?? 0} />
      ))}
      <OrbitControls
        makeDefault
        enablePan
        screenSpacePanning
        panSpeed={0.75}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        }}
        maxPolarAngle={Math.PI / 2.25}
        minDistance={5.2}
        maxDistance={11}
      />
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
