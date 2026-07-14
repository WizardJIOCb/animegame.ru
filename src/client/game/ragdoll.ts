import * as THREE from "three";
import type { RagdollImpact } from "./combat";

export type { RagdollImpact } from "./combat";

const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 4;
const SOLVER_ITERATIONS = 5;
const GRAVITY = -9.81;
const AIR_DRAG = 0.985;
const FLOOR_FRICTION = 0.7;
const FLOOR_RESTITUTION = 0.08;
const SLEEP_SPEED = 0.045;
const SLEEP_DELAY = 0.8;
const MAX_IMPACT_SPEED = 14;
const EPSILON = 1e-7;

type BoneSpec = {
  name: string;
  parent?: string;
  aimChild?: string;
  mass: number;
  radius: number;
};

const BONE_SPECS: BoneSpec[] = [
  { name: "pelvis", aimChild: "spine_01", mass: 4.4, radius: 0.16 },
  { name: "spine_01", parent: "pelvis", aimChild: "spine_02", mass: 3.4, radius: 0.15 },
  { name: "spine_02", parent: "spine_01", aimChild: "spine_03", mass: 3.2, radius: 0.15 },
  { name: "spine_03", parent: "spine_02", aimChild: "neck_01", mass: 3.6, radius: 0.17 },
  { name: "neck_01", parent: "spine_03", aimChild: "Head", mass: 1.1, radius: 0.1 },
  { name: "Head", parent: "neck_01", mass: 2.2, radius: 0.19 },

  { name: "clavicle_l", parent: "spine_03", aimChild: "upperarm_l", mass: 0.75, radius: 0.08 },
  { name: "upperarm_l", parent: "clavicle_l", aimChild: "lowerarm_l", mass: 1.15, radius: 0.085 },
  { name: "lowerarm_l", parent: "upperarm_l", aimChild: "hand_l", mass: 0.85, radius: 0.07 },
  { name: "hand_l", parent: "lowerarm_l", mass: 0.45, radius: 0.075 },

  { name: "clavicle_r", parent: "spine_03", aimChild: "upperarm_r", mass: 0.75, radius: 0.08 },
  { name: "upperarm_r", parent: "clavicle_r", aimChild: "lowerarm_r", mass: 1.15, radius: 0.085 },
  { name: "lowerarm_r", parent: "upperarm_r", aimChild: "hand_r", mass: 0.85, radius: 0.07 },
  { name: "hand_r", parent: "lowerarm_r", mass: 0.45, radius: 0.075 },

  { name: "thigh_l", parent: "pelvis", aimChild: "calf_l", mass: 2.45, radius: 0.11 },
  { name: "calf_l", parent: "thigh_l", aimChild: "foot_l", mass: 1.65, radius: 0.09 },
  { name: "foot_l", parent: "calf_l", aimChild: "ball_l", mass: 0.75, radius: 0.075 },
  { name: "ball_l", parent: "foot_l", mass: 0.35, radius: 0.06 },

  { name: "thigh_r", parent: "pelvis", aimChild: "calf_r", mass: 2.45, radius: 0.11 },
  { name: "calf_r", parent: "thigh_r", aimChild: "foot_r", mass: 1.65, radius: 0.09 },
  { name: "foot_r", parent: "calf_r", aimChild: "ball_r", mass: 0.75, radius: 0.075 },
  { name: "ball_r", parent: "foot_r", mass: 0.35, radius: 0.06 }
];

type Particle = {
  spec: BoneSpec;
  bone: THREE.Bone;
  position: THREE.Vector3;
  previous: THREE.Vector3;
  inverseMass: number;
  originalPosition: THREE.Vector3;
  originalQuaternion: THREE.Quaternion;
  localAimAxis: THREE.Vector3 | null;
};

type DistanceConstraint = {
  first: Particle;
  second: Particle;
  restLength: number;
  stiffness: number;
};

type FrameDriver = {
  boneName: string;
  origin: Particle;
  primary: Particle;
  secondaryFirst: Particle;
  secondarySecond: Particle;
  sourceFrame: THREE.Quaternion;
};

const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempQuaternionA = new THREE.Quaternion();
const tempQuaternionB = new THREE.Quaternion();
const tempQuaternionC = new THREE.Quaternion();
const tempMatrix = new THREE.Matrix4();

function isBone(object: THREE.Object3D | undefined): object is THREE.Bone {
  return Boolean(object && (object as THREE.Bone).isBone);
}

function makeFrameQuaternion(primary: THREE.Vector3, secondary: THREE.Vector3, target: THREE.Quaternion) {
  const yAxis = tempVectorA.copy(primary);
  if (yAxis.lengthSq() < EPSILON) return false;
  yAxis.normalize();

  const xAxis = tempVectorB.copy(secondary).addScaledVector(yAxis, -secondary.dot(yAxis));
  if (xAxis.lengthSq() < EPSILON) {
    xAxis.set(Math.abs(yAxis.x) < 0.8 ? 1 : 0, Math.abs(yAxis.x) < 0.8 ? 0 : 1, 0);
    xAxis.addScaledVector(yAxis, -xAxis.dot(yAxis));
  }
  xAxis.normalize();
  const zAxis = tempVectorC.crossVectors(xAxis, yAxis).normalize();
  xAxis.crossVectors(yAxis, zAxis).normalize();
  tempMatrix.makeBasis(xAxis, yAxis, zAxis);
  target.setFromRotationMatrix(tempMatrix).normalize();
  return true;
}

function constraintBetween(
  particles: Map<string, Particle>,
  firstName: string,
  secondName: string,
  stiffness: number
): DistanceConstraint | null {
  const first = particles.get(firstName);
  const second = particles.get(secondName);
  if (!first || !second) return null;
  return {
    first,
    second,
    restLength: first.position.distanceTo(second.position),
    stiffness
  };
}

/**
 * Lightweight client-side skeletal ragdoll.
 *
 * `RagdollImpact.point` and `velocity` must be in render-world coordinates:
 * the same coordinate system returned by Object3D.getWorldPosition/ThreeEvent.point.
 * The animation mixer must remain paused while this controller owns the bones.
 */
export class SkeletonRagdoll {
  private readonly scene: THREE.Object3D;
  private readonly particles: Particle[] = [];
  private readonly particleByName = new Map<string, Particle>();
  private readonly constraints: DistanceConstraint[] = [];
  private readonly frameDrivers = new Map<string, FrameDriver>();
  private accumulator = 0;
  private sleepTime = 0;
  private sleeping = false;
  private disposed = false;

  constructor(scene: THREE.Object3D, impact: RagdollImpact) {
    this.scene = scene;
    scene.updateWorldMatrix(true, true);

    for (const spec of BONE_SPECS) {
      const object = scene.getObjectByName(spec.name);
      if (!isBone(object)) continue;
      const position = object.getWorldPosition(new THREE.Vector3());
      const particle: Particle = {
        spec,
        bone: object,
        position,
        previous: position.clone(),
        inverseMass: 1 / spec.mass,
        originalPosition: object.position.clone(),
        originalQuaternion: object.quaternion.clone(),
        localAimAxis: null
      };
      this.particles.push(particle);
      this.particleByName.set(spec.name, particle);
    }

    this.captureAimAxes();
    this.createConstraints();
    this.createFrameDrivers();
    this.applyImpact(impact);
  }

  step(delta: number) {
    if (this.disposed || this.particles.length === 0 || !Number.isFinite(delta) || delta <= 0) return;
    if (this.sleeping) return;

    this.accumulator = Math.min(
      this.accumulator + Math.min(delta, FIXED_STEP * MAX_SUBSTEPS),
      FIXED_STEP * MAX_SUBSTEPS
    );

    let substeps = 0;
    while (this.accumulator >= FIXED_STEP && substeps < MAX_SUBSTEPS) {
      this.simulateFixedStep();
      this.accumulator -= FIXED_STEP;
      substeps += 1;
    }

    if (substeps > 0) this.applyPose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const particle of this.particles) {
      particle.bone.position.copy(particle.originalPosition);
      particle.bone.quaternion.copy(particle.originalQuaternion);
      particle.bone.updateMatrix();
    }
    this.scene.updateMatrixWorld(true);
    this.particles.length = 0;
    this.constraints.length = 0;
    this.particleByName.clear();
    this.frameDrivers.clear();
  }

  private captureAimAxes() {
    for (const particle of this.particles) {
      const childName = particle.spec.aimChild;
      const child = childName ? this.particleByName.get(childName) : undefined;
      if (!child) continue;
      const inverseWorldRotation = particle.bone.getWorldQuaternion(new THREE.Quaternion()).invert();
      particle.localAimAxis = child.position.clone()
        .sub(particle.position)
        .applyQuaternion(inverseWorldRotation)
        .normalize();
    }
  }

  private createConstraints() {
    for (const spec of BONE_SPECS) {
      if (!spec.parent) continue;
      const constraint = constraintBetween(this.particleByName, spec.parent, spec.name, 1);
      if (constraint && constraint.restLength > EPSILON) this.constraints.push(constraint);
    }

    const braces: Array<[string, string, number]> = [
      ["clavicle_l", "clavicle_r", 0.42],
      ["upperarm_l", "upperarm_r", 0.28],
      ["thigh_l", "thigh_r", 0.48],
      ["spine_03", "thigh_l", 0.3],
      ["spine_03", "thigh_r", 0.3],
      ["pelvis", "clavicle_l", 0.24],
      ["pelvis", "clavicle_r", 0.24]
    ];
    for (const [first, second, stiffness] of braces) {
      const constraint = constraintBetween(this.particleByName, first, second, stiffness);
      if (constraint && constraint.restLength > EPSILON) this.constraints.push(constraint);
    }
  }

  private createFrameDrivers() {
    this.createFrameDriver("pelvis", "spine_01", "thigh_l", "thigh_r");
    this.createFrameDriver("spine_03", "neck_01", "upperarm_l", "upperarm_r");
  }

  private createFrameDriver(
    boneName: string,
    primaryName: string,
    secondaryFirstName: string,
    secondarySecondName: string
  ) {
    const origin = this.particleByName.get(boneName);
    const primary = this.particleByName.get(primaryName);
    const secondaryFirst = this.particleByName.get(secondaryFirstName);
    const secondarySecond = this.particleByName.get(secondarySecondName);
    if (!origin || !primary || !secondaryFirst || !secondarySecond) return;

    const inverseWorldRotation = origin.bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    const primaryLocal = primary.position.clone().sub(origin.position).applyQuaternion(inverseWorldRotation);
    const secondaryLocal = secondaryFirst.position.clone().sub(secondarySecond.position).applyQuaternion(inverseWorldRotation);
    const sourceFrame = new THREE.Quaternion();
    if (!makeFrameQuaternion(primaryLocal, secondaryLocal, sourceFrame)) return;
    this.frameDrivers.set(boneName, {
      boneName,
      origin,
      primary,
      secondaryFirst,
      secondarySecond,
      sourceFrame
    });
  }

  private applyImpact(impact: RagdollImpact) {
    if (this.particles.length === 0) return;
    const point = new THREE.Vector3().fromArray(impact.point);
    let hit = this.particleByName.get(impact.boneName);
    if (point.toArray().every(Number.isFinite)) {
      let nearestDistance = hit ? hit.position.distanceToSquared(point) : Infinity;
      for (const particle of this.particles) {
        const distance = particle.position.distanceToSquared(point);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          hit = particle;
        }
      }
    }
    if (!hit) return;

    const velocity = new THREE.Vector3().fromArray(impact.velocity);
    if (!Number.isFinite(velocity.lengthSq()) || velocity.lengthSq() < EPSILON) return;
    velocity.clampLength(0, MAX_IMPACT_SPEED);

    for (const particle of this.particles) {
      let share = particle === hit ? 1 : 0;
      if (impact.kind === "explosion" && particle !== hit) {
        const distance = particle.position.distanceTo(point);
        share = 0.2 * THREE.MathUtils.clamp(1 - distance / 2.4, 0.18, 1);
      }
      if (share > 0) particle.previous.addScaledVector(velocity, -FIXED_STEP * share);
    }
  }

  private simulateFixedStep() {
    for (const particle of this.particles) {
      const velocity = tempVectorA.copy(particle.position).sub(particle.previous).multiplyScalar(AIR_DRAG);
      particle.previous.copy(particle.position);
      particle.position.add(velocity);
      particle.position.y += GRAVITY * FIXED_STEP * FIXED_STEP;
    }

    for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration += 1) {
      for (const constraint of this.constraints) this.solveConstraint(constraint);
      for (const particle of this.particles) {
        particle.position.y = Math.max(particle.spec.radius, particle.position.y);
      }
    }

    let maxSpeedSq = 0;
    let hasFloorContact = false;
    for (const particle of this.particles) {
      const onFloor = particle.position.y <= particle.spec.radius + 0.0001;
      if (onFloor) {
        hasFloorContact = true;
        const velocityX = particle.position.x - particle.previous.x;
        const velocityY = particle.position.y - particle.previous.y;
        const velocityZ = particle.position.z - particle.previous.z;
        particle.previous.x = particle.position.x - velocityX * FLOOR_FRICTION;
        particle.previous.z = particle.position.z - velocityZ * FLOOR_FRICTION;
        if (velocityY < 0) particle.previous.y = particle.position.y + velocityY * FLOOR_RESTITUTION;
      }
      maxSpeedSq = Math.max(maxSpeedSq, particle.position.distanceToSquared(particle.previous) / (FIXED_STEP * FIXED_STEP));
    }

    if (hasFloorContact && maxSpeedSq < SLEEP_SPEED * SLEEP_SPEED) {
      this.sleepTime += FIXED_STEP;
      if (this.sleepTime >= SLEEP_DELAY) {
        this.sleeping = true;
        for (const particle of this.particles) particle.previous.copy(particle.position);
      }
    } else {
      this.sleepTime = 0;
    }
  }

  private solveConstraint(constraint: DistanceConstraint) {
    const offset = tempVectorA.copy(constraint.second.position).sub(constraint.first.position);
    const distance = offset.length();
    if (distance < EPSILON) return;
    const weight = constraint.first.inverseMass + constraint.second.inverseMass;
    if (weight < EPSILON) return;
    const correction = ((distance - constraint.restLength) / distance) * constraint.stiffness;
    offset.multiplyScalar(correction);
    constraint.first.position.addScaledVector(offset, constraint.first.inverseMass / weight);
    constraint.second.position.addScaledVector(offset, -constraint.second.inverseMass / weight);
  }

  private applyPose() {
    for (const particle of this.particles) {
      const parent = particle.bone.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      const localPosition = tempVectorA.copy(particle.position);
      parent.worldToLocal(localPosition);
      particle.bone.position.copy(localPosition);

      const frameDriver = this.frameDrivers.get(particle.spec.name);
      if (frameDriver) {
        this.applyFrameRotation(frameDriver);
      } else {
        this.applyAimRotation(particle);
      }
      particle.bone.updateMatrix();
      particle.bone.updateWorldMatrix(false, false);
    }
    this.scene.updateMatrixWorld(true);
  }

  private applyAimRotation(particle: Particle) {
    const childName = particle.spec.aimChild;
    const child = childName ? this.particleByName.get(childName) : undefined;
    if (!child || !particle.localAimAxis || !particle.bone.parent) {
      particle.bone.quaternion.copy(particle.originalQuaternion);
      return;
    }

    const desiredDirection = tempVectorA.copy(child.position).sub(particle.position);
    if (desiredDirection.lengthSq() < EPSILON) return;
    desiredDirection.normalize();

    const parentWorldRotation = particle.bone.parent.getWorldQuaternion(tempQuaternionA);
    const baseWorldRotation = tempQuaternionB.copy(parentWorldRotation).multiply(particle.originalQuaternion);
    const baseDirection = tempVectorB.copy(particle.localAimAxis).applyQuaternion(baseWorldRotation).normalize();
    const swing = tempQuaternionC.setFromUnitVectors(baseDirection, desiredDirection);
    const desiredWorldRotation = swing.multiply(baseWorldRotation);
    particle.bone.quaternion.copy(parentWorldRotation.invert().multiply(desiredWorldRotation)).normalize();
  }

  private applyFrameRotation(driver: FrameDriver) {
    const bone = driver.origin.bone;
    if (!bone.parent) return;
    const primary = tempVectorA.copy(driver.primary.position).sub(driver.origin.position);
    const secondary = tempVectorB.copy(driver.secondaryFirst.position).sub(driver.secondarySecond.position);
    const desiredFrame = tempQuaternionA;
    if (!makeFrameQuaternion(primary, secondary, desiredFrame)) return;

    const desiredWorldRotation = tempQuaternionB.copy(desiredFrame)
      .multiply(tempQuaternionC.copy(driver.sourceFrame).invert());
    const parentWorldRotation = bone.parent.getWorldQuaternion(tempQuaternionC).invert();
    bone.quaternion.copy(parentWorldRotation.multiply(desiredWorldRotation)).normalize();
  }
}
