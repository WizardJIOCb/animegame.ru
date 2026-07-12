import { Html, Sky, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CatalogItem, HomeState, NeighborhoodResident, PublicUser, RemotePlayer } from "../types";
import { HomePlacedObject, Player } from "./GameScene";

type WorldPosition = { x: number; y: number; z: number; rotation?: number; vehicle?: boolean };

type NeighborhoodSceneProps = {
  user: PublicUser;
  home: HomeState;
  catalog: CatalogItem[];
  residents: NeighborhoodResident[];
  remotePlayers: RemotePlayer[];
  initialPosition?: WorldPosition;
  buildMode: boolean;
  selectedPlacedId: string;
  visitRequest?: { username: string; requestId: number };
  onMove: (position: WorldPosition) => void;
  onInteriorChange: (username: string | null) => void;
  onInteract: (itemId: string, action: string) => void;
  onSelectPlaced: (instanceId: string) => void;
  onBuildMove: (x: number, z: number) => void;
  onToast: (message: string) => void;
};

type CarTransform = {
  position: THREE.Vector3;
  rotation: number;
};

const WORLD_X = 42;
const WORLD_Z = 76;
const WALK_SPEED = 5.4;
const CAR_MAX_SPEED = 12.5;
const DOOR_HALF_WIDTH = 0.72;
const WALL_THICKNESS = 0.18;
const UP = new THREE.Vector3(0, 1, 0);
const CAR_COLORS = ["#f472b6", "#38bdf8", "#f59e0b", "#34d399", "#a78bfa", "#fb7185"];

function getCatalogItem(catalog: CatalogItem[], id?: string) {
  return id ? catalog.find((item) => item.id === id) : undefined;
}

function residentCarColor(resident: NeighborhoodResident) {
  return resident.carColor ?? CAR_COLORS[(resident.plotId - 1) % CAR_COLORS.length];
}

function frontVector(rotation: number) {
  return new THREE.Vector3(Math.sin(rotation), 0, Math.cos(rotation));
}

function rightVector(rotation: number) {
  return new THREE.Vector3(Math.cos(rotation), 0, -Math.sin(rotation));
}

function houseDepth(level: number) {
  if (level <= 1) return 16;
  if (level === 2) return 16.2;
  if (level === 3) return 16.35;
  return 16.5;
}

function houseWidth(level: number) {
  if (level <= 1) return 16.2;
  if (level === 2) return 16.45;
  if (level === 3) return 16.7;
  return 16.9 + Math.max(0, Math.min(8, level) - 4) * 0.12;
}

function houseHalfWidth(level: number) {
  return houseWidth(level) / 2 + 0.08;
}

function residentDoorPosition(resident: NeighborhoodResident) {
  const front = frontVector(resident.lot.rotation);
  const distance = houseDepth(resident.houseLevel) / 2 + 1.2;
  return new THREE.Vector3(
    resident.lot.x + front.x * distance,
    0,
    resident.lot.z + front.z * distance
  );
}

function worldToHouseLocal(position: THREE.Vector3, resident: NeighborhoodResident) {
  return position
    .clone()
    .sub(new THREE.Vector3(resident.lot.x, 0, resident.lot.z))
    .applyAxisAngle(UP, -resident.lot.rotation);
}

function houseLocalToWorld(position: THREE.Vector3, resident: NeighborhoodResident) {
  return position
    .clone()
    .applyAxisAngle(UP, resident.lot.rotation)
    .add(new THREE.Vector3(resident.lot.x, 0, resident.lot.z));
}

function residentInteriorTarget(resident: NeighborhoodResident) {
  return houseLocalToWorld(new THREE.Vector3(0, 0, houseDepth(resident.houseLevel) / 2 - 1.35), resident);
}

function residentAtPosition(position: THREE.Vector3, residents: NeighborhoodResident[]) {
  return residents.find((resident) => {
    const local = worldToHouseLocal(position, resident);
    const insideRoom = Math.abs(local.x) < houseWidth(resident.houseLevel) / 2 - WALL_THICKNESS
      && local.z > -houseDepth(resident.houseLevel) / 2 + WALL_THICKNESS
      && local.z < houseDepth(resident.houseLevel) / 2 - WALL_THICKNESS;
    const inDoorway = Math.abs(local.x) <= DOOR_HALF_WIDTH + 0.12
      && local.z >= houseDepth(resident.houseLevel) / 2 - 0.35
      && local.z <= houseDepth(resident.houseLevel) / 2 + 1;
    return insideRoom || inDoorway;
  });
}

function residentCarTransform(resident: NeighborhoodResident): CarTransform {
  const front = frontVector(resident.lot.rotation);
  const right = rightVector(resident.lot.rotation);
  return {
    position: new THREE.Vector3(
      resident.lot.x + front.x * 14.2 + right.x * 2.1,
      0,
      resident.lot.z + front.z * 14.2 + right.z * 2.1
    ),
    rotation: resident.plotId % 2 === 0 ? Math.PI : 0
  };
}

function isRoad(x: number, z: number) {
  return (Math.abs(x) <= 8.6 || Math.abs(z) <= 5.7) && Math.abs(x) <= WORLD_X && Math.abs(z) <= WORLD_Z;
}

function resolveWalkPosition(current: THREE.Vector3, requested: THREE.Vector3, residents: NeighborhoodResident[]) {
  const position = requested.clone();
  position.x = THREE.MathUtils.clamp(position.x, -WORLD_X + 0.6, WORLD_X - 0.6);
  position.z = THREE.MathUtils.clamp(position.z, -WORLD_Z + 0.6, WORLD_Z - 0.6);

  for (const resident of residents) {
    const currentLocal = worldToHouseLocal(current, resident);
    const nextLocal = worldToHouseLocal(position, resident);
    const halfWidth = houseHalfWidth(resident.houseLevel);
    const halfDepth = houseDepth(resident.houseLevel) / 2 + 0.08;
    const currentInside = Math.abs(currentLocal.x) < halfWidth && Math.abs(currentLocal.z) < halfDepth;
    const nextInside = Math.abs(nextLocal.x) < halfWidth && Math.abs(nextLocal.z) < halfDepth;

    if (currentInside) {
      if (!nextInside) {
        const leavesThroughDoor = nextLocal.z >= halfDepth
          && Math.abs(currentLocal.x) <= DOOR_HALF_WIDTH
          && Math.abs(nextLocal.x) <= DOOR_HALF_WIDTH + 0.18;
        if (leavesThroughDoor) continue;
        nextLocal.x = THREE.MathUtils.clamp(nextLocal.x, -halfWidth + 0.28, halfWidth - 0.28);
        nextLocal.z = THREE.MathUtils.clamp(nextLocal.z, -halfDepth + 0.28, halfDepth - 0.28);
        return houseLocalToWorld(nextLocal, resident).setY(0);
      }

      nextLocal.x = THREE.MathUtils.clamp(nextLocal.x, -halfWidth + 0.28, halfWidth - 0.28);
      nextLocal.z = Math.max(nextLocal.z, -halfDepth + 0.28);
      if (nextLocal.z > halfDepth - 0.28 && Math.abs(nextLocal.x) > DOOR_HALF_WIDTH) {
        nextLocal.z = halfDepth - 0.28;
      }
      return houseLocalToWorld(nextLocal, resident).setY(0);
    }

    if (!nextInside) continue;
    const entersThroughDoor = currentLocal.z >= halfDepth - 0.5
      && Math.abs(currentLocal.x) <= DOOR_HALF_WIDTH + 0.2
      && Math.abs(nextLocal.x) <= DOOR_HALF_WIDTH;
    if (entersThroughDoor) continue;

    const pushX = halfWidth - Math.abs(nextLocal.x);
    const pushZ = halfDepth - Math.abs(nextLocal.z);
    if (pushX < pushZ) {
      nextLocal.x = Math.sign(nextLocal.x || currentLocal.x || 1) * halfWidth;
    } else {
      nextLocal.z = Math.sign(nextLocal.z || currentLocal.z || 1) * halfDepth;
    }
    return houseLocalToWorld(nextLocal, resident).setY(0);
  }

  return position;
}

function blocksInteriorPath(item: CatalogItem) {
  const id = item.id.toLowerCase();
  if (item.type !== "furniture" && item.type !== "outdoor") return false;
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

function resolveInteriorItemCollisions(
  current: THREE.Vector3,
  requested: THREE.Vector3,
  residents: NeighborhoodResident[],
  catalog: CatalogItem[]
) {
  const resident = residentAtPosition(requested, residents) ?? residentAtPosition(current, residents);
  if (!resident) return requested;

  const halfDepth = houseDepth(resident.houseLevel) / 2;
  const candidate = worldToHouseLocal(requested, resident);
  const currentLocal = worldToHouseLocal(current, resident);
  const inExitCorridor = Math.abs(candidate.x) <= DOOR_HALF_WIDTH + 0.32 && candidate.z >= halfDepth - 2.85;
  if (inExitCorridor) return requested;

  for (const placed of resident.placedItems) {
    const item = getCatalogItem(catalog, placed.itemId);
    if (!item || !blocksInteriorPath(item)) continue;
    const baseSize = item.size ?? [0.9, 0.9, 0.9];
    const scale = placed.scale ?? 1;
    const halfX = baseSize[0] * scale / 2 + 0.22;
    const halfZ = baseSize[2] * scale / 2 + 0.22;
    const itemSpace = candidate.clone().sub(new THREE.Vector3(placed.x, 0, placed.z)).applyAxisAngle(UP, -placed.rotation);
    if (Math.abs(itemSpace.x) > halfX || Math.abs(itemSpace.z) > halfZ) continue;

    const currentItemSpace = currentLocal.clone().sub(new THREE.Vector3(placed.x, 0, placed.z)).applyAxisAngle(UP, -placed.rotation);
    const pushX = halfX - Math.abs(itemSpace.x);
    const pushZ = halfZ - Math.abs(itemSpace.z);
    if (pushX < pushZ) {
      itemSpace.x = Math.sign(currentItemSpace.x || itemSpace.x || 1) * halfX;
    } else {
      itemSpace.z = Math.sign(currentItemSpace.z || itemSpace.z || 1) * halfZ;
    }
    const adjusted = itemSpace
      .applyAxisAngle(UP, placed.rotation)
      .add(new THREE.Vector3(placed.x, 0, placed.z));
    candidate.copy(adjusted);
  }

  return houseLocalToWorld(candidate, resident).setY(0);
}

function StreetCamera({
  position,
  rotation,
  driving,
  homePosition,
  homeFront,
  neighborDirection,
  intro,
  inside
}: {
  position: THREE.Vector3;
  rotation: number;
  driving: boolean;
  homePosition: THREE.Vector3;
  homeFront: THREE.Vector3;
  neighborDirection: THREE.Vector3;
  intro: boolean;
  inside: boolean;
}) {
  const { camera } = useThree();
  const lookTarget = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const forward = frontVector(rotation);
    let desired: THREE.Vector3;
    let target: THREE.Vector3;
    if (driving) {
      desired = position.clone().addScaledVector(forward, -10).add(new THREE.Vector3(0, 7.2, 0));
      target = position.clone().addScaledVector(forward, 5);
    } else if (inside) {
      const side = rightVector(Math.atan2(homeFront.x, homeFront.z));
      desired = homePosition.clone()
        .addScaledVector(homeFront, intro ? 8.2 : 7)
        .addScaledVector(side, intro ? 2.2 : 1.45)
        .add(new THREE.Vector3(0, intro ? 6.2 : 5.25, 0));
      target = position.clone().add(new THREE.Vector3(0, 1.05, 0));
    } else if (intro) {
      desired = homePosition.clone()
        .addScaledVector(homeFront, 13.5)
        .addScaledVector(neighborDirection, -7)
        .add(new THREE.Vector3(0, 11.5, 0));
      target = homePosition.clone().add(new THREE.Vector3(0, 1.65, 0));
    } else {
      desired = position.clone()
        .addScaledVector(homeFront, 10.5)
        .addScaledVector(neighborDirection, -5)
        .add(new THREE.Vector3(0, 10.2, 0));
      target = position.clone().addScaledVector(neighborDirection, 1.4).add(new THREE.Vector3(0, 1.1, 0));
    }
    const damping = 1 - Math.exp(-delta * (driving ? 5.5 : 4));
    camera.position.lerp(desired, damping);
    lookTarget.current.lerp(target, damping);
    camera.lookAt(lookTarget.current);
  });

  return null;
}

function Tree({ position, scale = 1, autumn = false }: { position: [number, number, number]; scale?: number; autumn?: boolean }) {
  return (
    <group position={position} scale={scale}>
      <mesh castShadow position={[0, 1.25, 0]}>
        <cylinderGeometry args={[0.22, 0.32, 2.5, 8]} />
        <meshStandardMaterial color="#6b4423" roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0, 2.9, 0]}>
        <icosahedronGeometry args={[1.25, 1]} />
        <meshStandardMaterial color={autumn ? "#f59e55" : "#4f9b63"} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[-0.6, 2.5, 0.15]}>
        <icosahedronGeometry args={[0.82, 1]} />
        <meshStandardMaterial color={autumn ? "#f7b267" : "#65b96f"} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0.55, 2.45, -0.2]}>
        <icosahedronGeometry args={[0.76, 1]} />
        <meshStandardMaterial color={autumn ? "#ed7d52" : "#3e8652"} roughness={0.9} />
      </mesh>
    </group>
  );
}

function StreetLamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 2.25, 0]}>
        <cylinderGeometry args={[0.07, 0.1, 4.5, 10]} />
        <meshStandardMaterial color="#313947" metalness={0.55} roughness={0.42} />
      </mesh>
      <mesh castShadow position={[0, 4.45, 0]}>
        <boxGeometry args={[0.6, 0.22, 0.4]} />
        <meshStandardMaterial color="#fff4c7" emissive="#ffd98a" emissiveIntensity={0.55} />
      </mesh>
    </group>
  );
}

function Fence({ length = 8 }: { length?: number }) {
  const posts = Math.max(3, Math.round(length / 1.25));
  return (
    <group>
      {Array.from({ length: posts }, (_, index) => {
        const x = -length / 2 + (index / (posts - 1)) * length;
        return (
          <mesh key={index} castShadow position={[x, 0.55, 0]}>
            <boxGeometry args={[0.12, 1.1, 0.12]} />
            <meshStandardMaterial color="#f3e4c9" roughness={0.88} />
          </mesh>
        );
      })}
      <mesh castShadow position={[0, 0.38, 0]}>
        <boxGeometry args={[length, 0.12, 0.1]} />
        <meshStandardMaterial color="#e8d4b2" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 0.76, 0]}>
        <boxGeometry args={[length, 0.12, 0.1]} />
        <meshStandardMaterial color="#e8d4b2" roughness={0.9} />
      </mesh>
    </group>
  );
}

function OwnLotHighlight({ resident }: { resident: NeighborhoodResident }) {
  const width = 19.35;
  const depth = 26.4;
  return (
    <group position={[resident.lot.x, 0.018, resident.lot.z]} rotation={[0, resident.lot.rotation, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial color="#5eead4" transparent opacity={0.075} depthWrite={false} />
      </mesh>
      {[-depth / 2, depth / 2].map((z) => (
        <mesh key={`z-${z}`} position={[0, 0.045, z]} raycast={() => null}>
          <boxGeometry args={[width, 0.09, 0.1]} />
          <meshBasicMaterial color="#2dd4bf" transparent opacity={0.9} />
        </mesh>
      ))}
      {[-width / 2, width / 2].map((x) => (
        <mesh key={`x-${x}`} position={[x, 0.045, 0]} raycast={() => null}>
          <boxGeometry args={[0.1, 0.09, depth]} />
          <meshBasicMaterial color="#2dd4bf" transparent opacity={0.9} />
        </mesh>
      ))}
      <Html center position={[-4.25, 0.65, depth / 2]} distanceFactor={11} style={{ pointerEvents: "none" }}>
        <div className="own-lot-tag">Мой участок</div>
      </Html>
    </group>
  );
}

function Window({ x, y, z, rotation = 0 }: { x: number; y: number; z: number; rotation?: number }) {
  return (
    <group position={[x, y, z]} rotation={[0, rotation, 0]}>
      <mesh castShadow>
        <boxGeometry args={[1.05, 1.05, 0.09]} />
        <meshStandardMaterial color="#e9f8ff" emissive="#91d6f5" emissiveIntensity={0.16} roughness={0.22} />
      </mesh>
      <mesh position={[0, 0, 0.055]}>
        <boxGeometry args={[0.08, 1.08, 0.04]} />
        <meshStandardMaterial color="#ffffff" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0, 0.055]}>
        <boxGeometry args={[1.08, 0.08, 0.04]} />
        <meshStandardMaterial color="#ffffff" roughness={0.75} />
      </mesh>
    </group>
  );
}

function Scaffolding({ width, depth, height }: { width: number; depth: number; height: number }) {
  const corners: Array<[number, number]> = [
    [-width / 2, -depth / 2], [width / 2, -depth / 2], [-width / 2, depth / 2], [width / 2, depth / 2]
  ];
  return (
    <group>
      {corners.map(([x, z], index) => (
        <mesh key={index} castShadow position={[x, height / 2, z]}>
          <cylinderGeometry args={[0.055, 0.055, height, 8]} />
          <meshStandardMaterial color="#d59a52" roughness={0.92} />
        </mesh>
      ))}
      {[0.9, Math.max(1.2, height - 0.35)].map((y) => (
        <group key={y} position={[0, y, 0]}>
          <mesh castShadow position={[0, 0, depth / 2]}>
            <boxGeometry args={[width + 0.3, 0.1, 0.1]} />
            <meshStandardMaterial color="#d59a52" roughness={0.92} />
          </mesh>
          <mesh castShadow position={[0, 0, -depth / 2]}>
            <boxGeometry args={[width + 0.3, 0.1, 0.1]} />
            <meshStandardMaterial color="#d59a52" roughness={0.92} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function House({ resident, isOwn, onEnter }: { resident: NeighborhoodResident; isOwn: boolean; onEnter: (resident: NeighborhoodResident) => void }) {
  const [hovered, setHovered] = useState(false);
  const level = THREE.MathUtils.clamp(resident.houseLevel, 1, 8);
  const width = houseWidth(level);
  const depth = houseDepth(level);
  const bodyHeight = level >= 4 ? 4.5 + Math.max(0, level - 5) * 0.22 : level === 3 ? 3.05 : 2.45;
  const labelHeight = bodyHeight + (level >= 8 ? 5.25 : level >= 7 ? 3.8 : 2.8);
  const wallColor = resident.colors.walls;
  const roofColor = resident.colors.roof;
  const trimColor = resident.colors.trim;
  const showShell = level >= 2;

  return (
    <group
      position={[resident.lot.x, 0, resident.lot.z]}
      rotation={[0, resident.lot.rotation, 0]}
      onPointerEnter={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        setHovered(false);
        document.body.style.cursor = "default";
      }}
      onClick={(event) => {
        event.stopPropagation();
        onEnter(resident);
      }}
    >
      <mesh receiveShadow position={[0, 0.16, 0]}>
        <boxGeometry args={[width + 0.8, 0.32, depth + 0.8]} />
        <meshStandardMaterial color={level === 1 ? "#b8b5ad" : "#d8d1c5"} roughness={0.95} />
      </mesh>

      {showShell ? (
        <>
          <mesh castShadow receiveShadow position={[0, bodyHeight / 2 + 0.28, 0]}>
            <boxGeometry args={[width, bodyHeight, depth]} />
            <meshStandardMaterial color={wallColor} roughness={0.84} />
          </mesh>
          <mesh castShadow position={[0, bodyHeight + 1.05, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[Math.max(width, depth) * 0.73, 2.15, 4]} />
            <meshStandardMaterial color={roofColor} roughness={0.72} />
          </mesh>
          <mesh castShadow position={[0, 1.32, depth / 2 + 0.06]}>
            <boxGeometry args={[1.05, 2.08, 0.14]} />
            <meshStandardMaterial color={trimColor} roughness={0.72} />
          </mesh>
          <mesh position={[0.34, 1.3, depth / 2 + 0.15]}>
            <sphereGeometry args={[0.065, 10, 10]} />
            <meshStandardMaterial color="#f5c96b" metalness={0.7} roughness={0.25} />
          </mesh>
          <Window x={-1.85} y={1.55} z={depth / 2 + 0.065} />
          <Window x={1.85} y={1.55} z={depth / 2 + 0.065} />
          {level >= 4 ? (
            <>
              <Window x={-1.85} y={3.35} z={depth / 2 + 0.065} />
              <Window x={1.85} y={3.35} z={depth / 2 + 0.065} />
              <mesh castShadow position={[-width * 0.27, bodyHeight + 1.3, -0.4]}>
                <boxGeometry args={[0.55, 1.8, 0.65]} />
                <meshStandardMaterial color="#8b5a45" roughness={0.86} />
              </mesh>
            </>
          ) : null}
          {level >= 5 ? (
            <>
              <mesh castShadow receiveShadow position={[-width / 2 - 0.575, 1.15, 0.35]}>
                <boxGeometry args={[1.15, 2.3, depth * 0.74]} />
                <meshStandardMaterial color={wallColor} roughness={0.84} />
              </mesh>
              <mesh castShadow receiveShadow position={[width / 2 + 0.575, 1.15, 0.35]}>
                <boxGeometry args={[1.15, 2.3, depth * 0.74]} />
                <meshStandardMaterial color={wallColor} roughness={0.84} />
              </mesh>
              <mesh castShadow position={[0, 0.52, depth / 2 + 1.2]}>
                <boxGeometry args={[3.6, 0.22, 2.4]} />
                <meshStandardMaterial color="#d9c19b" roughness={0.9} />
              </mesh>
            </>
          ) : null}
          {level >= 6 ? (
            <group position={[0, 2.6, depth / 2 + 0.62]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[3.4, 0.16, 1.25]} />
                <meshStandardMaterial color="#d9c19b" roughness={0.88} />
              </mesh>
              <mesh castShadow position={[0, 0.55, 0.52]}>
                <boxGeometry args={[3.45, 0.08, 0.08]} />
                <meshStandardMaterial color={trimColor} roughness={0.65} />
              </mesh>
              {[-1.55, -0.52, 0.52, 1.55].map((x) => (
                <mesh key={x} castShadow position={[x, 0.28, 0.52]}>
                  <boxGeometry args={[0.06, 0.62, 0.06]} />
                  <meshStandardMaterial color={trimColor} roughness={0.65} />
                </mesh>
              ))}
            </group>
          ) : null}
          {level >= 7 ? (
            <group position={[0, bodyHeight + 1.35, 0.62]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[2.15, 1.28, 1.45]} />
                <meshStandardMaterial color={wallColor} roughness={0.78} />
              </mesh>
              <Window x={0} y={0} z={0.76} />
              <mesh castShadow position={[0, 0.98, 0]} rotation={[0, Math.PI / 4, 0]}>
                <coneGeometry args={[1.7, 1.05, 4]} />
                <meshStandardMaterial color={roofColor} roughness={0.7} />
              </mesh>
            </group>
          ) : null}
          {level >= 8 ? (
            <group position={[0, bodyHeight + 2.3, -0.75]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[1.75, 2.35, 1.75]} />
                <meshStandardMaterial color={trimColor} roughness={0.72} />
              </mesh>
              <mesh castShadow position={[0, 1.72, 0]}>
                <coneGeometry args={[1.55, 1.35, 6]} />
                <meshStandardMaterial color={roofColor} metalness={0.12} roughness={0.6} />
              </mesh>
              <mesh position={[0, 2.62, 0]}>
                <sphereGeometry args={[0.16, 12, 12]} />
                <meshStandardMaterial color="#f6cf68" emissive="#f2aa3f" emissiveIntensity={0.35} />
              </mesh>
            </group>
          ) : null}
        </>
      ) : (
        <>
          <Scaffolding width={width} depth={depth} height={2.8} />
          {[-1.7, -0.55, 0.6, 1.75].map((x) => (
            <mesh key={x} castShadow position={[x, 0.52, 0]} rotation={[0, 0.08 * x, 0]}>
              <boxGeometry args={[0.18, 0.18, 3.8]} />
              <meshStandardMaterial color="#b9793e" roughness={0.96} />
            </mesh>
          ))}
        </>
      )}

      {level === 2 ? <Scaffolding width={width + 0.7} depth={depth + 0.7} height={3.4} /> : null}
      <mesh receiveShadow position={[0, 0.035, depth / 2 + 2.25]}>
        <boxGeometry args={[1.5, 0.07, 4.5]} />
        <meshStandardMaterial color="#d9c6a2" roughness={0.98} />
      </mesh>
      <Html center position={[0, labelHeight, 0]} distanceFactor={13} style={{ pointerEvents: "none" }}>
        <button className={`${hovered ? "house-label active" : "house-label"}${isOwn ? " own" : ""}`} type="button">
          <b>{isOwn ? "Мой дом" : resident.username}</b>
          <span>{isOwn ? `${resident.username} · ` : ""}дом {level} ур. · {resident.homeValue.toLocaleString("ru-RU")} ₽</span>
        </button>
      </Html>
    </group>
  );
}

type SeamlessHouseProps = {
  resident: NeighborhoodResident;
  isOwn: boolean;
  active: boolean;
  catalog: CatalogItem[];
  buildMode: boolean;
  selectedPlacedId: string;
  onEnter: (resident: NeighborhoodResident) => void;
  onFloorClick: (event: ThreeEvent<MouseEvent>, resident: NeighborhoodResident) => void;
  onInteract: (itemId: string, action: string) => void;
  onSelectPlaced: (instanceId: string) => void;
};

function SeamlessHouse({
  resident,
  isOwn,
  active,
  catalog,
  buildMode,
  selectedPlacedId,
  onEnter,
  onFloorClick,
  onInteract,
  onSelectPlaced
}: SeamlessHouseProps) {
  const [hovered, setHovered] = useState(false);
  const level = THREE.MathUtils.clamp(resident.houseLevel, 1, 8);
  const width = houseWidth(level);
  const depth = houseDepth(level);
  const bodyHeight = level >= 4 ? 4.7 + Math.max(0, level - 5) * 0.22 : level === 3 ? 3.35 : 2.85;
  const visibleWallHeight = active ? Math.min(bodyHeight, 2.85) : bodyHeight;
  const labelHeight = bodyHeight + (level >= 8 ? 5.25 : level >= 7 ? 3.8 : 2.8);
  const wallColor = resident.colors.walls;
  const interiorWallColor = resident.homeStyle.wallColor;
  const floorColor = resident.homeStyle.floorColor;
  const roofColor = resident.colors.roof;
  const trimColor = resident.colors.trim;
  const frontSegmentWidth = width / 2 - DOOR_HALF_WIDTH;

  return (
    <group
      position={[resident.lot.x, 0, resident.lot.z]}
      rotation={[0, resident.lot.rotation, 0]}
      onPointerEnter={() => {
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        setHovered(false);
        document.body.style.cursor = "default";
      }}
      onClick={(event) => {
        event.stopPropagation();
        onEnter(resident);
      }}
    >
      <mesh receiveShadow position={[0, -0.08, 0]}>
        <boxGeometry args={[width + 0.7, 0.16, depth + 0.7]} />
        <meshStandardMaterial color={level === 1 ? "#b8b5ad" : "#d8d1c5"} roughness={0.95} />
      </mesh>
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, 0]}
        onClick={(event) => {
          event.stopPropagation();
          onFloorClick(event, resident);
        }}
      >
        <planeGeometry args={[width - 0.34, depth - 0.34]} />
        <meshStandardMaterial color={floorColor} roughness={0.88} />
      </mesh>

      <mesh castShadow receiveShadow position={[0, visibleWallHeight / 2, -depth / 2]}>
        <boxGeometry args={[width, visibleWallHeight, WALL_THICKNESS]} />
        <meshStandardMaterial color={interiorWallColor} roughness={0.84} />
      </mesh>
      {[-width / 2, width / 2].map((x) => (
        <mesh key={`side-${x}`} castShadow receiveShadow position={[x, visibleWallHeight / 2, 0]}>
          <boxGeometry args={[WALL_THICKNESS, visibleWallHeight, depth]} />
          <meshStandardMaterial color={interiorWallColor} roughness={0.84} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={`front-${side}`}
          castShadow
          receiveShadow
          position={[side * (DOOR_HALF_WIDTH + frontSegmentWidth / 2), visibleWallHeight / 2, depth / 2]}
        >
          <boxGeometry args={[frontSegmentWidth, visibleWallHeight, WALL_THICKNESS]} />
          <meshStandardMaterial color={wallColor} roughness={0.84} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 2.38, depth / 2]}>
        <boxGeometry args={[DOOR_HALF_WIDTH * 2 + 0.22, 0.22, WALL_THICKNESS + 0.04]} />
        <meshStandardMaterial color={trimColor} roughness={0.68} />
      </mesh>
      <mesh castShadow position={[-DOOR_HALF_WIDTH + 0.08, 1.08, depth / 2 + 0.42]} rotation={[0, -1.16, 0]}>
        <boxGeometry args={[DOOR_HALF_WIDTH * 1.82, 2.12, 0.12]} />
        <meshStandardMaterial color={trimColor} roughness={0.72} />
      </mesh>
      {active ? <pointLight position={[0, 2.35, 0]} color="#ffd7aa" intensity={1.2} distance={10} /> : null}

      {!active ? (
        <>
          <mesh castShadow position={[0, bodyHeight + 1.15, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[Math.max(width, depth) * 0.73, 2.35, 4]} />
            <meshStandardMaterial color={roofColor} roughness={0.72} />
          </mesh>
          <Window x={-4.15} y={1.55} z={depth / 2 + 0.105} />
          <Window x={4.15} y={1.55} z={depth / 2 + 0.105} />
          {level >= 4 ? (
            <>
              <Window x={-4.15} y={3.45} z={depth / 2 + 0.105} />
              <Window x={4.15} y={3.45} z={depth / 2 + 0.105} />
              <mesh castShadow position={[-width * 0.3, bodyHeight + 1.3, -1.4]}>
                <boxGeometry args={[0.65, 1.9, 0.72]} />
                <meshStandardMaterial color="#8b5a45" roughness={0.86} />
              </mesh>
            </>
          ) : null}
          {level >= 5 ? (
            <mesh castShadow position={[0, 0.48, depth / 2 + 1.25]}>
              <boxGeometry args={[5.6, 0.22, 2.5]} />
              <meshStandardMaterial color="#d9c19b" roughness={0.9} />
            </mesh>
          ) : null}
          {level >= 6 ? (
            <group position={[0, 2.75, depth / 2 + 0.62]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[5.2, 0.16, 1.25]} />
                <meshStandardMaterial color="#d9c19b" roughness={0.88} />
              </mesh>
              <mesh castShadow position={[0, 0.58, 0.52]}>
                <boxGeometry args={[5.25, 0.08, 0.08]} />
                <meshStandardMaterial color={trimColor} roughness={0.65} />
              </mesh>
              {[-2.45, -0.82, 0.82, 2.45].map((x) => (
                <mesh key={x} castShadow position={[x, 0.3, 0.52]}>
                  <boxGeometry args={[0.07, 0.66, 0.07]} />
                  <meshStandardMaterial color={trimColor} roughness={0.65} />
                </mesh>
              ))}
            </group>
          ) : null}
          {level >= 7 ? (
            <group position={[0, bodyHeight + 1.45, 0.8]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[3.1, 1.45, 2.1]} />
                <meshStandardMaterial color={wallColor} roughness={0.78} />
              </mesh>
              <Window x={0} y={0} z={1.1} />
              <mesh castShadow position={[0, 1.12, 0]} rotation={[0, Math.PI / 4, 0]}>
                <coneGeometry args={[2.2, 1.2, 4]} />
                <meshStandardMaterial color={roofColor} roughness={0.7} />
              </mesh>
            </group>
          ) : null}
          {level >= 8 ? (
            <group position={[0, bodyHeight + 2.7, -1.4]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[2.15, 2.8, 2.15]} />
                <meshStandardMaterial color={trimColor} roughness={0.72} />
              </mesh>
              <mesh castShadow position={[0, 2.15, 0]}>
                <coneGeometry args={[1.85, 1.55, 6]} />
                <meshStandardMaterial color={roofColor} metalness={0.12} roughness={0.6} />
              </mesh>
            </group>
          ) : null}
        </>
      ) : null}

      {level <= 2 && !active ? <Scaffolding width={width + 0.55} depth={depth + 0.55} height={3.25} /> : null}
      <mesh receiveShadow position={[0, 0.035, depth / 2 + 2.25]}>
        <boxGeometry args={[1.5, 0.07, 4.5]} />
        <meshStandardMaterial color="#d9c6a2" roughness={0.98} />
      </mesh>

      {active ? resident.placedItems.map((placed) => {
        const item = getCatalogItem(catalog, placed.itemId);
        if (!item) return null;
        return (
          <HomePlacedObject
            key={placed.instanceId}
            instanceId={placed.instanceId}
            item={item}
            x={placed.x}
            z={placed.z}
            rotation={placed.rotation}
            itemScale={placed.scale ?? 1}
            selected={isOwn && selectedPlacedId === placed.instanceId}
            buildMode={isOwn && buildMode}
            onInteract={(nextItem) => onInteract(nextItem.id, nextItem.type === "furniture" ? "use" : "look")}
            onSelect={onSelectPlaced}
          />
        );
      }) : null}

      {!active ? (
        <Html center position={[0, labelHeight, 0]} distanceFactor={13} style={{ pointerEvents: "none" }}>
          <button className={`${hovered ? "house-label active" : "house-label"}${isOwn ? " own" : ""}`} type="button">
            <b>{isOwn ? "Мой дом" : resident.username}</b>
            <span>{isOwn ? `${resident.username} · ` : ""}дом {level} ур. · {resident.homeValue.toLocaleString("ru-RU")} ₽</span>
          </button>
        </Html>
      ) : null}
    </group>
  );
}

function ResidentFigure({ resident }: { resident: NeighborhoodResident }) {
  const front = frontVector(resident.lot.rotation);
  const right = rightVector(resident.lot.rotation);
  const position = new THREE.Vector3(resident.lot.x, 0, resident.lot.z)
    .addScaledVector(front, houseDepth(resident.houseLevel) / 2 + 1.55)
    .addScaledVector(right, resident.plotId % 2 ? -1.6 : 1.6);
  const color = resident.colors.roof;

  return (
    <group position={position} rotation={[0, resident.lot.rotation + Math.PI, 0]}>
      <mesh castShadow position={[0, 1.48, 0]}>
        <sphereGeometry args={[0.29, 18, 18]} />
        <meshStandardMaterial color="#f2c7a5" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 0.88, 0]}>
        <capsuleGeometry args={[0.3, 0.72, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.78} />
      </mesh>
      <mesh castShadow position={[-0.18, 0.26, 0]}>
        <capsuleGeometry args={[0.095, 0.48, 5, 10]} />
        <meshStandardMaterial color="#384152" roughness={0.84} />
      </mesh>
      <mesh castShadow position={[0.18, 0.26, 0]}>
        <capsuleGeometry args={[0.095, 0.48, 5, 10]} />
        <meshStandardMaterial color="#384152" roughness={0.84} />
      </mesh>
    </group>
  );
}

function TownCar({ color, active = false }: { color: string; active?: boolean }) {
  const gltf = useGLTF("/assets/models/custom/town-car.glb");
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const nextMaterials = materials.map((material) => {
        const next = material.clone();
        if (next.name.toLowerCase().includes("carpaint")) {
          next.color.set(color);
          if ("roughness" in next) next.roughness = 0.42;
        }
        return next;
      });
      object.material = Array.isArray(object.material) ? nextMaterials : nextMaterials[0];
    });
    return clone;
  }, [gltf.scene, color]);

  return (
    <group>
      {active ? (
        <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.7, 2.05, 36]} />
          <meshBasicMaterial color="#5eead4" transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
      <primitive object={model} />
    </group>
  );
}

function CarFallback({ color }: { color: string }) {
  return (
    <group position={[0, 0.42, 0]}>
      <mesh castShadow>
        <boxGeometry args={[1.75, 0.55, 3.35]} />
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.12} />
      </mesh>
      <mesh castShadow position={[0, 0.48, -0.15]}>
        <boxGeometry args={[1.45, 0.65, 1.65]} />
        <meshStandardMaterial color="#bde8f7" roughness={0.2} metalness={0.08} />
      </mesh>
    </group>
  );
}

function Car({ transform, color, active = false }: { transform: CarTransform; color: string; active?: boolean }) {
  return (
    <group position={transform.position} rotation={[0, transform.rotation, 0]}>
      <Suspense fallback={<CarFallback color={color} />}>
        <TownCar color={color} active={active} />
      </Suspense>
    </group>
  );
}

function DistrictGeometry({ residents }: { residents: NeighborhoodResident[] }) {
  const treePositions = useMemo(() => residents.flatMap((resident) => {
    const front = frontVector(resident.lot.rotation);
    const right = rightVector(resident.lot.rotation);
    const center = new THREE.Vector3(resident.lot.x, 0, resident.lot.z);
    return [-1, 1].map((direction, index) => {
      const position = center.clone().addScaledVector(right, direction * 9.15).addScaledVector(front, -1.1 + index * 1.5);
      return { position: [position.x, 0, position.z] as [number, number, number], autumn: (resident.plotId + index) % 4 === 0 };
    });
  }), [residents]);

  return (
    <>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <planeGeometry args={[116, 170]} />
        <meshStandardMaterial color="#78ad68" roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]}>
        <planeGeometry args={[12.4, 164]} />
        <meshStandardMaterial color="#343942" roughness={0.96} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.026, 0]}>
        <planeGeometry args={[90, 11.2]} />
        <meshStandardMaterial color="#343942" roughness={0.96} />
      </mesh>
      {[-7.35, 7.35].map((x) => (
        <mesh key={x} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0, 0]}>
          <planeGeometry args={[2.2, 164]} />
          <meshStandardMaterial color="#d5d2ca" roughness={0.97} />
        </mesh>
      ))}
      {[-6.25, 6.25].map((x) => (
        <mesh key={`curb-${x}`} castShadow receiveShadow position={[x, 0.09, 0]}>
          <boxGeometry args={[0.18, 0.18, 164]} />
          <meshStandardMaterial color="#b8b6b0" roughness={0.96} />
        </mesh>
      ))}
      {Array.from({ length: 27 }, (_, index) => (
        <mesh key={`line-${index}`} position={[0, 0.005, -78 + index * 6]}>
          <boxGeometry args={[0.16, 0.025, 3.2]} />
          <meshStandardMaterial color="#f7e7a0" roughness={0.8} />
        </mesh>
      ))}
      {Array.from({ length: 15 }, (_, index) => (
        <mesh key={`cross-${index}`} position={[-42 + index * 6, 0.007, 0]}>
          <boxGeometry args={[3.2, 0.025, 0.16]} />
          <meshStandardMaterial color="#f7e7a0" roughness={0.8} />
        </mesh>
      ))}
      {residents.map((resident) => {
        const front = frontVector(resident.lot.rotation);
        const right = rightVector(resident.lot.rotation);
        const base = new THREE.Vector3(resident.lot.x, 0, resident.lot.z);
        const halfDepth = houseDepth(resident.houseLevel) / 2;
        const fencePosition = base.clone().addScaledVector(front, halfDepth + 4.15);
        return (
          <group key={`yard-${resident.plotId}`}>
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[resident.lot.x, -0.005, resident.lot.z]}>
              <planeGeometry args={[27, 19.5]} />
              <meshStandardMaterial color={resident.plotId % 3 === 0 ? "#82b96d" : "#8ec578"} roughness={1} />
            </mesh>
            <group position={fencePosition} rotation={[0, resident.lot.rotation, 0]}>
              <group position={[-5.95, 0, 0]}><Fence length={7.05} /></group>
              <group position={[5.95, 0, 0]}><Fence length={7.05} /></group>
            </group>
            <mesh receiveShadow position={base.clone().addScaledVector(front, halfDepth + 2.05)} rotation={[0, resident.lot.rotation, 0]}>
              <boxGeometry args={[1.55, 0.055, 4.2]} />
              <meshStandardMaterial color="#d7c7a8" roughness={1} />
            </mesh>
            <mesh castShadow position={base.clone().addScaledVector(front, halfDepth + 4.45).addScaledVector(right, -2.25)}>
              <boxGeometry args={[0.52, 1.05, 0.42]} />
              <meshStandardMaterial color={resident.colors.roof} roughness={0.62} />
            </mesh>
          </group>
        );
      })}
      {treePositions.map((tree, index) => (
        <Tree key={index} position={tree.position} scale={0.78 + (index % 3) * 0.08} autumn={tree.autumn} />
      ))}
      {[-70, -50, -30, -10, 10, 30, 50, 70].flatMap((z) => [
        <StreetLamp key={`left-${z}`} position={[-5.65, 0, z]} />,
        <StreetLamp key={`right-${z}`} position={[5.65, 0, z]} />
      ])}
      {Array.from({ length: 14 }, (_, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        const z = -70 + (index % 7) * 23;
        const height = 8 + (index % 4) * 3.2;
        return (
          <mesh key={`city-${index}`} castShadow position={[side * (50 + (index % 3) * 3.5), height / 2 - 0.1, z]}>
            <boxGeometry args={[8, height, 8]} />
            <meshStandardMaterial color={index % 3 === 0 ? "#9faec1" : "#b8b0c4"} roughness={0.92} />
          </mesh>
        );
      })}
    </>
  );
}

function NeighborhoodWorld({
  user,
  home,
  catalog,
  residents,
  remotePlayers,
  initialPosition,
  buildMode,
  selectedPlacedId,
  visitRequest,
  onMove,
  onInteriorChange,
  onInteract,
  onSelectPlaced,
  onBuildMove,
  onToast,
  onDrivingChange
}: NeighborhoodSceneProps & { onDrivingChange: (driving: boolean) => void }) {
  const worldResidents = useMemo(() => residents.map((resident) => resident.username === user.username ? {
    ...resident,
    avatar: home.avatar,
    homeStyle: home.homeStyle ?? resident.homeStyle,
    placedItems: home.placedItems
  } : resident), [home.avatar, home.homeStyle, home.placedItems, residents, user.username]);
  const ownResident = worldResidents.find((resident) => resident.username === user.username) ?? worldResidents[0];
  const viewOrigin = useMemo(() => new THREE.Vector3(ownResident.lot.x, 0, ownResident.lot.z), [ownResident]);
  const viewOffset = useMemo(() => viewOrigin.clone().multiplyScalar(-1), [viewOrigin]);
  const homeFront = useMemo(() => frontVector(ownResident.lot.rotation), [ownResident.lot.rotation]);
  const neighborDirection = useMemo(() => {
    const nearest = worldResidents
      .filter((resident) => resident.username !== ownResident.username)
      .map((resident) => new THREE.Vector3(resident.lot.x - ownResident.lot.x, 0, resident.lot.z - ownResident.lot.z))
      .sort((left, right) => left.lengthSq() - right.lengthSq())
      .slice(0, 3);
    const average = nearest.reduce((sum, direction) => sum.add(direction.clone().normalize()), new THREE.Vector3());
    if (average.lengthSq() < 0.01) return rightVector(ownResident.lot.rotation);
    return average.normalize();
  }, [ownResident, worldResidents]);
  const ownCarStart = useMemo(() => residentCarTransform(ownResident), [ownResident]);
  const defaultSpawn = useMemo(() => {
    return houseLocalToWorld(new THREE.Vector3(0, 0, houseDepth(ownResident.houseLevel) / 2 - 2.15), ownResident);
  }, [ownResident]);
  const playerPosition = useRef(new THREE.Vector3(
    initialPosition?.x ?? defaultSpawn.x,
    0,
    initialPosition?.z ?? defaultSpawn.z
  ));
  const playerRotation = useRef(initialPosition?.rotation ?? ownResident.lot.rotation);
  const carPosition = useRef(ownCarStart.position.clone());
  const carRotation = useRef(ownCarStart.rotation);
  const carSpeed = useRef(0);
  const keys = useRef(new Set<string>());
  const clickTarget = useRef<THREE.Vector3 | null>(null);
  const clickPath = useRef<THREE.Vector3[]>([]);
  const pendingVisit = useRef<NeighborhoodResident | null>(null);
  const handledVisitRequest = useRef<number | null>(null);
  const drivingRef = useRef(false);
  const lastMoveSent = useRef(0);
  const introViewRef = useRef(!initialPosition);
  const activeInteriorRef = useRef<NeighborhoodResident | null>(initialPosition ? residentAtPosition(playerPosition.current, worldResidents) ?? null : ownResident);
  const [renderPlayerPosition, setRenderPlayerPosition] = useState(() => playerPosition.current.clone());
  const [renderPlayerRotation, setRenderPlayerRotation] = useState(playerRotation.current);
  const [renderCarPosition, setRenderCarPosition] = useState(() => carPosition.current.clone());
  const [renderCarRotation, setRenderCarRotation] = useState(carRotation.current);
  const [moving, setMoving] = useState(false);
  const [driving, setDriving] = useState(false);
  const [introView, setIntroView] = useState(!initialPosition);
  const [activeInterior, setActiveInterior] = useState<NeighborhoodResident | null>(activeInteriorRef.current);

  const ownOutfit = getCatalogItem(catalog, user.avatar.outfit);
  const ownCharacter = getCatalogItem(catalog, user.avatar.character);
  const ownPet = getCatalogItem(catalog, user.avatar.pet);

  const remoteVectors = useMemo(() => remotePlayers.map((player) => ({
    ...player,
    vector: new THREE.Vector3(player.position.x, player.position.y, player.position.z),
    outfit: getCatalogItem(catalog, player.avatar?.outfit),
    character: getCatalogItem(catalog, player.avatar?.character),
    pet: getCatalogItem(catalog, player.avatar?.pet)
  })), [catalog, remotePlayers]);

  function startClickRoute(points: THREE.Vector3[]) {
    const route = points.filter((point, index) => index === 0 || point.distanceTo(points[index - 1]) > 0.08);
    clickTarget.current = route.shift() ?? null;
    clickPath.current = route;
  }

  function routeToResident(resident: NeighborhoodResident) {
    const currentInterior = activeInteriorRef.current;
    const route: THREE.Vector3[] = [];
    if (currentInterior && currentInterior.username !== resident.username) {
      route.push(residentDoorPosition(currentInterior));
    }
    if (!currentInterior || currentInterior.username !== resident.username) {
      route.push(residentDoorPosition(resident));
    }
    route.push(residentInteriorTarget(resident));
    pendingVisit.current = resident;
    startClickRoute(route);
  }

  useEffect(() => {
    const setDriveState = (next: boolean) => {
      drivingRef.current = next;
      setDriving(next);
      onDrivingChange(next);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      keys.current.add(key);
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
        event.preventDefault();
      }
      if (key !== "e" && key !== "f") return;
      if (event.repeat) return;

      if (drivingRef.current) {
        const side = rightVector(carRotation.current).multiplyScalar(1.65);
        playerPosition.current.copy(carPosition.current).add(side);
        playerRotation.current = carRotation.current;
        carSpeed.current = 0;
        setDriveState(false);
        onToast("Вы вышли из машины");
        return;
      }

      if (playerPosition.current.distanceTo(carPosition.current) <= 2.65) {
        clickTarget.current = null;
        clickPath.current = [];
        pendingVisit.current = null;
        playerPosition.current.copy(carPosition.current);
        playerRotation.current = carRotation.current;
        setDriveState(true);
        onToast("Машина заведена — WASD для езды, E чтобы выйти");
      } else {
        onToast("Подойдите к своей машине ближе");
      }
    };
    const onKeyUp = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.body.style.cursor = "default";
    };
  }, [onDrivingChange, onToast]);

  useEffect(() => {
    const announcePosition = () => onMove({
      x: playerPosition.current.x,
      y: 0,
      z: playerPosition.current.z,
      rotation: playerRotation.current,
      vehicle: false
    });
    announcePosition();
    onInteriorChange(activeInteriorRef.current?.username ?? null);
    const retry = window.setTimeout(announcePosition, 650);
    return () => window.clearTimeout(retry);
  }, []);

  useEffect(() => {
    const currentName = activeInteriorRef.current?.username;
    if (!currentName) return;
    const refreshed = worldResidents.find((resident) => resident.username === currentName) ?? null;
    activeInteriorRef.current = refreshed;
    setActiveInterior(refreshed);
  }, [worldResidents]);

  useEffect(() => {
    if (!visitRequest) return;
    if (handledVisitRequest.current === visitRequest.requestId) return;
    handledVisitRequest.current = visitRequest.requestId;
    const resident = worldResidents.find((entry) => entry.username === visitRequest.username);
    if (!resident) {
      onToast("Дом этого соседа не найден на улице");
      return;
    }
    if (drivingRef.current) {
      onToast("Сначала выйдите из машины");
      return;
    }
    routeToResident(resident);
    onToast(resident.username === user.username ? "Идём домой" : `Идём в гости к ${resident.username}`);
  }, [onToast, user.username, visitRequest, worldResidents]);

  useFrame((_, delta) => {
    let didMove = false;
    if (drivingRef.current) {
      const throttle = (keys.current.has("w") || keys.current.has("arrowup") ? 1 : 0)
        - (keys.current.has("s") || keys.current.has("arrowdown") ? 1 : 0);
      const steering = (keys.current.has("a") || keys.current.has("arrowleft") ? 1 : 0)
        - (keys.current.has("d") || keys.current.has("arrowright") ? 1 : 0);
      if (throttle !== 0) {
        carSpeed.current += throttle * delta * (throttle * carSpeed.current < 0 ? 13 : 7.8);
      } else {
        carSpeed.current *= Math.exp(-delta * 1.85);
      }
      if (keys.current.has(" ")) carSpeed.current *= Math.exp(-delta * 7);
      carSpeed.current = THREE.MathUtils.clamp(carSpeed.current, -5.2, CAR_MAX_SPEED);
      if (Math.abs(carSpeed.current) < 0.04) carSpeed.current = 0;
      const steerPower = (0.22 + Math.min(1, Math.abs(carSpeed.current) / 4.5)) * Math.sign(carSpeed.current || 1);
      carRotation.current += steering * delta * 1.45 * steerPower;
      const nextPosition = carPosition.current.clone().addScaledVector(frontVector(carRotation.current), carSpeed.current * delta);
      if (isRoad(nextPosition.x, nextPosition.z)) {
        carPosition.current.copy(nextPosition);
        didMove = Math.abs(carSpeed.current) > 0.03;
      } else {
        carSpeed.current *= -0.16;
      }
      playerPosition.current.copy(carPosition.current);
      playerRotation.current = carRotation.current;
    } else {
      const keyboardDirection = new THREE.Vector3(
        (keys.current.has("d") || keys.current.has("arrowright") ? 1 : 0) - (keys.current.has("a") || keys.current.has("arrowleft") ? 1 : 0),
        0,
        (keys.current.has("s") || keys.current.has("arrowdown") ? 1 : 0) - (keys.current.has("w") || keys.current.has("arrowup") ? 1 : 0)
      );
      let direction = keyboardDirection;
      if (keyboardDirection.lengthSq() > 0) {
        clickTarget.current = null;
        clickPath.current = [];
        pendingVisit.current = null;
      } else if (clickTarget.current) {
        direction = clickTarget.current.clone().sub(playerPosition.current);
        direction.y = 0;
        if (direction.length() < 0.16) {
          playerPosition.current.copy(clickTarget.current);
          clickTarget.current = clickPath.current.shift() ?? null;
          direction.set(0, 0, 0);
        }
      }

      if (direction.lengthSq() > 0) {
        direction.normalize();
        playerRotation.current = Math.atan2(direction.x, direction.z);
        const nextPosition = playerPosition.current.clone().addScaledVector(direction, WALK_SPEED * delta);
        const currentPosition = playerPosition.current.clone();
        const shellResolved = resolveWalkPosition(currentPosition, nextPosition, worldResidents);
        playerPosition.current.copy(resolveInteriorItemCollisions(currentPosition, shellResolved, worldResidents, catalog));
        didMove = true;
      }
    }

    const nextInterior = residentAtPosition(playerPosition.current, worldResidents) ?? null;
    if (nextInterior?.username !== activeInteriorRef.current?.username) {
      activeInteriorRef.current = nextInterior;
      setActiveInterior(nextInterior);
      onInteriorChange(nextInterior?.username ?? null);
      if (nextInterior) {
        onToast(nextInterior.username === user.username ? "Вы дома" : `Вы в гостях у ${nextInterior.username}`);
      } else {
        onToast("Вы вышли на улицу");
      }
    }
    if (pendingVisit.current && nextInterior?.username === pendingVisit.current.username) {
      pendingVisit.current = null;
    }

    setMoving(didMove);
    if (didMove && introViewRef.current) {
      introViewRef.current = false;
      setIntroView(false);
    }
    setRenderPlayerPosition(playerPosition.current.clone());
    setRenderPlayerRotation(playerRotation.current);
    setRenderCarPosition(carPosition.current.clone());
    setRenderCarRotation(carRotation.current);

    const now = performance.now();
    if (didMove && now - lastMoveSent.current > 120) {
      lastMoveSent.current = now;
      onMove({
        x: playerPosition.current.x,
        y: 0,
        z: playerPosition.current.z,
        rotation: playerRotation.current,
        vehicle: drivingRef.current
      });
    }
  });

  function handleGroundClick(event: ThreeEvent<MouseEvent>) {
    if (drivingRef.current) return;
    pendingVisit.current = null;
    const worldPoint = event.point.clone().add(viewOrigin).setY(0);
    const currentInterior = activeInteriorRef.current;
    const targetInterior = residentAtPosition(worldPoint, worldResidents);
    if (currentInterior && targetInterior?.username !== currentInterior.username) {
      startClickRoute([residentDoorPosition(currentInterior), worldPoint]);
      return;
    }
    startClickRoute([worldPoint]);
  }

  function handleInteriorFloorClick(event: ThreeEvent<MouseEvent>, resident: NeighborhoodResident) {
    if (drivingRef.current) return;
    const worldPoint = event.point.clone().add(viewOrigin).setY(0);
    if (buildMode && resident.username === user.username && activeInteriorRef.current?.username === user.username) {
      const local = worldToHouseLocal(worldPoint, resident);
      onBuildMove(
        THREE.MathUtils.clamp(local.x, -7.6, 7.6),
        THREE.MathUtils.clamp(local.z, -7.6, 7.6)
      );
      return;
    }
    pendingVisit.current = null;
    startClickRoute([worldPoint]);
  }

  function handleHouseEnter(resident: NeighborhoodResident) {
    if (drivingRef.current) {
      onToast("Сначала выйдите из машины возле дома");
      return;
    }
    routeToResident(resident);
    onToast(resident.username === user.username ? "Идём домой" : `Идём в гости к ${resident.username}`);
  }

  const controlledCarTransform = { position: renderCarPosition, rotation: renderCarRotation };
  const cameraPosition = (driving ? renderCarPosition : renderPlayerPosition).clone().sub(viewOrigin);
  const cameraResident = activeInterior ?? ownResident;
  const displayHomePosition = new THREE.Vector3(cameraResident.lot.x, 0, cameraResident.lot.z).sub(viewOrigin);
  const cameraHomeFront = frontVector(cameraResident.lot.rotation);

  return (
    <>
      <color attach="background" args={["#9ed9f3"]} />
      <fog attach="fog" args={["#b9ddec", 58, 148]} />
      <Sky distance={450000} sunPosition={[18, 28, 12]} turbidity={3.5} rayleigh={0.72} mieCoefficient={0.006} mieDirectionalG={0.76} />
      <hemisphereLight args={["#dff5ff", "#587447", 1.55]} />
      <directionalLight
        castShadow
        position={[18, 28, 16]}
        intensity={2.25}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={55}
        shadow-camera-bottom={-55}
        shadow-bias={-0.00012}
      />
      <Sparkles count={100} scale={[78, 10, 128]} size={1.35} speed={0.18} color="#fff2fb" opacity={0.52} />
      <group position={viewOffset}>
        <DistrictGeometry residents={worldResidents} />
        <mesh
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.012, 0]}
          onClick={handleGroundClick}
        >
          <planeGeometry args={[94, 140]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        <OwnLotHighlight resident={ownResident} />
        {worldResidents.map((resident) => (
          <SeamlessHouse
            key={resident.plotId}
            resident={resident}
            isOwn={resident.username === user.username}
            active={resident.username === activeInterior?.username}
            catalog={catalog}
            buildMode={buildMode && activeInterior?.username === user.username}
            selectedPlacedId={selectedPlacedId}
            onEnter={handleHouseEnter}
            onFloorClick={handleInteriorFloorClick}
            onInteract={onInteract}
            onSelectPlaced={onSelectPlaced}
          />
        ))}
        {worldResidents.filter((resident) => resident.username !== user.username).map((resident) => (
          <ResidentFigure key={`resident-${resident.plotId}`} resident={resident} />
        ))}
        {worldResidents.filter((resident) => resident.username !== user.username).map((resident) => (
          <Car
            key={`car-${resident.plotId}`}
            transform={residentCarTransform(resident)}
            color={residentCarColor(resident)}
          />
        ))}
        <Car transform={controlledCarTransform} color={residentCarColor(ownResident)} active={!driving} />

        {!driving ? (
          <Player
            username={user.username}
            color={ownOutfit?.color ?? "#ff8ab3"}
            position={renderPlayerPosition}
            isSelf
            pet={ownPet}
            character={ownCharacter}
            outfit={ownOutfit}
            moving={moving}
            rotation={renderPlayerRotation}
          />
        ) : null}
        {remoteVectors.map((player) => player.position.vehicle ? (
          <Car
            key={player.id ?? player.username}
            transform={{ position: player.vector, rotation: player.position.rotation ?? 0 }}
            color="#8b5cf6"
          />
        ) : (
          <Player
            key={player.id ?? player.username}
            username={player.username}
            color={player.outfit?.color ?? "#8b5cf6"}
            position={player.vector}
            pet={player.pet}
            character={player.character}
            outfit={player.outfit}
            moving
            rotation={player.position.rotation ?? 0}
          />
        ))}
      </group>
      <StreetCamera
        position={cameraPosition}
        rotation={driving ? renderCarRotation : renderPlayerRotation}
        driving={driving}
        homePosition={displayHomePosition}
        homeFront={activeInterior ? cameraHomeFront : homeFront}
        neighborDirection={neighborDirection}
        intro={introView}
        inside={Boolean(activeInterior)}
      />
    </>
  );
}

export function NeighborhoodScene(props: NeighborhoodSceneProps) {
  const [driving, setDriving] = useState(false);

  return (
    <>
      <Canvas shadows dpr={[1, 1.7]} camera={{ position: [16, 15, 20], fov: 48, near: 0.1, far: 220 }}>
        <NeighborhoodWorld {...props} onDrivingChange={setDriving} />
      </Canvas>
      <div className={driving ? "street-controls driving" : "street-controls"}>
        <span className="control-key">WASD</span>
        <span>{driving ? "ехать и рулить" : "идти"}</span>
        <span className="control-dot">·</span>
        <span className="control-key">E</span>
        <span>{driving ? "выйти" : "сесть в свою машину"}</span>
        {!driving ? <><span className="control-dot">·</span><span>открытая дверь ведёт прямо в дом</span></> : null}
      </div>
    </>
  );
}

useGLTF.preload("/assets/models/custom/town-car.glb");
