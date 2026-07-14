import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import type { WeaponKind } from "./combat";

export type ImpactSurface = "dirt" | "asphalt" | "concrete" | "wood" | "metal" | "glass" | "generic";

export type SurfaceImpactEffect = {
  id: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  incoming: THREE.Vector3;
  surface: ImpactSurface;
  weapon: WeaponKind;
  createdAt: number;
  duration: number;
};

export type SurfaceImpactMark = {
  id: number;
  surface: ImpactSurface;
  weapon: WeaponKind;
  geometry: THREE.BufferGeometry;
  anchor?: THREE.Object3D;
  instanced?: boolean;
};

type MuzzleFlashEffectProps = {
  id: number;
  point: THREE.Vector3;
  direction: THREE.Vector3;
  weapon: WeaponKind;
  color: string;
  createdAt: number;
};

type MuzzlePreset = {
  length: number;
  radius: number;
  flashLife: number;
  effectLife: number;
  sparkCount: number;
  smokeCount: number;
  lightIntensity: number;
  lightDistance: number;
};

type SurfacePreset = {
  dustCount: number;
  debrisCount: number;
  sparkCount: number;
  dustSpeed: number;
  debrisSpeed: number;
  sparkSpeed: number;
  dustColors: string[];
  debrisColors: string[];
  debrisShape: "chip" | "splinter" | "shard";
};

type DustParticle = {
  offset: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
};

type DebrisParticle = {
  offset: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: THREE.Quaternion;
  spinAxis: THREE.Vector3;
  spin: number;
  color: THREE.Color;
};

type SparkParticle = {
  offset: THREE.Vector3;
  velocity: THREE.Vector3;
  length: number;
  width: number;
};

const UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_FORWARD = new THREE.Vector3(0, 0, 1);
const MARK_FORWARD = new THREE.Vector3(0, 0, 1);
const GRAVITY = 9.81;

const IMPACT_MARK_TINTS: Record<ImpactSurface, string> = {
  dirt: "#aa8159",
  asphalt: "#8a9098",
  concrete: "#b8afa4",
  wood: "#bd8050",
  metal: "#c1c9ce",
  glass: "#d9f8ff",
  generic: "#aaa39a"
};

const MUZZLE_PRESETS: Record<WeaponKind, MuzzlePreset> = {
  pistol: {
    length: 0.28,
    radius: 0.085,
    flashLife: 0.07,
    effectLife: 0.34,
    sparkCount: 6,
    smokeCount: 2,
    lightIntensity: 12,
    lightDistance: 4.2
  },
  rifle: {
    length: 0.36,
    radius: 0.105,
    flashLife: 0.065,
    effectLife: 0.38,
    sparkCount: 9,
    smokeCount: 3,
    lightIntensity: 15,
    lightDistance: 4.8
  },
  rocket: {
    length: 0.58,
    radius: 0.17,
    flashLife: 0.12,
    effectLife: 0.58,
    sparkCount: 10,
    smokeCount: 6,
    lightIntensity: 19,
    lightDistance: 6.2
  },
  laser: {
    length: 0.3,
    radius: 0.07,
    flashLife: 0.085,
    effectLife: 0.25,
    sparkCount: 7,
    smokeCount: 0,
    lightIntensity: 13,
    lightDistance: 4.6
  },
  sniper: {
    length: 0.46,
    radius: 0.125,
    flashLife: 0.09,
    effectLife: 0.46,
    sparkCount: 10,
    smokeCount: 4,
    lightIntensity: 18,
    lightDistance: 5.5
  }
};

const SURFACE_PRESETS: Record<ImpactSurface, SurfacePreset> = {
  dirt: {
    dustCount: 9,
    debrisCount: 10,
    sparkCount: 0,
    dustSpeed: 0.85,
    debrisSpeed: 2.35,
    sparkSpeed: 0,
    dustColors: ["#8a6848", "#aa8159", "#6f593f"],
    debrisColors: ["#5c432f", "#765439", "#3f3528"],
    debrisShape: "chip"
  },
  asphalt: {
    dustCount: 6,
    debrisCount: 10,
    sparkCount: 3,
    dustSpeed: 0.72,
    debrisSpeed: 2.8,
    sparkSpeed: 4.8,
    dustColors: ["#5f646b", "#777b80", "#44484e"],
    debrisColors: ["#24282d", "#3b4046", "#15191d"],
    debrisShape: "chip"
  },
  concrete: {
    dustCount: 9,
    debrisCount: 9,
    sparkCount: 1,
    dustSpeed: 0.78,
    debrisSpeed: 2.65,
    sparkSpeed: 4.4,
    dustColors: ["#c8c0b2", "#a9a39a", "#ddd2c0"],
    debrisColors: ["#8d8880", "#bbb1a2", "#6e6a65"],
    debrisShape: "chip"
  },
  wood: {
    dustCount: 4,
    debrisCount: 12,
    sparkCount: 0,
    dustSpeed: 0.62,
    debrisSpeed: 3.05,
    sparkSpeed: 0,
    dustColors: ["#ae8251", "#c79b62", "#8d633b"],
    debrisColors: ["#9a6535", "#d0a064", "#704526"],
    debrisShape: "splinter"
  },
  metal: {
    dustCount: 2,
    debrisCount: 4,
    sparkCount: 16,
    dustSpeed: 0.5,
    debrisSpeed: 2.35,
    sparkSpeed: 7.2,
    dustColors: ["#656b70", "#8a8f92"],
    debrisColors: ["#3e4448", "#697177", "#252a2d"],
    debrisShape: "chip"
  },
  glass: {
    dustCount: 2,
    debrisCount: 14,
    sparkCount: 4,
    dustSpeed: 0.48,
    debrisSpeed: 3.6,
    sparkSpeed: 5.4,
    dustColors: ["#d7f6ff", "#a9dce8"],
    debrisColors: ["#c9f3ff", "#83cbdc", "#edfaff"],
    debrisShape: "shard"
  },
  generic: {
    dustCount: 6,
    debrisCount: 7,
    sparkCount: 2,
    dustSpeed: 0.7,
    debrisSpeed: 2.55,
    sparkSpeed: 4.5,
    dustColors: ["#8a847c", "#aaa39a", "#716c66"],
    debrisColors: ["#66615b", "#89827a", "#4b4844"],
    debrisShape: "chip"
  }
};

function deviceParticleScale() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return 1;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const lowConcurrency = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  return coarsePointer || lowConcurrency ? 0.58 : 1;
}

function scaledCount(count: number, scale: number) {
  if (count === 0) return 0;
  return Math.max(1, Math.round(count * scale));
}

function seedFrom(id: number, salt: number, weapon?: WeaponKind) {
  let seed = (Math.imul(id | 0, 0x45d9f3b) ^ Math.imul(salt, 0x27d4eb2d)) >>> 0;
  if (weapon) {
    for (let index = 0; index < weapon.length; index += 1) {
      seed = Math.imul(seed ^ weapon.charCodeAt(index), 16777619) >>> 0;
    }
  }
  return seed || 0x6d2b79f5;
}

function seededRandom(initialSeed: number) {
  let state = initialSeed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function safeDirection(source: THREE.Vector3, fallback = FALLBACK_FORWARD) {
  const direction = source.clone();
  if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 0.000001) return fallback.clone();
  return direction.normalize();
}

function tangentFrame(direction: THREE.Vector3) {
  const helper = Math.abs(direction.y) < 0.92 ? UP : new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(direction, helper).normalize();
  const bitangent = new THREE.Vector3().crossVectors(direction, tangent).normalize();
  return { tangent, bitangent };
}

function outwardVelocity(
  random: () => number,
  normal: THREE.Vector3,
  tangent: THREE.Vector3,
  bitangent: THREE.Vector3,
  speed: number,
  spread = 0.9
) {
  const velocity = normal.clone().multiplyScalar(speed * (0.58 + random() * 0.54));
  velocity.addScaledVector(tangent, (random() - 0.5) * speed * spread);
  velocity.addScaledVector(bitangent, (random() - 0.5) * speed * spread);
  velocity.y += speed * (0.08 + random() * 0.24);
  return velocity;
}

function configureDynamicMesh(mesh: THREE.InstancedMesh | null) {
  if (!mesh) return;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
}

function markRandom(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function traceIrregularDisc(
  context: CanvasRenderingContext2D,
  center: number,
  radius: number,
  points: number,
  wobble: number,
  seed: number
) {
  context.beginPath();
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const distance = radius * (1 - wobble * 0.5 + markRandom(seed + index * 7) * wobble);
    const x = center + Math.cos(angle) * distance;
    const y = center + Math.sin(angle) * distance;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

function createImpactMarkTexture(kind: "bullet" | "rocket") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  context.clearRect(0, 0, 128, 128);
  if (kind === "bullet") {
    const crater = context.createRadialGradient(61, 61, 3, 64, 64, 48);
    crater.addColorStop(0, "rgba(2, 2, 3, 1)");
    crater.addColorStop(0.18, "rgba(8, 7, 7, 1)");
    crater.addColorStop(0.34, "rgba(54, 49, 47, 0.98)");
    crater.addColorStop(0.52, "rgba(172, 163, 154, 0.76)");
    crater.addColorStop(0.7, "rgba(48, 43, 41, 0.48)");
    crater.addColorStop(1, "rgba(10, 9, 9, 0)");
    traceIrregularDisc(context, 64, 48, 28, 0.22, 17);
    context.fillStyle = crater;
    context.fill();

    context.lineCap = "round";
    for (let index = 0; index < 9; index += 1) {
      const angle = (index / 9) * Math.PI * 2 + markRandom(index + 91) * 0.34;
      const start = 28 + markRandom(index + 121) * 7;
      const bend = (markRandom(index + 151) - 0.5) * 0.22;
      const end = 46 + markRandom(index + 181) * 13;
      context.beginPath();
      context.moveTo(64 + Math.cos(angle) * start, 64 + Math.sin(angle) * start);
      context.lineTo(64 + Math.cos(angle + bend) * end, 64 + Math.sin(angle + bend) * end);
      context.strokeStyle = `rgba(32, 29, 28, ${0.32 + markRandom(index + 211) * 0.34})`;
      context.lineWidth = 1.1 + markRandom(index + 241) * 1.3;
      context.stroke();
    }

    traceIrregularDisc(context, 63, 13, 15, 0.3, 307);
    context.fillStyle = "rgba(0, 0, 1, 0.96)";
    context.fill();
  } else {
    const scorch = context.createRadialGradient(59, 58, 5, 64, 64, 61);
    scorch.addColorStop(0, "rgba(5, 4, 4, 0.98)");
    scorch.addColorStop(0.28, "rgba(13, 10, 9, 0.96)");
    scorch.addColorStop(0.52, "rgba(48, 32, 23, 0.86)");
    scorch.addColorStop(0.75, "rgba(102, 62, 34, 0.5)");
    scorch.addColorStop(1, "rgba(28, 20, 17, 0)");
    traceIrregularDisc(context, 64, 61, 36, 0.2, 401);
    context.fillStyle = scorch;
    context.fill();

    for (let index = 0; index < 38; index += 1) {
      const angle = markRandom(index + 451) * Math.PI * 2;
      const distance = 12 + Math.sqrt(markRandom(index + 487)) * 46;
      const radius = 0.8 + markRandom(index + 521) * 2.4;
      context.beginPath();
      context.arc(64 + Math.cos(angle) * distance, 64 + Math.sin(angle) * distance, radius, 0, Math.PI * 2);
      context.fillStyle = index % 7 === 0
        ? `rgba(177, 74, 25, ${0.24 + markRandom(index + 557) * 0.24})`
        : `rgba(4, 3, 3, ${0.28 + markRandom(index + 593) * 0.42})`;
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function impactMarkSize(mark: Pick<SurfaceImpactMark, "id" | "surface" | "weapon">) {
  const baseSize: Record<WeaponKind, number> = {
    pistol: 0.075,
    rifle: 0.068,
    rocket: 0.92,
    laser: 0.09,
    sniper: 0.13
  };
  const surfaceScale = mark.surface === "dirt" || mark.surface === "asphalt"
    ? 1.18
    : mark.surface === "glass"
      ? 1.22
      : mark.surface === "metal" && mark.weapon === "rocket"
        ? 0.72
        : 1;
  return baseSize[mark.weapon] * surfaceScale * (0.86 + markRandom(mark.id * 19 + 7) * 0.3);
}

function facingDecalGeometry(source: THREE.BufferGeometry, facingNormal: THREE.Vector3) {
  const positions = source.getAttribute("position");
  const normals = source.getAttribute("normal");
  const uvs = source.getAttribute("uv");
  const nextPositions: number[] = [];
  const nextNormals: number[] = [];
  const nextUvs: number[] = [];
  const faceNormal = new THREE.Vector3();
  const first = new THREE.Vector3();
  const second = new THREE.Vector3();
  const third = new THREE.Vector3();

  for (let index = 0; index < positions.count; index += 3) {
    first.fromBufferAttribute(positions, index);
    second.fromBufferAttribute(positions, index + 1);
    third.fromBufferAttribute(positions, index + 2);
    if (normals) {
      faceNormal.set(0, 0, 0);
      for (let offset = 0; offset < 3; offset += 1) {
        faceNormal.x += normals.getX(index + offset);
        faceNormal.y += normals.getY(index + offset);
        faceNormal.z += normals.getZ(index + offset);
      }
      faceNormal.normalize();
    } else {
      faceNormal.subVectors(second, first).cross(third.clone().sub(first)).normalize();
    }
    if (faceNormal.dot(facingNormal) <= 0.3) continue;

    for (let offset = 0; offset < 3; offset += 1) {
      const vertexIndex = index + offset;
      nextPositions.push(positions.getX(vertexIndex), positions.getY(vertexIndex), positions.getZ(vertexIndex));
      if (normals) {
        nextNormals.push(normals.getX(vertexIndex), normals.getY(vertexIndex), normals.getZ(vertexIndex));
      } else {
        nextNormals.push(faceNormal.x, faceNormal.y, faceNormal.z);
      }
      nextUvs.push(uvs.getX(vertexIndex), uvs.getY(vertexIndex));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(nextPositions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nextNormals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(nextUvs, 2));
  return geometry;
}

export function createSurfaceImpactMark({
  id,
  target,
  pointWorld,
  normalWorld,
  surface,
  weapon,
  coordinateRoot,
  anchor,
  sizeScale = 1,
  instanced = false
}: {
  id: number;
  target: THREE.Object3D;
  pointWorld: THREE.Vector3;
  normalWorld: THREE.Vector3;
  surface: ImpactSurface;
  weapon: WeaponKind;
  coordinateRoot: THREE.Object3D;
  anchor?: THREE.Object3D;
  sizeScale?: number;
  instanced?: boolean;
}): SurfaceImpactMark | null {
  if (!(target instanceof THREE.Mesh) || !target.geometry?.getAttribute("position")) return null;
  target.updateWorldMatrix(true, false);
  coordinateRoot.updateWorldMatrix(true, false);
  anchor?.updateWorldMatrix(true, false);

  const normal = safeDirection(normalWorld, UP);
  const markInfo = { id, surface, weapon };
  const radius = impactMarkSize(markInfo) * THREE.MathUtils.clamp(sizeScale, 0.2, 2);
  const orientation = new THREE.Quaternion().setFromUnitVectors(MARK_FORWARD, normal);
  orientation.multiply(
    new THREE.Quaternion().setFromAxisAngle(MARK_FORWARD, markRandom(id * 37 + 11) * Math.PI * 2)
  );
  const projectorPosition = pointWorld.clone().addScaledVector(normal, 0.002);
  const projectorSize = new THREE.Vector3(radius * 2, radius * 2, weapon === "rocket" ? 0.1 : 0.038);
  const projected = new DecalGeometry(
    target,
    projectorPosition,
    new THREE.Euler().setFromQuaternion(orientation),
    projectorSize
  );
  const clipped = facingDecalGeometry(projected, normal);
  projected.dispose();
  if (clipped.getAttribute("position").count === 0) {
    clipped.dispose();
    return null;
  }

  const coordinateSpace = anchor ?? coordinateRoot;
  coordinateSpace.updateWorldMatrix(true, false);
  clipped.applyMatrix4(coordinateSpace.matrixWorld.clone().invert());
  return { id, surface, weapon, geometry: clipped, anchor, instanced };
}

type ImpactMarkBatchEntry = {
  mark: SurfaceImpactMark;
  start: number;
  count: number;
};

type ImpactMarkBatch = {
  geometry: THREE.BufferGeometry;
  entries: ImpactMarkBatchEntry[];
};

function buildImpactMarkBatch(marks: SurfaceImpactMark[]): ImpactMarkBatch {
  const entries: ImpactMarkBatchEntry[] = [];
  let vertexCount = 0;
  for (const mark of marks) {
    const count = mark.geometry.getAttribute("position").count;
    entries.push({ mark, start: vertexCount, count });
    vertexCount += count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const tint = new THREE.Color();
  for (const entry of entries) {
    const sourcePosition = entry.mark.geometry.getAttribute("position");
    const sourceUv = entry.mark.geometry.getAttribute("uv");
    tint.set(IMPACT_MARK_TINTS[entry.mark.surface]);
    for (let index = 0; index < entry.count; index += 1) {
      const targetIndex = entry.start + index;
      positions[targetIndex * 3] = sourcePosition.getX(index);
      positions[targetIndex * 3 + 1] = sourcePosition.getY(index);
      positions[targetIndex * 3 + 2] = sourcePosition.getZ(index);
      uvs[targetIndex * 2] = sourceUv.getX(index);
      uvs[targetIndex * 2 + 1] = sourceUv.getY(index);
      colors[targetIndex * 3] = tint.r;
      colors[targetIndex * 3 + 1] = tint.g;
      colors[targetIndex * 3 + 2] = tint.b;
    }
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  if (marks.some((mark) => mark.anchor)) {
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
  }
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return { geometry, entries };
}

export function SurfaceImpactMarks({ marks }: { marks: SurfaceImpactMark[] }) {
  const bulletRef = useRef<THREE.Mesh>(null);
  const rocketRef = useRef<THREE.Mesh>(null);
  const bulletTexture = useMemo(() => createImpactMarkTexture("bullet"), []);
  const rocketTexture = useMemo(() => createImpactMarkTexture("rocket"), []);
  const textureEffectGeneration = useRef(0);
  const bulletMarks = useMemo(() => marks.filter((mark) => mark.weapon !== "rocket"), [marks]);
  const rocketMarks = useMemo(() => marks.filter((mark) => mark.weapon === "rocket"), [marks]);
  const bulletBatch = useMemo(() => buildImpactMarkBatch(bulletMarks), [bulletMarks]);
  const rocketBatch = useMemo(() => buildImpactMarkBatch(rocketMarks), [rocketMarks]);
  const hasDynamicMarks = useMemo(() => marks.some((mark) => mark.anchor), [marks]);
  const mountedRef = useRef(false);
  const currentGeometryRef = useRef({ bullet: bulletBatch.geometry, rocket: rocketBatch.geometry });
  currentGeometryRef.current = { bullet: bulletBatch.geometry, rocket: rocketBatch.geometry };
  const scratch = useMemo(() => ({
    inverseRoot: new THREE.Matrix4(),
    transform: new THREE.Matrix4(),
    position: new THREE.Vector3()
  }), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const generation = ++textureEffectGeneration.current;
    return () => {
      queueMicrotask(() => {
        if (textureEffectGeneration.current !== generation) return;
        bulletTexture.dispose();
        rocketTexture.dispose();
      });
    };
  }, [bulletTexture, rocketTexture]);

  useEffect(() => {
    const geometry = bulletBatch.geometry;
    return () => {
      queueMicrotask(() => {
        if (!mountedRef.current || currentGeometryRef.current.bullet !== geometry) geometry.dispose();
      });
    };
  }, [bulletBatch.geometry]);

  useEffect(() => {
    const geometry = rocketBatch.geometry;
    return () => {
      queueMicrotask(() => {
        if (!mountedRef.current || currentGeometryRef.current.rocket !== geometry) geometry.dispose();
      });
    };
  }, [rocketBatch.geometry]);

  const updateDynamicGeometry = useCallback((mesh: THREE.Mesh | null, batch: ImpactMarkBatch) => {
    if (!mesh?.parent) return;
    mesh.parent.updateWorldMatrix(true, false);
    scratch.inverseRoot.copy(mesh.parent.matrixWorld).invert();
    const outputPosition = batch.geometry.getAttribute("position") as THREE.BufferAttribute;
    outputPosition.clearUpdateRanges();
    let changed = false;

    for (const entry of batch.entries) {
      if (!entry.mark.anchor) continue;
      const sourcePosition = entry.mark.geometry.getAttribute("position");
      const anchor = entry.mark.anchor;
      if (anchor.parent) {
        anchor.updateWorldMatrix(true, false);
        scratch.transform.multiplyMatrices(scratch.inverseRoot, anchor.matrixWorld);
        for (let index = 0; index < entry.count; index += 1) {
          scratch.position.fromBufferAttribute(sourcePosition, index).applyMatrix4(scratch.transform);
          outputPosition.setXYZ(entry.start + index, scratch.position.x, scratch.position.y, scratch.position.z);
        }
      } else {
        for (let index = 0; index < entry.count; index += 1) {
          outputPosition.setXYZ(entry.start + index, 0, 0, 0);
        }
      }
      outputPosition.addUpdateRange(entry.start * 3, entry.count * 3);
      changed = true;
    }

    if (changed) {
      outputPosition.needsUpdate = true;
    }
  }, [scratch]);

  const updateDynamicBatches = useCallback(() => {
    updateDynamicGeometry(bulletRef.current, bulletBatch);
    updateDynamicGeometry(rocketRef.current, rocketBatch);
  }, [bulletBatch, rocketBatch, updateDynamicGeometry]);

  useLayoutEffect(() => {
    updateDynamicBatches();
  }, [updateDynamicBatches]);

  useFrame(() => {
    if (hasDynamicMarks) updateDynamicBatches();
  });

  return (
    <>
      <mesh ref={bulletRef} geometry={bulletBatch.geometry} frustumCulled={false} renderOrder={2} raycast={() => null}>
        <meshBasicMaterial
          map={bulletTexture}
          vertexColors
          transparent
          alphaTest={0.035}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-4}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={rocketRef} geometry={rocketBatch.geometry} frustumCulled={false} renderOrder={2} raycast={() => null}>
        <meshBasicMaterial
          map={rocketTexture}
          vertexColors
          transparent
          alphaTest={0.025}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-4}
          toneMapped={false}
        />
      </mesh>
    </>
  );
}

export function MuzzleFlashEffect({
  id,
  point,
  direction: directionSource,
  weapon,
  color,
  createdAt
}: MuzzleFlashEffectProps) {
  const rootRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Group>(null);
  const sparksRef = useRef<THREE.InstancedMesh>(null);
  const smokeRef = useRef<THREE.InstancedMesh>(null);
  const coreMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const shellMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const sparkMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const smokeMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const preset = MUZZLE_PRESETS[weapon];
  const budgetScale = useMemo(deviceParticleScale, []);
  const direction = useMemo(() => safeDirection(directionSource), [directionSource]);
  const orientation = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(UP, direction),
    [direction]
  );
  const frame = useMemo(() => tangentFrame(direction), [direction]);
  const sparkCount = scaledCount(preset.sparkCount, budgetScale);
  const smokeCount = scaledCount(preset.smokeCount, budgetScale);
  const particles = useMemo(() => {
    const random = seededRandom(seedFrom(id, 31, weapon));
    const sparks: SparkParticle[] = Array.from({ length: sparkCount }, () => {
      const velocity = direction.clone().multiplyScalar(1.8 + random() * 3.4)
        .addScaledVector(frame.tangent, (random() - 0.5) * 2.8)
        .addScaledVector(frame.bitangent, (random() - 0.5) * 2.8);
      return {
        offset: direction.clone().multiplyScalar(0.03 + random() * preset.length * 0.34),
        velocity,
        length: 0.045 + random() * 0.095,
        width: 0.006 + random() * 0.009
      };
    });
    const smoke: DustParticle[] = Array.from({ length: smokeCount }, () => ({
      offset: direction.clone().multiplyScalar(preset.length * (0.15 + random() * 0.42))
        .addScaledVector(frame.tangent, (random() - 0.5) * preset.radius * 0.6)
        .addScaledVector(frame.bitangent, (random() - 0.5) * preset.radius * 0.6),
      velocity: direction.clone().multiplyScalar(0.16 + random() * 0.28)
        .addScaledVector(frame.tangent, (random() - 0.5) * 0.22)
        .addScaledVector(frame.bitangent, (random() - 0.5) * 0.22)
        .addScaledVector(UP, 0.18 + random() * 0.28),
      radius: 0.035 + random() * 0.055
    }));
    return { sparks, smoke };
  }, [direction, frame.bitangent, frame.tangent, id, preset.length, preset.radius, smokeCount, sparkCount, weapon]);
  const scratch = useMemo(() => ({
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    identity: new THREE.Quaternion()
  }), []);

  useEffect(() => {
    configureDynamicMesh(sparksRef.current);
    configureDynamicMesh(smokeRef.current);
  }, []);

  useFrame(() => {
    const elapsed = Math.max(0, (performance.now() - createdAt) / 1000);
    const root = rootRef.current;
    if (root) root.visible = elapsed < preset.effectLife;
    if (elapsed >= preset.effectLife) return;

    const flashProgress = THREE.MathUtils.clamp(elapsed / preset.flashLife, 0, 1);
    const flashStrength = Math.pow(1 - flashProgress, 2);
    if (flashRef.current) {
      flashRef.current.visible = flashStrength > 0.001;
      const pulse = 0.82 + Math.sin(flashProgress * Math.PI) * 0.42;
      flashRef.current.scale.set(pulse, 0.75 + pulse * 0.25, pulse);
    }
    if (coreMaterialRef.current) coreMaterialRef.current.opacity = flashStrength;
    if (shellMaterialRef.current) shellMaterialRef.current.opacity = flashStrength * 0.9;
    if (lightRef.current) {
      lightRef.current.visible = flashProgress < 1;
      lightRef.current.intensity = preset.lightIntensity * flashStrength;
    }

    const sparkLife = Math.min(0.24, preset.effectLife * 0.68);
    const sparkProgress = THREE.MathUtils.clamp(elapsed / sparkLife, 0, 1);
    if (sparksRef.current) sparksRef.current.visible = sparkProgress < 1;
    particles.sparks.forEach((particle, index) => {
      scratch.position.copy(particle.offset)
        .addScaledVector(particle.velocity, elapsed)
        .addScaledVector(UP, -1.6 * elapsed * elapsed);
      const velocity = scratch.scale.copy(particle.velocity).addScaledVector(UP, -3.2 * elapsed);
      scratch.quaternion.setFromUnitVectors(UP, velocity.normalize());
      scratch.scale.set(
        particle.width * (1 - sparkProgress),
        particle.length * (1 - sparkProgress * 0.72),
        particle.width * (1 - sparkProgress)
      );
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      sparksRef.current?.setMatrixAt(index, scratch.matrix);
    });
    if (sparksRef.current) sparksRef.current.instanceMatrix.needsUpdate = true;
    if (sparkMaterialRef.current) sparkMaterialRef.current.opacity = (1 - sparkProgress) * 0.95;

    const smokeStart = preset.flashLife * 0.45;
    const smokeProgress = THREE.MathUtils.clamp((elapsed - smokeStart) / Math.max(0.01, preset.effectLife - smokeStart), 0, 1);
    if (smokeRef.current) smokeRef.current.visible = smokeProgress < 1;
    particles.smoke.forEach((particle, index) => {
      const smokeElapsed = Math.max(0, elapsed - smokeStart);
      scratch.position.copy(particle.offset).addScaledVector(particle.velocity, smokeElapsed);
      const radius = elapsed < smokeStart ? 0 : particle.radius * (0.55 + smokeProgress * 2.4);
      scratch.scale.setScalar(radius * (1 - Math.pow(smokeProgress, 3) * 0.35));
      scratch.matrix.compose(scratch.position, scratch.identity, scratch.scale);
      smokeRef.current?.setMatrixAt(index, scratch.matrix);
    });
    if (smokeRef.current) smokeRef.current.instanceMatrix.needsUpdate = true;
    if (smokeMaterialRef.current) smokeMaterialRef.current.opacity = (1 - smokeProgress) * 0.26;
  });

  const flameColor = weapon === "laser" ? color : "#ff9f2f";
  const coreColor = weapon === "laser" ? "#dffcff" : "#fff8cf";

  return (
    <group ref={rootRef} position={point}>
      <group ref={flashRef} quaternion={orientation}>
        <mesh position={[0, preset.length * 0.5, 0]} raycast={() => null}>
          <coneGeometry args={[preset.radius, preset.length, 9, 1, true]} />
          <meshBasicMaterial
            ref={shellMaterialRef}
            color={flameColor}
            transparent
            opacity={0.9}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, preset.length * 0.22, 0]} scale={[preset.radius * 0.72, preset.length * 0.42, preset.radius * 0.72]} raycast={() => null}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial
            ref={coreMaterialRef}
            color={coreColor}
            transparent
            opacity={1}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </group>
      {sparkCount > 0 ? (
        <instancedMesh ref={sparksRef} args={[undefined, undefined, sparkCount]} frustumCulled={false} raycast={() => null}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            ref={sparkMaterialRef}
            color={weapon === "laser" ? color : "#ffd166"}
            transparent
            opacity={0.95}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </instancedMesh>
      ) : null}
      {smokeCount > 0 ? (
        <instancedMesh ref={smokeRef} args={[undefined, undefined, smokeCount]} frustumCulled={false} raycast={() => null}>
          <icosahedronGeometry args={[1, 1]} />
          <meshBasicMaterial ref={smokeMaterialRef} color="#6b7078" transparent opacity={0.26} depthWrite={false} />
        </instancedMesh>
      ) : null}
      <pointLight
        ref={lightRef}
        color={weapon === "laser" ? color : "#ffb347"}
        intensity={0}
        distance={preset.lightDistance}
        decay={2}
        castShadow={false}
      />
    </group>
  );
}

export function SurfaceImpactEffectView({ effect }: { effect: SurfaceImpactEffect }) {
  const rootRef = useRef<THREE.Group>(null);
  const dustRef = useRef<THREE.InstancedMesh>(null);
  const debrisRef = useRef<THREE.InstancedMesh>(null);
  const sparksRef = useRef<THREE.InstancedMesh>(null);
  const dustMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const debrisMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const sparkMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const preset = SURFACE_PRESETS[effect.surface];
  const budgetScale = useMemo(deviceParticleScale, []);
  const dustCount = scaledCount(preset.dustCount, budgetScale);
  const debrisCount = scaledCount(preset.debrisCount, budgetScale);
  const sparkCount = scaledCount(preset.sparkCount, budgetScale);
  const impactFrame = useMemo(() => {
    const incoming = safeDirection(effect.incoming);
    const normal = safeDirection(effect.normal, incoming.clone().multiplyScalar(-1));
    if (normal.dot(incoming) > 0) normal.multiplyScalar(-1);
    return { incoming, normal, ...tangentFrame(normal) };
  }, [effect.incoming, effect.normal]);
  const particles = useMemo(() => {
    const random = seededRandom(seedFrom(effect.id, 79, effect.weapon));
    const dust: DustParticle[] = Array.from({ length: dustCount }, () => ({
      offset: impactFrame.normal.clone().multiplyScalar(0.012 + random() * 0.025)
        .addScaledVector(impactFrame.tangent, (random() - 0.5) * 0.09)
        .addScaledVector(impactFrame.bitangent, (random() - 0.5) * 0.09),
      velocity: outwardVelocity(
        random,
        impactFrame.normal,
        impactFrame.tangent,
        impactFrame.bitangent,
        preset.dustSpeed,
        1.15
      ),
      radius: 0.035 + random() * 0.075
    }));
    const debris: DebrisParticle[] = Array.from({ length: debrisCount }, (_, index) => {
      const baseSize = 0.018 + random() * 0.035;
      const scale = preset.debrisShape === "splinter"
        ? new THREE.Vector3(baseSize * 0.38, baseSize * (2.5 + random() * 3.2), baseSize * 0.45)
        : preset.debrisShape === "shard"
          ? new THREE.Vector3(baseSize * (0.8 + random()), baseSize * (1.5 + random() * 2), baseSize * 0.16)
          : new THREE.Vector3(baseSize * (0.7 + random() * 0.7), baseSize * (0.6 + random()), baseSize * (0.7 + random() * 0.7));
      const spinAxis = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5);
      if (spinAxis.lengthSq() < 0.0001) spinAxis.copy(UP);
      spinAxis.normalize();
      return {
        offset: impactFrame.normal.clone().multiplyScalar(0.015 + random() * 0.025),
        velocity: outwardVelocity(
          random,
          impactFrame.normal,
          impactFrame.tangent,
          impactFrame.bitangent,
          preset.debrisSpeed * (0.72 + random() * 0.55),
          1.25
        ),
        scale,
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI)),
        spinAxis,
        spin: (4.5 + random() * 11) * (index % 2 === 0 ? 1 : -1),
        color: new THREE.Color(preset.debrisColors[Math.floor(random() * preset.debrisColors.length)])
      };
    });
    const sparks: SparkParticle[] = Array.from({ length: sparkCount }, () => ({
      offset: impactFrame.normal.clone().multiplyScalar(0.018 + random() * 0.018),
      velocity: outwardVelocity(
        random,
        impactFrame.normal,
        impactFrame.tangent,
        impactFrame.bitangent,
        preset.sparkSpeed * (0.72 + random() * 0.65),
        1.45
      ),
      length: 0.05 + random() * 0.14,
      width: 0.005 + random() * 0.009
    }));
    return { dust, debris, sparks };
  }, [debrisCount, dustCount, effect.id, effect.weapon, impactFrame.bitangent, impactFrame.normal, impactFrame.tangent, preset, sparkCount]);
  const scratch = useMemo(() => ({
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    spinQuaternion: new THREE.Quaternion(),
    identity: new THREE.Quaternion()
  }), []);

  useEffect(() => {
    configureDynamicMesh(dustRef.current);
    configureDynamicMesh(debrisRef.current);
    configureDynamicMesh(sparksRef.current);
    particles.debris.forEach((particle, index) => debrisRef.current?.setColorAt(index, particle.color));
    if (debrisRef.current?.instanceColor) debrisRef.current.instanceColor.needsUpdate = true;
  }, [particles.debris]);

  useFrame(() => {
    const elapsed = Math.max(0, (performance.now() - effect.createdAt) / 1000);
    const lifetime = Math.max(0.12, effect.duration / 1000) * (budgetScale < 1 ? 0.72 : 1);
    const progress = THREE.MathUtils.clamp(elapsed / lifetime, 0, 1);
    if (rootRef.current) rootRef.current.visible = progress < 1;
    if (progress >= 1) return;

    const dustProgress = THREE.MathUtils.clamp(elapsed / Math.min(lifetime, 0.72), 0, 1);
    if (dustRef.current) dustRef.current.visible = dustProgress < 1;
    particles.dust.forEach((particle, index) => {
      scratch.position.copy(particle.offset).addScaledVector(particle.velocity, elapsed);
      scratch.position.y += elapsed * elapsed * 0.18;
      const growth = 0.55 + dustProgress * 2.7;
      const collapse = 1 - Math.pow(dustProgress, 3) * 0.72;
      scratch.scale.setScalar(particle.radius * growth * collapse);
      scratch.matrix.compose(scratch.position, scratch.identity, scratch.scale);
      dustRef.current?.setMatrixAt(index, scratch.matrix);
    });
    if (dustRef.current) dustRef.current.instanceMatrix.needsUpdate = true;
    if (dustMaterialRef.current) dustMaterialRef.current.opacity = Math.pow(1 - dustProgress, 1.45) * 0.48;

    particles.debris.forEach((particle, index) => {
      scratch.position.copy(particle.offset)
        .addScaledVector(particle.velocity, elapsed)
        .addScaledVector(UP, -0.5 * GRAVITY * elapsed * elapsed);
      if (scratch.position.y < -effect.point.y + 0.018) scratch.position.y = -effect.point.y + 0.018;
      scratch.spinQuaternion.setFromAxisAngle(particle.spinAxis, particle.spin * elapsed);
      scratch.quaternion.copy(particle.rotation).premultiply(scratch.spinQuaternion);
      const vanish = 1 - THREE.MathUtils.smoothstep(progress, 0.82, 1);
      scratch.scale.copy(particle.scale).multiplyScalar(vanish);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      debrisRef.current?.setMatrixAt(index, scratch.matrix);
    });
    if (debrisRef.current) debrisRef.current.instanceMatrix.needsUpdate = true;
    if (debrisMaterialRef.current) debrisMaterialRef.current.opacity = 1 - THREE.MathUtils.smoothstep(progress, 0.8, 1);

    const sparkLife = Math.min(lifetime, effect.surface === "metal" ? 0.42 : 0.3);
    const sparkProgress = THREE.MathUtils.clamp(elapsed / sparkLife, 0, 1);
    if (sparksRef.current) sparksRef.current.visible = sparkProgress < 1;
    particles.sparks.forEach((particle, index) => {
      scratch.position.copy(particle.offset)
        .addScaledVector(particle.velocity, elapsed)
        .addScaledVector(UP, -2.2 * elapsed * elapsed);
      const velocity = scratch.scale.copy(particle.velocity).addScaledVector(UP, -4.4 * elapsed);
      scratch.quaternion.setFromUnitVectors(UP, velocity.normalize());
      scratch.scale.set(
        particle.width * (1 - sparkProgress),
        particle.length * (1 - sparkProgress * 0.65),
        particle.width * (1 - sparkProgress)
      );
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      sparksRef.current?.setMatrixAt(index, scratch.matrix);
    });
    if (sparksRef.current) sparksRef.current.instanceMatrix.needsUpdate = true;
    if (sparkMaterialRef.current) sparkMaterialRef.current.opacity = Math.pow(1 - sparkProgress, 1.35);
  });

  const dustColor = preset.dustColors[effect.id % preset.dustColors.length];
  const sparkColor = effect.weapon === "laser" ? "#7ff8ff" : effect.surface === "glass" ? "#d9f8ff" : "#ffd166";

  return (
    <group ref={rootRef} position={effect.point}>
      {dustCount > 0 ? (
        <instancedMesh ref={dustRef} args={[undefined, undefined, dustCount]} frustumCulled={false} raycast={() => null}>
          <icosahedronGeometry args={[1, 1]} />
          <meshBasicMaterial ref={dustMaterialRef} color={dustColor} transparent opacity={0.48} depthWrite={false} />
        </instancedMesh>
      ) : null}
      {debrisCount > 0 ? (
        <instancedMesh ref={debrisRef} args={[undefined, undefined, debrisCount]} frustumCulled={false} raycast={() => null}>
          {preset.debrisShape === "shard" ? <tetrahedronGeometry args={[1, 0]} /> : <boxGeometry args={[1, 1, 1]} />}
          <meshStandardMaterial
            ref={debrisMaterialRef}
            color="#ffffff"
            vertexColors
            roughness={preset.debrisShape === "shard" ? 0.18 : 0.82}
            metalness={effect.surface === "metal" ? 0.48 : 0.02}
            transparent
          />
        </instancedMesh>
      ) : null}
      {sparkCount > 0 ? (
        <instancedMesh ref={sparksRef} args={[undefined, undefined, sparkCount]} frustumCulled={false} raycast={() => null}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            ref={sparkMaterialRef}
            color={sparkColor}
            transparent
            opacity={1}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </instancedMesh>
      ) : null}
    </group>
  );
}
