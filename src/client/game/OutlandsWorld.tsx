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
  outlandsEnemyVisualVariant,
  type OutlandsEnemyVisualAttachment,
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

type OutlandsSurfaceTextures = {
  meadow: THREE.CanvasTexture;
  forestFloor: THREE.CanvasTexture;
  trail: THREE.CanvasTexture;
  quarry: THREE.CanvasTexture;
  depot: THREE.CanvasTexture;
  concrete: THREE.CanvasTexture;
  ruins: THREE.CanvasTexture;
  organicDetail: THREE.CanvasTexture;
  hardDetail: THREE.CanvasTexture;
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

type SurfacePattern = "grass" | "soil" | "track" | "concrete" | "rock" | "detail";

function createSurfaceTexture({
  seed,
  base,
  accents,
  repeat,
  pattern,
  dataTexture = false
}: {
  seed: number;
  base: string;
  accents: readonly string[];
  repeat: readonly [number, number];
  pattern: SurfacePattern;
  dataTexture?: boolean;
}) {
  const size = pattern === "detail" ? 96 : 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  const random = seededRandom(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  const fleckCount = pattern === "detail" ? 780 : 520;
  for (let index = 0; index < fleckCount; index += 1) {
    const radius = pattern === "rock" || pattern === "concrete"
      ? 0.35 + random() * 2.1
      : 0.25 + random() * 1.35;
    context.globalAlpha = 0.08 + random() * 0.32;
    context.fillStyle = accents[Math.floor(random() * accents.length)] ?? base;
    context.beginPath();
    context.arc(random() * size, random() * size, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.lineCap = "round";
  if (pattern === "grass") {
    for (let index = 0; index < 105; index += 1) {
      const x = random() * size;
      const y = random() * size;
      context.globalAlpha = 0.12 + random() * 0.24;
      context.strokeStyle = accents[index % accents.length] ?? base;
      context.lineWidth = 0.45 + random() * 0.8;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + (random() - 0.5) * 3.5, y - 2 - random() * 5);
      context.stroke();
    }
  } else if (pattern === "soil" || pattern === "track") {
    for (let index = 0; index < 36; index += 1) {
      context.globalAlpha = 0.09 + random() * 0.18;
      context.strokeStyle = accents[index % accents.length] ?? base;
      context.lineWidth = 0.8 + random() * 2.2;
      const y = random() * size;
      context.beginPath();
      context.moveTo(-8, y);
      context.bezierCurveTo(size * 0.25, y + (random() - 0.5) * 8, size * 0.72, y + (random() - 0.5) * 8, size + 8, y + (random() - 0.5) * 4);
      context.stroke();
    }
  } else if (pattern === "concrete" || pattern === "rock") {
    for (let index = 0; index < 18; index += 1) {
      let x = random() * size;
      let y = random() * size;
      context.globalAlpha = pattern === "concrete" ? 0.24 : 0.16;
      context.strokeStyle = accents[index % accents.length] ?? "#222222";
      context.lineWidth = 0.45 + random() * 0.7;
      context.beginPath();
      context.moveTo(x, y);
      for (let segment = 0; segment < 3 + Math.floor(random() * 4); segment += 1) {
        x += (random() - 0.5) * 15;
        y += 4 + random() * 11;
        context.lineTo(x, y);
      }
      context.stroke();
    }
  }
  context.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;
  texture.colorSpace = dataTexture ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function useOutlandsSurfaceTextures(): OutlandsSurfaceTextures {
  const textures = useMemo<OutlandsSurfaceTextures>(() => ({
    meadow: createSurfaceTexture({
      seed: 0x6a6d31,
      base: "#526f49",
      accents: ["#31593c", "#708253", "#9b8b55", "#243f32"],
      repeat: [42, 32],
      pattern: "grass"
    }),
    forestFloor: createSurfaceTexture({
      seed: 0x183d77,
      base: "#3f6747",
      accents: ["#294a37", "#5d744c", "#6f5d3e", "#9a8c61"],
      repeat: [38, 13],
      pattern: "grass"
    }),
    trail: createSurfaceTexture({
      seed: 0x8841a2,
      base: "#8d7657",
      accents: ["#5e5140", "#b4a078", "#6c604d", "#c4b28a"],
      repeat: [3, 54],
      pattern: "track"
    }),
    quarry: createSurfaceTexture({
      seed: 0x5c6f02,
      base: "#9a6748",
      accents: ["#704936", "#bd8056", "#5d463a", "#d19767"],
      repeat: [18, 18],
      pattern: "rock"
    }),
    depot: createSurfaceTexture({
      seed: 0x1559bd,
      base: "#5b625d",
      accents: ["#343d39", "#7d8176", "#4b534f", "#9c8c70"],
      repeat: [16, 12],
      pattern: "concrete"
    }),
    concrete: createSurfaceTexture({
      seed: 0x9e7103,
      base: "#70736c",
      accents: ["#393f3d", "#96958b", "#565c57", "#b2a78e"],
      repeat: [13, 4],
      pattern: "concrete"
    }),
    ruins: createSurfaceTexture({
      seed: 0x72c411,
      base: "#5b605c",
      accents: ["#2f3735", "#777870", "#876f58", "#aaa28f"],
      repeat: [20, 18],
      pattern: "concrete"
    }),
    organicDetail: createSurfaceTexture({
      seed: 0xbad321,
      base: "#888888",
      accents: ["#313131", "#5f5f5f", "#bcbcbc", "#e0e0e0"],
      repeat: [5, 5],
      pattern: "detail",
      dataTexture: true
    }),
    hardDetail: createSurfaceTexture({
      seed: 0x9942ca,
      base: "#999999",
      accents: ["#3d3d3d", "#666666", "#c9c9c9", "#eeeeee"],
      repeat: [7, 7],
      pattern: "rock",
      dataTexture: true
    })
  }), []);

  useEffect(() => () => {
    Object.values(textures).forEach((texture) => texture.dispose());
  }, [textures]);
  return textures;
}

type MaterialTreatment = {
  tint?: string;
  roughness?: number;
  metalness?: number;
  detailTexture?: THREE.Texture;
  bumpScale?: number;
  emissive?: string;
  emissiveIntensity?: number;
};

function cloneStyledMaterial(
  source: THREE.Material | THREE.Material[],
  treatment: MaterialTreatment
): THREE.Material | THREE.Material[] {
  if (Array.isArray(source)) {
    return source.map((material) => cloneStyledMaterial(material, treatment) as THREE.Material);
  }
  const material = source.clone();
  const tint = new THREE.Color(treatment.tint ?? "#ffffff");
  if (material instanceof THREE.MeshStandardMaterial) {
    material.color.multiply(tint);
    material.roughness = treatment.roughness ?? material.roughness;
    material.metalness = treatment.metalness ?? material.metalness;
    if (treatment.detailTexture) {
      material.bumpMap = treatment.detailTexture;
      material.bumpScale = treatment.bumpScale ?? 0.035;
    }
    if (treatment.emissive) {
      material.emissive.lerp(new THREE.Color(treatment.emissive), 0.72);
      material.emissiveIntensity = Math.max(material.emissiveIntensity, treatment.emissiveIntensity ?? 0.25);
    }
    material.envMapIntensity = Math.min(material.envMapIntensity, treatment.metalness ? 1.1 : 0.72);
  } else if (material instanceof THREE.MeshPhongMaterial) {
    material.color.multiply(tint);
    material.shininess = Math.min(material.shininess, treatment.metalness ? 70 : 18);
  } else if (material instanceof THREE.MeshBasicMaterial) {
    material.color.multiply(tint);
  }
  material.needsUpdate = true;
  return material;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else material.dispose();
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

// Kenney's trees are authored as compact diorama props. Scale them to a
// believable 7–13 metre canopy and use instancing to keep the denser forest
// inexpensive to render.
const FOREST_TREES_A = makeScatter(112, 0x71a11, [-145, 145], [-108, -190], 11, [3.25, 5.15]);
const FOREST_TREES_B = makeScatter(94, 0x9913f, [-150, 150], [-138, -232], 14, [2.9, 4.65]);
const BORDER_TREES = makeScatter(72, 0x4d991, [-160, 160], [-220, -324], 42, [2.65, 4.2]);
export const OUTLAND_TREE_BLOCKERS = [...FOREST_TREES_A, ...FOREST_TREES_B, ...BORDER_TREES].map((tree) => ({
  x: tree.position[0],
  z: tree.position[2],
  radius: THREE.MathUtils.clamp(tree.scale * 0.16, 0.46, 0.86)
}));
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

function InstancedNature({
  url,
  transforms,
  surface,
  tint = "#ffffff",
  roughness = 0.94,
  detailTexture,
  bumpScale = 0.025
}: {
  url: string;
  transforms: ScatterTransform[];
  surface: "wood" | "dirt" | "concrete";
  tint?: string;
  roughness?: number;
  detailTexture?: THREE.Texture;
  bumpScale?: number;
}) {
  const gltf = useGLTF(url);
  const parts = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const next: InstancedPart[] = [];
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      next.push({
        geometry: object.geometry,
        material: cloneStyledMaterial(object.material, {
          tint,
          roughness,
          metalness: 0,
          detailTexture,
          bumpScale
        }),
        baseMatrix: object.matrixWorld.clone()
      });
    });
    return next;
  }, [bumpScale, detailTexture, gltf.scene, roughness, tint]);

  useEffect(() => () => {
    parts.forEach((part) => disposeMaterial(part.material));
  }, [parts]);

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
  surface = "generic",
  tint = "#ffffff",
  roughness = 0.88,
  metalness = 0,
  detailTexture,
  bumpScale = 0.025
}: {
  url: string;
  position: [number, number, number];
  rotation?: number;
  scale?: number;
  surface?: "wood" | "dirt" | "concrete" | "metal" | "generic";
  tint?: string;
  roughness?: number;
  metalness?: number;
  detailTexture?: THREE.Texture;
  bumpScale?: number;
}) {
  const gltf = useGLTF(url);
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.material = cloneStyledMaterial(object.material, {
        tint,
        roughness,
        metalness,
        detailTexture,
        bumpScale
      });
    });
    return clone;
  }, [bumpScale, detailTexture, gltf.scene, metalness, roughness, tint]);

  useEffect(() => () => {
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) disposeMaterial(object.material);
    });
  }, [model]);

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

function AbandonedDepot({ textures }: { textures: OutlandsSurfaceTextures }) {
  return (
    <group position={[-40, 0, -210]}>
      <mesh receiveShadow position={[0, 0.03, 0]} userData={{ impactSurface: "concrete" }}>
        <boxGeometry args={[48, 0.06, 36]} />
        <meshStandardMaterial color="#ffffff" map={textures.depot} roughness={0.98} bumpMap={textures.hardDetail} bumpScale={0.018} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 3.2, -15]} userData={{ impactSurface: "concrete" }}>
        <boxGeometry args={[45, 6.4, 0.7]} />
        <meshStandardMaterial color="#ddd9cb" map={textures.concrete} roughness={0.96} bumpMap={textures.hardDetail} bumpScale={0.035} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.52, -14.58]} userData={{ impactSurface: "concrete" }}>
        <boxGeometry args={[44.4, 0.86, 0.08]} />
        <meshStandardMaterial color="#373f3d" map={textures.hardDetail} roughness={1} />
      </mesh>
      {[-21.5, 21.5].map((x) => (
        <mesh key={x} castShadow receiveShadow position={[x, 2.2, 0]} userData={{ impactSurface: "concrete" }}>
          <boxGeometry args={[0.7, 4.4, 30]} />
          <meshStandardMaterial color="#c4c0b3" map={textures.concrete} roughness={0.97} bumpMap={textures.hardDetail} bumpScale={0.03} />
        </mesh>
      ))}
      {[-14, 0, 14].map((x, index) => (
        <group key={x} position={[x, 0, 4 + (index % 2) * 5]} userData={{ impactSurface: "metal" }}>
          <mesh castShadow position={[0, 2.3, 0]}>
            <boxGeometry args={[0.32, 4.6, 0.32]} />
            <meshStandardMaterial color="#29363b" roughnessMap={textures.hardDetail} metalness={0.75} roughness={0.48} />
          </mesh>
          <mesh castShadow position={[0, 4.45, 0]} rotation={[0, 0, index % 2 ? 0.22 : -0.18]}>
            <boxGeometry args={[9.5, 0.3, 0.3]} />
            <meshStandardMaterial color="#35454b" roughnessMap={textures.hardDetail} metalness={0.7} roughness={0.5} />
          </mesh>
        </group>
      ))}
      <StaticModel
        url="/assets/models/kenney-nature/tent_detailedOpen.glb"
        position={[13, 0, 7]}
        rotation={2.5}
        scale={3.35}
        surface="wood"
        tint="#a9a488"
        roughness={0.98}
        detailTexture={textures.organicDetail}
        bumpScale={0.035}
      />
      <StaticModel
        url="/assets/models/kenney-nature/log_stack.glb"
        position={[17.5, 0, 12.5]}
        rotation={1.1}
        scale={2.15}
        surface="wood"
        tint="#8c735a"
        roughness={1}
        detailTexture={textures.organicDetail}
        bumpScale={0.055}
      />
      <mesh castShadow position={[-10, 1.3, -5]} rotation={[0.08, 0.3, -0.13]} userData={{ impactSurface: "metal" }}>
        <boxGeometry args={[8, 2.6, 3.2]} />
        <meshStandardMaterial color="#4a5b60" roughnessMap={textures.hardDetail} bumpMap={textures.hardDetail} bumpScale={0.018} metalness={0.5} roughness={0.62} />
      </mesh>
    </group>
  );
}

function Quarry({ textures }: { textures: OutlandsSurfaceTextures }) {
  const mountains = [
    [118, 9, -224, 18, 11, 16], [137, 13, -250, 23, 17, 21], [124, 8, -281, 19, 12, 18],
    [104, 7, -308, 16, 10, 14], [151, 18, -303, 29, 22, 24]
  ] as const;
  return (
    <group>
      <mesh receiveShadow position={[85, -0.03, -252]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <circleGeometry args={[56, 48]} />
        <meshStandardMaterial color="#ffffff" map={textures.quarry} roughness={1} bumpMap={textures.hardDetail} bumpScale={0.055} />
      </mesh>
      {mountains.map(([x, y, z, sx, sy, sz], index) => (
        <mesh key={index} castShadow receiveShadow position={[x, y - 2.5, z]} scale={[sx, sy, sz]} rotation={[0.08, index * 0.71, -0.06]} userData={{ impactSurface: "dirt" }}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial
            color={index % 2 ? "#8a6853" : "#755346"}
            roughnessMap={textures.hardDetail}
            bumpMap={textures.hardDetail}
            bumpScale={0.045}
            roughness={0.99}
            flatShading
          />
        </mesh>
      ))}
      <mesh receiveShadow position={[75, 0.05, -251]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[9, 13, 32]} />
        <meshBasicMaterial color="#ef9a5e" transparent opacity={0.32} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function OldCityRuins({ textures }: { textures: OutlandsSurfaceTextures }) {
  const blocks = [
    [-87, -275, 18, 7, 10], [-60, -274, 14, 11, 8], [-91, -301, 11, 15, 6], [-61, -306, 19, 8, 12]
  ] as const;
  return (
    <group>
      <mesh receiveShadow position={[-76, -0.025, -289]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "concrete" }}>
        <planeGeometry args={[76, 72]} />
        <meshStandardMaterial color="#ffffff" map={textures.ruins} roughness={1} bumpMap={textures.hardDetail} bumpScale={0.028} />
      </mesh>
      {blocks.map(([x, z, width, depth, height], index) => (
        <group key={index} position={[x, 0, z]} rotation={[0, index * 0.27 - 0.25, 0]}>
          <mesh castShadow receiveShadow position={[0, height / 2, -depth / 2]} userData={{ impactSurface: "concrete" }}>
            <boxGeometry args={[width, height, 0.55]} />
            <meshStandardMaterial
              color={index % 2 ? "#d2c9b9" : "#b9c0b9"}
              map={textures.concrete}
              bumpMap={textures.hardDetail}
              bumpScale={0.04}
              roughness={0.99}
            />
          </mesh>
          <mesh castShadow receiveShadow position={[-width / 2, height * 0.32, 0]} userData={{ impactSurface: "concrete" }}>
            <boxGeometry args={[0.55, height * 0.64, depth]} />
            <meshStandardMaterial color="#c1b9aa" map={textures.concrete} bumpMap={textures.hardDetail} bumpScale={0.04} roughness={0.99} />
          </mesh>
          <mesh castShadow position={[width * 0.18, 1, depth * 0.05]} rotation={[0.2, 0.35, 0.42]} userData={{ impactSurface: "concrete" }}>
            <boxGeometry args={[width * 0.7, 0.45, 1.2]} />
            <meshStandardMaterial color="#77766d" map={textures.concrete} bumpMap={textures.hardDetail} bumpScale={0.035} roughness={1} />
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
          {nearby ? (
            <mesh position={[0, 1.3, 0]} raycast={() => null}>
              <cylinderGeometry args={[0.035, 0.18, 2.8, 12, 1, true]} />
              <meshBasicMaterial color="#77ffda" transparent opacity={0.24} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          ) : null}
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

export function OutlandsEnemyVariantAttachments({
  enemyId,
  kind
}: {
  enemyId: string;
  kind: OutlandsEnemyKind;
}) {
  const visual = outlandsEnemyVisualVariant(enemyId, kind);
  const attachment: OutlandsEnemyVisualAttachment = visual.attachment;
  if (attachment === "none") return null;
  const shell = visual.tint;
  const accent = visual.accent;
  const glow = visual.emissive;
  const glowIntensity = visual.emissiveIntensity;

  if (attachment === "sensor-array") {
    return (
      <group userData={{ impactSurface: "metal" }}>
        <mesh castShadow position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <torusGeometry args={[0.53, 0.055, 8, 28]} />
          <meshStandardMaterial color={shell} metalness={0.82} roughness={0.28} />
        </mesh>
        {[-0.36, 0, 0.36].map((x, index) => (
          <group key={x} position={[x, 0.48 + (index % 2) * 0.12, 0]}>
            <mesh castShadow raycast={() => null}>
              <cylinderGeometry args={[0.025, 0.04, 0.58, 8]} />
              <meshStandardMaterial color={shell} metalness={0.88} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.32, 0]} raycast={() => null}>
              <sphereGeometry args={[0.09 + index * 0.012, 12, 9]} />
              <meshStandardMaterial color={accent} emissive={glow} emissiveIntensity={glowIntensity} metalness={0.32} roughness={0.22} />
            </mesh>
          </group>
        ))}
      </group>
    );
  }

  if (attachment === "thermal-fins") {
    return (
      <group userData={{ impactSurface: "metal" }}>
        {[-1, 1].flatMap((side) => [-0.28, 0.28].map((z, index) => (
          <mesh
            key={`${side}-${z}`}
            castShadow
            position={[side * 0.58, index ? 0.08 : -0.08, z]}
            rotation={[0, 0, side * (0.48 + index * 0.13)]}
            raycast={() => null}
          >
            <boxGeometry args={[0.11, 0.72, 0.36]} />
            <meshStandardMaterial color={index ? accent : shell} emissive={glow} emissiveIntensity={index ? glowIntensity * 0.42 : 0.08} metalness={0.72} roughness={0.31} />
          </mesh>
        )))}
        <mesh position={[0, -0.02, -0.57]} raycast={() => null}>
          <sphereGeometry args={[0.2, 14, 10]} />
          <meshStandardMaterial color={accent} emissive={glow} emissiveIntensity={glowIntensity * 1.35} roughness={0.18} />
        </mesh>
      </group>
    );
  }

  if (attachment === "bulwark-plates") {
    return (
      <group userData={{ impactSurface: "metal" }}>
        <mesh castShadow position={[0, 1.02, -0.72]} rotation={[-0.2, 0, 0]} raycast={() => null}>
          <boxGeometry args={[1.72, 0.78, 0.18]} />
          <meshStandardMaterial color={shell} metalness={0.68} roughness={0.39} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} castShadow position={[side * 0.82, 0.78, -0.12]} rotation={[0, side * 0.22, side * -0.12]} raycast={() => null}>
            <boxGeometry args={[0.38, 0.62, 1.25]} />
            <meshStandardMaterial color={shell} metalness={0.7} roughness={0.37} />
          </mesh>
        ))}
        <mesh position={[0, 1.05, -0.825]} raycast={() => null}>
          <boxGeometry args={[0.76, 0.11, 0.04]} />
          <meshStandardMaterial color={accent} emissive={glow} emissiveIntensity={glowIntensity} roughness={0.2} />
        </mesh>
      </group>
    );
  }

  if (attachment === "stalker-spines") {
    return (
      <group userData={{ impactSurface: "metal" }}>
        {[-0.64, -0.22, 0.22, 0.64].map((z, index) => (
          <mesh key={z} castShadow position={[0, 1.12 + Math.sin(index * 1.7) * 0.08, z]} rotation={[0.2 + index * 0.08, 0, 0]} raycast={() => null}>
            <coneGeometry args={[0.115, 0.68 - index * 0.055, 7]} />
            <meshStandardMaterial color={index % 2 ? accent : shell} emissive={glow} emissiveIntensity={index % 2 ? glowIntensity * 0.45 : 0.12} metalness={0.78} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[0, 0.86, -0.54]} raycast={() => null}>
          <sphereGeometry args={[0.13, 12, 9]} />
          <meshStandardMaterial color={accent} emissive={glow} emissiveIntensity={glowIntensity * 1.2} roughness={0.2} />
        </mesh>
      </group>
    );
  }

  if (attachment === "scout-rig") {
    return (
      <group userData={{ impactSurface: "metal" }}>
        <mesh castShadow position={[0, 1.18, 0.28]} raycast={() => null}>
          <boxGeometry args={[0.48, 0.7, 0.24]} />
          <meshStandardMaterial color={shell} roughness={0.72} metalness={0.22} />
        </mesh>
        <mesh castShadow position={[0.28, 1.73, 0.25]} rotation={[0, 0, -0.08]} raycast={() => null}>
          <cylinderGeometry args={[0.018, 0.025, 0.7, 7]} />
          <meshStandardMaterial color={accent} metalness={0.65} roughness={0.32} />
        </mesh>
        <mesh position={[0, 1.67, -0.24]} raycast={() => null}>
          <boxGeometry args={[0.42, 0.09, 0.06]} />
          <meshStandardMaterial color={accent} emissive={glow} emissiveIntensity={glowIntensity} roughness={0.18} />
        </mesh>
      </group>
    );
  }

  return (
    <group userData={{ impactSurface: "metal" }}>
      <mesh castShadow position={[0, 1.12, 0.31]} raycast={() => null}>
        <boxGeometry args={[0.7, 0.88, 0.32]} />
        <meshStandardMaterial color={shell} roughness={0.58} metalness={0.36} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} castShadow position={[side * 0.49, 1.48, -0.02]} rotation={[0, 0, side * 0.1]} raycast={() => null}>
          <boxGeometry args={[0.4, 0.34, 0.52]} />
          <meshStandardMaterial color={shell} metalness={0.48} roughness={0.48} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 1.2, -0.25]} raycast={() => null}>
        <boxGeometry args={[0.72, 0.55, 0.12]} />
        <meshStandardMaterial color={accent} emissive={glow} emissiveIntensity={glowIntensity * 0.22} metalness={0.52} roughness={0.42} />
      </mesh>
    </group>
  );
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
  const enemyId = username.startsWith("outlands:") ? username.slice("outlands:".length) : username;
  const visual = outlandsEnemyVisualVariant(enemyId, kind);
  const url = kind === "eyeDrone" ? EYE_DRONE_MODEL_URL : QUAD_SHELL_MODEL_URL;
  const gltf = useGLTF(url);
  const model = useMemo(() => {
    const clone = cloneSkeleton(gltf.scene);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.material = cloneStyledMaterial(object.material, {
        tint: visual.tint,
        roughness: kind === "eyeDrone" ? 0.34 : 0.43,
        metalness: kind === "eyeDrone" ? 0.62 : 0.55,
        emissive: visual.emissive,
        emissiveIntensity: visual.emissiveIntensity * 0.24
      });
    });
    return clone;
  }, [gltf.scene, kind, visual.emissive, visual.emissiveIntensity, visual.tint]);
  useEffect(() => () => {
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) disposeMaterial(object.material);
    });
  }, [model]);
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

  const baseModelScale = kind === "eyeDrone" ? 1.25 : 1.08;
  const variantScaleRatio = THREE.MathUtils.clamp(visual.modelScale / baseModelScale, 0.82, 1.36);
  const hitboxPosition: [number, number, number] = kind === "eyeDrone" ? [0, 0, 0] : [0, 0.82 * variantScaleRatio, 0];
  const baseHitboxSize: [number, number, number] = kind === "eyeDrone" ? [1.2, 1.1, 1.2] : [1.75, 1.6, 1.75];
  const hitboxSize = baseHitboxSize.map((value) => value * variantScaleRatio) as [number, number, number];
  const healthPercent = Math.max(0, Math.min(100, health / maxHealth * 100));

  return (
    <group
      ref={groupRef}
      position={position}
      userData={{ playerUsername: username, impactSurface: "metal", impactDynamic: true }}
    >
      <primitive object={model} scale={visual.modelScale} />
      <OutlandsEnemyVariantAttachments enemyId={enemyId} kind={kind} />
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
      <Html center position={[0, (kind === "eyeDrone" ? 1.1 : 2.25) * variantScaleRatio, 0]} distanceFactor={14} style={{ pointerEvents: "none" }}>
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
  const textures = useOutlandsSurfaceTextures();
  return (
    <group>
      <mesh receiveShadow position={[0, -0.085, -201]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <planeGeometry args={[340, 262]} />
        <meshStandardMaterial color="#ffffff" map={textures.meadow} roughness={1} bumpMap={textures.organicDetail} bumpScale={0.035} />
      </mesh>
      <mesh receiveShadow position={[0, -0.07, -141]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <planeGeometry args={[300, 76]} />
        <meshStandardMaterial color="#ffffff" map={textures.forestFloor} roughness={1} bumpMap={textures.organicDetail} bumpScale={0.045} />
      </mesh>
      <mesh receiveShadow position={[0, -0.048, -201]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <planeGeometry args={[9.5, 262]} />
        <meshStandardMaterial color="#9b8a6d" map={textures.trail} roughness={1} bumpMap={textures.hardDetail} bumpScale={0.032} />
      </mesh>
      <mesh receiveShadow position={[0, -0.039, -201]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <planeGeometry args={[3.8, 262]} />
        <meshStandardMaterial color="#c0aa82" map={textures.trail} roughness={0.98} bumpMap={textures.hardDetail} bumpScale={0.02} />
      </mesh>

      <CheckpointGate activeExpedition={activeExpedition} nearExtraction={nearExtraction} />
      <AbandonedDepot textures={textures} />
      <Quarry textures={textures} />
      <OldCityRuins textures={textures} />

      <InstancedNature
        url="/assets/models/kenney-nature/tree_pineTallA.glb"
        transforms={FOREST_TREES_A}
        surface="wood"
        tint="#bed4b7"
        roughness={0.98}
        detailTexture={textures.organicDetail}
        bumpScale={0.045}
      />
      <InstancedNature
        url="/assets/models/kenney-nature/tree_pineTallB.glb"
        transforms={FOREST_TREES_B}
        surface="wood"
        tint="#a8c5aa"
        roughness={0.99}
        detailTexture={textures.organicDetail}
        bumpScale={0.05}
      />
      <InstancedNature
        url="/assets/models/kenney-nature/tree_pineSmallC.glb"
        transforms={BORDER_TREES}
        surface="wood"
        tint="#96b49c"
        roughness={0.99}
        detailTexture={textures.organicDetail}
        bumpScale={0.055}
      />
      <InstancedNature
        url="/assets/models/kenney-nature/rock_largeB.glb"
        transforms={QUARRY_ROCKS_A}
        surface="dirt"
        tint="#b98f73"
        roughness={1}
        detailTexture={textures.hardDetail}
        bumpScale={0.07}
      />
      <InstancedNature
        url="/assets/models/kenney-nature/rock_largeE.glb"
        transforms={RUIN_ROCKS}
        surface="concrete"
        tint="#a5a69e"
        roughness={1}
        detailTexture={textures.hardDetail}
        bumpScale={0.065}
      />

      <mesh receiveShadow position={[13, -0.024, -140]} rotation={[-Math.PI / 2, 0, 0]} userData={{ impactSurface: "dirt" }}>
        <circleGeometry args={[10.5, 36]} />
        <meshStandardMaterial color="#9b7958" map={textures.quarry} roughness={1} bumpMap={textures.hardDetail} bumpScale={0.035} />
      </mesh>
      <StaticModel
        url="/assets/models/kenney-nature/campfire_stones.glb"
        position={[11, 0, -137]}
        scale={2.25}
        surface="concrete"
        tint="#b6a28c"
        roughness={1}
        detailTexture={textures.hardDetail}
        bumpScale={0.055}
      />
      <StaticModel
        url="/assets/models/kenney-nature/campfire_logs.glb"
        position={[11, 0.08, -137]}
        rotation={0.34}
        scale={1.85}
        surface="wood"
        tint="#9a6946"
        roughness={0.99}
        detailTexture={textures.organicDetail}
        bumpScale={0.05}
      />
      <StaticModel
        url="/assets/models/kenney-nature/tent_detailedOpen.glb"
        position={[15.5, 0, -142.5]}
        rotation={-0.5}
        scale={3.2}
        surface="wood"
        tint="#b9b18a"
        roughness={0.98}
        detailTexture={textures.organicDetail}
        bumpScale={0.035}
      />
      <StaticModel
        url="/assets/models/kenney-nature/log_stack.glb"
        position={[19.5, 0, -136.2]}
        rotation={-0.9}
        scale={1.8}
        surface="wood"
        tint="#936d4c"
        roughness={1}
        detailTexture={textures.organicDetail}
        bumpScale={0.055}
      />
      <pointLight position={[11, 1.35, -137]} color="#ff9c55" intensity={5.1} distance={11} />

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
