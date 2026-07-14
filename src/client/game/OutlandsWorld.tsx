import { Html, useAnimations, useGLTF } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  EYE_DRONE_MODEL_URL,
  EXTRACTION_POSITION,
  EXTRACTION_RADIUS,
  LOOT_CHEST_MODEL_URL,
  OUTLAND_CONTAINERS,
  OUTLANDS_ENTRY_Z,
  QUAD_SHELL_MODEL_URL,
  type OutlandsEnemyKind
} from "./outlands";

type ScatterTransform = {
  position: [number, number, number];
  rotation: number;
  scale: number;
};

type InstancedPart = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  baseMatrix: THREE.Matrix4;
};

export type RobotMotion = "idle" | "walk" | "run" | "attack" | "hit" | "death";

type OutlandsRobotProps = {
  kind: Extract<OutlandsEnemyKind, "eyeDrone" | "quadShell">;
  username: string;
  displayName: string;
  position: THREE.Vector3;
  rotationRef: RefObject<number>;
  motionRef: RefObject<RobotMotion>;
  health: number;
  maxHealth: number;
  dead: boolean;
  faction: "neutral" | "hostile";
  onCombatHit?: (event: ThreeEvent<MouseEvent>) => void;
};

type OutlandsEnvironmentProps = {
  activeExpedition: boolean;
  lootedContainerIds: ReadonlySet<string>;
  nearbyContainerId?: string;
  nearExtraction: boolean;
  onContainerClick: (containerId: string, event: ThreeEvent<MouseEvent>) => void;
};

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function makeScatter(
  count: number,
  seed: number,
  xRange: [number, number],
  zRange: [number, number],
  minRoadDistance: number,
  scaleRange: [number, number]
) {
  const random = seededRandom(seed);
  const result: ScatterTransform[] = [];
  let attempts = 0;
  while (result.length < count && attempts < count * 10) {
    attempts += 1;
    const x = THREE.MathUtils.lerp(xRange[0], xRange[1], random());
    const z = THREE.MathUtils.lerp(zRange[0], zRange[1], random());
    if (Math.abs(x) < minRoadDistance) continue;
    if (x < -20 && x > -64 && z < -185 && z > -232) continue;
    if (x > 48 && x < 108 && z < -215 && z > -278) continue;
    if (x < -42 && x > -104 && z < -260) continue;
    result.push({
      position: [x, -0.04, z],
      rotation: random() * Math.PI * 2,
      scale: THREE.MathUtils.lerp(scaleRange[0], scaleRange[1], random())
    });
  }
  return result;
}

const FOREST_TREES_A = makeScatter(44, 0x71a11, [-116, 116], [-112, -180], 12, [0.82, 1.45]);
const FOREST_TREES_B = makeScatter(34, 0x9913f, [-132, 132], [-142, -226], 15, [0.72, 1.25]);
const BORDER_TREES = makeScatter(30, 0x4d991, [-150, 150], [-228, -318], 48, [0.78, 1.2]);
const QUARRY_ROCKS_A = makeScatter(23, 0x811dd, [44, 132], [-205, -292], 0, [0.8, 1.75]);
const RUIN_ROCKS = makeScatter(18, 0x6bb51, [-136, -32], [-238, -320], 0, [0.65, 1.25]);

function InstancedPartView({ part, transforms, surface }: {
  part: InstancedPart;
  transforms: ScatterTransform[];
  surface: "wood" | "dirt" | "concrete";
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const placement = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    transforms.forEach((transform, index) => {
      position.fromArray(transform.position);
      quaternion.setFromAxisAngle(up, transform.rotation);
      scale.setScalar(transform.scale);
      placement.compose(position, quaternion, scale);
      matrix.multiplyMatrices(placement, part.baseMatrix);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [part, transforms]);

  return (
    <instancedMesh
      ref={ref}
      args={[part.geometry, part.material, transforms.length]}
      castShadow
      receiveShadow
      userData={{ impactSurface: surface }}
    />
  );
}

function InstancedNature({ url, transforms, surface }: {
  url: string;
  transforms: ScatterTransform[];
  surface: "wood" | "dirt" | "concrete";
}) {
  const gltf = useGLTF(url);
  const parts = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const next: InstancedPart[] = [];
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      next.push({
        geometry: object.geometry,
        material: object.material,
        baseMatrix: object.matrixWorld.clone()
      });
    });
    return next;
  }, [gltf.scene]);

  return (
    <group>
      {parts.map((part, index) => (
        <InstancedPartView key={`${url}-${index}`} part={part} transforms={transforms} surface={surface} />
      ))}
    </group>
  );
}

function StaticModel({
  url,
  position,
  rotation = 0,
  scale = 1,
  surface = "generic"
}: {
  url: string;
  position: [number, number, number];
  rotation?: number;
  scale?: number;
  surface?: "wood" | "dirt" | "concrete" | "metal" | "generic";
}) {
  const gltf = useGLTF(url);
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return clone;
  }, [gltf.scene]);

  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale} userData={{ impactSurface: surface }}>
      <primitive object={model} />
    </group>
  );
}

function CheckpointGate({ activeExpedition, nearExtraction }: {
  activeExpedition: boolean;
  nearExtraction: boolean;
}) {
  return (
    <group position={[0, 0, OUTLANDS_ENTRY_Z]}>
      <mesh receiveShadow position={[0, 0.04, 0]} userData={{ impactSurface: "concrete" }}>
        <boxGeometry args={[28, 0.08, 9]} />
        <meshStandardMaterial color="#6f7b6c" roughness={0.9} />
      </mesh>
      {[-9.7, 9.7].map((x) => (
        <group key={x} position={[x, 0, 0]} userData={{ impactSurface: "metal" }}>
          <mesh castShadow position={[0, 3.5, 0]}>
            <boxGeometry args={[0.75, 7, 0.85]} />
            <meshStandardMaterial color="#24343b" metalness={0.7} roughness={0.32} />
          </mesh>
          <mesh position={[0, 5.7, 0.2]}>
            <boxGeometry args={[1.05, 0.24, 1.05]} />
            <meshStandardMaterial color={activeExpedition ? "#39efb1" : "#f59e6b"} emissive={activeExpedition ? "#0d7b58" : "#7a271a"} emissiveIntensity={2.2} />
          </mesh>
          <pointLight position={[0, 5.6, 0]} color={activeExpedition ? "#45ffc2" : "#ff8b68"} intensity={6} distance={13} />
        </group>
      ))}
      <mesh castShadow position={[0, 6.25, 0]} userData={{ impactSurface: "metal" }}>
        <boxGeometry args={[20.1, 0.7, 0.8]} />
        <meshStandardMaterial color="#18272d" metalness={0.68} roughness={0.35} />
      </mesh>
      <mesh position={[0, 6.24, 0.43]}>
        <planeGeometry args={[8.5, 0.9]} />
        <meshStandardMaterial color="#10262c" emissive="#20b486" emissiveIntensity={0.75} />
      </mesh>
      <Html center position={[0, 6.25, 0.46]} distanceFactor={18} style={{ pointerEvents: "none" }}>
        <div className="outlands-world-sign"><b>СЕВЕРНЫЙ КПП</b><span>{activeExpedition ? "экспедиция активна" : "нужно подготовить вылазку"}</span></div>
      </Html>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 18, 0, 0]}>
          {Array.from({ length: 7 }, (_, index) => (
            <mesh key={index} castShadow position={[side * index * 2.2, 1.15, 0]} userData={{ impactSurface: "metal" }}>
              <boxGeometry args={[0.11, 2.3, 0.11]} />
              <meshStandardMaterial color="#53646a" metalness={0.65} roughness={0.42} />
            </mesh>
          ))}
        </group>
      ))}
      {nearExtraction ? (
        <Html center position={[0, 2.1, 3.2]} distanceFactor={13} style={{ pointerEvents: "none" }}>
          <div className="world-interact-label extraction"><b>E</b><span>эвакуировать добычу</span></div>
        </Html>
      ) : null}
    </group>
  );
}

function ZoneMarker({ position, title, subtitle, color }: {
  position: [number, number, number];
  title: string;
  subtitle: string;
  color: string;
}) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 1.7, 0]} userData={{ impactSurface: "metal" }}>
        <cylinderGeometry args={[0.08, 0.1, 3.4, 8]} />
        <meshStandardMaterial color="#172127" metalness={0.72} roughness={0.38} />
      </mesh>
      <mesh position={[0, 3.25, 0]}>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.4} />
      </mesh>
      <pointLight position={[0, 3.25, 0]} color={color} intensity={3.5} distance={9} />
      <Html center position={[0, 4.15, 0]} distanceFactor={22} style={{ pointerEvents: "none" }}>
        <div className="outlands-zone-label" style={{ borderColor: color }}><b>{title}</b><span>{subtitle}</span></div>
      </Html>
    </group>
  );
}

function AbandonedDepot() {
  return (
    <group position={[-40, 0, -210]}>
      <mesh receiveShadow position={[0, 0.03, 0]} userData={{ impactSurface: "concrete" }}>
        <boxGeometry args={[48, 0.06, 36]} />
        <meshStandardMaterial color="#59605b" roughness={0.96} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 3.2, -15]} userData={{ impactSurface: "concrete" }}>
        <boxGeometry args={[45, 6.4, 0.7]} />
        <meshStandardMaterial color="#6c746f" roughness={0.92} />
      </mesh>
      {[-21.5, 21.5].map((x) => (
        <mesh key={x} castShadow receiveShadow position={[x, 2.2, 0]} userData={{ impactSurface: "concrete" }}>
          <boxGeometry args={[0.7, 4.4, 30]} />
          <meshStandardMaterial color="#636a66" roughness={0.94} />
        </mesh>
      ))}
      {[-14, 0, 14].map((x, index) => (
        <group key={x} position={[x, 0, 4 + (index % 2) * 5]} userData={{ impactSurface: "metal" }}>
          <mesh castShadow position={[0, 2.3, 0]}>
            <boxGeometry args={[0.32, 4.6, 0.32]} />
            <meshStandardMaterial color="#29363b" metalness={0.75} roughness={0.42} />
          </mesh>
          <mesh castShadow position={[0, 4.45, 0]} rotation={[0, 0, index % 2 ? 0.22 : -0.18]}>
            <boxGeometry args={[9.5, 0.3, 0.3]} />
            <meshStandardMaterial color="#35454b" metalness={0.7} roughness={0.45} />
          </mesh>
        </group>
      ))}
      <StaticModel url="/assets/models/kenney-nature/tent_detailedOpen.glb" position={[13, 0, 7]} rotation={2.5} scale={1.7} surface="wood" />
      <StaticModel url="/assets/models/kenney-nature/log_stack.glb" position={[16, 0, 12]} rotation={1.1} scale={1.45} surface="wood" />
      <mesh castShadow position={[-10, 1.3, -5]} rotation={[0.08, 0.3, -0.13]} userData={{ impactSurface: "metal" }}>
        <boxGeometry args={[8, 2.6, 3.2]} />
        <meshStandardMaterial color="#4a5b60" metalness={0.5} roughness={0.58} />
      </mesh>
    </group>
  );
}

function Quarry() {
  const mountains = [
    [118, 9, -224, 18, 11, 16], [137, 13, -250, 23, 17, 21], [124, 8, -281, 19, 12, 18],
    [104, 7, -308, 16, 10, 14], [151, 18, -303, 29, 22, 24]
  ] as const;
  return (
    <group>
      <mesh receiveShadow position={[85, -0.03, -252]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <circleGeometry args={[56, 48]} />
        <meshStandardMaterial color="#9b6646" roughness={1} />
      </mesh>
      {mountains.map(([x, y, z, sx, sy, sz], index) => (
        <mesh key={index} castShadow receiveShadow position={[x, y - 2.5, z]} scale={[sx, sy, sz]} rotation={[0.08, index * 0.71, -0.06]} userData={{ impactSurface: "dirt" }}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={index % 2 ? "#80614f" : "#735344"} roughness={0.98} flatShading />
        </mesh>
      ))}
      <mesh receiveShadow position={[75, 0.05, -251]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[9, 13, 32]} />
        <meshBasicMaterial color="#ef9a5e" transparent opacity={0.32} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function OldCityRuins() {
  const blocks = [
    [-87, -275, 18, 7, 10], [-60, -274, 14, 11, 8], [-91, -301, 11, 15, 6], [-61, -306, 19, 8, 12]
  ] as const;
  return (
    <group>
      <mesh receiveShadow position={[-76, -0.025, -289]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "concrete" }}>
        <planeGeometry args={[76, 72]} />
        <meshStandardMaterial color="#5d625e" roughness={1} />
      </mesh>
      {blocks.map(([x, z, width, depth, height], index) => (
        <group key={index} position={[x, 0, z]} rotation={[0, index * 0.27 - 0.25, 0]}>
          <mesh castShadow receiveShadow position={[0, height / 2, -depth / 2]} userData={{ impactSurface: "concrete" }}>
            <boxGeometry args={[width, height, 0.55]} />
            <meshStandardMaterial color={index % 2 ? "#77746e" : "#686d69"} roughness={0.98} />
          </mesh>
          <mesh castShadow receiveShadow position={[-width / 2, height * 0.32, 0]} userData={{ impactSurface: "concrete" }}>
            <boxGeometry args={[0.55, height * 0.64, depth]} />
            <meshStandardMaterial color="#74716a" roughness={0.98} />
          </mesh>
          <mesh castShadow position={[width * 0.18, 1, depth * 0.05]} rotation={[0.2, 0.35, 0.42]} userData={{ impactSurface: "concrete" }}>
            <boxGeometry args={[width * 0.7, 0.45, 1.2]} />
            <meshStandardMaterial color="#545955" roughness={1} />
          </mesh>
        </group>
      ))}
      {[-3, -1, 1, 3].map((offset) => (
        <mesh key={offset} position={[-76 + offset * 4.2, 0.012, -289]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "asphalt" }}>
          <planeGeometry args={[2.2, 0.24]} />
          <meshBasicMaterial color="#d7d4a1" />
        </mesh>
      ))}
    </group>
  );
}

function LootChest({
  containerId,
  position,
  rotation,
  opened,
  nearby,
  activeExpedition,
  onClick
}: {
  containerId: string;
  position: readonly [number, number, number];
  rotation: number;
  opened: boolean;
  nearby: boolean;
  activeExpedition: boolean;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const gltf = useGLTF(LOOT_CHEST_MODEL_URL);
  const model = useMemo(() => {
    const clone = cloneSkeleton(gltf.scene);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return clone;
  }, [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, model);
  const mountedOpened = useRef(opened);

  useEffect(() => {
    const openAction = actions.Open;
    const idleAction = actions[opened ? "Idle_Open" : "Idle_Closed"];
    Object.values(actions).forEach((action) => action?.fadeOut(0.12));
    if (opened && !mountedOpened.current && openAction) {
      openAction.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.08).play();
      openAction.clampWhenFinished = true;
    } else {
      idleAction?.reset().fadeIn(0.12).play();
    }
    mountedOpened.current = opened;
  }, [actions, opened]);

  const definition = OUTLAND_CONTAINERS.find((container) => container.id === containerId);
  return (
    <group
      position={[position[0], position[1], position[2]]}
      rotation={[0, rotation, 0]}
      scale={1.18}
      userData={{ impactSurface: "metal", impactDynamic: true, lootContainerId: containerId }}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
    >
      <primitive object={model} />
      {!opened ? (
        <>
          <pointLight position={[0, 1.25, 0]} color={nearby ? "#63ffd0" : "#41c99f"} intensity={nearby ? 4.8 : 1.6} distance={nearby ? 7 : 3.5} />
          <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <ringGeometry args={[0.95, 1.18, 28]} />
            <meshBasicMaterial color={nearby ? "#72ffd5" : "#269c7a"} transparent opacity={nearby ? 0.7 : 0.28} side={THREE.DoubleSide} />
          </mesh>
        </>
      ) : null}
      {nearby ? (
        <Html center position={[0, 1.9, 0]} distanceFactor={12} style={{ pointerEvents: "none" }}>
          <div className="world-interact-label loot">
            <b>{opened ? "✓" : "E"}</b>
            <span>{opened ? "контейнер пуст" : activeExpedition ? `обыскать · ${definition?.name ?? "контейнер"}` : "сначала начните вылазку"}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

function robotAnimationName(kind: "eyeDrone" | "quadShell", motion: RobotMotion) {
  if (kind === "eyeDrone") {
    if (motion === "attack") return "Attack";
    if (motion === "hit" || motion === "death") return "Hit";
    if (motion === "walk" || motion === "run") return "Charging";
    return "Idle";
  }
  if (motion === "death") return "TurnOff";
  if (motion === "attack") return "Attack";
  if (motion === "hit") return "Hit";
  if (motion === "run") return "Run";
  if (motion === "walk") return "Walk";
  return "Idle";
}

export function OutlandsRobot({
  kind,
  username,
  displayName,
  position,
  rotationRef,
  motionRef,
  health,
  maxHealth,
  dead,
  faction,
  onCombatHit
}: OutlandsRobotProps) {
  const url = kind === "eyeDrone" ? EYE_DRONE_MODEL_URL : QUAD_SHELL_MODEL_URL;
  const gltf = useGLTF(url);
  const model = useMemo(() => {
    const clone = cloneSkeleton(gltf.scene);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return clone;
  }, [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, model);
  const groupRef = useRef<THREE.Group>(null);
  const lastAction = useRef<THREE.AnimationAction | null>(null);
  const startedAt = useRef(performance.now());

  useFrame(() => {
    const motion = motionRef.current;
    const action = actions[robotAnimationName(kind, motion)];
    if (action && lastAction.current !== action) {
      lastAction.current?.fadeOut(0.15);
      action.reset();
      if (motion === "death" || motion === "hit") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      action.fadeIn(0.15).play();
      lastAction.current = action;
    }
    const group = groupRef.current;
    if (!group) return;
    group.position.copy(position);
    group.rotation.y = rotationRef.current;
    if (kind === "eyeDrone") {
      const hover = dead ? 0.18 : 1.35 + Math.sin((performance.now() - startedAt.current) * 0.0022) * 0.12;
      group.position.y += hover;
      group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, dead ? 1.25 : 0, 0.1);
    } else {
      group.rotation.z = 0;
    }
  });

  const hitboxPosition: [number, number, number] = kind === "eyeDrone" ? [0, 0, 0] : [0, 0.82, 0];
  const hitboxSize: [number, number, number] = kind === "eyeDrone" ? [1.2, 1.1, 1.2] : [1.75, 1.6, 1.75];
  const healthPercent = Math.max(0, Math.min(100, health / maxHealth * 100));

  return (
    <group
      ref={groupRef}
      position={position}
      userData={{ playerUsername: username, impactSurface: "metal", impactDynamic: true }}
    >
      <primitive object={model} scale={kind === "eyeDrone" ? 1.25 : 1.08} />
      <mesh
        position={hitboxPosition}
        userData={{
          combatHitbox: true,
          combatUsername: username,
          bodyPart: "chest",
          boneName: "robot_core",
          combatRoot: model
        }}
        onClick={onCombatHit}
      >
        <boxGeometry args={hitboxSize} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html center position={[0, kind === "eyeDrone" ? 1.1 : 2.25, 0]} distanceFactor={14} style={{ pointerEvents: "none" }}>
        <div className={`outlands-enemy-label ${faction}${dead ? " dead" : ""}`}>
          <div><b>{displayName}</b><span>{faction === "neutral" ? "нейтральный" : dead ? "уничтожен" : "опасность"}</span></div>
          <i><em style={{ width: `${healthPercent}%` }} /></i>
        </div>
      </Html>
    </group>
  );
}

export function OutlandsEnvironment({
  activeExpedition,
  lootedContainerIds,
  nearbyContainerId,
  nearExtraction,
  onContainerClick
}: OutlandsEnvironmentProps) {
  return (
    <group>
      <mesh receiveShadow position={[0, -0.085, -201]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <planeGeometry args={[340, 262]} />
        <meshStandardMaterial color="#506d4d" roughness={1} />
      </mesh>
      <mesh receiveShadow position={[0, -0.07, -141]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <planeGeometry args={[300, 76]} />
        <meshStandardMaterial color="#3f6948" roughness={1} />
      </mesh>
      <mesh receiveShadow position={[0, -0.048, -201]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <planeGeometry args={[9.5, 262]} />
        <meshStandardMaterial color="#866e52" roughness={1} />
      </mesh>
      <mesh receiveShadow position={[0, -0.039, -201]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <planeGeometry args={[3.8, 262]} />
        <meshStandardMaterial color="#9e8766" roughness={1} />
      </mesh>

      <CheckpointGate activeExpedition={activeExpedition} nearExtraction={nearExtraction} />
      <AbandonedDepot />
      <Quarry />
      <OldCityRuins />

      <InstancedNature url="/assets/models/kenney-nature/tree_pineTallA.glb" transforms={FOREST_TREES_A} surface="wood" />
      <InstancedNature url="/assets/models/kenney-nature/tree_pineTallB.glb" transforms={FOREST_TREES_B} surface="wood" />
      <InstancedNature url="/assets/models/kenney-nature/tree_pineSmallC.glb" transforms={BORDER_TREES} surface="wood" />
      <InstancedNature url="/assets/models/kenney-nature/rock_largeB.glb" transforms={QUARRY_ROCKS_A} surface="dirt" />
      <InstancedNature url="/assets/models/kenney-nature/rock_largeE.glb" transforms={RUIN_ROCKS} surface="concrete" />

      <StaticModel url="/assets/models/kenney-nature/campfire_stones.glb" position={[11, 0, -137]} scale={1.7} surface="concrete" />
      <StaticModel url="/assets/models/kenney-nature/tent_detailedOpen.glb" position={[14, 0, -141]} rotation={-0.5} scale={1.55} surface="wood" />
      <pointLight position={[11, 1.05, -137]} color="#ff9c55" intensity={4.2} distance={9} />

      <ZoneMarker position={[11, 0, -116]} title="ХВОЙНЫЙ РУБЕЖ" subtitle="низкая угроза · ресурсы" color="#4ff0ad" />
      <ZoneMarker position={[-16, 0, -181]} title="ЗАБРОШЕННОЕ ДЕПО" subtitle="роботы · энергоблоки" color="#ffb45e" />
      <ZoneMarker position={[44, 0, -219]} title="КРАСНЫЙ КАРЬЕР" subtitle="высокая угроза · сплавы" color="#ff765e" />
      <ZoneMarker position={[-44, 0, -259]} title="СТАРЫЙ ГОРОД" subtitle="рейдеры · чертежи" color="#c887ff" />

      <mesh position={[EXTRACTION_POSITION[0], 0.021, EXTRACTION_POSITION[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[EXTRACTION_RADIUS - 0.45, EXTRACTION_RADIUS, 48]} />
        <meshBasicMaterial color={activeExpedition ? "#45ffc1" : "#8ca5a0"} transparent opacity={activeExpedition ? 0.58 : 0.25} side={THREE.DoubleSide} />
      </mesh>
      <pointLight position={[EXTRACTION_POSITION[0], 1.3, EXTRACTION_POSITION[2]]} color="#49ffc5" intensity={nearExtraction && activeExpedition ? 4.5 : 0.8} distance={12} />

      {OUTLAND_CONTAINERS.map((container) => (
        <LootChest
          key={container.id}
          containerId={container.id}
          position={container.position}
          rotation={container.rotation}
          opened={lootedContainerIds.has(container.id)}
          nearby={nearbyContainerId === container.id}
          activeExpedition={activeExpedition}
          onClick={(event) => onContainerClick(container.id, event)}
        />
      ))}
    </group>
  );
}
