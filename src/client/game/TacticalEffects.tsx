import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { ExpeditionGrenadeEffect, ExpeditionGrenadeId } from "../../shared/expedition";

export type ThrownGrenadeVisual = {
  id: number;
  itemId: ExpeditionGrenadeId;
  effect: ExpeditionGrenadeEffect;
  color: string;
  radius: number;
  createdAt: number;
  fuseMs: number;
  position: [number, number, number];
  velocity: [number, number, number];
};

export type GrenadeBlastVisual = {
  id: number;
  effect: ExpeditionGrenadeEffect;
  color: string;
  radius: number;
  createdAt: number;
  position: [number, number, number];
};

export type EnemyAbilityVisual = {
  id: number;
  kind: "mine" | "heal" | "mutant-slam" | "colossus-slam" | "storm-strike" | "void-pulse";
  color: string;
  radius: number;
  createdAt: number;
  telegraphMs: number;
  duration: number;
  position: [number, number, number];
};

const UP = new THREE.Vector3(0, 1, 0);

function seeded(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function grenadeBlastLifetime(effect: ExpeditionGrenadeEffect) {
  if (effect === "incendiary" || effect === "vortex") return 3_200;
  if (effect === "cluster") return 2_650;
  if (effect === "cryo") return 2_100;
  if (effect === "emp") return 1_650;
  return 1_250;
}

export function ThrownGrenadeView({
  grenade,
  onDetonate
}: {
  grenade: ThrownGrenadeVisual;
  onDetonate: (grenade: ThrownGrenadeVisual, position: THREE.Vector3) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const shellMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const positionRef = useRef(new THREE.Vector3().fromArray(grenade.position));
  const velocityRef = useRef(new THREE.Vector3().fromArray(grenade.velocity));
  const detonatedRef = useRef(false);
  const onDetonateRef = useRef(onDetonate);
  onDetonateRef.current = onDetonate;

  useFrame((_, rawDelta) => {
    if (detonatedRef.current) return;
    const elapsed = performance.now() - grenade.createdAt;
    if (elapsed >= grenade.fuseMs) {
      detonatedRef.current = true;
      if (groupRef.current) groupRef.current.visible = false;
      onDetonateRef.current(grenade, positionRef.current.clone());
      return;
    }

    const delta = Math.min(rawDelta, 0.035);
    const velocity = velocityRef.current;
    velocity.y -= 9.81 * delta;
    velocity.multiplyScalar(Math.exp(-delta * 0.075));
    positionRef.current.addScaledVector(velocity, delta);

    if (positionRef.current.y < 0.14) {
      positionRef.current.y = 0.14;
      if (velocity.y < -0.42) {
        velocity.y *= -0.43;
        velocity.x *= 0.76;
        velocity.z *= 0.76;
      } else {
        velocity.y = 0;
        velocity.x *= Math.exp(-delta * 4.8);
        velocity.z *= Math.exp(-delta * 4.8);
      }
    }

    if (Math.abs(positionRef.current.x) > 419.4) {
      positionRef.current.x = THREE.MathUtils.clamp(positionRef.current.x, -419.4, 419.4);
      velocity.x *= -0.5;
    }
    if (positionRef.current.z < -1399.4 || positionRef.current.z > 89.4) {
      positionRef.current.z = THREE.MathUtils.clamp(positionRef.current.z, -1399.4, 89.4);
      velocity.z *= -0.5;
    }

    const pulse = 0.5 + 0.5 * Math.sin(elapsed * (elapsed > grenade.fuseMs * 0.68 ? 0.026 : 0.011));
    if (groupRef.current) {
      groupRef.current.position.copy(positionRef.current);
      groupRef.current.rotation.x += delta * (5 + velocity.length() * 0.18);
      groupRef.current.rotation.z += delta * 3.7;
    }
    if (shellMaterialRef.current) shellMaterialRef.current.emissiveIntensity = 0.42 + pulse * 2.4;
    if (lightRef.current) lightRef.current.intensity = 0.55 + pulse * 2.2;
  });

  const angular = grenade.effect === "vortex" || grenade.effect === "cryo";
  return (
    <group ref={groupRef} position={grenade.position} raycast={() => null}>
      <mesh castShadow>
        {angular ? <octahedronGeometry args={[0.19, 0]} /> : <sphereGeometry args={[0.18, 12, 8]} />}
        <meshStandardMaterial
          ref={shellMaterialRef}
          color="#17202a"
          emissive={grenade.color}
          emissiveIntensity={0.8}
          metalness={0.82}
          roughness={0.26}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.19, 0.027, 6, 16]} />
        <meshBasicMaterial color={grenade.color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[0.075, 0.15, 0.055]} />
        <meshStandardMaterial color="#d9e2e7" metalness={0.9} roughness={0.2} />
      </mesh>
      <pointLight ref={lightRef} color={grenade.color} intensity={1.2} distance={3.4} decay={2} />
    </group>
  );
}

export function GrenadeBlastEffect({
  blast,
  onComplete
}: {
  blast: GrenadeBlastVisual;
  onComplete: (id: number) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const coreMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const ringsRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.InstancedMesh>(null);
  const particleMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const clustersRef = useRef<THREE.InstancedMesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const completeRef = useRef(false);
  const lifetime = grenadeBlastLifetime(blast.effect);
  const particles = useMemo(() => Array.from({ length: 34 }, (_, index) => {
    const theta = seeded(blast.id * 43 + index) * Math.PI * 2;
    const y = seeded(blast.id * 61 + index) * 1.5 - 0.22;
    const radial = Math.sqrt(Math.max(0, 1 - Math.min(1, y * y)));
    return {
      direction: new THREE.Vector3(Math.cos(theta) * radial, y, Math.sin(theta) * radial).normalize(),
      speed: 0.52 + seeded(blast.id * 89 + index) * 1.2,
      spin: (seeded(blast.id * 113 + index) - 0.5) * 8,
      scale: 0.045 + seeded(blast.id * 137 + index) * 0.095
    };
  }), [blast.id]);
  const clusterOffsets = useMemo(() => [
    [0, 0, 0], [0.58, 0.08, 0.12], [-0.52, 0.04, 0.28], [0.18, 0.12, -0.62],
    [-0.2, 0.07, -0.5], [0.48, 0.05, 0.48], [-0.6, 0.1, -0.34]
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z)), []);
  const scratch = useMemo(() => ({
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    euler: new THREE.Euler()
  }), []);

  useFrame(() => {
    const elapsedMs = performance.now() - blast.createdAt;
    const progress = THREE.MathUtils.clamp(elapsedMs / lifetime, 0, 1);
    if (progress >= 1 && !completeRef.current) {
      completeRef.current = true;
      if (groupRef.current) groupRef.current.visible = false;
      onComplete(blast.id);
      return;
    }
    const burst = Math.sin(Math.min(1, progress * 2.2) * Math.PI * 0.5);
    const coreScale = blast.effect === "incendiary"
      ? blast.radius * (0.12 + Math.min(1, progress * 3) * 0.42)
      : blast.radius * (0.08 + burst * 0.32);
    if (coreRef.current) coreRef.current.scale.setScalar(coreScale);
    if (coreMaterialRef.current) {
      coreMaterialRef.current.opacity = blast.effect === "incendiary"
        ? (1 - progress) * 0.22
        : (1 - progress) * 0.48;
    }
    if (ringsRef.current) {
      ringsRef.current.scale.setScalar(blast.radius * (0.12 + progress * 0.9));
      ringsRef.current.rotation.y += 0.018;
      ringsRef.current.rotation.x = blast.effect === "vortex" ? progress * 1.4 : 0;
    }
    if (lightRef.current) lightRef.current.intensity = (1 - progress) * (blast.effect === "cluster" ? 17 : 11);

    particles.forEach((particle, index) => {
      const localProgress = blast.effect === "vortex" ? 1 - progress : progress;
      const travel = blast.radius * particle.speed * localProgress;
      scratch.position.copy(particle.direction).multiplyScalar(travel);
      if (blast.effect === "incendiary") {
        scratch.position.y = Math.abs(particle.direction.y) * blast.radius * 0.35 + progress * blast.radius * 0.48;
        scratch.position.x *= 0.36;
        scratch.position.z *= 0.36;
      } else if (blast.effect === "vortex") {
        scratch.position.applyAxisAngle(UP, progress * (7 + particle.spin));
        scratch.position.y *= 0.55;
      } else if (blast.effect === "emp") {
        scratch.position.y *= 0.18;
      } else {
        scratch.position.y -= 0.5 * progress * progress * blast.radius * 0.45;
      }
      const particleScale = particle.scale * blast.radius * (1 - progress) * (blast.effect === "cryo" ? 1.65 : 1);
      scratch.scale.setScalar(Math.max(0.001, particleScale));
      scratch.euler.set(progress * particle.spin, index * 1.7, progress * particle.spin * 0.7);
      scratch.quaternion.setFromEuler(scratch.euler);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      particlesRef.current?.setMatrixAt(index, scratch.matrix);
    });
    if (particlesRef.current) particlesRef.current.instanceMatrix.needsUpdate = true;
    if (particleMaterialRef.current) particleMaterialRef.current.opacity = (1 - progress) * 0.9;

    if (blast.effect === "cluster") {
      clusterOffsets.forEach((offset, index) => {
        const delay = index * 0.075;
        const phase = THREE.MathUtils.clamp((progress - delay) / 0.35, 0, 1);
        scratch.position.copy(offset).multiplyScalar(blast.radius * 0.48);
        scratch.scale.setScalar(Math.sin(phase * Math.PI) * blast.radius * (0.16 + index % 2 * 0.05));
        scratch.matrix.compose(scratch.position, scratch.quaternion.identity(), scratch.scale);
        clustersRef.current?.setMatrixAt(index, scratch.matrix);
      });
      if (clustersRef.current) clustersRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  const wireframe = blast.effect === "emp" || blast.effect === "cryo" || blast.effect === "vortex";
  return (
    <group ref={groupRef} position={blast.position} raycast={() => null}>
      <mesh ref={coreRef}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshBasicMaterial
          ref={coreMaterialRef}
          color={blast.color}
          transparent
          opacity={0.45}
          depthWrite={false}
          wireframe={wireframe}
          toneMapped={false}
        />
      </mesh>
      <group ref={ringsRef} rotation={[-Math.PI / 2, 0, 0]}>
        {[0.55, 0.78, 1].map((radius, index) => (
          <mesh key={radius} scale={[radius, radius, radius]}>
            <torusGeometry args={[1, blast.effect === "emp" ? 0.026 : 0.045, 7, 48]} />
            <meshBasicMaterial color={blast.color} transparent opacity={0.75 - index * 0.15} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <instancedMesh ref={particlesRef} args={[undefined, undefined, particles.length]}>
        {blast.effect === "frag" || blast.effect === "cryo"
          ? <tetrahedronGeometry args={[1, 0]} />
          : <sphereGeometry args={[1, 6, 4]} />}
        <meshBasicMaterial ref={particleMaterialRef} color={blast.color} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {blast.effect === "cluster" ? (
        <instancedMesh ref={clustersRef} args={[undefined, undefined, clusterOffsets.length]}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshBasicMaterial color="#ff7b42" transparent opacity={0.54} depthWrite={false} toneMapped={false} />
        </instancedMesh>
      ) : null}
      <pointLight ref={lightRef} color={blast.color} intensity={10} distance={blast.radius * 2.2} decay={2} />
    </group>
  );
}

export function EnemyAbilityEffectView({ effect }: { effect: EnemyAbilityVisual }) {
  const groupRef = useRef<THREE.Group>(null);
  const telegraphRef = useRef<THREE.MeshBasicMaterial>(null);
  const blastRef = useRef<THREE.Mesh>(null);
  const blastMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const beamRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const elapsed = performance.now() - effect.createdAt;
    const telegraphProgress = THREE.MathUtils.clamp(elapsed / effect.telegraphMs, 0, 1);
    const impactProgress = THREE.MathUtils.clamp((elapsed - effect.telegraphMs) / Math.max(1, effect.duration - effect.telegraphMs), 0, 1);
    if (groupRef.current) groupRef.current.visible = elapsed < effect.duration;
    if (telegraphRef.current) {
      telegraphRef.current.opacity = elapsed < effect.telegraphMs
        ? 0.28 + Math.sin(telegraphProgress * Math.PI * 10) * 0.16
        : (1 - impactProgress) * 0.15;
    }
    if (blastRef.current) {
      blastRef.current.visible = elapsed >= effect.telegraphMs;
      blastRef.current.scale.setScalar(effect.radius * (0.06 + Math.sin(impactProgress * Math.PI) * 0.46));
    }
    if (blastMaterialRef.current) blastMaterialRef.current.opacity = (1 - impactProgress) * 0.58;
    if (beamRef.current) {
      beamRef.current.visible = effect.kind === "storm-strike" && elapsed >= effect.telegraphMs;
      beamRef.current.scale.y = 9 + Math.sin(impactProgress * Math.PI * 8) * 2;
    }
  });

  const healing = effect.kind === "heal";
  const voidPulse = effect.kind === "void-pulse";
  return (
    <group ref={groupRef} position={effect.position} raycast={() => null}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]} scale={[effect.radius, effect.radius, effect.radius]}>
        <ringGeometry args={[0.72, 1, 64]} />
        <meshBasicMaterial ref={telegraphRef} color={effect.color} transparent opacity={0.42} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={blastRef} visible={false}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshBasicMaterial ref={blastMaterialRef} color={effect.color} transparent opacity={0.5} depthWrite={false} wireframe={voidPulse || healing} toneMapped={false} />
      </mesh>
      {effect.kind === "storm-strike" ? (
        <mesh ref={beamRef} visible={false} position={[0, 9, 0]}>
          <cylinderGeometry args={[0.07, 0.25, 2, 7]} />
          <meshBasicMaterial color="#dffcff" transparent opacity={0.92} depthWrite={false} toneMapped={false} />
        </mesh>
      ) : null}
    </group>
  );
}
