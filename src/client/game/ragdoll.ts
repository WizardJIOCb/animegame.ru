import * as THREE from "three";
import type { RagdollImpact } from "./combat";

export type { RagdollImpact } from "./combat";

const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 4;
const PHYSICS_SUBSTEPS = 3;
const PHYSICS_STEP = FIXED_STEP / PHYSICS_SUBSTEPS;
const SOLVER_ITERATIONS = 4;
const GRAVITY = -9.81;
const AIR_DRAG = 0.985;
const SUBSTEP_AIR_DRAG = Math.pow(AIR_DRAG, 1 / PHYSICS_SUBSTEPS);
// Exponential tangential damping. A literal 0.7 multiplier every 1/60 s made
// floor contacts lose virtually all horizontal speed in a fraction of a
// second, pinning one joint while the rest of the body folded around it.
const FLOOR_FRICTION_PER_SECOND = 3.2;
const FLOOR_TANGENTIAL_RETENTION = Math.exp(-FLOOR_FRICTION_PER_SECOND * PHYSICS_STEP);
const FLOOR_RESTITUTION = 0.08;
const SLEEP_SPEED = 0.045;
const SLEEP_DELAY = 0.8;
const MAX_IMPACT_SPEED = 14;
const MAX_PARTICLE_SPEED = 12;
const LOCAL_IMPACT_SHARE = 1.15;
const CONNECTED_BULLET_SHARE = 0.12;
const SELF_COLLISION_SCALE = 0.96;
const REST_SEPARATION_RATIO = 0.9;
const TORSO_SHAPE_STIFFNESS = 0.34;
const CAPSULE_RADIUS_SCALE = 0.82;
const CAPSULE_SEPARATION_SCALE = 0.94;
const CAPSULE_REST_SEPARATION_RATIO = 0.9;
const CAPSULE_FRAME_STIFFNESS = 0.94;
const CAPSULE_ITERATION_STIFFNESS = 1 - Math.pow(
  1 - CAPSULE_FRAME_STIFFNESS,
  1 / (SOLVER_ITERATIONS * PHYSICS_SUBSTEPS)
);
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

// These particles describe attachment points, not flexible limb segments. Keeping
// their complete distance graph approximately rigid prevents the chest, shoulders
// and hip sockets from folding into the characteristic "ragdoll ball".
const TORSO_PARTICLE_NAMES = [
  "pelvis",
  "spine_01",
  "spine_02",
  "spine_03",
  "neck_01",
  "clavicle_l",
  "upperarm_l",
  "clavicle_r",
  "upperarm_r",
  "thigh_l",
  "thigh_r"
] as const;

const TORSO_PARTICLE_SET = new Set<string>(TORSO_PARTICLE_NAMES);

const ANATOMICAL_CHAINS = [
  new Set(["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head"]),
  new Set(["spine_03", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l"]),
  new Set(["spine_03", "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r"]),
  new Set(["pelvis", "thigh_l", "calf_l", "foot_l", "ball_l"]),
  new Set(["pelvis", "thigh_r", "calf_r", "foot_r", "ball_r"])
] as const;

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

type MinimumDistanceConstraint = {
  first: Particle;
  second: Particle;
  minimumDistance: number;
  stiffness: number;
  fallbackDirection: THREE.Vector3;
};

type CapsuleSegment = {
  first: Particle;
  second: Particle;
  radius: number;
};

type SegmentCollisionConstraint = {
  first: CapsuleSegment;
  second: CapsuleSegment;
  minimumDistance: number;
  fallbackNormal: THREE.Vector3;
};

type ClosestSegmentResult = {
  firstT: number;
  secondT: number;
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
const tempVectorD = new THREE.Vector3();
const tempVectorE = new THREE.Vector3();
const tempVectorF = new THREE.Vector3();
const tempVectorG = new THREE.Vector3();
const tempVectorH = new THREE.Vector3();
const tempVectorI = new THREE.Vector3();
const tempQuaternionA = new THREE.Quaternion();
const tempQuaternionB = new THREE.Quaternion();
const tempQuaternionC = new THREE.Quaternion();
const tempMatrix = new THREE.Matrix4();
const closestSegmentResult: ClosestSegmentResult = { firstT: 0, secondT: 0 };

function findClosestSegmentParameters(
  firstStart: THREE.Vector3,
  firstEnd: THREE.Vector3,
  secondStart: THREE.Vector3,
  secondEnd: THREE.Vector3,
  target: ClosestSegmentResult
) {
  const firstDirection = tempVectorD.copy(firstEnd).sub(firstStart);
  const secondDirection = tempVectorE.copy(secondEnd).sub(secondStart);
  const startDelta = tempVectorF.copy(firstStart).sub(secondStart);
  const firstLengthSq = firstDirection.lengthSq();
  const secondLengthSq = secondDirection.lengthSq();
  const secondProjection = secondDirection.dot(startDelta);
  let firstT = 0;
  let secondT = 0;

  if (firstLengthSq <= EPSILON && secondLengthSq <= EPSILON) {
    target.firstT = 0;
    target.secondT = 0;
    return target;
  }
  if (firstLengthSq <= EPSILON) {
    secondT = THREE.MathUtils.clamp(secondProjection / secondLengthSq, 0, 1);
  } else {
    const firstProjection = firstDirection.dot(startDelta);
    if (secondLengthSq <= EPSILON) {
      firstT = THREE.MathUtils.clamp(-firstProjection / firstLengthSq, 0, 1);
    } else {
      const directionsDot = firstDirection.dot(secondDirection);
      const denominator = firstLengthSq * secondLengthSq - directionsDot * directionsDot;
      if (denominator > EPSILON * firstLengthSq * secondLengthSq) {
        firstT = THREE.MathUtils.clamp(
          (directionsDot * secondProjection - firstProjection * secondLengthSq) / denominator,
          0,
          1
        );
      }
      secondT = (directionsDot * firstT + secondProjection) / secondLengthSq;
      if (secondT < 0) {
        secondT = 0;
        firstT = THREE.MathUtils.clamp(-firstProjection / firstLengthSq, 0, 1);
      } else if (secondT > 1) {
        secondT = 1;
        firstT = THREE.MathUtils.clamp((directionsDot - firstProjection) / firstLengthSq, 0, 1);
      }
    }
  }

  target.firstT = firstT;
  target.secondT = secondT;
  return target;
}

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
  private readonly bendConstraints: MinimumDistanceConstraint[] = [];
  private readonly selfCollisionConstraints: MinimumDistanceConstraint[] = [];
  private readonly capsuleSegments: CapsuleSegment[] = [];
  private readonly segmentCollisionConstraints: SegmentCollisionConstraint[] = [];
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
    this.createBendConstraints();
    this.createSelfCollisionConstraints();
    this.createCapsuleCollisionConstraints();
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
    this.bendConstraints.length = 0;
    this.selfCollisionConstraints.length = 0;
    this.capsuleSegments.length = 0;
    this.segmentCollisionConstraints.length = 0;
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
    const constraintsByPair = new Map<string, DistanceConstraint>();
    const addConstraint = (firstName: string, secondName: string, stiffness: number) => {
      const first = this.particleByName.get(firstName);
      const second = this.particleByName.get(secondName);
      if (!first || !second) return;
      const key = firstName < secondName ? `${firstName}:${secondName}` : `${secondName}:${firstName}`;
      const existing = constraintsByPair.get(key);
      if (existing) {
        existing.stiffness = Math.max(existing.stiffness, stiffness);
        return;
      }
      const constraint = constraintBetween(this.particleByName, firstName, secondName, stiffness);
      if (constraint && constraint.restLength > EPSILON) {
        constraintsByPair.set(key, constraint);
        this.constraints.push(constraint);
      }
    };

    for (const spec of BONE_SPECS) {
      if (!spec.parent) continue;
      addConstraint(spec.parent, spec.name, 1);
    }

    for (let firstIndex = 0; firstIndex < TORSO_PARTICLE_NAMES.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < TORSO_PARTICLE_NAMES.length; secondIndex += 1) {
        addConstraint(
          TORSO_PARTICLE_NAMES[firstIndex],
          TORSO_PARTICLE_NAMES[secondIndex],
          TORSO_SHAPE_STIFFNESS
        );
      }
    }
  }

  private createBendConstraints() {
    // A minimum end-to-end distance limits how tightly a two-bone chain can
    // close. It still permits a broad ragdoll bend without allowing a wrist,
    // ankle or head to collapse back into its own parent joint.
    this.addBendConstraint("upperarm_l", "lowerarm_l", "hand_l", 0.52, 0.88);
    this.addBendConstraint("upperarm_r", "lowerarm_r", "hand_r", 0.52, 0.88);
    this.addBendConstraint("thigh_l", "calf_l", "foot_l", 0.58, 0.94);
    this.addBendConstraint("thigh_r", "calf_r", "foot_r", 0.58, 0.94);
    this.addBendConstraint("calf_l", "foot_l", "ball_l", 0.38, 0.78);
    this.addBendConstraint("calf_r", "foot_r", "ball_r", 0.38, 0.78);
    this.addBendConstraint("spine_03", "neck_01", "Head", 0.78, 0.94);

    this.addScaledMinimumConstraint("pelvis", "Head", 0.76, 0.9);
    this.addScaledMinimumConstraint("spine_01", "Head", 0.78, 0.9);
    this.addScaledMinimumConstraint("spine_03", "Head", 0.82, 0.92);
    this.addScaledMinimumConstraint("clavicle_l", "Head", 0.9, 0.86);
    this.addScaledMinimumConstraint("clavicle_r", "Head", 0.9, 0.86);

    // Distal limbs may cross the body, but they should not disappear into its
    // centre. Ratios are based on the captured animation pose, so aiming and
    // walking poses remain valid instead of being forced toward a T-pose.
    this.addScaledMinimumConstraint("pelvis", "hand_l", 0.52, 0.76);
    this.addScaledMinimumConstraint("pelvis", "hand_r", 0.52, 0.76);
    this.addScaledMinimumConstraint("spine_02", "hand_l", 0.46, 0.72);
    this.addScaledMinimumConstraint("spine_02", "hand_r", 0.46, 0.72);

    // A standing/walking death pose should be able to fold substantially, but
    // a foot must not travel all the way through the upper torso. Scaling from
    // the captured pose also keeps crouched characters less restricted.
    for (const foot of ["foot_l", "foot_r"]) {
      this.addScaledMinimumConstraint(foot, "Head", 0.56, 0.82);
      this.addScaledMinimumConstraint(foot, "spine_03", 0.5, 0.78);
      this.addScaledMinimumConstraint(foot, "clavicle_l", 0.52, 0.78);
      this.addScaledMinimumConstraint(foot, "clavicle_r", 0.52, 0.78);
    }
  }

  private addBendConstraint(
    firstName: string,
    jointName: string,
    secondName: string,
    minimumRatio: number,
    stiffness: number
  ) {
    const first = this.particleByName.get(firstName);
    const joint = this.particleByName.get(jointName);
    const second = this.particleByName.get(secondName);
    if (!first || !joint || !second) return;
    const chainLength = first.position.distanceTo(joint.position) + joint.position.distanceTo(second.position);
    this.pushMinimumConstraint(this.bendConstraints, first, second, chainLength * minimumRatio, stiffness);
  }

  private addScaledMinimumConstraint(
    firstName: string,
    secondName: string,
    restDistanceRatio: number,
    stiffness: number
  ) {
    const first = this.particleByName.get(firstName);
    const second = this.particleByName.get(secondName);
    if (!first || !second) return;
    this.pushMinimumConstraint(
      this.bendConstraints,
      first,
      second,
      first.position.distanceTo(second.position) * restDistanceRatio,
      stiffness
    );
  }

  private createSelfCollisionConstraints() {
    for (let firstIndex = 0; firstIndex < this.particles.length; firstIndex += 1) {
      const first = this.particles[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < this.particles.length; secondIndex += 1) {
        const second = this.particles[secondIndex];
        if (TORSO_PARTICLE_SET.has(first.spec.name) && TORSO_PARTICLE_SET.has(second.spec.name)) continue;
        const radiusDistance = (first.spec.radius + second.spec.radius) * SELF_COLLISION_SCALE;
        const initialDistance = first.position.distanceTo(second.position);
        // Close joints (notably head/shoulders) overlap by design in the bind
        // pose. Preserve most of their captured separation instead of either
        // forcing the pose apart or omitting the pair and allowing collapse.
        const minimumDistance = Math.min(radiusDistance, initialDistance * REST_SEPARATION_RATIO);
        if (minimumDistance < EPSILON) continue;
        this.pushMinimumConstraint(
          this.selfCollisionConstraints,
          first,
          second,
          minimumDistance,
          0.72
        );
      }
    }
  }

  private createCapsuleCollisionConstraints() {
    for (const spec of BONE_SPECS) {
      if (!spec.parent) continue;
      const first = this.particleByName.get(spec.parent);
      const second = this.particleByName.get(spec.name);
      if (!first || !second || first.position.distanceToSquared(second.position) < EPSILON) continue;
      this.capsuleSegments.push({
        first,
        second,
        radius: Math.min(first.spec.radius, second.spec.radius) * CAPSULE_RADIUS_SCALE
      });
    }

    for (let firstIndex = 0; firstIndex < this.capsuleSegments.length; firstIndex += 1) {
      const first = this.capsuleSegments[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < this.capsuleSegments.length; secondIndex += 1) {
        const second = this.capsuleSegments[secondIndex];
        if (this.shouldSkipCapsulePair(first, second)) continue;

        const closest = findClosestSegmentParameters(
          first.first.position,
          first.second.position,
          second.first.position,
          second.second.position,
          closestSegmentResult
        );
        const firstPoint = tempVectorG.copy(first.first.position).lerp(first.second.position, closest.firstT);
        const secondPoint = tempVectorH.copy(second.first.position).lerp(second.second.position, closest.secondT);
        const initialDelta = tempVectorI.copy(secondPoint).sub(firstPoint);
        const initialDistance = initialDelta.length();
        const minimumDistance = Math.min(
          (first.radius + second.radius) * CAPSULE_SEPARATION_SCALE,
          initialDistance * CAPSULE_REST_SEPARATION_RATIO
        );
        if (minimumDistance < EPSILON) continue;
        const fallbackNormal = initialDelta.multiplyScalar(1 / initialDistance).clone();
        this.segmentCollisionConstraints.push({ first, second, minimumDistance, fallbackNormal });
      }
    }
  }

  private shouldSkipCapsulePair(first: CapsuleSegment, second: CapsuleSegment) {
    const firstParticles = [first.first, first.second];
    const secondParticles = [second.first, second.second];
    for (const firstParticle of firstParticles) {
      for (const secondParticle of secondParticles) {
        if (firstParticle === secondParticle) return true;
      }
    }
    if (
      firstParticles.every((particle) => TORSO_PARTICLE_SET.has(particle.spec.name))
      && secondParticles.every((particle) => TORSO_PARTICLE_SET.has(particle.spec.name))
    ) return true;

    const sameChain = ANATOMICAL_CHAINS.some((chain) =>
      [...firstParticles, ...secondParticles].every((particle) => chain.has(particle.spec.name))
    );
    if (!sameChain) return false;
    return firstParticles.some((firstParticle) =>
      secondParticles.some((secondParticle) => this.areDirectlyConnected(firstParticle, secondParticle))
    );
  }

  private areDirectlyConnected(first: Particle, second: Particle) {
    return first.spec.parent === second.spec.name || second.spec.parent === first.spec.name;
  }

  private pushMinimumConstraint(
    target: MinimumDistanceConstraint[],
    first: Particle,
    second: Particle,
    minimumDistance: number,
    stiffness: number
  ) {
    const fallbackDirection = second.position.clone().sub(first.position);
    if (fallbackDirection.lengthSq() < EPSILON) fallbackDirection.set(1, 0, 0);
    fallbackDirection.normalize();
    target.push({ first, second, minimumDistance, stiffness, fallbackDirection });
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
    const pointIsFinite = point.toArray().every(Number.isFinite);
    let hit = this.particleByName.get(impact.boneName);
    if (!hit && pointIsFinite) {
      let nearestDistance = Infinity;
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

    const localShares = new Map<Particle, number>([[hit, LOCAL_IMPACT_SHARE]]);
    const hitChild = hit.spec.aimChild ? this.particleByName.get(hit.spec.aimChild) : undefined;
    if (hitChild && pointIsFinite) {
      const segment = tempVectorA.copy(hitChild.position).sub(hit.position);
      const segmentLengthSq = segment.lengthSq();
      if (segmentLengthSq > EPSILON) {
        const hitT = THREE.MathUtils.clamp(
          tempVectorB.copy(point).sub(hit.position).dot(segment) / segmentLengthSq,
          0,
          1
        );
        localShares.set(hit, LOCAL_IMPACT_SHARE * (1 - hitT));
        localShares.set(hitChild, LOCAL_IMPACT_SHARE * hitT);
      }
    }
    const localParticles = [...localShares.keys()];

    for (const particle of this.particles) {
      let share = localShares.get(particle) ?? 0;
      if (impact.kind === "explosion") {
        const distance = particle.position.distanceTo(point);
        share += 0.2 * THREE.MathUtils.clamp(1 - distance / 2.4, 0.18, 1);
      } else if (!localShares.has(particle)) {
        const directlyConnected = localParticles.some((localParticle) => (
          particle.spec.parent === localParticle.spec.name
          || localParticle.spec.parent === particle.spec.name
        ));
        if (directlyConnected) share = CONNECTED_BULLET_SHARE;
      }
      if (share > 0) particle.previous.addScaledVector(velocity, -FIXED_STEP * share);
    }
  }

  private simulateFixedStep() {
    // Convert the fixed-step Verlet history to the shorter collision substep.
    // This retains the same velocity while ensuring even a clamped 12 m/s
    // impact advances only ~6.7 cm before capsule contacts are resolved.
    for (const particle of this.particles) {
      particle.previous.lerp(particle.position, 1 - 1 / PHYSICS_SUBSTEPS);
    }

    let maxSpeedSq = 0;
    let hasFloorContact = false;
    for (let substep = 0; substep < PHYSICS_SUBSTEPS; substep += 1) {
      const result = this.simulateCollisionSubstep();
      maxSpeedSq = Math.max(maxSpeedSq, result.maxSpeedSq);
      hasFloorContact ||= result.hasFloorContact;
    }

    // Store history again in fixed-step units; the next call converts it back
    // before substepping. Constraint and contact velocity changes are retained.
    for (const particle of this.particles) {
      const displacement = tempVectorA.copy(particle.position).sub(particle.previous)
        .multiplyScalar(PHYSICS_SUBSTEPS);
      particle.previous.copy(particle.position).sub(displacement);
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

  private simulateCollisionSubstep() {
    for (const particle of this.particles) {
      const velocity = tempVectorA.copy(particle.position).sub(particle.previous).multiplyScalar(SUBSTEP_AIR_DRAG);
      particle.previous.copy(particle.position);
      particle.position.add(velocity);
      particle.position.y += GRAVITY * PHYSICS_STEP * PHYSICS_STEP;
      const displacement = tempVectorB.copy(particle.position).sub(particle.previous);
      const maximumDisplacement = MAX_PARTICLE_SPEED * PHYSICS_STEP;
      if (displacement.lengthSq() > maximumDisplacement * maximumDisplacement) {
        displacement.setLength(maximumDisplacement);
        particle.position.copy(particle.previous).add(displacement);
      }
    }

    for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration += 1) {
      for (const constraint of this.constraints) this.solveConstraint(constraint);
      for (const constraint of this.bendConstraints) this.solveMinimumDistanceConstraint(constraint);
      for (const constraint of this.selfCollisionConstraints) this.solveMinimumDistanceConstraint(constraint);
      for (const constraint of this.segmentCollisionConstraints) this.solveSegmentCollisionConstraint(constraint);
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
        particle.previous.x = particle.position.x - velocityX * FLOOR_TANGENTIAL_RETENTION;
        particle.previous.z = particle.position.z - velocityZ * FLOOR_TANGENTIAL_RETENTION;
        if (velocityY < 0) particle.previous.y = particle.position.y + velocityY * FLOOR_RESTITUTION;
      }
      const displacement = tempVectorA.copy(particle.position).sub(particle.previous);
      const maximumDisplacement = MAX_PARTICLE_SPEED * PHYSICS_STEP;
      if (displacement.lengthSq() > maximumDisplacement * maximumDisplacement) {
        displacement.setLength(maximumDisplacement);
        particle.previous.copy(particle.position).sub(displacement);
      }
      maxSpeedSq = Math.max(
        maxSpeedSq,
        particle.position.distanceToSquared(particle.previous) / (PHYSICS_STEP * PHYSICS_STEP)
      );
    }
    return { maxSpeedSq, hasFloorContact };
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

  private solveMinimumDistanceConstraint(constraint: MinimumDistanceConstraint) {
    const offset = tempVectorA.copy(constraint.second.position).sub(constraint.first.position);
    let distance = offset.length();
    if (distance >= constraint.minimumDistance) return;
    if (distance < EPSILON) {
      offset.copy(constraint.fallbackDirection);
      distance = 0;
    } else {
      offset.multiplyScalar(1 / distance);
    }
    const weight = constraint.first.inverseMass + constraint.second.inverseMass;
    if (weight < EPSILON) return;
    const correction = (constraint.minimumDistance - distance) * constraint.stiffness;
    constraint.first.position.addScaledVector(offset, -correction * constraint.first.inverseMass / weight);
    constraint.second.position.addScaledVector(offset, correction * constraint.second.inverseMass / weight);
  }

  private solveSegmentCollisionConstraint(constraint: SegmentCollisionConstraint) {
    const closest = findClosestSegmentParameters(
      constraint.first.first.position,
      constraint.first.second.position,
      constraint.second.first.position,
      constraint.second.second.position,
      closestSegmentResult
    );
    const firstT = closest.firstT;
    const secondT = closest.secondT;
    const firstPoint = tempVectorG.copy(constraint.first.first.position)
      .lerp(constraint.first.second.position, firstT);
    const secondPoint = tempVectorH.copy(constraint.second.first.position)
      .lerp(constraint.second.second.position, secondT);
    const normal = tempVectorI.copy(secondPoint).sub(firstPoint);
    const distance = normal.length();
    if (distance >= constraint.minimumDistance) return;

    if (distance > EPSILON) {
      normal.multiplyScalar(1 / distance);
      constraint.fallbackNormal.copy(normal);
    } else {
      findClosestSegmentParameters(
        constraint.first.first.previous,
        constraint.first.second.previous,
        constraint.second.first.previous,
        constraint.second.second.previous,
        closestSegmentResult
      );
      firstPoint.copy(constraint.first.first.previous)
        .lerp(constraint.first.second.previous, closestSegmentResult.firstT);
      secondPoint.copy(constraint.second.first.previous)
        .lerp(constraint.second.second.previous, closestSegmentResult.secondT);
      normal.copy(secondPoint).sub(firstPoint);
      if (normal.lengthSq() > EPSILON) {
        normal.normalize();
        if (normal.dot(constraint.fallbackNormal) < 0) normal.multiplyScalar(-1);
      } else {
        normal.copy(constraint.fallbackNormal);
      }
    }

    const firstStartFactor = 1 - firstT;
    const firstEndFactor = firstT;
    const secondStartFactor = 1 - secondT;
    const secondEndFactor = secondT;
    const denominator =
      constraint.first.first.inverseMass * firstStartFactor * firstStartFactor
      + constraint.first.second.inverseMass * firstEndFactor * firstEndFactor
      + constraint.second.first.inverseMass * secondStartFactor * secondStartFactor
      + constraint.second.second.inverseMass * secondEndFactor * secondEndFactor;
    if (denominator < EPSILON) return;

    const correction = (constraint.minimumDistance - distance) * CAPSULE_ITERATION_STIFFNESS / denominator;
    constraint.first.first.position.addScaledVector(
      normal,
      -correction * constraint.first.first.inverseMass * firstStartFactor
    );
    constraint.first.second.position.addScaledVector(
      normal,
      -correction * constraint.first.second.inverseMass * firstEndFactor
    );
    constraint.second.first.position.addScaledVector(
      normal,
      correction * constraint.second.first.inverseMass * secondStartFactor
    );
    constraint.second.second.position.addScaledVector(
      normal,
      correction * constraint.second.second.inverseMass * secondEndFactor
    );
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
