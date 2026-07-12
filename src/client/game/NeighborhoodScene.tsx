import { Html, Sky, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CatalogItem, NeighborhoodResident, PublicUser, RemotePlayer } from "../types";
import { Player } from "./GameScene";

type WorldPosition = { x: number; y: number; z: number; rotation?: number; vehicle?: boolean };

type NeighborhoodSceneProps = {
  user: PublicUser;
  catalog: CatalogItem[];
  residents: NeighborhoodResident[];
  remotePlayers: RemotePlayer[];
  initialPosition?: WorldPosition;
  onMove: (position: WorldPosition) => void;
  onVisit: (username: string) => void;
  onToast: (message: string) => void;
};

type CarTransform = {
  position: THREE.Vector3;
  rotation: number;
};

const WORLD_X = 34;
const WORLD_Z = 49;
const WALK_SPEED = 5.4;
const CAR_MAX_SPEED = 12.5;
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
  if (level <= 1) return 4.2;
  if (level === 2) return 4.5;
  if (level === 3) return 5;
  return 5.4;
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

function residentCarTransform(resident: NeighborhoodResident): CarTransform {
  const front = frontVector(resident.lot.rotation);
  const right = rightVector(resident.lot.rotation);
  return {
    position: new THREE.Vector3(
      resident.lot.x + front.x * 10.2 + right.x * 2.1,
      0,
      resident.lot.z + front.z * 10.2 + right.z * 2.1
    ),
    rotation: resident.plotId % 2 === 0 ? Math.PI : 0
  };
}

function isRoad(x: number, z: number) {
  return (Math.abs(x) <= 8.6 || Math.abs(z) <= 5.7) && Math.abs(x) <= WORLD_X && Math.abs(z) <= WORLD_Z;
}

function clampWalkPosition(position: THREE.Vector3, residents: NeighborhoodResident[]) {
  position.x = THREE.MathUtils.clamp(position.x, -WORLD_X + 0.6, WORLD_X - 0.6);
  position.z = THREE.MathUtils.clamp(position.z, -WORLD_Z + 0.6, WORLD_Z - 0.6);

  for (const resident of residents) {
    const local = position.clone().sub(new THREE.Vector3(resident.lot.x, 0, resident.lot.z));
    local.applyAxisAngle(UP, -resident.lot.rotation);
    const halfWidth = resident.houseLevel >= 5 ? 4.4 : 3.4;
    const halfDepth = houseDepth(resident.houseLevel) / 2;
    if (Math.abs(local.x) < halfWidth && Math.abs(local.z) < halfDepth) {
      const pushX = halfWidth - Math.abs(local.x);
      const pushZ = halfDepth - Math.abs(local.z);
      if (pushX < pushZ) {
        local.x = Math.sign(local.x || 1) * halfWidth;
      } else {
        local.z = Math.sign(local.z || 1) * halfDepth;
      }
      local.applyAxisAngle(UP, resident.lot.rotation);
      position.set(resident.lot.x + local.x, 0, resident.lot.z + local.z);
    }
  }

  return position;
}

function StreetCamera({ position, rotation, driving }: { position: THREE.Vector3; rotation: number; driving: boolean }) {
  const { camera } = useThree();
  const lookTarget = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const forward = frontVector(rotation);
    const desired = driving
      ? position.clone().addScaledVector(forward, -10).add(new THREE.Vector3(0, 7.2, 0))
      : position.clone().add(new THREE.Vector3(11.5, 12.5, 15.5));
    const target = driving
      ? position.clone().addScaledVector(forward, 5)
      : position.clone().add(new THREE.Vector3(0, 1.1, 0));
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

function House({ resident, onEnter }: { resident: NeighborhoodResident; onEnter: (resident: NeighborhoodResident) => void }) {
  const [hovered, setHovered] = useState(false);
  const level = THREE.MathUtils.clamp(resident.houseLevel, 1, 8);
  const width = level >= 5 ? 7.6 + (level - 5) * 0.32 : level >= 3 ? 6.2 : 5.2;
  const depth = houseDepth(level);
  const bodyHeight = level >= 4 ? 4.5 + Math.max(0, level - 5) * 0.22 : level === 3 ? 3.05 : 2.45;
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
              <mesh castShadow receiveShadow position={[-width / 2 - 1.15, 1.15, 0.35]}>
                <boxGeometry args={[2.3, 2.3, depth * 0.74]} />
                <meshStandardMaterial color={wallColor} roughness={0.84} />
              </mesh>
              <mesh castShadow receiveShadow position={[width / 2 + 1.15, 1.15, 0.35]}>
                <boxGeometry args={[2.3, 2.3, depth * 0.74]} />
                <meshStandardMaterial color={wallColor} roughness={0.84} />
              </mesh>
              <mesh castShadow position={[0, 0.52, depth / 2 + 1.2]}>
                <boxGeometry args={[3.6, 0.22, 2.4]} />
                <meshStandardMaterial color="#d9c19b" roughness={0.9} />
              </mesh>
            </>
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
      <Html center position={[0, bodyHeight + 2.8, 0]} distanceFactor={13}>
        <button className={hovered ? "house-label active" : "house-label"} type="button">
          <b>{resident.username}</b>
          <span>Дом {level} ур. · {resident.homeValue.toLocaleString("ru-RU")} ₽</span>
        </button>
      </Html>
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
      const position = center.clone().addScaledVector(right, direction * 5.1).addScaledVector(front, -0.4 + index * 0.8);
      return { position: [position.x, 0, position.z] as [number, number, number], autumn: (resident.plotId + index) % 4 === 0 };
    });
  }), [residents]);

  return (
    <>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <planeGeometry args={[82, 112]} />
        <meshStandardMaterial color="#78ad68" roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]}>
        <planeGeometry args={[12.4, 104]} />
        <meshStandardMaterial color="#343942" roughness={0.96} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.026, 0]}>
        <planeGeometry args={[76, 11.2]} />
        <meshStandardMaterial color="#343942" roughness={0.96} />
      </mesh>
      {[-7.35, 7.35].map((x) => (
        <mesh key={x} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0, 0]}>
          <planeGeometry args={[2.2, 104]} />
          <meshStandardMaterial color="#d5d2ca" roughness={0.97} />
        </mesh>
      ))}
      {[-6.25, 6.25].map((x) => (
        <mesh key={`curb-${x}`} castShadow receiveShadow position={[x, 0.09, 0]}>
          <boxGeometry args={[0.18, 0.18, 104]} />
          <meshStandardMaterial color="#b8b6b0" roughness={0.96} />
        </mesh>
      ))}
      {Array.from({ length: 18 }, (_, index) => (
        <mesh key={`line-${index}`} position={[0, 0.005, -49 + index * 6]}>
          <boxGeometry args={[0.16, 0.025, 3.2]} />
          <meshStandardMaterial color="#f7e7a0" roughness={0.8} />
        </mesh>
      ))}
      {Array.from({ length: 12 }, (_, index) => (
        <mesh key={`cross-${index}`} position={[-32 + index * 6, 0.007, 0]}>
          <boxGeometry args={[3.2, 0.025, 0.16]} />
          <meshStandardMaterial color="#f7e7a0" roughness={0.8} />
        </mesh>
      ))}
      {residents.map((resident) => {
        const front = frontVector(resident.lot.rotation);
        const right = rightVector(resident.lot.rotation);
        const base = new THREE.Vector3(resident.lot.x, 0, resident.lot.z);
        const fencePosition = base.clone().addScaledVector(front, 5.45);
        return (
          <group key={`yard-${resident.plotId}`}>
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[resident.lot.x, -0.005, resident.lot.z]}>
              <planeGeometry args={[11.5, 11.2]} />
              <meshStandardMaterial color={resident.plotId % 3 === 0 ? "#82b96d" : "#8ec578"} roughness={1} />
            </mesh>
            <group position={fencePosition} rotation={[0, resident.lot.rotation, 0]}>
              <group position={[-3.9, 0, 0]}><Fence length={3.1} /></group>
              <group position={[3.9, 0, 0]}><Fence length={3.1} /></group>
            </group>
            <mesh receiveShadow position={base.clone().addScaledVector(front, 4.2)} rotation={[0, resident.lot.rotation, 0]}>
              <boxGeometry args={[1.55, 0.055, 4.8]} />
              <meshStandardMaterial color="#d7c7a8" roughness={1} />
            </mesh>
            <mesh castShadow position={base.clone().addScaledVector(front, 5.75).addScaledVector(right, -2.25)}>
              <boxGeometry args={[0.52, 1.05, 0.42]} />
              <meshStandardMaterial color={resident.colors.roof} roughness={0.62} />
            </mesh>
          </group>
        );
      })}
      {treePositions.map((tree, index) => (
        <Tree key={index} position={tree.position} scale={0.78 + (index % 3) * 0.08} autumn={tree.autumn} />
      ))}
      {[-42, -28, -14, 14, 28, 42].flatMap((z) => [
        <StreetLamp key={`left-${z}`} position={[-5.65, 0, z]} />,
        <StreetLamp key={`right-${z}`} position={[5.65, 0, z]} />
      ])}
      {Array.from({ length: 14 }, (_, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        const z = -44 + (index % 7) * 14.5;
        const height = 8 + (index % 4) * 3.2;
        return (
          <mesh key={`city-${index}`} castShadow position={[side * (39 + (index % 3) * 3.5), height / 2 - 0.1, z]}>
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
  catalog,
  residents,
  remotePlayers,
  initialPosition,
  onMove,
  onVisit,
  onToast,
  onDrivingChange
}: NeighborhoodSceneProps & { onDrivingChange: (driving: boolean) => void }) {
  const ownResident = residents.find((resident) => resident.username === user.username) ?? residents[0];
  const ownCarStart = useMemo(() => residentCarTransform(ownResident), [ownResident]);
  const defaultSpawn = useMemo(() => {
    const door = residentDoorPosition(ownResident);
    const front = frontVector(ownResident.lot.rotation);
    return door.addScaledVector(front, 1.25);
  }, [ownResident]);
  const playerPosition = useRef(new THREE.Vector3(
    initialPosition?.x ?? defaultSpawn.x,
    0,
    initialPosition?.z ?? defaultSpawn.z
  ));
  const playerRotation = useRef(initialPosition?.rotation ?? ownResident.lot.rotation + Math.PI);
  const carPosition = useRef(ownCarStart.position.clone());
  const carRotation = useRef(ownCarStart.rotation);
  const carSpeed = useRef(0);
  const keys = useRef(new Set<string>());
  const clickTarget = useRef<THREE.Vector3 | null>(null);
  const pendingVisit = useRef<NeighborhoodResident | null>(null);
  const drivingRef = useRef(false);
  const lastMoveSent = useRef(0);
  const [renderPlayerPosition, setRenderPlayerPosition] = useState(() => playerPosition.current.clone());
  const [renderPlayerRotation, setRenderPlayerRotation] = useState(playerRotation.current);
  const [renderCarPosition, setRenderCarPosition] = useState(() => carPosition.current.clone());
  const [renderCarRotation, setRenderCarRotation] = useState(carRotation.current);
  const [moving, setMoving] = useState(false);
  const [driving, setDriving] = useState(false);

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
        pendingVisit.current = null;
      } else if (clickTarget.current) {
        direction = clickTarget.current.clone().sub(playerPosition.current);
        direction.y = 0;
        if (direction.length() < 0.16) {
          playerPosition.current.copy(clickTarget.current);
          clickTarget.current = null;
          direction.set(0, 0, 0);
        }
      }

      if (direction.lengthSq() > 0) {
        direction.normalize();
        playerRotation.current = Math.atan2(direction.x, direction.z);
        const nextPosition = playerPosition.current.clone().addScaledVector(direction, WALK_SPEED * delta);
        clampWalkPosition(nextPosition, residents);
        playerPosition.current.copy(nextPosition);
        didMove = true;
      }

      const visit = pendingVisit.current;
      if (visit && playerPosition.current.distanceTo(residentDoorPosition(visit)) < 1.45) {
        pendingVisit.current = null;
        clickTarget.current = null;
        onVisit(visit.username);
      }
    }

    setMoving(didMove);
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
    const next = clampWalkPosition(event.point.clone().setY(0), residents);
    pendingVisit.current = null;
    clickTarget.current = next;
  }

  function handleHouseEnter(resident: NeighborhoodResident) {
    if (drivingRef.current) {
      onToast("Сначала выйдите из машины возле дома");
      return;
    }
    pendingVisit.current = resident;
    clickTarget.current = residentDoorPosition(resident);
    onToast(resident.username === user.username ? "Идём домой" : `Идём в гости к ${resident.username}`);
  }

  const controlledCarTransform = { position: renderCarPosition, rotation: renderCarRotation };

  return (
    <>
      <color attach="background" args={["#9ed9f3"]} />
      <fog attach="fog" args={["#b9ddec", 48, 112]} />
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
      <Sparkles count={80} scale={[64, 10, 94]} size={1.35} speed={0.18} color="#fff2fb" opacity={0.52} />
      <DistrictGeometry residents={residents} />
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, 0]}
        onClick={handleGroundClick}
      >
        <planeGeometry args={[80, 108]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {residents.map((resident) => (
        <House key={resident.plotId} resident={resident} onEnter={handleHouseEnter} />
      ))}
      {residents.filter((resident) => resident.username !== user.username).map((resident) => (
        <ResidentFigure key={`resident-${resident.plotId}`} resident={resident} />
      ))}
      {residents.filter((resident) => resident.username !== user.username).map((resident) => (
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
      <StreetCamera position={driving ? renderCarPosition : renderPlayerPosition} rotation={driving ? renderCarRotation : renderPlayerRotation} driving={driving} />
    </>
  );
}

export function NeighborhoodScene(props: NeighborhoodSceneProps) {
  const [driving, setDriving] = useState(false);

  return (
    <>
      <Canvas shadows dpr={[1, 1.7]} camera={{ position: [16, 15, 20], fov: 48, near: 0.1, far: 180 }}>
        <NeighborhoodWorld {...props} onDrivingChange={setDriving} />
      </Canvas>
      <div className={driving ? "street-controls driving" : "street-controls"}>
        <span className="control-key">WASD</span>
        <span>{driving ? "ехать и рулить" : "идти"}</span>
        <span className="control-dot">·</span>
        <span className="control-key">E</span>
        <span>{driving ? "выйти" : "сесть в свою машину"}</span>
        {!driving ? <><span className="control-dot">·</span><span>клик по дому — зайти</span></> : null}
      </div>
    </>
  );
}

useGLTF.preload("/assets/models/custom/town-car.glb");
