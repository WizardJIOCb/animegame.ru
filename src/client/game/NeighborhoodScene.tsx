import { Html, OrbitControls, Sky, Sparkles, useGLTF } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import type { CatalogItem, HomeState, NeighborhoodResident, PublicUser, RemotePlayer } from "../types";
import {
  createSurfaceImpactMark,
  MuzzleFlashEffect,
  SurfaceImpactEffectView,
  SurfaceImpactMarks,
  type ImpactSurface,
  type SurfaceImpactEffect,
  type SurfaceImpactMark
} from "./CombatEffects";
import { HomePlacedObject, Player } from "./GameScene";
import { OUTLAND_TREE_BLOCKERS, OutlandsEnemyVariantAttachments, OutlandsEnvironment, OutlandsRobot, type RobotMotion } from "./OutlandsWorld";
import {
  TOWN_CAR_MODEL_URL,
  WEAPONS,
  WEAPON_ORDER,
  type BodyPart,
  type CharacterBloodMark,
  type CharacterMotion,
  type RagdollImpact,
  type UpperBodyMotion,
  type WeaponRecoilState,
  type WeaponKind
} from "./combat";
import {
  EXTRACTION_POSITION,
  EXTRACTION_RADIUS,
  isAtExtractionCheckpoint,
  OUTLAND_CONTAINERS,
  OUTLAND_ENEMIES,
  OUTLANDS_ENTRY_Z,
  OUTLANDS_MAX_X,
  OUTLANDS_MIN_X,
  OUTLANDS_MIN_Z,
  WORLD_REGION_LABELS,
  worldRegionAt,
  type OutlandsEnemyDefinition,
  type OutlandsEnemyBehavior,
  type OutlandsEnemyKind,
  type WorldRegion
} from "./outlands";
import type { SkeletonRagdoll } from "./ragdoll";
import type {
  ExpeditionEnemyId,
  ExpeditionGearId,
  ExpeditionGearSlot,
  ExpeditionGrenadeId,
  ExpeditionHitInput,
  ExpeditionHitZone,
  ExpeditionSkillId,
  ExpeditionTacticalId,
  ExpeditionTacticalTarget
} from "../../shared/expedition";
import {
  EXPEDITION_ARTIFACTS,
  EXPEDITION_ARTIFACT_IDS,
  EXPEDITION_DOWNED_BLEED_OUT_MS,
  EXPEDITION_GEAR,
  EXPEDITION_GRENADE_IDS,
  EXPEDITION_GRENADES,
  EXPEDITION_SHIELD_PER_MODULE
} from "../../shared/expedition";

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
  expeditionActive?: boolean;
  expeditionWeapon?: WeaponKind;
  expeditionSkills?: Record<ExpeditionSkillId, number>;
  expeditionGear?: Record<ExpeditionGearSlot, ExpeditionGearId | null>;
  expeditionTacticalCounts?: Partial<Record<ExpeditionTacticalId, number>>;
  expeditionSupportRobotUntil?: number | null;
  expeditionScannerUntil?: number | null;
  lootedContainerIds?: string[];
  lootedEnemyIds?: string[];
  defeatedEnemyIds?: string[];
  enemyHealth?: Partial<Record<ExpeditionEnemyId, number>>;
  expeditionSyncPending?: boolean;
  expeditionAmmo?: number;
  bandageCount?: number;
  shieldCount?: number;
  expeditionHealPulse?: number;
  expeditionPlayerHealth?: number;
  expeditionPlayerShield?: number;
  expeditionDownedAt?: number | null;
  expeditionBleedOutAt?: number | null;
  onWorldRegionChange?: (region: WorldRegion) => void;
  onExtractionAvailabilityChange?: (available: boolean) => void;
  onLootContainer?: (containerId: string) => void;
  onLootEnemy?: (enemyId: string) => void;
  onUseBandage?: () => void | boolean | Promise<void | boolean>;
  onUseTactical?: (
    itemId: ExpeditionTacticalId,
    origin: { x: number; z: number },
    targets: ExpeditionTacticalTarget[]
  ) => void | boolean | Promise<void | boolean>;
  onOpenExpeditionPanel?: (tab?: "inventory" | "skills" | "gear" | "traders") => void;
  onExpeditionShot?: (hits: ExpeditionHitInput[]) => void;
  onExtract?: () => void;
  onPlayerDefeated?: () => boolean | Promise<boolean>;
  onPlayerSurrender?: () => boolean | Promise<boolean>;
  onExpeditionStatusChange?: (status: { health: number; maxHealth: number; shield: number; downed: boolean }) => void;
};

type CarTransform = {
  position: THREE.Vector3;
  rotation: number;
};

type PlayerDownedUiState = {
  fallingUntil: number;
  bleedOutAt: number;
} | null;

type PlayerHitFeedback = "health" | "shield" | "heal";

type CameraBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type InteriorNavBlocker = {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  rotation: number;
};

type InteriorNavCell = {
  x: number;
  z: number;
};

type InteriorNavGrid = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  columns: number;
  rows: number;
  blockers: InteriorNavBlocker[];
};

type PendingInteriorInteraction = {
  itemId: string;
  action: string;
  residentUsername: string;
  approachPoint: THREE.Vector3;
} | null;

const WORLD_MIN_X = OUTLANDS_MIN_X;
const WORLD_MAX_X = OUTLANDS_MAX_X;
const WORLD_MIN_Z = OUTLANDS_MIN_Z;
const WORLD_MAX_Z = 90;
const OUTLANDS_LOCK_Z = -99;
const WALK_SPEED = 2.35;
const RUN_SPEED = 5.15;
const CROUCH_SPEED = 1.15;
const WALK_DELTA_CAP = 0.05;
const JUMP_DURATION_MS = 1180;
const JUMP_HEIGHT = 1.15;
const NPC_MAX_HEALTH = 100;
const NPC_RESPAWN_MS = 6200;
const BULLET_DEATH_IMPULSE_MULTIPLIER = 1.95;
const EXPLOSION_DEATH_IMPULSE_MULTIPLIER = 1.6;
const MAX_DEATH_IMPULSE_SPEED = 14;
const CORPSE_RAGDOLL_RESPONSE_SCALE = 0.38;
const MAX_CORPSE_IMPULSE_SPEED = 8;
const INTERIOR_GRID_STEP = 0.45;
const PLAYER_PATH_CLEARANCE = 0.28;
const CAR_MAX_SPEED = 12.5;
const DOWNED_FALL_MS = 1_350;
const DOWNED_BLEED_OUT_MS = EXPEDITION_DOWNED_BLEED_OUT_MS;
const DOWNED_CRAWL_SPEED = 0.58;
const DOOR_HALF_WIDTH = 0.72;
const WALL_THICKNESS = 0.18;
const UP = new THREE.Vector3(0, 1, 0);
const CAR_COLORS = ["#f472b6", "#38bdf8", "#f59e0b", "#34d399", "#a78bfa", "#fb7185"];
const CITY_TRADERS = [
  { id: "gunsmith", name: "Оружейник Марк", subtitle: "оружие · патроны · гранаты", position: new THREE.Vector3(9.5, 0, -78), color: "#d9773f" },
  { id: "quartermaster", name: "Снабженец Ирис", subtitle: "броня · каски · материалы", position: new THREE.Vector3(-9.5, 0, -78), color: "#3aa67e" },
  { id: "artifacts", name: "Артефактор Нокс", subtitle: "редкие технологии", position: new THREE.Vector3(16.5, 0, -84), color: "#7c5dcc" }
] as const;

type TravelMode = "walk" | "run";
type CameraMode = "strategy" | "thirdPerson";

type NpcRuntime = {
  username: string;
  position: THREE.Vector3;
  rotationRef: { current: number };
  motionRef: { current: CharacterMotion };
  health: number;
  dead: boolean;
  respawnAt: number;
  targetIndex: number;
  idleUntil: number;
  speed: number;
  seed: number;
  respawnNonce: number;
  deathNonce: number;
  bloodMarks: CharacterBloodMark[];
  ragdollImpact?: RagdollImpact;
  ragdollControllerRef: { current: SkeletonRagdoll | null };
  kind: "resident" | OutlandsEnemyKind;
  displayName: string;
  maxHealth: number;
  faction: "civilian" | "neutral" | "hostile";
  enemyId?: string;
  damage: number;
  aggroRange: number;
  attackRange: number;
  attackStyle: "melee" | "ranged";
  behavior: OutlandsEnemyBehavior;
  respawnMs: number;
  homePosition: THREE.Vector3;
  patrol: THREE.Vector3[];
  aggroed: boolean;
  lastAttackAt: number;
  attackUntil: number;
  hitUntil: number;
  robotMotionRef: { current: RobotMotion };
};

type PendingRagdollImpact = Omit<RagdollImpact, "nonce">;

type CombatHit = {
  runtime: NpcRuntime;
  bodyPart: BodyPart;
  boneName: string;
  bone?: THREE.Bone;
  modelRoot?: THREE.Object3D;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
};

type ShotEffect = {
  id: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  weapon: WeaponKind;
  width: number;
  tracerLength: number;
  createdAt: number;
  duration: number;
  tracerDuration: number;
  blastDuration: number;
  blastRadius?: number;
};

type WeaponAmmoState = Record<WeaponKind, number>;

type WeaponReloadState = {
  weapon: WeaponKind;
  startedAt: number;
  endsAt: number;
};

type BloodEffect = {
  id: number;
  point: THREE.Vector3;
  direction: THREE.Vector3;
  createdAt: number;
  duration: number;
};

const BODY_DAMAGE_MULTIPLIER: Record<BodyPart, number> = {
  head: 1.8,
  chest: 1,
  abdomen: 0.95,
  pelvis: 0.9,
  leftUpperArm: 0.76,
  leftLowerArm: 0.72,
  leftHand: 0.64,
  rightUpperArm: 0.76,
  rightLowerArm: 0.72,
  rightHand: 0.64,
  leftThigh: 0.82,
  leftCalf: 0.74,
  leftFoot: 0.64,
  rightThigh: 0.82,
  rightCalf: 0.74,
  rightFoot: 0.64
};

function expeditionHitZone(bodyPart: BodyPart): ExpeditionHitZone {
  if (bodyPart === "head" || bodyPart === "chest" || bodyPart === "abdomen" || bodyPart === "pelvis") {
    return bodyPart;
  }
  if (bodyPart.endsWith("UpperArm")) return "upperArm";
  if (bodyPart.endsWith("LowerArm")) return "lowerArm";
  if (bodyPart.endsWith("Hand")) return "hand";
  if (bodyPart.endsWith("Thigh")) return "thigh";
  if (bodyPart.endsWith("Calf")) return "calf";
  return "foot";
}

const DEFAULT_BODY_PART: BodyPart = "chest";
const DEFAULT_BODY_BONE = "spine_03";
const AIM_CENTER = new THREE.Vector2(0, 0);
const BLOOD_EFFECT_DURATION = 7200;
const SURFACE_IMPACT_DURATION = 1350;
const CHARACTER_BLOOD_MARK_LIMIT = 8;

function createWeaponAmmoState(): WeaponAmmoState {
  return Object.fromEntries(
    WEAPON_ORDER.map((weapon) => [weapon, WEAPONS[weapon].magazineSize])
  ) as WeaponAmmoState;
}

function impactMarkLimits() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return { bullet: 112, rocket: 16 };
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const lowConcurrency = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  return coarsePointer || lowConcurrency ? { bullet: 48, rocket: 8 } : { bullet: 112, rocket: 16 };
}

function objectActorUsername(object: THREE.Object3D | null) {
  let cursor = object;
  while (cursor) {
    if (typeof cursor.userData.playerUsername === "string") return cursor.userData.playerUsername as string;
    cursor = cursor.parent;
  }
  return undefined;
}

function materialIsInvisible(object: THREE.Object3D) {
  if (!(object instanceof THREE.Mesh)) return false;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.length > 0 && materials.every((material) => !material.visible || (material.transparent && material.opacity <= 0.001));
}

function explicitImpactSurface(object: THREE.Object3D | null) {
  let cursor = object;
  while (cursor) {
    const surface = cursor.userData.impactSurface;
    if (surface === "dirt" || surface === "asphalt" || surface === "concrete" || surface === "wood"
      || surface === "metal" || surface === "glass" || surface === "generic") {
      return surface as ImpactSurface;
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function dynamicImpactAnchor(object: THREE.Object3D | null) {
  let cursor = object;
  while (cursor) {
    if (cursor.userData.impactDynamic) return cursor;
    cursor = cursor.parent;
  }
  return undefined;
}

function resolveImpactSurface(object: THREE.Object3D): ImpactSurface {
  const explicit = explicitImpactSurface(object);
  if (explicit) return explicit;

  const objectName = object.name.toLowerCase();
  if (objectName.includes("glass") || objectName.includes("window") || objectName.includes("windshield")) return "glass";
  if (objectName.includes("wood") || objectName.includes("plank") || objectName.includes("fence") || objectName.includes("trunk")) return "wood";
  if (objectName.includes("metal") || objectName.includes("chrome") || objectName.includes("carpaint") || objectName.includes("wheel")) return "metal";

  if (object instanceof THREE.Mesh) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const materialName = material.name.toLowerCase();
      if (materialName.includes("glass") || materialName.includes("window")) return "glass";
      if (materialName.includes("wood") || materialName.includes("plank")) return "wood";
      if (materialName.includes("metal") || materialName.includes("chrome") || materialName.includes("carpaint")) return "metal";
      if (material instanceof THREE.MeshStandardMaterial && material.metalness >= 0.38) return "metal";
    }
  }
  return "generic";
}

function objectIsWorldVisible(object: THREE.Object3D) {
  let cursor: THREE.Object3D | null = object;
  while (cursor) {
    if (!cursor.visible) return false;
    cursor = cursor.parent;
  }
  return true;
}

function isPrimarySceneClick(event: ThreeEvent<MouseEvent>) {
  return event.nativeEvent.button === 0 && event.delta <= 6;
}

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
  return (Math.abs(x) <= 8.6 || (Math.abs(z) <= 5.7 && Math.abs(x) <= 42))
    && x >= WORLD_MIN_X && x <= WORLD_MAX_X
    && z >= WORLD_MIN_Z && z <= WORLD_MAX_Z;
}

function resolveWalkPosition(current: THREE.Vector3, requested: THREE.Vector3, residents: NeighborhoodResident[]) {
  const position = requested.clone();
  position.x = THREE.MathUtils.clamp(position.x, WORLD_MIN_X + 0.6, WORLD_MAX_X - 0.6);
  position.z = THREE.MathUtils.clamp(position.z, WORLD_MIN_Z + 0.6, WORLD_MAX_Z - 0.6);

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

const OUTLANDS_BOX_BLOCKERS = [
  { x: -40, z: -225, halfX: 23, halfZ: 0.7 },
  { x: -61.5, z: -210, halfX: 0.7, halfZ: 15.5 },
  { x: -18.5, z: -210, halfX: 0.7, halfZ: 15.5 },
  { x: -50, z: -215, halfX: 4.5, halfZ: 2.2 },
  { x: -87, z: -280, halfX: 9.5, halfZ: 1.1 },
  { x: -96, z: -275, halfX: 1.1, halfZ: 5.5 },
  { x: -60, z: -279.5, halfX: 7.5, halfZ: 1.1 },
  { x: -67, z: -274, halfX: 1.1, halfZ: 6 },
  { x: -91, z: -308.5, halfX: 6, halfZ: 1.1 },
  { x: -96.5, z: -301, halfX: 1.1, halfZ: 8 },
  { x: -61, z: -310, halfX: 10, halfZ: 1.1 },
  { x: -70.5, z: -306, halfX: 1.1, halfZ: 4.5 }
] as const;

const OUTLANDS_CIRCLE_BLOCKERS = [
  { x: 118, z: -224, radius: 13 },
  { x: 137, z: -250, radius: 17 },
  { x: 124, z: -281, radius: 14 },
  { x: 104, z: -308, radius: 12 },
  { x: 151, z: -303, radius: 20 },
  { x: 14, z: -141, radius: 2.2 },
  ...OUTLAND_TREE_BLOCKERS,
  ...OUTLAND_CONTAINERS.map((container) => ({ x: container.position[0], z: container.position[2], radius: 1.25 }))
];

function resolveOutlandsCollisions(current: THREE.Vector3, requested: THREE.Vector3, clearance = 0.42) {
  if (requested.z > -108 && current.z > -108) return requested;
  const position = requested.clone();
  for (const blocker of OUTLANDS_BOX_BLOCKERS) {
    const halfX = blocker.halfX + clearance;
    const halfZ = blocker.halfZ + clearance;
    const inside = (point: THREE.Vector3) => Math.abs(point.x - blocker.x) < halfX && Math.abs(point.z - blocker.z) < halfZ;
    if (!inside(position) || inside(current)) continue;
    const slideX = new THREE.Vector3(position.x, position.y, current.z);
    const slideZ = new THREE.Vector3(current.x, position.y, position.z);
    if (!inside(slideX) && !inside(slideZ)) {
      position.copy(Math.abs(position.x - current.x) >= Math.abs(position.z - current.z) ? slideX : slideZ);
    } else if (!inside(slideX)) {
      position.copy(slideX);
    } else if (!inside(slideZ)) {
      position.copy(slideZ);
    } else {
      position.copy(current);
    }
  }
  for (const blocker of OUTLANDS_CIRCLE_BLOCKERS) {
    const radius = blocker.radius + clearance;
    const dx = position.x - blocker.x;
    const dz = position.z - blocker.z;
    const distanceSq = dx * dx + dz * dz;
    const currentDistanceSq = (current.x - blocker.x) ** 2 + (current.z - blocker.z) ** 2;
    if (distanceSq >= radius * radius || currentDistanceSq < radius * radius) continue;
    const distance = Math.sqrt(Math.max(distanceSq, 0.000001));
    position.x = blocker.x + dx / distance * radius;
    position.z = blocker.z + dz / distance * radius;
  }
  return position;
}

function blocksInteriorPath(item: CatalogItem) {
  const id = item.id.toLowerCase();
  if (item.type !== "furniture" && item.type !== "decor" && item.type !== "outdoor") return false;
  const isDoorway = id.includes("doorway") || id.includes("build-door");
  const isFloorSurface = (item.size?.[1] ?? Infinity) <= 0.12
    || id.startsWith("kenney-floor")
    || id.includes("rug")
    || id.includes("terrain")
    || id.includes("platform")
    || id.includes("deck")
    || id.includes("lawn")
    || id.startsWith("kenney-nature-ground-")
    || id.startsWith("kenney-nature-path-");
  const isSoftPlant = id.startsWith("kenney-nature-grass") || id.startsWith("kenney-nature-flower");
  return !isDoorway && !isFloorSurface && !isSoftPlant;
}

function makeInteriorNavGrid(resident: NeighborhoodResident, catalog: CatalogItem[]): InteriorNavGrid {
  const wallPadding = 0.38;
  const minX = -houseWidth(resident.houseLevel) / 2 + wallPadding;
  const maxX = houseWidth(resident.houseLevel) / 2 - wallPadding;
  const minZ = -houseDepth(resident.houseLevel) / 2 + wallPadding;
  const maxZ = houseDepth(resident.houseLevel) / 2 - wallPadding;
  const blockers = resident.placedItems.flatMap((placed): InteriorNavBlocker[] => {
    const item = getCatalogItem(catalog, placed.itemId);
    if (!item || !blocksInteriorPath(item)) return [];
    const baseSize = item.size ?? [0.9, 0.9, 0.9];
    const scale = placed.scale ?? 1;
    const width = baseSize[0] * scale;
    const depth = baseSize[2] * scale;
    return [{
      x: placed.x,
      z: placed.z,
      halfX: width / 2 + PLAYER_PATH_CLEARANCE,
      halfZ: depth / 2 + PLAYER_PATH_CLEARANCE,
      rotation: placed.rotation
    }];
  });

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    columns: Math.floor((maxX - minX) / INTERIOR_GRID_STEP) + 1,
    rows: Math.floor((maxZ - minZ) / INTERIOR_GRID_STEP) + 1,
    blockers
  };
}

function isInteriorPointClearOfBlockers(x: number, z: number, grid: InteriorNavGrid) {
  return !grid.blockers.some((blocker) => {
    const dx = x - blocker.x;
    const dz = z - blocker.z;
    const cos = Math.cos(blocker.rotation);
    const sin = Math.sin(blocker.rotation);
    const itemX = dx * cos - dz * sin;
    const itemZ = dx * sin + dz * cos;
    return Math.abs(itemX) <= blocker.halfX && Math.abs(itemZ) <= blocker.halfZ;
  });
}

function isInteriorNavPointWalkable(x: number, z: number, grid: InteriorNavGrid) {
  if (x < grid.minX || x > grid.maxX || z < grid.minZ || z > grid.maxZ) return false;
  return isInteriorPointClearOfBlockers(x, z, grid);
}

function interiorCellKey(cell: InteriorNavCell) {
  return `${cell.x}:${cell.z}`;
}

function interiorCellToLocal(cell: InteriorNavCell, grid: InteriorNavGrid) {
  return new THREE.Vector3(
    grid.minX + cell.x * INTERIOR_GRID_STEP,
    0,
    grid.minZ + cell.z * INTERIOR_GRID_STEP
  );
}

function interiorLocalToCell(point: THREE.Vector3, grid: InteriorNavGrid): InteriorNavCell {
  return {
    x: THREE.MathUtils.clamp(Math.round((point.x - grid.minX) / INTERIOR_GRID_STEP), 0, grid.columns - 1),
    z: THREE.MathUtils.clamp(Math.round((point.z - grid.minZ) / INTERIOR_GRID_STEP), 0, grid.rows - 1)
  };
}

function isInteriorCellWalkable(cell: InteriorNavCell, grid: InteriorNavGrid) {
  const point = interiorCellToLocal(cell, grid);
  return isInteriorNavPointWalkable(point.x, point.z, grid);
}

function nearestInteriorWalkableCell(
  cell: InteriorNavCell,
  grid: InteriorNavGrid,
  connectsToExactPoint?: (cell: InteriorNavCell) => boolean
) {
  const canUse = (candidate: InteriorNavCell) => (
    isInteriorCellWalkable(candidate, grid) && (connectsToExactPoint?.(candidate) ?? true)
  );
  if (canUse(cell)) return cell;
  const maxRadius = Math.max(grid.columns, grid.rows);
  for (let radius = 1; radius < maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const next = { x: cell.x + dx, z: cell.z + dz };
        if (next.x < 0 || next.x >= grid.columns || next.z < 0 || next.z >= grid.rows) continue;
        if (canUse(next)) return next;
      }
    }
  }
  return null;
}

function isInteriorSegmentWalkable(from: THREE.Vector3, to: THREE.Vector3, grid: InteriorNavGrid) {
  const distance = from.distanceTo(to);
  const samples = Math.max(1, Math.ceil(distance / (INTERIOR_GRID_STEP * 0.4)));
  for (let index = 0; index <= samples; index += 1) {
    const point = from.clone().lerp(to, index / samples);
    if (!isInteriorNavPointWalkable(point.x, point.z, grid)) return false;
  }
  return true;
}

function simplifyInteriorPath(points: THREE.Vector3[], grid: InteriorNavGrid) {
  if (points.length <= 2) return points;
  const simplified = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (next > anchor + 1 && !isInteriorSegmentWalkable(points[anchor], points[next], grid)) {
      next -= 1;
    }
    simplified.push(points[next]);
    anchor = next;
  }
  return simplified;
}

function findInteriorPath(
  startWorld: THREE.Vector3,
  goalWorld: THREE.Vector3,
  resident: NeighborhoodResident,
  catalog: CatalogItem[],
  existingGrid?: InteriorNavGrid
) {
  const grid = existingGrid ?? makeInteriorNavGrid(resident, catalog);
  const startLocal = worldToHouseLocal(startWorld, resident).setY(0);
  const goalLocal = worldToHouseLocal(goalWorld, resident).setY(0);
  if (!isInteriorNavPointWalkable(goalLocal.x, goalLocal.z, grid)) return null;
  const startWalkable = isInteriorNavPointWalkable(startLocal.x, startLocal.z, grid);
  const startCell = nearestInteriorWalkableCell(
    interiorLocalToCell(startLocal, grid),
    grid,
    startWalkable
      ? (candidate) => isInteriorSegmentWalkable(startLocal, interiorCellToLocal(candidate, grid), grid)
      : undefined
  );
  const goalCell = nearestInteriorWalkableCell(
    interiorLocalToCell(goalLocal, grid),
    grid,
    (candidate) => isInteriorSegmentWalkable(interiorCellToLocal(candidate, grid), goalLocal, grid)
  );
  if (!startCell || !goalCell) return null;

  const startKey = interiorCellKey(startCell);
  const goalKey = interiorCellKey(goalCell);
  const open: InteriorNavCell[] = [startCell];
  const cameFrom = new Map<string, string>();
  const cells = new Map<string, InteriorNavCell>([[startKey, startCell], [goalKey, goalCell]]);
  const gScore = new Map<string, number>([[startKey, 0]]);
  const directions = [
    { x: 1, z: 0, cost: 1 },
    { x: -1, z: 0, cost: 1 },
    { x: 0, z: 1, cost: 1 },
    { x: 0, z: -1, cost: 1 },
    { x: 1, z: 1, cost: Math.SQRT2 },
    { x: 1, z: -1, cost: Math.SQRT2 },
    { x: -1, z: 1, cost: Math.SQRT2 },
    { x: -1, z: -1, cost: Math.SQRT2 }
  ];
  const heuristic = (cell: InteriorNavCell) => Math.hypot(cell.x - goalCell.x, cell.z - goalCell.z);
  const guardLimit = grid.columns * grid.rows * 2;

  for (let guard = 0; open.length > 0 && guard < guardLimit; guard += 1) {
    open.sort((left, right) => {
      const leftScore = (gScore.get(interiorCellKey(left)) ?? Infinity) + heuristic(left);
      const rightScore = (gScore.get(interiorCellKey(right)) ?? Infinity) + heuristic(right);
      return leftScore - rightScore;
    });
    const current = open.shift()!;
    const currentKey = interiorCellKey(current);

    if (currentKey === goalKey) {
      const cellPath = [current];
      let cursor = currentKey;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!;
        cellPath.push(cells.get(cursor)!);
      }
      cellPath.reverse();

      const localPath = [startLocal.clone()];
      const startCenter = interiorCellToLocal(startCell, grid);
      if (startLocal.distanceTo(startCenter) > 0.08) localPath.push(startCenter);
      for (const cell of cellPath.slice(1)) {
        localPath.push(interiorCellToLocal(cell, grid));
      }
      const finalLocal = goalLocal;
      if (localPath[localPath.length - 1].distanceTo(finalLocal) > 0.08) localPath.push(finalLocal);

      return simplifyInteriorPath(localPath, grid)
        .slice(1)
        .map((point) => houseLocalToWorld(point, resident).setY(0));
    }

    for (const direction of directions) {
      const next = { x: current.x + direction.x, z: current.z + direction.z };
      if (next.x < 0 || next.x >= grid.columns || next.z < 0 || next.z >= grid.rows) continue;
      if (!isInteriorCellWalkable(next, grid)) continue;
      const currentPoint = interiorCellToLocal(current, grid);
      const nextPoint = interiorCellToLocal(next, grid);
      if (!isInteriorSegmentWalkable(currentPoint, nextPoint, grid)) continue;
      if (direction.x !== 0 && direction.z !== 0) {
        if (!isInteriorCellWalkable({ x: current.x + direction.x, z: current.z }, grid)
          || !isInteriorCellWalkable({ x: current.x, z: current.z + direction.z }, grid)) {
          continue;
        }
      }

      const nextKey = interiorCellKey(next);
      const tentativeScore = (gScore.get(currentKey) ?? Infinity) + direction.cost;
      if (tentativeScore >= (gScore.get(nextKey) ?? Infinity)) continue;
      cameFrom.set(nextKey, currentKey);
      cells.set(nextKey, next);
      gScore.set(nextKey, tentativeScore);
      if (!open.some((cell) => interiorCellKey(cell) === nextKey)) open.push(next);
    }
  }

  return null;
}

function interiorDoorApproach(resident: NeighborhoodResident) {
  return houseLocalToWorld(
    new THREE.Vector3(0, 0, houseDepth(resident.houseLevel) / 2 - 0.62),
    resident
  );
}

function isInteriorDoorClear(resident: NeighborhoodResident, catalog: CatalogItem[]) {
  const innerDoorLocal = worldToHouseLocal(interiorDoorApproach(resident), resident);
  const outerDoorLocal = worldToHouseLocal(residentDoorPosition(resident), resident);
  const grid = makeInteriorNavGrid(resident, catalog);
  if (!isInteriorNavPointWalkable(innerDoorLocal.x, innerDoorLocal.z, grid)) return false;
  const samples = Math.ceil((outerDoorLocal.z - innerDoorLocal.z) / 0.12);
  return Array.from({ length: samples + 1 }, (_, index) => (
    innerDoorLocal.z + (outerDoorLocal.z - innerDoorLocal.z) * index / samples
  )).every((z) => isInteriorPointClearOfBlockers(innerDoorLocal.x, z, grid));
}

function appendUniqueRoute(route: THREE.Vector3[], points: THREE.Vector3[]) {
  for (const point of points) {
    const last = route[route.length - 1];
    if (!last || last.distanceTo(point) > 0.08) route.push(point.clone().setY(0));
  }
}

function routeLength(start: THREE.Vector3, route: THREE.Vector3[]) {
  let length = 0;
  let cursor = start;
  for (const point of route) {
    length += cursor.distanceTo(point);
    cursor = point;
  }
  return length;
}

function resolveInteriorItemCollisions(
  current: THREE.Vector3,
  requested: THREE.Vector3,
  residents: NeighborhoodResident[],
  catalog: CatalogItem[]
) {
  const resident = residentAtPosition(requested, residents) ?? residentAtPosition(current, residents);
  if (!resident) return requested;

  const candidate = worldToHouseLocal(requested, resident);
  const currentLocal = worldToHouseLocal(current, resident);

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
  cameraMode,
  cameraYaw,
  cameraPitch,
  shoulderSide,
  aiming,
  worldRoot,
  homePosition,
  homeFront,
  neighborDirection,
  intro,
  inside,
  keys,
  bounds
}: {
  position: THREE.Vector3;
  rotation: number;
  driving: boolean;
  cameraMode: CameraMode;
  cameraYaw: { current: number };
  cameraPitch: { current: number };
  shoulderSide: 1 | -1;
  aiming: boolean;
  worldRoot: { current: THREE.Group | null };
  homePosition: THREE.Vector3;
  homeFront: THREE.Vector3;
  neighborDirection: THREE.Vector3;
  intro: boolean;
  inside: boolean;
  keys: { current: Set<string> };
  bounds: CameraBounds;
}) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const initialized = useRef(false);
  const wasDriving = useRef(driving);
  const wasInside = useRef(inside);
  const drivingState = useRef(driving);
  const cameraModeState = useRef(cameraMode);
  const lookTarget = useRef(new THREE.Vector3());
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const touchPointers = useRef(new Map<number, { x: number; y: number }>());
  const touchPanRef = useRef<{ x: number; y: number } | null>(null);
  const cameraCollisionRaycaster = useRef(new THREE.Raycaster());
  drivingState.current = driving;
  cameraModeState.current = cameraMode;

  function getFlatAxes() {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    right.y = 0;
    right.normalize();

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    return { right, forward };
  }

  function panFlat(move: THREE.Vector3) {
    const controls = controlsRef.current;
    if (!controls || move.lengthSq() === 0) return;

    const nextTarget = controls.target.clone().add(move);
    nextTarget.x = THREE.MathUtils.clamp(nextTarget.x, bounds.minX, bounds.maxX);
    nextTarget.z = THREE.MathUtils.clamp(nextTarget.z, bounds.minZ, bounds.maxZ);
    const appliedMove = nextTarget.sub(controls.target);
    camera.position.add(appliedMove);
    controls.target.add(appliedMove);
    controls.update();
  }

  useEffect(() => {
    const element = gl.domElement;
    const previousTouchAction = element.style.touchAction;
    element.style.touchAction = "none";

    function getTouchCentroid() {
      const points = [...touchPointers.current.values()];
      if (points.length < 2) return null;
      return points.reduce(
        (center, point) => ({
          x: center.x + point.x / points.length,
          y: center.y + point.y / points.length
        }),
        { x: 0, y: 0 }
      );
    }

    function panByScreenDelta(dx: number, dy: number, mode: "drag" | "touch") {
      if (drivingState.current || cameraModeState.current === "thirdPerson") return;
      const controls = controlsRef.current;
      if (!controls) return;
      const { right, forward } = getFlatAxes();
      const distance = camera.position.distanceTo(controls.target);
      const speed = Math.max(0.008, distance * 0.0018);
      const move = mode === "touch"
        ? right.multiplyScalar(dx * speed).add(forward.multiplyScalar(-dy * speed))
        : right.multiplyScalar(-dx * speed).add(forward.multiplyScalar(dy * speed));
      panFlat(move);
    }

    function handlePointerDown(event: PointerEvent) {
      if (drivingState.current || cameraModeState.current === "thirdPerson") return;
      if (event.pointerType === "touch") {
        touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPointers.current.size >= 2) {
          event.preventDefault();
          touchPanRef.current = getTouchCentroid();
          element.setPointerCapture?.(event.pointerId);
        }
        return;
      }

      if (event.button !== 2) return;
      event.preventDefault();
      dragRef.current = { x: event.clientX, y: event.clientY };
      element.setPointerCapture?.(event.pointerId);
    }

    function handlePointerMove(event: PointerEvent) {
      if (drivingState.current || cameraModeState.current === "thirdPerson") return;
      if (event.pointerType === "touch") {
        if (!touchPointers.current.has(event.pointerId)) return;
        touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const centroid = getTouchCentroid();
        if (!centroid) {
          touchPanRef.current = null;
          return;
        }

        event.preventDefault();
        const last = touchPanRef.current ?? centroid;
        touchPanRef.current = centroid;
        panByScreenDelta(centroid.x - last.x, centroid.y - last.y, "touch");
        return;
      }

      const last = dragRef.current;
      if (!last) return;
      event.preventDefault();
      dragRef.current = { x: event.clientX, y: event.clientY };
      panByScreenDelta(event.clientX - last.x, event.clientY - last.y, "drag");
    }

    function handlePointerUp(event: PointerEvent) {
      if (event.pointerType === "touch") {
        touchPointers.current.delete(event.pointerId);
        touchPanRef.current = getTouchCentroid();
      } else if (event.button === 2) {
        dragRef.current = null;
      }
      if (element.hasPointerCapture?.(event.pointerId)) {
        element.releasePointerCapture?.(event.pointerId);
      }
    }

    element.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      element.style.touchAction = previousTouchAction;
      dragRef.current = null;
      touchPointers.current.clear();
      touchPanRef.current = null;
      element.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [camera, gl, bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ]);

  useEffect(() => {
    const element = gl.domElement;
    const handleMouseMove = (event: MouseEvent) => {
      if (cameraModeState.current !== "thirdPerson" || document.pointerLockElement !== element) return;
      cameraYaw.current -= event.movementX * 0.00235;
      cameraPitch.current = THREE.MathUtils.clamp(cameraPitch.current - event.movementY * 0.0019, -0.72, 0.58);
    };
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [cameraPitch, cameraYaw, gl]);

  useEffect(() => {
    if (cameraMode === "strategy") initialized.current = false;
  }, [cameraMode]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const forward = frontVector(rotation);

    if (driving) {
      if (!wasDriving.current) {
        lookTarget.current.copy(controls.target);
      }
      const desired = position.clone().addScaledVector(forward, -10).add(new THREE.Vector3(0, 7.2, 0));
      const target = position.clone().addScaledVector(forward, 5);
      const damping = 1 - Math.exp(-delta * 5.5);
      camera.position.lerp(desired, damping);
      lookTarget.current.lerp(target, damping);
      camera.lookAt(lookTarget.current);
      if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - 48) > 0.01) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, 48, damping);
        camera.updateProjectionMatrix();
      }
      wasDriving.current = true;
      return;
    }

    if (cameraMode === "thirdPerson") {
      const forward = frontVector(cameraYaw.current);
      const right = rightVector(cameraYaw.current);
      const followDistance = inside ? 1.85 : aiming ? 2.2 : 2.85;
      const shoulderOffset = (aiming ? 0.58 : 0.72) * shoulderSide;
      const pivot = position.clone().add(new THREE.Vector3(0, aiming ? 1.32 : 1.45, 0));
      const desired = position.clone()
        .addScaledVector(forward, -followDistance)
        .addScaledVector(right, shoulderOffset)
        .add(new THREE.Vector3(0, aiming ? 1.48 : 1.62, 0));
      const boom = desired.clone().sub(pivot);
      const boomLength = boom.length();
      let snapAroundObstruction = false;
      if (worldRoot.current && boomLength > 0.01) {
        const collisionRay = cameraCollisionRaycaster.current;
        collisionRay.set(pivot, boom.normalize());
        collisionRay.far = boomLength;
        const obstruction = collisionRay.intersectObject(worldRoot.current, true).find(({ object }) => (
          !objectActorUsername(object)
          && !object.userData.aimSurface
          && objectIsWorldVisible(object)
          && !materialIsInvisible(object)
        ));
        if (obstruction) {
          const safeDistance = Math.max(0, obstruction.distance - Math.min(0.12, obstruction.distance * 0.5));
          snapAroundObstruction = camera.position.distanceTo(pivot) > safeDistance + 0.025;
          desired.copy(pivot).addScaledVector(collisionRay.ray.direction, safeDistance);
        }
      }
      const damping = 1 - Math.exp(-delta * 13);
      if (snapAroundObstruction) camera.position.copy(desired);
      else camera.position.lerp(desired, damping);
      const cosPitch = Math.cos(cameraPitch.current);
      const lookDirection = new THREE.Vector3(
        Math.sin(cameraYaw.current) * cosPitch,
        Math.sin(cameraPitch.current),
        Math.cos(cameraYaw.current) * cosPitch
      );
      camera.lookAt(camera.position.clone().addScaledVector(lookDirection, 24));
      const targetFov = aiming ? 42 : 50;
      if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - targetFov) > 0.01) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, damping);
        camera.updateProjectionMatrix();
      }
      wasDriving.current = false;
      return;
    }

    if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - 48) > 0.01) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, 48, 1 - Math.exp(-delta * 8));
      camera.updateProjectionMatrix();
    }

    const changedArea = wasInside.current !== inside;
    if (!initialized.current || changedArea) {
      let desired: THREE.Vector3;
      let target: THREE.Vector3;
      if (inside) {
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
      camera.position.copy(desired);
      controls.target.copy(target);
      lookTarget.current.copy(target);
      camera.lookAt(target);
      controls.update();
      initialized.current = true;
      wasInside.current = inside;
    } else if (wasDriving.current) {
      const target = position.clone().add(new THREE.Vector3(0, 1.1, 0));
      controls.target.copy(target);
      lookTarget.current.copy(target);
      camera.lookAt(target);
      controls.update();
    }
    wasDriving.current = false;

    const x = (keys.current.has("d") || keys.current.has("arrowright") ? 1 : 0)
      - (keys.current.has("a") || keys.current.has("arrowleft") ? 1 : 0);
    const z = (keys.current.has("w") || keys.current.has("arrowup") ? 1 : 0)
      - (keys.current.has("s") || keys.current.has("arrowdown") ? 1 : 0);
    if (x === 0 && z === 0) return;

    const { right, forward: cameraForward } = getFlatAxes();
    const move = right.multiplyScalar(x).add(cameraForward.multiplyScalar(z));
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(delta * 7.2);
      panFlat(move);
    }
  }, -1);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={!driving && cameraMode === "strategy"}
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      panSpeed={0}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      }}
      maxPolarAngle={Math.PI / 2.2}
      minDistance={4.5}
      maxDistance={38}
    />
  );
}

function FollowingSun() {
  const { camera, scene } = useThree();
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    scene.add(target);
    return () => {
      scene.remove(target);
    };
  }, [scene, target]);

  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    target.position.set(camera.position.x, 0, camera.position.z);
    light.position.set(camera.position.x + 18, 28, camera.position.z + 16);
    target.updateMatrixWorld();
  }, -4);

  return (
    <directionalLight
      ref={lightRef}
      target={target}
      castShadow
      intensity={2.25}
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-45}
      shadow-camera-right={45}
      shadow-camera-top={55}
      shadow-camera-bottom={-55}
      shadow-camera-near={0.5}
      shadow-camera-far={95}
      shadow-bias={-0.00012}
    />
  );
}

function Tree({ position, scale = 1, autumn = false }: { position: [number, number, number]; scale?: number; autumn?: boolean }) {
  return (
    <group position={position} scale={scale} userData={{ impactSurface: "wood" }}>
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
    <group position={position} userData={{ impactSurface: "metal" }}>
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
    <group userData={{ impactSurface: "wood" }}>
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
    <group position={[x, y, z]} rotation={[0, rotation, 0]} userData={{ impactSurface: "glass" }}>
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
    <group userData={{ impactSurface: "wood" }}>
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
      userData={{ impactSurface: "concrete" }}
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
        if (!isPrimarySceneClick(event)) return;
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
  onInteract: (
    resident: NeighborhoodResident,
    item: CatalogItem,
    x: number,
    z: number,
    rotation: number,
    size: [number, number, number]
  ) => void;
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
      userData={{ impactSurface: "concrete" }}
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
        if (!isPrimarySceneClick(event)) return;
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
          if (!isPrimarySceneClick(event)) return;
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
            onInteract={(nextItem, x, z, size) => onInteract(resident, nextItem, x, z, placed.rotation, size)}
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

const NPC_PATROL_ROUTE = [
  new THREE.Vector3(-6.1, 0, -68),
  new THREE.Vector3(-6.1, 0, -45),
  new THREE.Vector3(-6.1, 0, -22),
  new THREE.Vector3(-6.1, 0, 0),
  new THREE.Vector3(-6.1, 0, 22),
  new THREE.Vector3(-6.1, 0, 45),
  new THREE.Vector3(-6.1, 0, 68),
  new THREE.Vector3(6.1, 0, 68),
  new THREE.Vector3(6.1, 0, 45),
  new THREE.Vector3(6.1, 0, 22),
  new THREE.Vector3(6.1, 0, 0),
  new THREE.Vector3(6.1, 0, -22),
  new THREE.Vector3(6.1, 0, -45),
  new THREE.Vector3(6.1, 0, -68)
];

function stableNameSeed(name: string) {
  return [...name].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 17);
}

function nearestPatrolIndex(position: THREE.Vector3) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  NPC_PATROL_ROUTE.forEach((point, index) => {
    const distance = point.distanceToSquared(position);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function createNpcRuntime(resident: NeighborhoodResident): NpcRuntime {
  const seed = stableNameSeed(resident.username);
  const streetSide = resident.lot.x < 0 ? -6.1 : 6.1;
  const position = new THREE.Vector3(streetSide, 0, THREE.MathUtils.clamp(resident.lot.z + (seed % 7) - 3, -67, 67));
  return {
    username: resident.username,
    position,
    rotationRef: { current: resident.lot.rotation },
    motionRef: { current: "idle" },
    health: NPC_MAX_HEALTH,
    dead: false,
    respawnAt: 0,
    targetIndex: (nearestPatrolIndex(position) + 1 + (seed % 3)) % NPC_PATROL_ROUTE.length,
    idleUntil: performance.now() + (seed % 2200),
    speed: 0.92 + (seed % 36) / 100,
    seed,
    respawnNonce: 0,
    deathNonce: 0,
    bloodMarks: [],
    ragdollControllerRef: { current: null },
    kind: "resident",
    displayName: resident.username,
    maxHealth: NPC_MAX_HEALTH,
    faction: "civilian",
    damage: 0,
    aggroRange: 0,
    attackRange: 0,
    attackStyle: "melee",
    behavior: "patrol",
    respawnMs: NPC_RESPAWN_MS,
    homePosition: position.clone(),
    patrol: NPC_PATROL_ROUTE,
    aggroed: false,
    lastAttackAt: 0,
    attackUntil: 0,
    hitUntil: 0,
    robotMotionRef: { current: "idle" }
  };
}

function nearestRouteIndex(position: THREE.Vector3, route: THREE.Vector3[]) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  route.forEach((point, index) => {
    const distance = point.distanceToSquared(position);
    if (distance >= bestDistance) return;
    bestDistance = distance;
    bestIndex = index;
  });
  return bestIndex;
}

function createOutlandsRuntime(definition: OutlandsEnemyDefinition): NpcRuntime {
  const seed = stableNameSeed(definition.id);
  const position = new THREE.Vector3().fromArray(definition.position);
  const patrol = definition.patrol.map((point) => new THREE.Vector3().fromArray(point));
  return {
    username: `outlands:${definition.id}`,
    position,
    rotationRef: { current: Math.PI },
    motionRef: { current: definition.kind === "human" ? "armedIdle" : "idle" },
    health: definition.maxHealth,
    dead: false,
    respawnAt: 0,
    targetIndex: (nearestRouteIndex(position, patrol) + 1) % patrol.length,
    idleUntil: performance.now() + seed % 1600,
    speed: definition.speed,
    seed,
    respawnNonce: 0,
    deathNonce: 0,
    bloodMarks: [],
    ragdollControllerRef: { current: null },
    kind: definition.kind,
    displayName: definition.name,
    maxHealth: definition.maxHealth,
    faction: definition.faction,
    enemyId: definition.id,
    damage: definition.damage,
    aggroRange: definition.aggroRange,
    attackRange: definition.attackRange,
    attackStyle: definition.attackStyle,
    behavior: definition.behavior ?? "patrol",
    respawnMs: definition.respawnMs,
    homePosition: position.clone(),
    patrol,
    aggroed: false,
    lastAttackAt: 0,
    attackUntil: 0,
    hitUntil: 0,
    robotMotionRef: { current: "idle" }
  };
}

function ShotEffectView({ effect }: { effect: ShotEffect }) {
  const group = useRef<THREE.Group>(null);
  const tracerRef = useRef<THREE.Mesh>(null);
  const tracerMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const blastMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const blastRef = useRef<THREE.Mesh>(null);
  const tracerStartedAt = useRef<number | null>(null);
  const transform = useMemo(() => {
    const direction = effect.end.clone().sub(effect.start);
    const length = Math.max(0.01, direction.length());
    direction.normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, direction);
    return { direction, length, quaternion };
  }, [effect.end, effect.start]);

  useFrame(() => {
    const now = performance.now();
    const elapsed = now - effect.createdAt;
    if (tracerStartedAt.current === null) tracerStartedAt.current = now;
    const tracerElapsed = now - tracerStartedAt.current;
    const tracerProgress = THREE.MathUtils.clamp(tracerElapsed / effect.tracerDuration, 0, 1);
    const blastProgress = THREE.MathUtils.clamp(elapsed / effect.blastDuration, 0, 1);
    const tracerAlive = tracerElapsed < effect.tracerDuration;
    if (group.current) group.current.visible = tracerAlive || elapsed < effect.duration;
    if (tracerRef.current) {
      const segmentLength = Math.min(effect.tracerLength, transform.length);
      const headDistance = THREE.MathUtils.lerp(segmentLength, transform.length, tracerProgress);
      const tailDistance = Math.max(0, headDistance - segmentLength);
      const visibleLength = Math.max(0.01, headDistance - tailDistance);
      tracerRef.current.visible = tracerAlive;
      tracerRef.current.position.copy(effect.start)
        .addScaledVector(transform.direction, (headDistance + tailDistance) * 0.5);
      tracerRef.current.scale.set(1, visibleLength, 1);
    }
    if (tracerMaterial.current) {
      tracerMaterial.current.opacity = tracerAlive
        ? 0.82 + Math.sin(tracerProgress * Math.PI) * 0.16
        : 0;
    }
    if (blastMaterial.current) blastMaterial.current.opacity = (1 - blastProgress) * 0.48;
    if (blastRef.current) {
      blastRef.current.visible = blastProgress < 1;
      const radius = (effect.blastRadius ?? 0.45) * (0.22 + blastProgress * 0.78);
      blastRef.current.scale.setScalar(radius);
    }
  });

  return (
    <group ref={group}>
      <mesh ref={tracerRef} name={`shot-tracer:${effect.id}`} position={effect.start} quaternion={transform.quaternion} raycast={() => null}>
        <cylinderGeometry args={[effect.width, effect.width, 1, 8]} />
        <meshBasicMaterial ref={tracerMaterial} color={effect.color} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
      </mesh>
      {effect.blastRadius ? (
        <mesh ref={blastRef} name="blast" position={effect.end} raycast={() => null}>
          <sphereGeometry args={[1, 18, 12]} />
          <meshBasicMaterial ref={blastMaterial} color={effect.color} transparent opacity={0.48} depthWrite={false} toneMapped={false} />
        </mesh>
      ) : null}
      <MuzzleFlashEffect
        id={effect.id}
        point={effect.start}
        direction={transform.direction}
        weapon={effect.weapon}
        color={effect.color}
        createdAt={effect.createdAt}
      />
    </group>
  );
}

function bloodRandom(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function BloodHitEffect({ effect }: { effect: BloodEffect }) {
  const cloudRef = useRef<THREE.InstancedMesh>(null);
  const dropletsRef = useRef<THREE.InstancedMesh>(null);
  const stainsRef = useRef<THREE.InstancedMesh>(null);
  const cloudMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const dropletMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const stainMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const particles = useMemo(() => {
    const direction = effect.direction.clone().normalize();
    const right = direction.clone().cross(UP);
    if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
    else right.normalize();
    const spreadUp = right.clone().cross(direction).normalize();
    const clouds = Array.from({ length: 8 }, (_, index) => ({
      velocity: direction.clone().multiplyScalar(0.28 + bloodRandom(effect.id * 41 + index) * 0.7)
        .addScaledVector(right, (bloodRandom(effect.id * 67 + index) - 0.5) * 0.9)
        .addScaledVector(spreadUp, (bloodRandom(effect.id * 89 + index) - 0.35) * 0.7),
      radius: 0.045 + bloodRandom(effect.id * 109 + index) * 0.075
    }));
    const droplets = Array.from({ length: 18 }, (_, index) => {
      const velocity = direction.clone().multiplyScalar(1.15 + bloodRandom(effect.id * 127 + index) * 2.5)
        .addScaledVector(right, (bloodRandom(effect.id * 149 + index) - 0.5) * 2.3)
        .addScaledVector(spreadUp, (bloodRandom(effect.id * 173 + index) - 0.2) * 1.65);
      velocity.y += 0.65 + bloodRandom(effect.id * 191 + index) * 2.15;
      const groundY = 0.018;
      const height = Math.max(0, effect.point.y - groundY);
      const landingTime = THREE.MathUtils.clamp(
        (velocity.y + Math.sqrt(velocity.y * velocity.y + 2 * 9.81 * height)) / 9.81,
        0.16,
        1.65
      );
      const landing = effect.point.clone()
        .addScaledVector(velocity, landingTime)
        .addScaledVector(UP, -0.5 * 9.81 * landingTime * landingTime);
      landing.y = groundY + index * 0.00008;
      return {
        velocity,
        landingTime,
        landing,
        radius: 0.018 + bloodRandom(effect.id * 211 + index) * 0.022,
        stainRadius: 0.045 + bloodRandom(effect.id * 233 + index) * 0.1,
        stainRotation: bloodRandom(effect.id * 257 + index) * Math.PI * 2
      };
    });
    return { clouds, droplets };
  }, [effect.direction, effect.id, effect.point]);
  const scratch = useMemo(() => ({
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    identity: new THREE.Quaternion(),
    groundQuaternion: new THREE.Quaternion(),
    groundEuler: new THREE.Euler()
  }), []);

  useFrame(() => {
    const elapsed = Math.max(0, (performance.now() - effect.createdAt) / 1000);
    const cloudLife = 0.32;
    particles.clouds.forEach((particle, index) => {
      const alive = elapsed < cloudLife;
      scratch.position.copy(effect.point).addScaledVector(particle.velocity, elapsed);
      const radius = alive ? particle.radius * (0.65 + elapsed * 5.5) : 0;
      scratch.scale.setScalar(radius);
      scratch.matrix.compose(scratch.position, scratch.identity, scratch.scale);
      cloudRef.current?.setMatrixAt(index, scratch.matrix);
    });
    if (cloudRef.current) cloudRef.current.instanceMatrix.needsUpdate = true;
    if (cloudMaterialRef.current) {
      const progress = THREE.MathUtils.clamp(elapsed / cloudLife, 0, 1);
      cloudMaterialRef.current.opacity = (1 - progress) * 0.68;
    }

    particles.droplets.forEach((particle, index) => {
      if (elapsed < particle.landingTime) {
        scratch.position.copy(effect.point)
          .addScaledVector(particle.velocity, elapsed)
          .addScaledVector(UP, -0.5 * 9.81 * elapsed * elapsed);
        scratch.scale.setScalar(particle.radius);
      } else {
        scratch.position.copy(particle.landing);
        scratch.scale.setScalar(0);
      }
      scratch.matrix.compose(scratch.position, scratch.identity, scratch.scale);
      dropletsRef.current?.setMatrixAt(index, scratch.matrix);

      if (elapsed >= particle.landingTime && elapsed * 1000 < effect.duration) {
        const stainGrowth = THREE.MathUtils.clamp((elapsed - particle.landingTime) * 8, 0.25, 1);
        scratch.position.copy(particle.landing);
        scratch.scale.set(particle.stainRadius * stainGrowth, particle.stainRadius * (0.55 + index % 3 * 0.18), 1);
        scratch.groundEuler.set(-Math.PI / 2, 0, particle.stainRotation);
        scratch.groundQuaternion.setFromEuler(scratch.groundEuler);
      } else {
        scratch.position.copy(particle.landing);
        scratch.scale.setScalar(0);
        scratch.groundQuaternion.copy(scratch.identity);
      }
      scratch.matrix.compose(scratch.position, scratch.groundQuaternion, scratch.scale);
      stainsRef.current?.setMatrixAt(index, scratch.matrix);
    });
    if (dropletsRef.current) dropletsRef.current.instanceMatrix.needsUpdate = true;
    if (stainsRef.current) stainsRef.current.instanceMatrix.needsUpdate = true;
    if (dropletMaterialRef.current) {
      dropletMaterialRef.current.opacity = elapsed < 1.8 ? 0.96 : 0;
    }
    if (stainMaterialRef.current) {
      const fadeStart = effect.duration / 1000 - 2.2;
      stainMaterialRef.current.opacity = 0.72 * (1 - THREE.MathUtils.clamp((elapsed - fadeStart) / 2.2, 0, 1));
    }
  });

  return (
    <group>
      <instancedMesh ref={cloudRef} args={[undefined, undefined, particles.clouds.length]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[1, 7, 5]} />
        <meshBasicMaterial ref={cloudMaterialRef} color="#9f1239" transparent opacity={0.68} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={dropletsRef} args={[undefined, undefined, particles.droplets.length]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshStandardMaterial ref={dropletMaterialRef} color="#7f1028" emissive="#36040f" emissiveIntensity={0.22} roughness={0.72} transparent />
      </instancedMesh>
      <instancedMesh ref={stainsRef} args={[undefined, undefined, particles.droplets.length]} frustumCulled={false} raycast={() => null} renderOrder={2}>
        <circleGeometry args={[1, 7]} />
        <meshBasicMaterial
          ref={stainMaterialRef}
          color="#5c0716"
          transparent
          opacity={0.72}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  );
}

function TownCar({ color, active = false }: { color: string; active?: boolean }) {
  const gltf = useGLTF(TOWN_CAR_MODEL_URL);
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const surfaceName = `${object.name} ${materials.map((material) => material.name).join(" ")}`.toLowerCase();
      object.userData.impactSurface = surfaceName.includes("glass") || surfaceName.includes("window")
        ? "glass"
        : "metal";
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
    <group userData={{ impactSurface: "metal" }}>
      {active ? (
        <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
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
    <group position={[0, 0.42, 0]} userData={{ impactSurface: "metal" }}>
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
    <group
      position={transform.position}
      rotation={[0, transform.rotation, 0]}
      userData={{ impactSurface: "metal", impactDynamic: true }}
    >
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
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} userData={{ impactSurface: "dirt" }}>
        <planeGeometry args={[116, 170]} />
        <meshStandardMaterial color="#78ad68" roughness={1} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]} userData={{ impactSurface: "asphalt" }}>
        <planeGeometry args={[12.4, 164]} />
        <meshStandardMaterial color="#343942" roughness={0.96} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.026, 0]} userData={{ impactSurface: "asphalt" }}>
        <planeGeometry args={[90, 11.2]} />
        <meshStandardMaterial color="#343942" roughness={0.96} />
      </mesh>
      {[-7.35, 7.35].map((x) => (
        <mesh key={x} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0, 0]} userData={{ impactSurface: "concrete" }}>
          <planeGeometry args={[2.2, 164]} />
          <meshStandardMaterial color="#d5d2ca" roughness={0.97} />
        </mesh>
      ))}
      {[-6.25, 6.25].map((x) => (
        <mesh key={`curb-${x}`} castShadow receiveShadow position={[x, 0.09, 0]} userData={{ impactSurface: "concrete" }}>
          <boxGeometry args={[0.18, 0.18, 164]} />
          <meshStandardMaterial color="#b8b6b0" roughness={0.96} />
        </mesh>
      ))}
      {Array.from({ length: 27 }, (_, index) => (
        <mesh key={`line-${index}`} position={[0, 0.005, -78 + index * 6]} userData={{ impactSurface: "asphalt" }}>
          <boxGeometry args={[0.16, 0.025, 3.2]} />
          <meshStandardMaterial color="#f7e7a0" roughness={0.8} />
        </mesh>
      ))}
      {Array.from({ length: 15 }, (_, index) => (
        <mesh key={`cross-${index}`} position={[-42 + index * 6, 0.007, 0]} userData={{ impactSurface: "asphalt" }}>
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
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[resident.lot.x, -0.005, resident.lot.z]} userData={{ impactSurface: "dirt" }}>
              <planeGeometry args={[27, 19.5]} />
              <meshStandardMaterial color={resident.plotId % 3 === 0 ? "#82b96d" : "#8ec578"} roughness={1} />
            </mesh>
            <group position={fencePosition} rotation={[0, resident.lot.rotation, 0]}>
              <group position={[-5.95, 0, 0]}><Fence length={7.05} /></group>
              <group position={[5.95, 0, 0]}><Fence length={7.05} /></group>
            </group>
            <mesh receiveShadow position={base.clone().addScaledVector(front, halfDepth + 2.05)} rotation={[0, resident.lot.rotation, 0]} userData={{ impactSurface: "concrete" }}>
              <boxGeometry args={[1.55, 0.055, 4.2]} />
              <meshStandardMaterial color="#d7c7a8" roughness={1} />
            </mesh>
            <mesh castShadow position={base.clone().addScaledVector(front, halfDepth + 4.45).addScaledVector(right, -2.25)} userData={{ impactSurface: "metal" }}>
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
          <mesh key={`city-${index}`} castShadow position={[side * (50 + (index % 3) * 3.5), height / 2 - 0.1, z]} userData={{ impactSurface: "concrete" }}>
            <boxGeometry args={[8, height, 8]} />
            <meshStandardMaterial color={index % 3 === 0 ? "#9faec1" : "#b8b0c4"} roughness={0.92} />
          </mesh>
        );
      })}
    </>
  );
}

function OutlandsHumanVariantRig({
  enemyId,
  position,
  rotationRef,
  dead
}: {
  enemyId: string;
  position: THREE.Vector3;
  rotationRef: RefObject<number>;
  dead: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.copy(position);
    groupRef.current.rotation.y = rotationRef.current;
    groupRef.current.visible = !dead;
  });
  return (
    <group ref={groupRef} position={position} rotation={[0, rotationRef.current, 0]}>
      <OutlandsEnemyVariantAttachments enemyId={enemyId} kind="human" />
    </group>
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
  expeditionActive = false,
  expeditionWeapon,
  expeditionSkills,
  expeditionGear,
  expeditionTacticalCounts = {},
  expeditionSupportRobotUntil,
  expeditionScannerUntil,
  lootedContainerIds = [],
  lootedEnemyIds = [],
  defeatedEnemyIds = [],
  enemyHealth,
  expeditionSyncPending = false,
  bandageCount = 0,
  shieldCount = 0,
  expeditionHealPulse = 0,
  expeditionPlayerHealth,
  expeditionPlayerShield,
  expeditionDownedAt,
  expeditionBleedOutAt,
  onWorldRegionChange,
  onExtractionAvailabilityChange,
  onLootContainer,
  onLootEnemy,
  onUseBandage,
  onUseTactical,
  onOpenExpeditionPanel,
  onExpeditionShot,
  onExtract,
  onPlayerDefeated,
  onPlayerSurrender,
  onDrivingChange,
  selectedWeapon,
  onWeaponChange,
  reloadState,
  onConsumeRound,
  onReload,
  aiming,
  onAimingChange,
  onInsideChange,
  cameraMode,
  onCameraModeChange,
  onPointerLockChange,
  recoilRef,
  onVitalsChange,
  onDownedStateChange,
  onPlayerHitFeedback,
  surrenderNonce
}: NeighborhoodSceneProps & {
  onDrivingChange: (driving: boolean) => void;
  selectedWeapon: WeaponKind;
  onWeaponChange: (weapon: WeaponKind) => void;
  reloadState: WeaponReloadState | null;
  onConsumeRound: (weapon: WeaponKind) => number | null;
  onReload: (weapon: WeaponKind) => void;
  aiming: boolean;
  onAimingChange: (aiming: boolean) => void;
  onInsideChange: (inside: boolean) => void;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
  onPointerLockChange: (locked: boolean) => void;
  recoilRef: RefObject<WeaponRecoilState>;
  onVitalsChange: (health: number, region: WorldRegion, shield: number) => void;
  onDownedStateChange: (state: PlayerDownedUiState) => void;
  onPlayerHitFeedback: (feedback: PlayerHitFeedback) => void;
  surrenderNonce: number;
}) {
  const { camera, gl } = useThree();
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
  const travelMode = useRef<TravelMode>("walk");
  const jumpElapsedMs = useRef<number | null>(null);
  const shootingUntil = useRef(0);
  const nextShotAt = useRef(0);
  const shotId = useRef(0);
  const bloodId = useRef(0);
  const bodyBloodId = useRef(0);
  const impactId = useRef(0);
  const shotNonceRef = useRef(0);
  const worldGroupRef = useRef<THREE.Group>(null);
  const playerMuzzleRef = useRef<THREE.Object3D | null>(null);
  const playerAimTargetRef = useRef<THREE.Vector3 | null>(null);
  const aimDistanceRef = useRef(WEAPONS[selectedWeapon].range);
  const lastAimSurfaceAt = useRef(0);
  const cameraModeRef = useRef<CameraMode>(cameraMode);
  const cameraYaw = useRef(initialPosition?.rotation ?? ownResident.lot.rotation);
  const cameraPitch = useRef(-0.08);
  const aimingRef = useRef(aiming);
  const thirdPersonFireHeld = useRef(false);
  const lastPointerLockErrorAt = useRef(0);
  const lastWeaponWheelAt = useRef(0);
  const lastOutlandsGateToastAt = useRef(0);
  const selectedWeaponRef = useRef(selectedWeapon);
  const reloadStateRef = useRef(reloadState);
  const shootAtRef = useRef<(target: THREE.Vector3) => void>(() => undefined);
  const shotRaycaster = useRef(new THREE.Raycaster());
  const aimRaycaster = useRef(new THREE.Raycaster());
  const playerMotionRef = useRef<CharacterMotion>("idle");
  const playerUpperMotionRef = useRef<UpperBodyMotion | null>(null);
  const pendingVisit = useRef<NeighborhoodResident | null>(null);
  const pendingInteraction = useRef<PendingInteriorInteraction>(null);
  const handledVisitRequest = useRef<number | null>(null);
  const drivingRef = useRef(false);
  const lastMoveSent = useRef(0);
  const lastRotationSent = useRef(playerRotation.current);
  const introViewRef = useRef(!initialPosition);
  const activeInteriorRef = useRef<NeighborhoodResident | null>(initialPosition ? residentAtPosition(playerPosition.current, worldResidents) ?? null : ownResident);
  const [renderPlayerPosition] = useState(() => playerPosition.current.clone());
  const renderPlayerRotation = useRef(playerRotation.current);
  const [cameraFollowPosition] = useState(() => playerPosition.current.clone().sub(viewOrigin));
  const [renderCarPosition, setRenderCarPosition] = useState(() => carPosition.current.clone());
  const [renderCarRotation, setRenderCarRotation] = useState(carRotation.current);
  const [moving, setMoving] = useState(false);
  const [playerMotion, setPlayerMotion] = useState<CharacterMotion>("idle");
  const [shotEffects, setShotEffects] = useState<ShotEffect[]>([]);
  const [bloodEffects, setBloodEffects] = useState<BloodEffect[]>([]);
  const [playerRagdollImpact, setPlayerRagdollImpact] = useState<RagdollImpact>();
  const [impactEffects, setImpactEffects] = useState<SurfaceImpactEffect[]>([]);
  const [impactMarks, setImpactMarks] = useState<SurfaceImpactMark[]>([]);
  const [selectedGrenade, setSelectedGrenade] = useState<ExpeditionGrenadeId>("grenade-frag");
  const selectedGrenadeRef = useRef<ExpeditionGrenadeId>("grenade-frag");
  const impactMarkGeometriesRef = useRef(new Set<THREE.BufferGeometry>());
  const markLimits = useMemo(impactMarkLimits, []);
  const [, setNpcUiVersion] = useState(0);
  const [driving, setDriving] = useState(false);
  const [introView, setIntroView] = useState(!initialPosition);
  const [activeInterior, setActiveInterior] = useState<NeighborhoodResident | null>(activeInteriorRef.current);
  const [shoulderSide, setShoulderSide] = useState<1 | -1>(1);
  const restoredDowned = Boolean(expeditionActive && expeditionDownedAt && expeditionBleedOutAt);
  const restoredClockNow = performance.now();
  const restoredFallingUntil = restoredDowned
    ? restoredClockNow + Math.max(0, Number(expeditionDownedAt) + DOWNED_FALL_MS - Date.now())
    : 0;
  const restoredBleedOutAt = restoredDowned
    ? restoredClockNow + Math.max(0, Number(expeditionBleedOutAt) - Date.now())
    : 0;
  const playerHealthRef = useRef(expeditionActive ? expeditionPlayerHealth ?? 100 : 100);
  const playerShieldRef = useRef(expeditionActive
    ? expeditionPlayerShield ?? Math.max(0, shieldCount) * EXPEDITION_SHIELD_PER_MODULE
    : 0);
  const playerDownedRef = useRef(restoredDowned);
  const downedFallingUntilRef = useRef(restoredFallingUntil);
  const downedBleedOutAtRef = useRef(restoredBleedOutAt);
  const healingRef = useRef(false);
  const surrenderRequestedRef = useRef(false);
  const defeatSubmissionRef = useRef(false);
  const defeatRetryAtRef = useRef(0);
  const lastHealPulseRef = useRef(expeditionHealPulse);
  const lastSurrenderNonceRef = useRef(surrenderNonce);
  const enemyDamageTimersRef = useRef(new Set<number>());
  const currentRegionRef = useRef<WorldRegion>(worldRegionAt(playerPosition.current.x, playerPosition.current.z));
  const nearbyContainerRef = useRef<string | undefined>(undefined);
  const nearbyEnemyRef = useRef<string | undefined>(undefined);
  const nearExtractionRef = useRef(false);
  const extractionAvailableRef = useRef(false);
  const [nearbyContainerId, setNearbyContainerId] = useState<string>();
  const [nearbyEnemyId, setNearbyEnemyId] = useState<string>();
  const [nearExtraction, setNearExtraction] = useState(false);
  const lootedContainerSet = useMemo(() => new Set(lootedContainerIds), [lootedContainerIds]);
  const lootedEnemySet = useMemo(() => new Set(lootedEnemyIds), [lootedEnemyIds]);
  const defeatedEnemySet = useMemo(() => new Set(defeatedEnemyIds), [defeatedEnemyIds]);
  const expeditionActiveRef = useRef(expeditionActive);
  const previousExpeditionActiveRef = useRef(false);
  const expeditionWeaponRef = useRef<WeaponKind | undefined>(expeditionWeapon);
  const survivalSkillLevel = expeditionSkills?.survival ?? 0;
  const weaponSkillLevel = expeditionSkills?.weapons ?? 0;
  const playerMaxHealthRef = useRef(100 + survivalSkillLevel * 10);
  const weaponSkillLevelRef = useRef(weaponSkillLevel);
  const bandageCountRef = useRef(bandageCount);
  const tacticalCountsRef = useRef(expeditionTacticalCounts);
  const tacticalBusyRef = useRef(false);
  const supportRobotPosition = useRef(playerPosition.current.clone().add(new THREE.Vector3(-2, 0, 1.5)));
  const supportRobotRotation = useRef(0);
  const supportRobotMotion = useRef<RobotMotion>("idle");
  const nextSupportShotAt = useRef(0);
  const supportRobotUntilRef = useRef(expeditionSupportRobotUntil ?? 0);

  const ownOutfit = getCatalogItem(catalog, user.avatar.outfit);
  const ownCharacter = getCatalogItem(catalog, user.avatar.character);
  const ownPet = getCatalogItem(catalog, user.avatar.pet);
  const outlandsHumanVisuals = worldResidents.filter((resident) => resident.username !== user.username);
  const rangerVisual = outlandsHumanVisuals[0] ?? ownResident;
  const rangerPosition = useMemo(() => new THREE.Vector3(13.5, 0, -93), []);
  const onToastRef = useRef(onToast);
  const onMoveRef = useRef(onMove);
  const buildModeRef = useRef(buildMode);
  const lootedContainerSetRef = useRef(lootedContainerSet);
  const lootedEnemySetRef = useRef(lootedEnemySet);
  const onDrivingChangeRef = useRef(onDrivingChange);
  const onExtractRef = useRef(onExtract);
  const onLootContainerRef = useRef(onLootContainer);
  const onLootEnemyRef = useRef(onLootEnemy);
  const onUseBandageRef = useRef(onUseBandage);
  const onUseTacticalRef = useRef(onUseTactical);
  const onReloadRef = useRef(onReload);
  const onWeaponChangeRef = useRef(onWeaponChange);

  cameraModeRef.current = cameraMode;
  aimingRef.current = aiming;
  selectedWeaponRef.current = selectedWeapon;
  reloadStateRef.current = reloadState;
  expeditionActiveRef.current = expeditionActive;
  expeditionWeaponRef.current = expeditionWeapon;
  tacticalCountsRef.current = expeditionTacticalCounts;
  supportRobotUntilRef.current = expeditionSupportRobotUntil ?? 0;
  onUseTacticalRef.current = onUseTactical;
  playerMaxHealthRef.current = 100 + survivalSkillLevel * 10;
  weaponSkillLevelRef.current = weaponSkillLevel;
  bandageCountRef.current = bandageCount;
  buildModeRef.current = buildMode;
  lootedContainerSetRef.current = lootedContainerSet;
  lootedEnemySetRef.current = lootedEnemySet;
  onDrivingChangeRef.current = onDrivingChange;
  onExtractRef.current = onExtract;
  onLootContainerRef.current = onLootContainer;
  onLootEnemyRef.current = onLootEnemy;
  onUseBandageRef.current = onUseBandage;
  onReloadRef.current = onReload;
  onWeaponChangeRef.current = onWeaponChange;

  useEffect(() => {
    onToastRef.current = onToast;
  }, [onToast]);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => () => {
    onExtractionAvailabilityChange?.(false);
    for (const timer of enemyDamageTimersRef.current) window.clearTimeout(timer);
    enemyDamageTimersRef.current.clear();
  }, [onExtractionAvailabilityChange]);

  useEffect(() => {
    const region = worldRegionAt(playerPosition.current.x, playerPosition.current.z);
    currentRegionRef.current = region;
    onWorldRegionChange?.(region);
    onVitalsChange(playerHealthRef.current, region, playerShieldRef.current);
  }, [onVitalsChange, onWorldRegionChange]);

  useEffect(() => {
    if (expeditionActive) return;
    const playerOutside = playerPosition.current.z < OUTLANDS_LOCK_Z;
    const carOutside = carPosition.current.z < OUTLANDS_LOCK_Z;
    if (!playerOutside && !carOutside) return;
    if (drivingRef.current) {
      drivingRef.current = false;
      setDriving(false);
      onDrivingChange(false);
    }
    if (carOutside) {
      carPosition.current.copy(ownCarStart.position);
      carRotation.current = ownCarStart.rotation;
      carSpeed.current = 0;
      setRenderCarPosition(ownCarStart.position.clone());
      setRenderCarRotation(ownCarStart.rotation);
    }
    if (playerOutside) {
      playerPosition.current.set(0, 0, -72);
      playerRotation.current = Math.PI;
      currentRegionRef.current = "city";
      onWorldRegionChange?.("city");
      onVitalsChange(playerHealthRef.current, "city", playerShieldRef.current);
      onMoveRef.current({ x: 0, y: 0, z: -72, rotation: Math.PI, vehicle: false });
    }
  }, [expeditionActive, onDrivingChange, onVitalsChange, onWorldRegionChange, ownCarStart]);

  useEffect(() => {
    onInsideChange(Boolean(activeInterior));
    if (activeInterior) {
      keys.current.delete("q");
      thirdPersonFireHeld.current = false;
      aimingRef.current = false;
      onAimingChange(false);
      document.body.style.cursor = "default";
    }
  }, [activeInterior, onAimingChange, onInsideChange]);

  const npcRuntimeMap = useRef(new Map<string, NpcRuntime>());
  const npcActors = useMemo(() => {
    const remoteNames = new Set(remotePlayers.map((player) => player.username.toLowerCase()));
    return worldResidents.filter((resident) => (
      resident.username !== user.username && !remoteNames.has(resident.username.toLowerCase())
    )).map((resident) => {
    let runtime = npcRuntimeMap.current.get(resident.username);
    if (!runtime) {
      runtime = createNpcRuntime(resident);
      npcRuntimeMap.current.set(resident.username, runtime);
    }
    return { resident, runtime };
    });
  }, [remotePlayers, user.username, worldResidents]);

  const outlandsActors = useMemo(() => OUTLAND_ENEMIES.map((definition) => {
    const username = `outlands:${definition.id}`;
    let runtime = npcRuntimeMap.current.get(username);
    if (!runtime) {
      runtime = createOutlandsRuntime(definition);
      npcRuntimeMap.current.set(username, runtime);
    }
    return { definition, runtime };
  }), []);

  useEffect(() => {
    if (previousExpeditionActiveRef.current === expeditionActive) return;
    const wasActive = previousExpeditionActiveRef.current;
    previousExpeditionActiveRef.current = expeditionActive;
    const now = performance.now();
    const nextDowned = Boolean(expeditionActive && expeditionDownedAt && expeditionBleedOutAt);
    playerHealthRef.current = expeditionActive
      ? THREE.MathUtils.clamp(expeditionPlayerHealth ?? playerMaxHealthRef.current, 0, playerMaxHealthRef.current)
      : playerMaxHealthRef.current;
    playerShieldRef.current = expeditionActive
      ? Math.max(0, expeditionPlayerShield ?? Math.max(0, shieldCount) * EXPEDITION_SHIELD_PER_MODULE)
      : 0;
    playerDownedRef.current = nextDowned;
    setPlayerRagdollImpact(undefined);
    downedFallingUntilRef.current = nextDowned
      ? now + Math.max(0, Number(expeditionDownedAt) + DOWNED_FALL_MS - Date.now())
      : 0;
    downedBleedOutAtRef.current = nextDowned
      ? now + Math.max(0, Number(expeditionBleedOutAt) - Date.now())
      : 0;
    onDownedStateChange(nextDowned ? {
      fallingUntil: downedFallingUntilRef.current,
      bleedOutAt: downedBleedOutAtRef.current
    } : null);
    for (const { runtime } of outlandsActors) {
      const defeated = Boolean(expeditionActive && runtime.enemyId && defeatedEnemySet.has(runtime.enemyId));
      const storedHealth = runtime.enemyId ? Number(enemyHealth?.[runtime.enemyId as ExpeditionEnemyId]) : Number.NaN;
      const authoritativeHealth = Number.isFinite(storedHealth)
        ? THREE.MathUtils.clamp(storedHealth, 0, runtime.maxHealth)
        : runtime.maxHealth;
      runtime.position.copy(runtime.homePosition);
      runtime.health = defeated ? 0 : authoritativeHealth;
      runtime.dead = defeated;
      runtime.respawnAt = defeated ? Number.POSITIVE_INFINITY : 0;
      runtime.bloodMarks = [];
      runtime.ragdollImpact = undefined;
      runtime.ragdollControllerRef.current = null;
      runtime.respawnNonce += 1;
      runtime.targetIndex = (nearestRouteIndex(runtime.position, runtime.patrol) + 1) % runtime.patrol.length;
      runtime.idleUntil = performance.now() + 500;
      runtime.lastAttackAt = 0;
      runtime.attackUntil = 0;
      runtime.hitUntil = 0;
      runtime.aggroed = false;
      runtime.motionRef.current = defeated ? "death" : runtime.kind === "human" ? "armedIdle" : "idle";
      runtime.robotMotionRef.current = defeated ? "death" : "idle";
    }
    setNpcUiVersion((version) => version + 1);

    if (wasActive && !expeditionActive) {
      if (drivingRef.current) {
        drivingRef.current = false;
        setDriving(false);
        onDrivingChange(false);
      }
      if (carPosition.current.z <= OUTLANDS_ENTRY_Z) {
        carPosition.current.copy(ownCarStart.position);
        carRotation.current = ownCarStart.rotation;
        carSpeed.current = 0;
        setRenderCarPosition(ownCarStart.position.clone());
        setRenderCarRotation(ownCarStart.rotation);
      }
      if (playerPosition.current.z <= OUTLANDS_ENTRY_Z) {
        playerPosition.current.set(0, 0, -72);
        playerRotation.current = Math.PI;
        clickTarget.current = null;
        clickPath.current = [];
        currentRegionRef.current = "city";
        onWorldRegionChange?.("city");
        onMoveRef.current({ x: 0, y: 0, z: -72, rotation: Math.PI, vehicle: false });
      }
    }
    onVitalsChange(playerHealthRef.current, currentRegionRef.current, playerShieldRef.current);
  }, [defeatedEnemySet, enemyHealth, expeditionActive, expeditionBleedOutAt, expeditionDownedAt, expeditionPlayerHealth, expeditionPlayerShield, onDownedStateChange, onDrivingChange, onVitalsChange, onWorldRegionChange, outlandsActors, ownCarStart, shieldCount]);

  useEffect(() => {
    if (!expeditionActive) return;
    let changed = false;
    if (Number.isFinite(expeditionPlayerHealth)) {
      const nextHealth = THREE.MathUtils.clamp(
        Number(expeditionPlayerHealth),
        0,
        playerMaxHealthRef.current
      );
      if (nextHealth !== playerHealthRef.current) {
        playerHealthRef.current = nextHealth;
        changed = true;
      }
    }
    if (Number.isFinite(expeditionPlayerShield)) {
      const nextShield = Math.max(0, Number(expeditionPlayerShield));
      if (nextShield !== playerShieldRef.current) {
        playerShieldRef.current = nextShield;
        changed = true;
      }
    }
    if (expeditionDownedAt && expeditionBleedOutAt) {
      const now = performance.now();
      const nextFallingUntil = now + Math.max(0, expeditionDownedAt + DOWNED_FALL_MS - Date.now());
      const nextBleedOutAt = now + Math.max(0, expeditionBleedOutAt - Date.now());
      playerDownedRef.current = true;
      downedFallingUntilRef.current = nextFallingUntil;
      downedBleedOutAtRef.current = nextBleedOutAt;
      updatePlayerMotion("death");
      onDownedStateChange({ fallingUntil: nextFallingUntil, bleedOutAt: nextBleedOutAt });
      changed = true;
    }
    if (changed) {
      onVitalsChange(playerHealthRef.current, currentRegionRef.current, playerShieldRef.current);
    }
  }, [expeditionActive, expeditionBleedOutAt, expeditionDownedAt, expeditionPlayerHealth, expeditionPlayerShield, onDownedStateChange, onVitalsChange]);

  useEffect(() => {
    if (lastHealPulseRef.current === expeditionHealPulse) return;
    lastHealPulseRef.current = expeditionHealPulse;
    if (!expeditionActive || playerDownedRef.current) return;
    onVitalsChange(playerHealthRef.current, currentRegionRef.current, playerShieldRef.current);
    onPlayerHitFeedback("heal");
    onToastRef.current("Бинт использован · здоровье восстановлено");
  }, [expeditionActive, expeditionHealPulse, onPlayerHitFeedback, onVitalsChange]);

  useEffect(() => {
    // Keep the immediate hit reaction while requests are queued. Applying an
    // older response between two automatic-rifle shots would otherwise heal or
    // briefly revive the target. The final authoritative snapshot is applied
    // as soon as the queue drains.
    if (!expeditionActive || expeditionSyncPending) return;
    let changed = false;
    for (const { runtime } of outlandsActors) {
      if (!runtime.enemyId) continue;
      const enemyId = runtime.enemyId as ExpeditionEnemyId;
      const storedHealth = Number(enemyHealth?.[enemyId]);
      const nextHealth = defeatedEnemySet.has(enemyId)
        ? 0
        : Number.isFinite(storedHealth)
          ? THREE.MathUtils.clamp(storedHealth, 0, runtime.maxHealth)
          : runtime.maxHealth;
      const shouldBeDead = nextHealth <= 0 || defeatedEnemySet.has(enemyId);
      if (runtime.health !== nextHealth) {
        runtime.health = nextHealth;
        changed = true;
      }
      if (shouldBeDead && !runtime.dead) {
        runtime.dead = true;
        runtime.respawnAt = Number.POSITIVE_INFINITY;
        runtime.hitUntil = 0;
        runtime.aggroed = false;
        runtime.motionRef.current = "death";
        runtime.robotMotionRef.current = "death";
        changed = true;
      } else if (!shouldBeDead && runtime.dead) {
        runtime.dead = false;
        runtime.respawnAt = 0;
        runtime.ragdollImpact = undefined;
        runtime.ragdollControllerRef.current = null;
        runtime.respawnNonce += 1;
        runtime.motionRef.current = runtime.kind === "human" ? "armedIdle" : "idle";
        runtime.robotMotionRef.current = "idle";
        changed = true;
      }
    }
    if (changed) setNpcUiVersion((version) => version + 1);
  }, [defeatedEnemySet, enemyHealth, expeditionActive, expeditionSyncPending, outlandsActors]);

  const remoteVectors = useMemo(() => remotePlayers.map((player) => ({
    ...player,
    vector: new THREE.Vector3(player.position.x, player.position.y, player.position.z),
    outfit: getCatalogItem(catalog, player.avatar?.outfit),
    character: getCatalogItem(catalog, player.avatar?.character),
    pet: getCatalogItem(catalog, player.avatar?.pet)
  })), [catalog, remotePlayers]);

  function finishInteriorInteraction(interaction: NonNullable<PendingInteriorInteraction>) {
    const stillInsideTargetHome = activeInteriorRef.current?.username === interaction.residentUsername;
    const reachedApproachPoint = playerPosition.current.distanceTo(interaction.approachPoint) <= 0.42;
    if (!stillInsideTargetHome || !reachedApproachPoint) {
      onToast("Не получилось подойти к предмету достаточно близко");
      return;
    }
    onInteract(interaction.itemId, interaction.action);
  }

  function startClickRoute(
    points: THREE.Vector3[],
    interaction: PendingInteriorInteraction = null,
    requestedMode?: TravelMode
  ) {
    const route = points.filter((point, index) => index === 0 || point.distanceTo(points[index - 1]) > 0.08);
    travelMode.current = requestedMode ?? (keys.current.has("shift") ? "run" : "walk");
    clickTarget.current = route.shift() ?? null;
    clickPath.current = route;
    pendingInteraction.current = interaction;
    if (!clickTarget.current && interaction) {
      pendingInteraction.current = null;
      finishInteriorInteraction(interaction);
    }
  }

  function buildRouteToInteriorEntry(resident: NeighborhoodResident) {
    const currentInterior = activeInteriorRef.current;
    const route: THREE.Vector3[] = [];
    let cursor = playerPosition.current.clone();

    if (currentInterior && currentInterior.username !== resident.username) {
      if (!isInteriorDoorClear(currentInterior, catalog)) {
        onToast("Путь к двери перекрыт предметами");
        return null;
      }
      const innerDoor = interiorDoorApproach(currentInterior);
      const exitPath = findInteriorPath(cursor, innerDoor, currentInterior, catalog);
      if (!exitPath) {
        onToast("Путь к двери перекрыт предметами");
        return null;
      }
      appendUniqueRoute(route, exitPath);
      appendUniqueRoute(route, [residentDoorPosition(currentInterior)]);
      cursor = residentDoorPosition(currentInterior);
    }

    if (!currentInterior || currentInterior.username !== resident.username) {
      const outerDoor = residentDoorPosition(resident);
      const innerDoor = interiorDoorApproach(resident);
      if (!isInteriorDoorClear(resident, catalog)) {
        onToast("Вход в дом перекрыт предметами");
        return null;
      }
      appendUniqueRoute(route, [outerDoor, innerDoor]);
      cursor = innerDoor;
    }

    return { route, cursor };
  }

  function routeToResident(resident: NeighborhoodResident) {
    clickTarget.current = null;
    clickPath.current = [];
    pendingVisit.current = null;
    pendingInteraction.current = null;
    const entry = buildRouteToInteriorEntry(resident);
    if (!entry) return false;
    const { route, cursor } = entry;

    const target = residentInteriorTarget(resident);
    const interiorPath = findInteriorPath(cursor, target, resident, catalog);
    if (!interiorPath) {
      onToast("Не получается проложить путь внутри дома");
      return false;
    }
    appendUniqueRoute(route, interiorPath);
    pendingVisit.current = resident;
    startClickRoute(route);
    return true;
  }

  function updatePlayerMotion(next: CharacterMotion) {
    if (playerMotionRef.current === next) return;
    playerMotionRef.current = next;
    setPlayerMotion(next);
  }

  function setAiming(next: boolean) {
    aimingRef.current = next;
    onAimingChange(next);
  }

  function requestThirdPersonPointerLock() {
    const reportError = () => {
      const now = performance.now();
      if (now - lastPointerLockErrorAt.current < 800) return;
      lastPointerLockErrorAt.current = now;
      onToastRef.current("Не удалось захватить мышь — кликните по сцене ещё раз");
    };
    try {
      if (!gl.domElement.requestPointerLock) {
        reportError();
        return;
      }
      const request = gl.domElement.requestPointerLock();
      if (request && typeof request.catch === "function") {
        request.catch(reportError);
      }
    } catch {
      reportError();
    }
  }

  function setCameraMode(next: CameraMode, capturePointer = true) {
    cameraModeRef.current = next;
    onCameraModeChange(next);
    clickTarget.current = null;
    clickPath.current = [];
    pendingVisit.current = null;
    pendingInteraction.current = null;
    keys.current.delete("q");
    thirdPersonFireHeld.current = false;
    setAiming(false);
    if (next === "thirdPerson") {
      cameraYaw.current = playerRotation.current;
      cameraPitch.current = -0.08;
      lastRotationSent.current = playerRotation.current;
      if (capturePointer) requestThirdPersonPointerLock();
      else if (document.pointerLockElement === gl.domElement) document.exitPointerLock?.();
    } else if (document.pointerLockElement === gl.domElement) {
      document.exitPointerLock?.();
    }
  }

  function combatMetadata(object: THREE.Object3D) {
    if (!object.userData.combatHitbox) return null;
    const username = object.userData.combatUsername ?? object.userData.username;
    const runtime = typeof username === "string" ? npcRuntimeMap.current.get(username) : undefined;
    if (!runtime) return null;
    return {
      runtime,
      bodyPart: (object.userData.bodyPart ?? DEFAULT_BODY_PART) as BodyPart,
      boneName: String(object.userData.boneName ?? DEFAULT_BODY_BONE),
      bone: object.userData.combatBone instanceof THREE.Bone
        ? object.userData.combatBone as THREE.Bone
        : undefined,
      modelRoot: object.userData.combatRoot instanceof THREE.Object3D
        ? object.userData.combatRoot as THREE.Object3D
        : undefined
    };
  }

  function validRayIntersection(intersections: THREE.Intersection[]) {
    for (const intersection of intersections) {
      const object = intersection.object;
      if (object.name.startsWith("shot-tracer:")) continue;
      if (object.userData.aimSurface) continue;
      if (!objectIsWorldVisible(object)) continue;
      const actorUsername = objectActorUsername(object);
      if (actorUsername === user.username) continue;
      const combat = combatMetadata(object);
      if (combat) return { intersection, combat };
      if (object.userData.combatHitbox || actorUsername) continue;
      if (materialIsInvisible(object)) continue;
      return { intersection, combat: null };
    }
    return null;
  }

  function intersectionWorldNormal(intersection: THREE.Intersection, incoming: THREE.Vector3) {
    let objectMatrix = intersection.object.matrixWorld;
    if (intersection.object instanceof THREE.InstancedMesh && intersection.instanceId !== undefined) {
      const instanceMatrix = new THREE.Matrix4();
      intersection.object.getMatrixAt(intersection.instanceId, instanceMatrix);
      objectMatrix = new THREE.Matrix4().multiplyMatrices(intersection.object.matrixWorld, instanceMatrix);
    }
    const normal = intersection.face
      ? intersection.face.normal.clone().applyNormalMatrix(
          new THREE.Matrix3().getNormalMatrix(objectMatrix)
        ).normalize()
      : incoming.clone().negate();
    if (normal.dot(incoming) > 0) normal.negate();
    return normal;
  }

  function preciseCombatIntersection(combat: ReturnType<typeof combatMetadata>) {
    if (!combat?.modelRoot) return null;
    combat.modelRoot.updateWorldMatrix(true, true);
    const intersections: THREE.Intersection[] = [];
    combat.modelRoot.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh) || !objectIsWorldVisible(object)) return;
      object.computeBoundingBox();
      object.computeBoundingSphere();
      THREE.SkinnedMesh.prototype.raycast.call(object, shotRaycaster.current, intersections);
    });
    intersections.sort((left, right) => left.distance - right.distance);
    return intersections[0] ?? null;
  }

  function closestCombatZones(referencePoint: THREE.Vector3) {
    const group = worldGroupRef.current;
    const closest = new Map<NpcRuntime, {
      bodyPart: BodyPart;
      boneName: string;
      bone?: THREE.Bone;
      modelRoot?: THREE.Object3D;
      point: THREE.Vector3;
    }>();
    const bestDistances = new Map<NpcRuntime, number>();
    if (!group) return closest;
    group.traverse((object) => {
      const metadata = combatMetadata(object);
      if (!metadata) return;
      const center = object.getWorldPosition(new THREE.Vector3());
      const towardCenter = center.clone().sub(referencePoint);
      let point = center;
      if (towardCenter.lengthSq() > 0.000001) {
        const raycaster = shotRaycaster.current;
        const centerDistance = towardCenter.length();
        raycaster.set(referencePoint, towardCenter.multiplyScalar(1 / centerDistance));
        raycaster.near = 0;
        raycaster.far = centerDistance + 2;
        point = raycaster.intersectObject(object, false)[0]?.point.clone() ?? center;
      }
      const distance = point.distanceToSquared(referencePoint);
      if (distance >= (bestDistances.get(metadata.runtime) ?? Infinity)) return;
      bestDistances.set(metadata.runtime, distance);
      closest.set(metadata.runtime, {
        bodyPart: metadata.bodyPart,
        boneName: metadata.boneName,
        bone: metadata.bone,
        modelRoot: metadata.modelRoot,
        point
      });
    });
    return closest;
  }

  function blastReachesTarget(origin: THREE.Vector3, target: THREE.Vector3) {
    const group = worldGroupRef.current;
    if (!group) return false;
    const direction = target.clone().sub(origin);
    const distance = direction.length();
    if (distance <= 0.12) return true;
    direction.normalize();
    const raycaster = shotRaycaster.current;
    const hasEnvironmentBlock = (intersections: THREE.Intersection[]) => intersections.some(({ object, distance: hitDistance }) => (
      hitDistance < distance - 0.025
      && !object.name.startsWith("shot-tracer:")
      && !objectActorUsername(object)
      && !object.userData.combatHitbox
      && !object.userData.aimSurface
      && objectIsWorldVisible(object)
      && !materialIsInvisible(object)
    ));

    raycaster.set(origin.clone().addScaledVector(direction, 0.006), direction);
    raycaster.far = Math.max(0.01, distance - 0.012);
    if (hasEnvironmentBlock(raycaster.intersectObject(group, true))) return false;

    const reverse = direction.clone().multiplyScalar(-1);
    raycaster.set(target.clone().addScaledVector(reverse, 0.006), reverse);
    raycaster.far = Math.max(0.01, distance - 0.012);
    return !hasEnvironmentBlock(raycaster.intersectObject(group, true));
  }

  function damageNpc(runtime: NpcRuntime, damage: number, now: number, impact: PendingRagdollImpact) {
    if (runtime.dead || damage <= 0) return false;
    if (runtime.faction === "hostile") runtime.aggroed = true;
    runtime.health = Math.max(0, runtime.health - Math.round(damage));
    runtime.hitUntil = now + 340;
    if (runtime.kind === "eyeDrone" || runtime.kind === "quadShell") runtime.robotMotionRef.current = "hit";
    if (runtime.health === 0) {
      runtime.dead = true;
      runtime.respawnAt = now + runtime.respawnMs;
      runtime.motionRef.current = "death";
      runtime.robotMotionRef.current = "death";
      runtime.deathNonce += 1;
      if (runtime.kind === "resident" || runtime.kind === "human") {
        const deathVelocity = new THREE.Vector3().fromArray(impact.velocity);
        if (Number.isFinite(deathVelocity.lengthSq()) && deathVelocity.lengthSq() > 0) {
          deathVelocity
            .multiplyScalar(impact.kind === "bullet"
              ? BULLET_DEATH_IMPULSE_MULTIPLIER
              : EXPLOSION_DEATH_IMPULSE_MULTIPLIER)
            .clampLength(0, MAX_DEATH_IMPULSE_SPEED);
        } else {
          deathVelocity.set(0, 0, 0);
        }
        runtime.ragdollImpact = {
          ...impact,
          velocity: deathVelocity.toArray(),
          nonce: runtime.deathNonce
        };
      } else {
        runtime.ragdollImpact = undefined;
      }
      if (runtime.enemyId) {
        onToast(`${runtime.displayName} повержен`);
      } else {
        onToast(`${runtime.username} повержен — вернётся в центре города`);
      }
    }
    setNpcUiVersion((version) => version + 1);
    return runtime.dead;
  }

  function impactDeadNpc(runtime: NpcRuntime, impact: PendingRagdollImpact) {
    if (!runtime.dead) return false;
    const ragdoll = runtime.ragdollControllerRef.current;
    if (!ragdoll) return false;
    const velocity = new THREE.Vector3().fromArray(impact.velocity);
    if (!Number.isFinite(velocity.lengthSq()) || velocity.lengthSq() < 0.000001) return false;
    velocity.clampLength(0, MAX_CORPSE_IMPULSE_SPEED);
    runtime.deathNonce += 1;
    ragdoll.addImpact({
      ...impact,
      velocity: velocity.toArray(),
      nonce: runtime.deathNonce
    }, CORPSE_RAGDOLL_RESPONSE_SCALE);
    return true;
  }

  function spawnEnemyTracer(runtime: NpcRuntime, now: number) {
    const start = runtime.position.clone()
      .addScaledVector(frontVector(runtime.rotationRef.current), runtime.kind === "human" ? 0.62 : 0.95)
      .setY(runtime.kind === "human" ? 1.25 : runtime.kind === "eyeDrone" ? 1.45 : 1.05);
    const end = playerPosition.current.clone().setY(1.02);
    shotId.current += 1;
    const shot: ShotEffect = {
      id: shotId.current,
      start,
      end,
      color: runtime.behavior === "sentinel"
        ? "#5fe8ff"
        : runtime.behavior === "artillery"
          ? "#ff6638"
          : runtime.behavior === "skirmisher"
            ? "#d8ff62"
            : runtime.kind === "human" ? "#ffb15c" : "#ff345f",
      weapon: "laser",
      width: 0.022,
      tracerLength: 1.4,
      createdAt: now,
      duration: 420,
      tracerDuration: 105,
      blastDuration: runtime.behavior === "artillery" ? 520 : 240,
      blastRadius: runtime.behavior === "artillery" ? 1.8 : undefined
    };
    setShotEffects((effects) => [
      ...effects.filter((effect) => now - effect.createdAt < effect.duration),
      shot
    ].slice(-20));
  }

  function enterPlayerDowned(source: NpcRuntime) {
    if (playerDownedRef.current) return;
    const now = performance.now();
    playerDownedRef.current = true;
    downedFallingUntilRef.current = now + DOWNED_FALL_MS;
    downedBleedOutAtRef.current = now + DOWNED_BLEED_OUT_MS;
    clickTarget.current = null;
    clickPath.current = [];
    pendingVisit.current = null;
    pendingInteraction.current = null;
    thirdPersonFireHeld.current = false;
    jumpElapsedMs.current = null;
    keys.current.clear();
    setAiming(false);
    playerUpperMotionRef.current = null;
    const group = worldGroupRef.current;
    const playerWorld = group
      ? group.localToWorld(playerPosition.current.clone().setY(1.02))
      : playerPosition.current.clone().setY(1.02);
    const sourceWorld = group
      ? group.localToWorld(source.position.clone().setY(source.kind === "human" ? 1.25 : 1.05))
      : source.position.clone().setY(source.kind === "human" ? 1.25 : 1.05);
    const fallVelocity = playerWorld.clone().sub(sourceWorld).setY(0);
    if (fallVelocity.lengthSq() < 0.001) fallVelocity.set(0, 0, 1);
    fallVelocity.normalize().multiplyScalar(2.8).setY(1.15);
    setPlayerRagdollImpact({
      nonce: Date.now(),
      kind: "bullet",
      bodyPart: "chest",
      boneName: "spine_02",
      point: playerWorld.toArray(),
      velocity: fallVelocity.toArray()
    });
    updatePlayerMotion("death");
    if (cameraModeRef.current !== "thirdPerson") setCameraMode("thirdPerson", false);
    else if (document.pointerLockElement === gl.domElement) document.exitPointerLock?.();
    document.body.style.cursor = "default";
    onDownedStateChange({
      fallingUntil: downedFallingUntilRef.current,
      bleedOutAt: downedBleedOutAtRef.current
    });
    onToast(`${source.displayName} вывел вас из строя · после падения можно медленно ползти`);
    for (const { runtime } of outlandsActors) runtime.aggroed = false;
  }

  async function finishPlayerDefeat(surrendered: boolean) {
    if (!playerDownedRef.current || defeatSubmissionRef.current || performance.now() < defeatRetryAtRef.current) return;
    defeatSubmissionRef.current = true;
    let confirmed = false;
    try {
      const callback = surrendered ? onPlayerSurrender : onPlayerDefeated;
      confirmed = Boolean(await callback?.());
    } catch {
      confirmed = false;
    } finally {
      defeatSubmissionRef.current = false;
    }
    if (!confirmed) {
      surrenderRequestedRef.current = false;
      defeatRetryAtRef.current = performance.now() + 1_500;
      onToast("Не удалось вернуться в город · повторяем попытку");
      return;
    }
    playerDownedRef.current = false;
    setPlayerRagdollImpact(undefined);
    surrenderRequestedRef.current = false;
    downedFallingUntilRef.current = 0;
    downedBleedOutAtRef.current = 0;
    onDownedStateChange(null);
    onToast(surrendered ? "Вы сдались · добыча потеряна" : "Вы истекли кровью · добыча потеряна");
    if (drivingRef.current) {
      drivingRef.current = false;
      setDriving(false);
      onDrivingChange(false);
    }
    carPosition.current.copy(ownCarStart.position);
    carRotation.current = ownCarStart.rotation;
    carSpeed.current = 0;
    setRenderCarPosition(ownCarStart.position.clone());
    setRenderCarRotation(ownCarStart.rotation);
    playerHealthRef.current = playerMaxHealthRef.current;
    playerShieldRef.current = 0;
    playerPosition.current.set(0, 0, -72);
    playerRotation.current = Math.PI;
    clickTarget.current = null;
    clickPath.current = [];
    thirdPersonFireHeld.current = false;
    for (const { runtime } of outlandsActors) runtime.aggroed = false;
    currentRegionRef.current = "city";
    onWorldRegionChange?.("city");
    onVitalsChange(playerHealthRef.current, "city", playerShieldRef.current);
    onMoveRef.current({ x: 0, y: 0, z: -72, rotation: Math.PI, vehicle: false });
  }

  function damagePlayer(amount: number, source: NpcRuntime) {
    if (amount <= 0 || playerDownedRef.current || playerHealthRef.current <= 0) return;
    const now = performance.now();
    const gearReduction = Object.values(expeditionGear ?? {}).reduce((total, gearId) => (
      total + (gearId ? EXPEDITION_GEAR[gearId].damageReduction : 0)
    ), 0);
    const armorSkillBonus = (expeditionSkills?.armor ?? 0) * 0.04;
    const effectiveReduction = THREE.MathUtils.clamp(gearReduction * (1 + armorSkillBonus), 0, 0.42);
    const supportReduction = supportRobotUntilRef.current > Date.now() ? 0.28 : 0;
    let remainingDamage = Math.max(0, Math.round(amount * (1 - effectiveReduction) * (1 - supportReduction)));
    if (playerShieldRef.current > 0) {
      const absorbed = Math.min(playerShieldRef.current, remainingDamage);
      playerShieldRef.current -= absorbed;
      remainingDamage -= absorbed;
      onPlayerHitFeedback("shield");
    }
    if (remainingDamage > 0) {
      playerHealthRef.current = Math.max(0, playerHealthRef.current - remainingDamage);
      const group = worldGroupRef.current;
      if (group) {
        const sourceWorld = group.localToWorld(source.position.clone().setY(source.kind === "human" ? 1.25 : 1.05));
        const playerWorld = group.localToWorld(playerPosition.current.clone().setY(1.05));
        spawnBloodEffect(playerWorld, playerWorld.clone().sub(sourceWorld).normalize(), now);
      }
      onPlayerHitFeedback("health");
    }
    onVitalsChange(playerHealthRef.current, currentRegionRef.current, playerShieldRef.current);
    if (playerHealthRef.current <= 0) enterPlayerDowned(source);
  }

  function advanceOutlandsPatrol(runtime: NpcRuntime, now: number, delta: number) {
    if (now < runtime.idleUntil) {
      runtime.motionRef.current = runtime.kind === "human" ? "armedIdle" : "idle";
      runtime.robotMotionRef.current = "idle";
      return;
    }
    const target = runtime.patrol[runtime.targetIndex] ?? runtime.homePosition;
    const direction = target.clone().sub(runtime.position).setY(0);
    const distance = direction.length();
    if (distance < 0.2) {
      runtime.position.copy(target);
      runtime.targetIndex = (runtime.targetIndex + 1) % runtime.patrol.length;
      runtime.idleUntil = now + 550 + (runtime.seed + runtime.targetIndex * 97) % 1250;
      runtime.motionRef.current = runtime.kind === "human" ? "armedIdle" : "idle";
      runtime.robotMotionRef.current = "idle";
      return;
    }
    direction.normalize();
    runtime.rotationRef.current = Math.atan2(direction.x, direction.z);
    const requested = runtime.position.clone().addScaledVector(direction, Math.min(distance, runtime.speed * 0.58 * Math.min(delta, WALK_DELTA_CAP)));
    runtime.position.copy(resolveOutlandsCollisions(runtime.position, requested, 0.55));
    runtime.motionRef.current = "walk";
    runtime.robotMotionRef.current = "walk";
  }

  function getThirdPersonAimPoint(resolveSurface = true) {
    const group = worldGroupRef.current;
    const config = WEAPONS[selectedWeaponRef.current];
    const raycaster = aimRaycaster.current;
    AIM_CENTER.set(recoilRef.current.x, recoilRef.current.y);
    raycaster.setFromCamera(AIM_CENTER, camera);
    raycaster.far = config.range;
    if (group) {
      if (resolveSurface) {
        const valid = validRayIntersection(raycaster.intersectObject(group, true));
        aimDistanceRef.current = valid?.intersection.distance ?? config.range;
      }
      const distance = THREE.MathUtils.clamp(aimDistanceRef.current, 0.5, config.range);
      const targetWorld = raycaster.ray.at(distance, new THREE.Vector3());
      if (!playerAimTargetRef.current) playerAimTargetRef.current = new THREE.Vector3();
      playerAimTargetRef.current.copy(targetWorld);
      return group.worldToLocal(targetWorld.clone());
    }
    const targetWorld = raycaster.ray.at(config.range, new THREE.Vector3());
    if (!playerAimTargetRef.current) playerAimTargetRef.current = new THREE.Vector3();
    playerAimTargetRef.current.copy(targetWorld);
    return targetWorld.add(viewOrigin);
  }

  function spawnBloodEffect(impactWorld: THREE.Vector3, directionWorld: THREE.Vector3, now: number) {
    const group = worldGroupRef.current;
    if (!group) return;
    const point = group.worldToLocal(impactWorld.clone());
    const directionEnd = group.worldToLocal(impactWorld.clone().add(directionWorld));
    const direction = directionEnd.sub(point);
    if (direction.lengthSq() < 0.000001) direction.set(0, 0.3, 1);
    direction.normalize();
    bloodId.current += 1;
    const effect: BloodEffect = {
      id: bloodId.current,
      point,
      direction,
      createdAt: now,
      duration: BLOOD_EFFECT_DURATION
    };
    setBloodEffects((effects) => [
      ...effects.filter((current) => now < current.createdAt + current.duration),
      effect
    ].slice(-12));
  }

  function addCharacterBloodMark(
    runtime: NpcRuntime,
    bodyPart: BodyPart,
    boneName: string,
    bone: THREE.Bone | undefined,
    pointWorld: THREE.Vector3,
    normalWorld: THREE.Vector3,
    weapon: WeaponKind
  ) {
    if (runtime.kind === "eyeDrone" || runtime.kind === "quadShell") return;
    if (!bone?.parent) return;
    bone.updateWorldMatrix(true, false);
    const normal = normalWorld.clone();
    if (normal.lengthSq() < 0.000001) normal.set(0, 0, 1);
    else normal.normalize();
    const localNormal = normal.clone().applyMatrix3(
      new THREE.Matrix3().setFromMatrix4(bone.matrixWorld).transpose()
    ).normalize();
    const localPoint = bone.worldToLocal(pointWorld.clone().addScaledVector(normal, 0.006));
    const worldScale = bone.getWorldScale(new THREE.Vector3());
    const scale = Math.max(0.001, (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3);
    const limb = bodyPart.includes("Arm") || bodyPart.includes("Hand") || bodyPart.includes("Thigh")
      || bodyPart.includes("Calf") || bodyPart.includes("Foot");
    const baseRadius = weapon === "rocket" ? 0.125 : bodyPart === "head" ? 0.072 : limb ? 0.052 : 0.088;
    bodyBloodId.current += 1;
    const mark: CharacterBloodMark = {
      id: bodyBloodId.current,
      boneName,
      localPoint: localPoint.toArray(),
      localNormal: localNormal.toArray(),
      radius: baseRadius * (0.86 + bloodRandom(bodyBloodId.current * 313) * 0.28) / scale,
      rotation: bloodRandom(bodyBloodId.current * 347) * Math.PI * 2
    };
    runtime.bloodMarks = [...runtime.bloodMarks, mark].slice(-CHARACTER_BLOOD_MARK_LIMIT);
    setNpcUiVersion((version) => version + 1);
  }

  function spawnSurfaceImpact(
    impactWorld: THREE.Vector3,
    normalWorld: THREE.Vector3,
    incomingWorld: THREE.Vector3,
    intersection: THREE.Intersection,
    weapon: WeaponKind,
    now: number
  ) {
    const group = worldGroupRef.current;
    if (!group) return;
    const object = intersection.object;
    const point = group.worldToLocal(impactWorld.clone());
    const normal = group.worldToLocal(impactWorld.clone().add(normalWorld)).sub(point).normalize();
    const incoming = group.worldToLocal(impactWorld.clone().add(incomingWorld)).sub(point).normalize();
    const surface = resolveImpactSurface(object);
    impactId.current += 1;
    const effect: SurfaceImpactEffect = {
      id: impactId.current,
      point,
      normal,
      incoming,
      surface,
      weapon,
      createdAt: now,
      duration: weapon === "rocket" ? 1500 : SURFACE_IMPACT_DURATION
    };
    setImpactEffects((effects) => [
      ...effects.filter((current) => now < current.createdAt + current.duration),
      effect
    ].slice(-14));
    let markTarget: THREE.Object3D = object;
    let instanced = false;
    if (object instanceof THREE.InstancedMesh) {
      if (intersection.instanceId === undefined || weapon === "rocket") return;
      object.updateWorldMatrix(true, false);
      const instanceMatrix = new THREE.Matrix4();
      object.getMatrixAt(intersection.instanceId, instanceMatrix);
      const instanceWorldMatrix = new THREE.Matrix4().multiplyMatrices(object.matrixWorld, instanceMatrix);
      const instanceTarget = new THREE.Mesh(object.geometry, object.material);
      instanceTarget.matrixAutoUpdate = false;
      instanceTarget.matrix.copy(instanceWorldMatrix);
      instanceTarget.matrixWorld.copy(instanceWorldMatrix);
      markTarget = instanceTarget;
      instanced = true;
    }
    const anchor = instanced ? undefined : dynamicImpactAnchor(object);
    const mark = createSurfaceImpactMark({
      id: impactId.current,
      target: markTarget,
      pointWorld: impactWorld,
      normalWorld,
      surface,
      weapon,
      coordinateRoot: group,
      anchor,
      sizeScale: instanced ? 0.7 : 1,
      instanced
    });
    if (mark) {
      setImpactMarks((marks) => {
        const next = [...marks, mark];
        const bulletCandidates = next.filter((current) => current.weapon !== "rocket");
        const instancedLimit = Math.min(24, markLimits.bullet);
        const instancedMarks = bulletCandidates.filter((current) => current.instanced).slice(-instancedLimit);
        const regularLimit = Math.max(0, markLimits.bullet - instancedMarks.length);
        const regularMarks = regularLimit > 0
          ? bulletCandidates.filter((current) => !current.instanced).slice(-regularLimit)
          : [];
        const rocketMarks = next.filter((current) => current.weapon === "rocket").slice(-markLimits.rocket);
        return [...regularMarks, ...instancedMarks, ...rocketMarks].sort((left, right) => left.id - right.id);
      });
    }
  }

  function resolveWorldAccess(current: THREE.Vector3, requested: THREE.Vector3) {
    const position = requested.clone();
    if (position.z > OUTLANDS_ENTRY_Z) {
      position.x = THREE.MathUtils.clamp(position.x, -41.4, 41.4);
    }
    const crossingCheckpointFence = current.z > OUTLANDS_ENTRY_Z - 1
      && position.z <= OUTLANDS_ENTRY_Z - 1
      && Math.abs(position.x) > 10;
    if (crossingCheckpointFence) position.z = OUTLANDS_ENTRY_Z + 0.25;
    if (!expeditionActiveRef.current && position.z < OUTLANDS_LOCK_Z) {
      position.z = OUTLANDS_LOCK_Z;
      clickTarget.current = null;
      clickPath.current = [];
      const now = performance.now();
      if (now - lastOutlandsGateToastAt.current > 1600) {
        lastOutlandsGateToastAt.current = now;
        onToastRef.current("Перед выходом за КПП выберите снаряжение и начните вылазку в правой панели");
      }
    }
    return position;
  }

  function spawnSyntheticImpact(
    impactWorld: THREE.Vector3,
    normalWorld: THREE.Vector3,
    incomingWorld: THREE.Vector3,
    surface: ImpactSurface,
    weapon: WeaponKind,
    now: number
  ) {
    const group = worldGroupRef.current;
    if (!group) return;
    const point = group.worldToLocal(impactWorld.clone());
    const normal = group.worldToLocal(impactWorld.clone().add(normalWorld)).sub(point).normalize();
    const incoming = group.worldToLocal(impactWorld.clone().add(incomingWorld)).sub(point).normalize();
    impactId.current += 1;
    const effect: SurfaceImpactEffect = {
      id: impactId.current,
      point,
      normal,
      incoming,
      surface,
      weapon,
      createdAt: now,
      duration: weapon === "rocket" ? 1500 : SURFACE_IMPACT_DURATION
    };
    setImpactEffects((effects) => [
      ...effects.filter((current) => now < current.createdAt + current.duration),
      effect
    ].slice(-14));
  }

  function applyWeaponRecoil(config: (typeof WEAPONS)[WeaponKind]) {
    const recoil = recoilRef.current;
    recoil.kick = Math.min(config.recoilKick * 1.65, recoil.kick + config.recoilKick);
    if (cameraModeRef.current !== "thirdPerson") return;
    const horizontalKick = (Math.random() * 2 - 1) * config.recoilYaw;
    const verticalKick = config.recoilPitch * (0.82 + Math.random() * 0.36);
    recoil.x = THREE.MathUtils.clamp(recoil.x + horizontalKick, -0.075, 0.075);
    recoil.y = THREE.MathUtils.clamp(recoil.y + verticalKick, 0, 0.12);
    getThirdPersonAimPoint(false);
  }

  function shootAt(target: THREE.Vector3) {
    if (drivingRef.current || playerDownedRef.current) return;
    if (activeInteriorRef.current) {
      onToast("Чтобы стрелять, сначала выйдите на улицу");
      return;
    }

    const weapon = selectedWeaponRef.current;
    const config = WEAPONS[weapon];
    const shotDamage = config.damage * (expeditionActiveRef.current ? 1 + weaponSkillLevelRef.current * 0.05 : 1);
    const now = performance.now();
    if (now < nextShotAt.current) return;
    const group = worldGroupRef.current;
    if (!group) return;
    const remainingRounds = onConsumeRound(weapon);
    if (remainingRounds === null) return;
    nextShotAt.current = now + config.cooldownMs;
    clickTarget.current = null;
    clickPath.current = [];
    pendingVisit.current = null;
    pendingInteraction.current = null;

    const shotStartWorld = group.localToWorld(playerPosition.current.clone().setY(1.15));
    const muzzle = playerMuzzleRef.current;
    if (muzzle?.userData.weapon === weapon) {
      muzzle.updateWorldMatrix(true, false);
      muzzle.getWorldPosition(shotStartWorld);
    }
    const targetWorld = group.localToWorld(target.clone());
    if (!playerAimTargetRef.current) playerAimTargetRef.current = new THREE.Vector3();
    playerAimTargetRef.current.copy(targetWorld);
    const directionWorld = targetWorld.clone().sub(shotStartWorld);
    if (directionWorld.lengthSq() < 0.001) directionWorld.copy(frontVector(playerRotation.current));
    const targetDistance = Math.max(0.1, directionWorld.length());
    directionWorld.normalize();

    const flatDirection = directionWorld.clone().setY(0);
    if (flatDirection.lengthSq() > 0.001) {
      flatDirection.normalize();
      playerRotation.current = Math.atan2(flatDirection.x, flatDirection.z);
    }

    const shotDistance = Math.min(config.range, targetDistance + 0.35);
    const raycaster = shotRaycaster.current;
    raycaster.set(shotStartWorld, directionWorld);
    raycaster.far = shotDistance;
    const valid = validRayIntersection(raycaster.intersectObject(group, true));
    let impactWorld = valid?.intersection.point.clone()
      ?? shotStartWorld.clone().addScaledVector(directionWorld, Math.min(config.range, targetDistance));
    const preciseCombat = valid?.combat ? preciseCombatIntersection(valid.combat) : null;
    if (preciseCombat) impactWorld = preciseCombat.point.clone();
    const directCombat: CombatHit | null = valid?.combat ? {
      ...valid.combat,
      point: impactWorld.clone(),
      normal: preciseCombat
        ? intersectionWorldNormal(preciseCombat, directionWorld)
        : intersectionWorldNormal(valid.intersection, directionWorld),
      distance: preciseCombat?.distance ?? valid.intersection.distance
    } : null;
    let impactSurfaceNormal: THREE.Vector3 | null = null;
    if (valid && !valid.combat) {
      impactSurfaceNormal = intersectionWorldNormal(valid.intersection, directionWorld);
      spawnSurfaceImpact(
        impactWorld,
        impactSurfaceNormal,
        directionWorld,
        valid.intersection,
        weapon,
        now
      );
    }
    const combatRuntimes = [
      ...npcActors.map(({ runtime }) => runtime),
      ...outlandsActors.map(({ runtime }) => runtime)
    ];
    const blastZones = config.blastRadius ? closestCombatZones(impactWorld) : null;
    const expeditionHits: ExpeditionHitInput[] = [];

    if (config.blastRadius) {
      for (const runtime of combatRuntimes) {
        const exactZone = directCombat?.runtime === runtime ? directCombat : blastZones?.get(runtime) ?? null;
        const bodyPoint = exactZone?.point
          ?? group.localToWorld(runtime.position.clone().setY(0.92));
        const distance = bodyPoint.distanceTo(impactWorld);
        if (distance > config.blastRadius) continue;
        if (impactSurfaceNormal && bodyPoint.clone().sub(impactWorld).dot(impactSurfaceNormal) < -0.015) continue;
        if (!blastReachesTarget(impactWorld, bodyPoint)) continue;
        const falloff = THREE.MathUtils.clamp(1 - distance / (config.blastRadius * 1.25), 0.28, 1);
        const impulseDirection = bodyPoint.clone().sub(impactWorld);
        if (impulseDirection.lengthSq() < 0.002) impulseDirection.copy(directionWorld);
        impulseDirection.y += 0.32;
        impulseDirection.normalize();
        const bloodDirection = impulseDirection.clone();
        const impact: PendingRagdollImpact = {
          kind: "explosion",
          bodyPart: exactZone?.bodyPart ?? DEFAULT_BODY_PART,
          boneName: exactZone?.boneName ?? DEFAULT_BODY_BONE,
          point: bodyPoint.toArray(),
          velocity: impulseDirection.clone().multiplyScalar((config.blastImpulse ?? config.impactImpulse) * falloff).toArray()
        };
        const wasAlive = !runtime.dead;
        if (runtime.dead) {
          impactDeadNpc(runtime, impact);
        } else {
          damageNpc(runtime, shotDamage * falloff, now, impact);
        }
        if (wasAlive && expeditionActiveRef.current && runtime.enemyId) {
          expeditionHits.push({
            enemyId: runtime.enemyId as ExpeditionEnemyId,
            zone: expeditionHitZone(exactZone?.bodyPart ?? DEFAULT_BODY_PART),
            damageScale: falloff,
            position: { x: runtime.position.x, z: runtime.position.z }
          });
        }
        const markNormal = directCombat?.runtime === runtime
          ? directCombat.normal
          : impactWorld.clone().sub(bodyPoint).normalize();
        if (runtime.kind === "eyeDrone" || runtime.kind === "quadShell") {
          spawnSyntheticImpact(bodyPoint, markNormal, directionWorld, "metal", weapon, now);
        } else {
          addCharacterBloodMark(
            runtime,
            exactZone?.bodyPart ?? DEFAULT_BODY_PART,
            exactZone?.boneName ?? DEFAULT_BODY_BONE,
            exactZone?.bone,
            bodyPoint,
            markNormal,
            weapon
          );
          spawnBloodEffect(bodyPoint, bloodDirection, now);
        }
      }
    } else if (directCombat) {
      const impulse = directionWorld.clone().multiplyScalar(config.impactImpulse);
      impulse.y += 0.24;
      const impact: PendingRagdollImpact = {
        kind: "bullet",
        bodyPart: directCombat.bodyPart,
        boneName: directCombat.boneName,
        point: directCombat.point.toArray(),
        velocity: impulse.toArray()
      };
      if (directCombat.runtime.dead) {
        impactDeadNpc(directCombat.runtime, impact);
      } else {
        damageNpc(
          directCombat.runtime,
          shotDamage * BODY_DAMAGE_MULTIPLIER[directCombat.bodyPart],
          now,
          impact
        );
        if (expeditionActiveRef.current && directCombat.runtime.enemyId) {
          expeditionHits.push({
            enemyId: directCombat.runtime.enemyId as ExpeditionEnemyId,
            zone: expeditionHitZone(directCombat.bodyPart),
            position: { x: directCombat.runtime.position.x, z: directCombat.runtime.position.z }
          });
        }
      }
      if (directCombat.runtime.kind === "eyeDrone" || directCombat.runtime.kind === "quadShell") {
        spawnSyntheticImpact(directCombat.point, directCombat.normal, directionWorld, "metal", weapon, now);
      } else {
        addCharacterBloodMark(
          directCombat.runtime,
          directCombat.bodyPart,
          directCombat.boneName,
          directCombat.bone,
          directCombat.point,
          directCombat.normal,
          weapon
        );
        spawnBloodEffect(directCombat.point, directionWorld, now);
      }
    }
    if (expeditionActiveRef.current) onExpeditionShot?.(expeditionHits);

    const tracerDistance = shotStartWorld.distanceTo(impactWorld);
    const tracerDuration = THREE.MathUtils.clamp(
      tracerDistance / config.tracerSpeed * 1000,
      72,
      150
    );
    const shotStart = group.worldToLocal(shotStartWorld.clone());
    const impact = group.worldToLocal(impactWorld.clone());
    shotId.current += 1;
    setShotEffects((effects) => [
      ...effects.filter((effect) => now - effect.createdAt < effect.duration),
      {
        id: shotId.current,
        start: shotStart,
        end: impact,
        color: config.color,
        weapon,
        width: config.tracerWidth,
        tracerLength: config.tracerLength,
        createdAt: now,
        duration: weapon === "rocket" ? 900 : weapon === "laser" ? 620 : 520,
        tracerDuration,
        blastDuration: weapon === "rocket" ? 620 : 360,
        blastRadius: config.blastRadius
      }
    ].slice(-16));
    shootingUntil.current = now + (remainingRounds === 0 ? Math.min(150, config.cooldownMs) : 370);
    shotNonceRef.current += 1;
    if (remainingRounds === 0) onReload(weapon);
    applyWeaponRecoil(config);
    lastRotationSent.current = playerRotation.current;
    lastMoveSent.current = now;
    onMove({
      x: playerPosition.current.x,
      y: 0,
      z: playerPosition.current.z,
      rotation: playerRotation.current,
      vehicle: false
    });
  }

  function tacticalTargetPoint(itemId: ExpeditionTacticalId) {
    if (itemId === "artifact-robot-beacon" || itemId === "artifact-scanner") {
      return playerPosition.current.clone();
    }
    let target = cameraModeRef.current === "thirdPerson"
      ? getThirdPersonAimPoint()
      : playerPosition.current.clone().addScaledVector(frontVector(playerRotation.current), 12);
    target = target.clone().setY(0);
    const offset = target.clone().sub(playerPosition.current).setY(0);
    const maximumRange = itemId === "artifact-nuke" ? 30 : 24;
    if (offset.length() > maximumRange) target.copy(playerPosition.current).add(offset.setLength(maximumRange));
    return target.setY(0);
  }

  async function deployTactical(itemId: ExpeditionTacticalId) {
    if (!expeditionActiveRef.current || tacticalBusyRef.current || playerDownedRef.current) return false;
    if ((tacticalCountsRef.current[itemId] ?? 0) <= 0) {
      onToastRef.current("Такого предмета нет в рюкзаке");
      return false;
    }
    const handler = onUseTacticalRef.current;
    if (!handler) return false;
    const target = tacticalTargetPoint(itemId);
    const grenade = EXPEDITION_GRENADE_IDS.includes(itemId as ExpeditionGrenadeId)
      ? EXPEDITION_GRENADES[itemId as ExpeditionGrenadeId]
      : null;
    const isNuke = itemId === "artifact-nuke";
    const radius = isNuke ? 500 : grenade?.radius ?? 0;
    const targets: ExpeditionTacticalTarget[] = outlandsActors.flatMap(({ runtime }) => {
      if (!runtime.enemyId || runtime.dead) return [];
      const distance = runtime.position.distanceTo(target);
      if (distance > radius + 1.25) return [];
      return [{
        enemyId: runtime.enemyId as ExpeditionEnemyId,
        distance,
        position: { x: runtime.position.x, z: runtime.position.z }
      }];
    });

    const visualColor = grenade?.color
      ?? (itemId === "artifact-nuke" ? "#fff2a8" : itemId === "artifact-scanner" ? "#ae8cff" : "#55f2d2");
    const visualRadius = isNuke ? 28 : grenade?.radius ?? (itemId === "artifact-scanner" ? 15 : 3.5);
    const now = performance.now();
    shotId.current += 1;
    const tacticalShot: ShotEffect = {
      id: shotId.current,
      start: playerPosition.current.clone().setY(1.25),
      end: target.clone().setY(0.18),
      color: visualColor,
      weapon: "rocket",
      width: grenade ? 0.055 : 0.09,
      tracerLength: grenade ? 0.45 : 2.2,
      createdAt: now,
      duration: isNuke ? 2_250 : 980,
      tracerDuration: grenade ? 420 : 160,
      blastDuration: isNuke ? 2_100 : 780,
      blastRadius: visualRadius
    };
    setShotEffects((effects) => [
      ...effects.filter((effect) => now - effect.createdAt < effect.duration),
      tacticalShot
    ].slice(-22));

    if (grenade || isNuke) {
      for (const { runtime } of outlandsActors) {
        if (runtime.kind !== "human" || runtime.dead) continue;
        const distance = runtime.position.distanceTo(target);
        if (!isNuke && distance > visualRadius + 1.25) continue;
        const direction = runtime.position.clone().sub(target).setY(0.35);
        if (direction.lengthSq() < 0.001) direction.set(0.3, 0.65, 0.2);
        const impulse = (isNuke ? 18 : 10) * Math.max(0.35, 1 - distance / Math.max(1, visualRadius * 1.25));
        runtime.deathNonce += 1;
        runtime.ragdollImpact = {
          nonce: runtime.deathNonce,
          kind: "explosion",
          bodyPart: "chest",
          boneName: "spine",
          point: target.toArray(),
          velocity: direction.normalize().multiplyScalar(impulse).toArray()
        };
      }
    }

    tacticalBusyRef.current = true;
    try {
      const used = await handler(itemId, { x: target.x, z: target.z }, targets);
      return used !== false;
    } finally {
      tacticalBusyRef.current = false;
    }
  }

  shootAtRef.current = shootAt;

  useEffect(() => {
    const controlKey = (event: KeyboardEvent) => {
      const byCode: Record<string, string> = {
        KeyW: "w",
        KeyA: "a",
        KeyS: "s",
        KeyD: "d",
        KeyE: "e",
        KeyF: "f",
        KeyG: "g",
        KeyH: "h",
        KeyQ: "q",
        KeyR: "r",
        KeyB: "b",
        KeyV: "v",
        ShiftLeft: "shift",
        ShiftRight: "shift",
        ControlLeft: "control",
        ControlRight: "control",
        ArrowUp: "arrowup",
        ArrowLeft: "arrowleft",
        ArrowDown: "arrowdown",
        ArrowRight: "arrowright",
        Space: " "
      };
      return byCode[event.code] ?? event.key.toLowerCase();
    };

    const setDriveState = (next: boolean) => {
      drivingRef.current = next;
      setDriving(next);
      onDrivingChangeRef.current(next);
      if (next) {
        jumpElapsedMs.current = null;
        keys.current.delete("q");
        setAiming(false);
        if (cameraModeRef.current === "thirdPerson") setCameraMode("strategy");
        document.body.style.cursor = "default";
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      const key = controlKey(event);
      if (playerDownedRef.current) {
        if (key === "g") {
          event.preventDefault();
          if (!event.repeat) surrenderRequestedRef.current = true;
          return;
        }
        if (["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(key)) {
          event.preventDefault();
          keys.current.add(key);
        }
        return;
      }
      if (key === "h") {
        event.preventDefault();
        if (event.repeat || healingRef.current) return;
        if (!expeditionActiveRef.current) {
          onToastRef.current("Бинты используются во время вылазки");
          return;
        }
        if (playerHealthRef.current >= playerMaxHealthRef.current) {
          onToastRef.current("Здоровье уже полное");
          return;
        }
        if (bandageCountRef.current <= 0 || !onUseBandageRef.current) {
          onToastRef.current("В рюкзаке нет бинтов");
          return;
        }
        healingRef.current = true;
        Promise.resolve(onUseBandageRef.current())
          .catch(() => onToastRef.current("Не удалось использовать бинт"))
          .finally(() => { healingRef.current = false; });
        return;
      }
      if (key === "v") {
        event.preventDefault();
        if (event.repeat) return;
        if (drivingRef.current || buildModeRef.current) {
          onToastRef.current(buildModeRef.current ? "Сначала выйдите из режима обустройства" : "Вид от третьего лица недоступен в машине");
          return;
        }
        setCameraMode(cameraModeRef.current === "thirdPerson" ? "strategy" : "thirdPerson");
        return;
      }
      if (key === "b" && cameraModeRef.current === "thirdPerson") {
        event.preventDefault();
        if (event.repeat) return;
        setShoulderSide((side) => side === 1 ? -1 : 1);
        return;
      }
      if (key === "q" && (drivingRef.current || activeInteriorRef.current || cameraModeRef.current === "thirdPerson")) {
        event.preventDefault();
        return;
      }
      if (key === "r") {
        event.preventDefault();
        if (!event.repeat && !drivingRef.current && !activeInteriorRef.current) {
          onReloadRef.current(selectedWeaponRef.current);
        }
        return;
      }
      const grenadeIndex = Number(key) - 6;
      if (Number.isInteger(grenadeIndex) && grenadeIndex >= 0 && grenadeIndex < EXPEDITION_GRENADE_IDS.length) {
        event.preventDefault();
        if (event.repeat) return;
        const grenadeId = EXPEDITION_GRENADE_IDS[grenadeIndex];
        selectedGrenadeRef.current = grenadeId;
        setSelectedGrenade(grenadeId);
        onToastRef.current(`${EXPEDITION_GRENADES[grenadeId].name} выбрана · T — бросить`);
        return;
      }
      if (key === "t") {
        event.preventDefault();
        if (!event.repeat) void deployTactical(selectedGrenadeRef.current);
        return;
      }
      const artifactHotkey = ({
        z: "artifact-nuke",
        x: "artifact-robot-beacon",
        c: "artifact-scanner"
      } as const)[key as "z" | "x" | "c"];
      if (artifactHotkey) {
        event.preventDefault();
        if (!event.repeat) void deployTactical(artifactHotkey);
        return;
      }
      keys.current.add(key);
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "control", "q"].includes(key)) {
        event.preventDefault();
      }

      const weaponIndex = Number(key) - 1;
      if (Number.isInteger(weaponIndex) && weaponIndex >= 0 && weaponIndex < WEAPON_ORDER.length) {
        const weapon = WEAPON_ORDER[weaponIndex];
        const lockedWeapon = expeditionActiveRef.current ? expeditionWeaponRef.current : undefined;
        if (lockedWeapon && weapon !== lockedWeapon) {
          onToastRef.current(`В эту вылазку взят только ${WEAPONS[lockedWeapon].label.toLowerCase()}`);
          return;
        }
        selectedWeaponRef.current = weapon;
        onWeaponChangeRef.current(weapon);
      }

      if (key === "q") {
        clickTarget.current = null;
        clickPath.current = [];
        pendingVisit.current = null;
        pendingInteraction.current = null;
        setAiming(true);
        document.body.style.cursor = "crosshair";
      }

      if (key === " " && !drivingRef.current && !event.repeat && jumpElapsedMs.current === null) {
        jumpElapsedMs.current = 0;
      }

      if (key !== "e" && key !== "f") return;
      if (event.repeat) return;

      if (key === "e" && !drivingRef.current && nearbyEnemyRef.current) {
        const enemyId = nearbyEnemyRef.current;
        if (lootedEnemySetRef.current.has(enemyId)) {
          onToastRef.current("С этого противника уже всё забрали");
        } else if (!expeditionActiveRef.current) {
          onToastRef.current("Сначала начните вылазку в правой панели");
        } else {
          onLootEnemyRef.current?.(enemyId);
        }
        return;
      }

      if (key === "e" && !drivingRef.current && nearbyContainerRef.current) {
        const containerId = nearbyContainerRef.current;
        if (lootedContainerSetRef.current.has(containerId)) {
          onToastRef.current("Этот контейнер уже пуст");
        } else if (!expeditionActiveRef.current) {
          onToastRef.current("Сначала начните вылазку в правой панели");
        } else {
          onLootContainerRef.current?.(containerId);
        }
        return;
      }

      if (key === "e" && !drivingRef.current && nearExtractionRef.current && expeditionActiveRef.current) {
        onExtractRef.current?.();
        return;
      }

      if (drivingRef.current) {
        const side = rightVector(carRotation.current).multiplyScalar(1.65);
        playerPosition.current.copy(carPosition.current).add(side);
        playerRotation.current = carRotation.current;
        carSpeed.current = 0;
        setDriveState(false);
        onToastRef.current("Вы вышли из машины");
        return;
      }

      if (playerPosition.current.distanceTo(carPosition.current) <= 2.65) {
        clickTarget.current = null;
        clickPath.current = [];
        pendingVisit.current = null;
        pendingInteraction.current = null;
        playerPosition.current.copy(carPosition.current);
        playerRotation.current = carRotation.current;
        setDriveState(true);
        onToastRef.current("Машина заведена — WASD для езды, E чтобы выйти");
      } else {
        onToastRef.current("Подойдите к своей машине ближе");
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = controlKey(event);
      keys.current.delete(key);
      if (cameraModeRef.current === "thirdPerson" && ["w", "a", "s", "d"].includes(key)) {
        lastRotationSent.current = playerRotation.current;
        onMoveRef.current({
          x: playerPosition.current.x,
          y: 0,
          z: playerPosition.current.z,
          rotation: playerRotation.current,
          vehicle: false
        });
      }
      if (key === "q") {
        setAiming(false);
        document.body.style.cursor = "default";
      }
    };
    const clearKeys = () => {
      keys.current.clear();
      thirdPersonFireHeld.current = false;
      setAiming(false);
      document.body.style.cursor = "default";
    };
    const onVisibilityChange = () => {
      if (document.hidden) clearKeys();
    };
    const onWheel = (event: WheelEvent) => {
      const weaponWheelActive = cameraModeRef.current === "thirdPerson" || keys.current.has("q");
      if (!weaponWheelActive || drivingRef.current || activeInteriorRef.current || Math.abs(event.deltaY) < 0.5) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const now = performance.now();
      if (now - lastWeaponWheelAt.current < 110) return;
      lastWeaponWheelAt.current = now;
      const currentIndex = WEAPON_ORDER.indexOf(selectedWeaponRef.current);
      const direction = event.deltaY > 0 ? 1 : -1;
      const nextIndex = (currentIndex + direction + WEAPON_ORDER.length) % WEAPON_ORDER.length;
      const weapon = WEAPON_ORDER[nextIndex];
      const lockedWeapon = expeditionActiveRef.current ? expeditionWeaponRef.current : undefined;
      if (lockedWeapon && weapon !== lockedWeapon) {
        onToastRef.current(`Сменить комплект можно после эвакуации`);
        return;
      }
      selectedWeaponRef.current = weapon;
      onWeaponChangeRef.current(weapon);
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);
    document.addEventListener("visibilitychange", onVisibilityChange);
    gl.domElement.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      gl.domElement.removeEventListener("wheel", onWheel, { capture: true });
      clearKeys();
      document.body.style.cursor = "default";
    };
  }, [gl]);

  useEffect(() => {
    const element = gl.domElement;

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === element;
      onPointerLockChange(locked);
      if (!locked) {
        thirdPersonFireHeld.current = false;
        if (cameraModeRef.current === "thirdPerson") setAiming(false);
      }
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (cameraModeRef.current !== "thirdPerson") return;
      event.preventDefault();
      if (playerDownedRef.current) {
        thirdPersonFireHeld.current = false;
        setAiming(false);
        return;
      }
      if (document.pointerLockElement !== element) {
        requestThirdPersonPointerLock();
        return;
      }
      if (event.button === 2) {
        setAiming(true);
      } else if (event.button === 0) {
        if (activeInteriorRef.current) {
          onToastRef.current("Чтобы стрелять, сначала выйдите на улицу");
          return;
        }
        thirdPersonFireHeld.current = true;
        if (performance.now() >= nextShotAt.current) shootAtRef.current(getThirdPersonAimPoint());
      }
    };
    const handleMouseUp = (event: MouseEvent) => {
      if (cameraModeRef.current === "thirdPerson" && event.button === 2) setAiming(false);
      if (event.button === 0) thirdPersonFireHeld.current = false;
    };
    const handlePointerLockError = () => {
      const now = performance.now();
      if (now - lastPointerLockErrorAt.current < 800) return;
      lastPointerLockErrorAt.current = now;
      onToastRef.current("Не удалось захватить мышь — кликните по сцене ещё раз");
    };

    document.addEventListener("pointerlockchange", handlePointerLockChange);
    document.addEventListener("pointerlockerror", handlePointerLockError);
    element.addEventListener("mousedown", handleMouseDown, { passive: false });
    window.addEventListener("mouseup", handleMouseUp);
    handlePointerLockChange();
    return () => {
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      document.removeEventListener("pointerlockerror", handlePointerLockError);
      element.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      if (document.pointerLockElement === element) document.exitPointerLock?.();
      onPointerLockChange(false);
    };
  }, [gl, onAimingChange, onPointerLockChange]);

  useEffect(() => {
    if (buildMode && cameraModeRef.current === "thirdPerson") setCameraMode("strategy");
  }, [buildMode]);

  useEffect(() => {
    recoilRef.current.x = 0;
    recoilRef.current.y = 0;
    recoilRef.current.kick = 0;
    aimDistanceRef.current = WEAPONS[selectedWeapon].range;
    if (cameraMode !== "thirdPerson") playerAimTargetRef.current = null;
  }, [cameraMode, recoilRef, selectedWeapon]);

  useEffect(() => {
    if (shotEffects.length === 0) return;
    const nextExpiry = Math.min(...shotEffects.map((effect) => effect.createdAt + effect.duration));
    const timeout = window.setTimeout(() => {
      const now = performance.now();
      setShotEffects((effects) => effects.filter((effect) => now < effect.createdAt + effect.duration));
    }, Math.max(16, nextExpiry - performance.now() + 24));
    return () => window.clearTimeout(timeout);
  }, [shotEffects]);

  useEffect(() => {
    if (bloodEffects.length === 0) return;
    const nextExpiry = Math.min(...bloodEffects.map((effect) => effect.createdAt + effect.duration));
    const timeout = window.setTimeout(() => {
      const now = performance.now();
      setBloodEffects((effects) => effects.filter((effect) => now < effect.createdAt + effect.duration));
    }, Math.max(32, nextExpiry - performance.now() + 32));
    return () => window.clearTimeout(timeout);
  }, [bloodEffects]);

  useEffect(() => {
    if (impactEffects.length === 0) return;
    const nextExpiry = Math.min(...impactEffects.map((effect) => effect.createdAt + effect.duration));
    const timeout = window.setTimeout(() => {
      const now = performance.now();
      setImpactEffects((effects) => effects.filter((effect) => now < effect.createdAt + effect.duration));
    }, Math.max(24, nextExpiry - performance.now() + 24));
    return () => window.clearTimeout(timeout);
  }, [impactEffects]);

  useEffect(() => {
    const currentGeometries = new Set(impactMarks.map((mark) => mark.geometry));
    for (const geometry of impactMarkGeometriesRef.current) {
      if (!currentGeometries.has(geometry)) geometry.dispose();
    }
    impactMarkGeometriesRef.current = currentGeometries;
  }, [impactMarks]);

  useEffect(() => () => {
    for (const geometry of impactMarkGeometriesRef.current) geometry.dispose();
    impactMarkGeometriesRef.current.clear();
  }, []);

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
    if (cameraModeRef.current === "thirdPerson") setCameraMode("strategy");
    if (routeToResident(resident)) {
      onToast(resident.username === user.username ? "Идём домой" : `Идём в гости к ${resident.username}`);
    }
  }, [onToast, user.username, visitRequest, worldResidents]);

  useFrame((_, delta) => {
    const now = performance.now();
    const recoilDelta = Math.min(delta, 0.05);
    const screenDecay = Math.exp(-recoilDelta * 10.5);
    recoilRef.current.x *= screenDecay;
    recoilRef.current.y *= screenDecay;
    recoilRef.current.kick *= Math.exp(-recoilDelta * 18);
    if (Math.abs(recoilRef.current.x) < 0.00005) recoilRef.current.x = 0;
    if (Math.abs(recoilRef.current.y) < 0.00005) recoilRef.current.y = 0;
    if (recoilRef.current.kick < 0.00005) recoilRef.current.kick = 0;
    if (cameraModeRef.current === "thirdPerson") {
      const resolveSurface = now - lastAimSurfaceAt.current >= 48;
      if (resolveSurface) lastAimSurfaceAt.current = now;
      getThirdPersonAimPoint(resolveSurface);
    }
    if (cameraModeRef.current === "thirdPerson"
      && thirdPersonFireHeld.current
      && now >= nextShotAt.current
      && document.pointerLockElement === gl.domElement) {
      shootAtRef.current(getThirdPersonAimPoint());
    }
  });

  useFrame((_, delta) => {
    const now = performance.now();
    if (supportRobotUntilRef.current > Date.now() && expeditionActiveRef.current) {
      const desired = playerPosition.current.clone()
        .addScaledVector(frontVector(playerRotation.current + Math.PI / 2), 2.15)
        .addScaledVector(frontVector(playerRotation.current), -1.25)
        .setY(0);
      const previous = supportRobotPosition.current.clone();
      supportRobotPosition.current.lerp(desired, 1 - Math.exp(-Math.min(delta, 0.05) * 4.8));
      supportRobotMotion.current = previous.distanceToSquared(supportRobotPosition.current) > 0.00004 ? "run" : "idle";
      const targetRuntime = outlandsActors
        .map(({ runtime }) => runtime)
        .filter((runtime) => runtime.faction === "hostile" && !runtime.dead)
        .sort((left, right) => left.position.distanceToSquared(supportRobotPosition.current) - right.position.distanceToSquared(supportRobotPosition.current))[0];
      if (targetRuntime && targetRuntime.position.distanceToSquared(supportRobotPosition.current) < 34 ** 2) {
        const towardTarget = targetRuntime.position.clone().sub(supportRobotPosition.current);
        supportRobotRotation.current = Math.atan2(towardTarget.x, towardTarget.z);
        if (now >= nextSupportShotAt.current) {
          nextSupportShotAt.current = now + 880;
          shotId.current += 1;
          const supportShot: ShotEffect = {
            id: shotId.current,
            start: supportRobotPosition.current.clone().setY(1.05),
            end: targetRuntime.position.clone().setY(targetRuntime.kind === "human" ? 1.05 : 0.9),
            color: "#5fffe1",
            weapon: "laser",
            width: 0.026,
            tracerLength: 1.55,
            createdAt: now,
            duration: 440,
            tracerDuration: 110,
            blastDuration: 250
          };
          setShotEffects((effects) => [...effects.filter((effect) => now - effect.createdAt < effect.duration), supportShot].slice(-22));
          targetRuntime.aggroed = true;
        }
      } else {
        supportRobotRotation.current = playerRotation.current;
      }
    }
    if (surrenderNonce !== lastSurrenderNonceRef.current) {
      lastSurrenderNonceRef.current = surrenderNonce;
      if (playerDownedRef.current) surrenderRequestedRef.current = true;
    }
    if (playerDownedRef.current && (surrenderRequestedRef.current || now >= downedBleedOutAtRef.current)) {
      void finishPlayerDefeat(surrenderRequestedRef.current);
    }
    for (const { runtime } of npcActors) {
      if (runtime.dead) {
        if (now >= runtime.respawnAt) {
          runtime.dead = false;
          runtime.health = NPC_MAX_HEALTH;
          runtime.ragdollImpact = undefined;
          runtime.bloodMarks = [];
          runtime.ragdollControllerRef.current = null;
          runtime.respawnNonce += 1;
          const angle = (runtime.seed * 0.73 + runtime.respawnNonce * 2.17) % (Math.PI * 2);
          const radius = 0.8 + ((runtime.seed + runtime.respawnNonce * 17) % 24) / 10;
          runtime.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
          runtime.rotationRef.current = angle;
          runtime.targetIndex = nearestPatrolIndex(runtime.position);
          runtime.idleUntil = now + 900;
          runtime.motionRef.current = "idle";
          setNpcUiVersion((version) => version + 1);
          onToast(`${runtime.username} воскрес в центре города`);
        }
        continue;
      }

      if (now < runtime.idleUntil) {
        runtime.motionRef.current = "idle";
        continue;
      }

      const target = NPC_PATROL_ROUTE[runtime.targetIndex];
      const direction = target.clone().sub(runtime.position).setY(0);
      const distance = direction.length();
      if (distance < 0.13) {
        runtime.position.copy(target);
        runtime.targetIndex = (runtime.targetIndex + 1) % NPC_PATROL_ROUTE.length;
        runtime.idleUntil = now + 650 + ((runtime.seed + runtime.targetIndex * 211) % 1450);
        runtime.motionRef.current = "idle";
      } else {
        direction.normalize();
        runtime.rotationRef.current = Math.atan2(direction.x, direction.z);
        runtime.position.addScaledVector(direction, Math.min(distance, runtime.speed * Math.min(delta, WALK_DELTA_CAP)));
        runtime.motionRef.current = "walk";
      }
    }

    for (const { runtime } of outlandsActors) {
      if (runtime.dead) {
        if (runtime.enemyId && expeditionActiveRef.current && defeatedEnemySet.has(runtime.enemyId)) continue;
        if (now >= runtime.respawnAt) {
          runtime.dead = false;
          runtime.health = runtime.maxHealth;
          runtime.ragdollImpact = undefined;
          runtime.bloodMarks = [];
          runtime.ragdollControllerRef.current = null;
          runtime.respawnNonce += 1;
          runtime.position.copy(runtime.homePosition);
          runtime.position.x += ((runtime.seed + runtime.respawnNonce * 13) % 9 - 4) * 0.35;
          runtime.position.z += ((runtime.seed + runtime.respawnNonce * 19) % 9 - 4) * 0.35;
          runtime.rotationRef.current = Math.PI;
          runtime.targetIndex = (nearestRouteIndex(runtime.position, runtime.patrol) + 1) % runtime.patrol.length;
          runtime.idleUntil = now + 900;
          runtime.motionRef.current = runtime.kind === "human" ? "armedIdle" : "idle";
          runtime.robotMotionRef.current = "idle";
          runtime.aggroed = false;
          setNpcUiVersion((version) => version + 1);
        }
        continue;
      }

      if (now < runtime.hitUntil) {
        runtime.motionRef.current = runtime.kind === "human" ? "armedIdle" : "idle";
        runtime.robotMotionRef.current = "hit";
        continue;
      }

      const toPlayer = playerPosition.current.clone().sub(runtime.position).setY(0);
      const playerDistance = toPlayer.length();
      const homeDistance = runtime.position.distanceTo(runtime.homePosition);
      const playerInCombatZone = expeditionActiveRef.current
        && playerPosition.current.z < -105
        && !playerDownedRef.current
        && !activeInteriorRef.current;
      if (runtime.aggroed && (playerDistance > runtime.aggroRange * 1.85 || homeDistance > runtime.aggroRange * 1.5)) runtime.aggroed = false;
      const chasing = runtime.faction === "hostile"
        && playerInCombatZone
        && playerDistance <= runtime.aggroRange * 1.85
        && (runtime.aggroed || playerDistance <= runtime.aggroRange);

      if (!chasing) {
        advanceOutlandsPatrol(runtime, now, delta);
        continue;
      }

      runtime.aggroed = true;
      if (playerDistance > runtime.attackRange) {
        toPlayer.normalize();
        runtime.rotationRef.current = Math.atan2(toPlayer.x, toPlayer.z);
        const chaseScale = runtime.behavior === "sentinel"
          ? 0.5
          : runtime.behavior === "artillery"
            ? 0.62
            : runtime.behavior === "stalker"
              ? 1.22
              : 1;
        const requested = runtime.position.clone().addScaledVector(toPlayer, runtime.speed * chaseScale * Math.min(delta, WALK_DELTA_CAP));
        runtime.position.copy(resolveOutlandsCollisions(runtime.position, requested, 0.55));
        runtime.motionRef.current = "run";
        runtime.robotMotionRef.current = "run";
        continue;
      }

      runtime.rotationRef.current = Math.atan2(toPlayer.x, toPlayer.z);
      if ((runtime.behavior === "artillery" || runtime.behavior === "skirmisher") && playerDistance < runtime.attackRange * 0.58) {
        const retreat = toPlayer.lengthSq() > 0.0001 ? toPlayer.normalize().multiplyScalar(-1) : new THREE.Vector3(1, 0, 0);
        const requested = runtime.position.clone().addScaledVector(retreat, runtime.speed * 0.7 * Math.min(delta, WALK_DELTA_CAP));
        runtime.position.copy(resolveOutlandsCollisions(runtime.position, requested, 0.55));
      } else if (runtime.behavior === "skirmisher" && playerDistance > 0.001) {
        const strafe = toPlayer.normalize();
        strafe.set(-strafe.z, 0, strafe.x).multiplyScalar((Math.floor(now / 1_400) + runtime.seed) % 2 ? 1 : -1);
        const requested = runtime.position.clone().addScaledVector(strafe, runtime.speed * 0.42 * Math.min(delta, WALK_DELTA_CAP));
        runtime.position.copy(resolveOutlandsCollisions(runtime.position, requested, 0.55));
      }
      if (now < runtime.attackUntil) {
        runtime.motionRef.current = "shoot";
        runtime.robotMotionRef.current = "attack";
      } else {
        runtime.motionRef.current = "armedIdle";
        runtime.robotMotionRef.current = "idle";
      }
      const attackCooldown = ({
        sentinel: 560,
        artillery: 2_150,
        tank: 1_320,
        stalker: 720,
        skirmisher: 780,
        brute: 1_180,
        patrol: 980 + runtime.seed % 420
      } satisfies Record<OutlandsEnemyBehavior, number>)[runtime.behavior];
      if (now - runtime.lastAttackAt < attackCooldown) continue;
      const group = worldGroupRef.current;
      const startWorld = group?.localToWorld(runtime.position.clone().setY(runtime.kind === "human" ? 1.2 : 0.9));
      const endWorld = group?.localToWorld(playerPosition.current.clone().setY(1.0));
      if (startWorld && endWorld && !blastReachesTarget(startWorld, endWorld)) continue;
      runtime.lastAttackAt = now;
      runtime.attackUntil = now + 430;
      runtime.motionRef.current = "shoot";
      runtime.robotMotionRef.current = "attack";
      if (runtime.attackStyle === "ranged") {
        spawnEnemyTracer(runtime, now);
        const timer = window.setTimeout(() => {
          enemyDamageTimersRef.current.delete(timer);
          if (!expeditionActiveRef.current || playerDownedRef.current) return;
          damagePlayer(runtime.damage, runtime);
        }, 90);
        enemyDamageTimersRef.current.add(timer);
        if (runtime.behavior === "brute") {
          const burstTimer = window.setTimeout(() => {
            enemyDamageTimersRef.current.delete(burstTimer);
            if (!expeditionActiveRef.current || playerDownedRef.current || runtime.dead) return;
            spawnEnemyTracer(runtime, performance.now());
            damagePlayer(Math.max(1, Math.round(runtime.damage * 0.72)), runtime);
          }, 190);
          enemyDamageTimersRef.current.add(burstTimer);
        }
      } else {
        damagePlayer(runtime.damage, runtime);
      }
    }

    let didMove = false;
    let completedClickRoute = false;
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
      const requestedCarPosition = carPosition.current.clone().addScaledVector(frontVector(carRotation.current), carSpeed.current * delta);
      const nextPosition = resolveOutlandsCollisions(
        carPosition.current,
        resolveWorldAccess(carPosition.current, requestedCarPosition),
        1.05
      );
      if (isRoad(nextPosition.x, nextPosition.z)) {
        carPosition.current.copy(nextPosition);
        didMove = Math.abs(carSpeed.current) > 0.03;
      } else {
        carSpeed.current *= -0.16;
      }
      playerPosition.current.copy(carPosition.current);
      playerRotation.current = carRotation.current;
    } else if (playerDownedRef.current) {
      const falling = now < downedFallingUntilRef.current;
      const inputX = (keys.current.has("a") || keys.current.has("arrowleft") ? 1 : 0)
        - (keys.current.has("d") || keys.current.has("arrowright") ? 1 : 0);
      const inputZ = (keys.current.has("w") || keys.current.has("arrowup") ? 1 : 0)
        - (keys.current.has("s") || keys.current.has("arrowdown") ? 1 : 0);
      if (!falling && (inputX !== 0 || inputZ !== 0)) {
        const movement = frontVector(cameraYaw.current).multiplyScalar(inputZ)
          .addScaledVector(rightVector(cameraYaw.current), inputX)
          .normalize();
        const currentPosition = playerPosition.current.clone();
        const requested = currentPosition.clone().addScaledVector(movement, DOWNED_CRAWL_SPEED * Math.min(delta, WALK_DELTA_CAP));
        const shellResolved = resolveWalkPosition(currentPosition, requested, worldResidents);
        const worldResolved = resolveOutlandsCollisions(currentPosition, resolveWorldAccess(currentPosition, shellResolved));
        if (currentPosition.distanceToSquared(worldResolved) > 0.00000025) {
          playerPosition.current.copy(worldResolved);
          playerRotation.current = Math.atan2(movement.x, movement.z);
          didMove = true;
        }
      }
    } else if (cameraModeRef.current === "thirdPerson") {
      const inputX = (keys.current.has("a") ? 1 : 0) - (keys.current.has("d") ? 1 : 0);
      const inputZ = (keys.current.has("w") ? 1 : 0) - (keys.current.has("s") ? 1 : 0);
      const facingCamera = aimingRef.current || thirdPersonFireHeld.current || now < shootingUntil.current;
      if (facingCamera) playerRotation.current = cameraYaw.current;
      if (inputX !== 0 || inputZ !== 0) {
        const movement = frontVector(cameraYaw.current).multiplyScalar(inputZ)
          .addScaledVector(rightVector(cameraYaw.current), inputX)
          .normalize();
        const crouching = keys.current.has("control");
        const running = keys.current.has("shift") && !crouching;
        travelMode.current = running ? "run" : "walk";
        const movementSpeed = crouching ? CROUCH_SPEED : running ? RUN_SPEED : WALK_SPEED;
        const currentPosition = playerPosition.current.clone();
        const nextPosition = currentPosition.clone().addScaledVector(movement, movementSpeed * Math.min(delta, WALK_DELTA_CAP));
        const shellResolved = resolveWalkPosition(currentPosition, nextPosition, worldResidents);
        const itemResolved = resolveInteriorItemCollisions(currentPosition, shellResolved, worldResidents, catalog);
        const worldResolved = resolveOutlandsCollisions(currentPosition, resolveWorldAccess(currentPosition, itemResolved));
        if (currentPosition.distanceToSquared(worldResolved) > 0.00000025) {
          playerPosition.current.copy(worldResolved);
          didMove = true;
          if (!facingCamera) playerRotation.current = Math.atan2(movement.x, movement.z);
        }
      }
    } else {
      if (clickTarget.current) {
        const direction = clickTarget.current.clone().sub(playerPosition.current);
        direction.y = 0;
        const distance = direction.length();
        const movementSpeed = keys.current.has("control")
          ? CROUCH_SPEED
          : travelMode.current === "run"
            ? RUN_SPEED
            : WALK_SPEED;
        const maxStep = movementSpeed * Math.min(delta, WALK_DELTA_CAP);
        if (distance <= maxStep + 0.001) {
          const currentPosition = playerPosition.current.clone();
          const shellResolved = resolveWalkPosition(currentPosition, clickTarget.current, worldResidents);
          const itemResolved = resolveInteriorItemCollisions(currentPosition, shellResolved, worldResidents, catalog);
          const worldResolved = resolveOutlandsCollisions(currentPosition, resolveWorldAccess(currentPosition, itemResolved));
          didMove = currentPosition.distanceToSquared(worldResolved) > 0.000001;
          playerPosition.current.copy(worldResolved);
          const reachedTarget = worldResolved.distanceToSquared(clickTarget.current) < 0.04;
          clickTarget.current = reachedTarget ? clickPath.current.shift() ?? null : null;
          if (!reachedTarget) clickPath.current = [];
          completedClickRoute = !clickTarget.current && clickPath.current.length === 0;
        } else {
          direction.normalize();
          playerRotation.current = Math.atan2(direction.x, direction.z);
          const currentPosition = playerPosition.current.clone();
          const nextPosition = currentPosition.clone().addScaledVector(direction, maxStep);
          const shellResolved = resolveWalkPosition(currentPosition, nextPosition, worldResidents);
          const itemResolved = resolveInteriorItemCollisions(currentPosition, shellResolved, worldResidents, catalog);
          const worldResolved = resolveOutlandsCollisions(currentPosition, resolveWorldAccess(currentPosition, itemResolved));
          const actualDistance = currentPosition.distanceTo(worldResolved);
          if (actualDistance > 0.0005) {
            playerPosition.current.copy(worldResolved);
            didMove = true;
          }
        }
      }
    }

    if (!drivingRef.current && !clickTarget.current && clickPath.current.length === 0 && pendingInteraction.current) {
      const interaction = pendingInteraction.current;
      pendingInteraction.current = null;
      finishInteriorInteraction(interaction);
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

    const nextRegion = worldRegionAt(playerPosition.current.x, playerPosition.current.z);
    if (nextRegion !== currentRegionRef.current) {
      currentRegionRef.current = nextRegion;
      onWorldRegionChange?.(nextRegion);
      onVitalsChange(playerHealthRef.current, nextRegion, playerShieldRef.current);
    }
    let nextNearbyContainer: string | undefined;
    let nearestContainerDistance = 3.25;
    for (const container of OUTLAND_CONTAINERS) {
      if (lootedContainerSetRef.current.has(container.id)) continue;
      const distance = playerPosition.current.distanceTo(new THREE.Vector3().fromArray(container.position));
      if (distance >= nearestContainerDistance) continue;
      nearestContainerDistance = distance;
      nextNearbyContainer = container.id;
    }
    if (nextNearbyContainer !== nearbyContainerRef.current) {
      nearbyContainerRef.current = nextNearbyContainer;
      setNearbyContainerId(nextNearbyContainer);
    }
    let nextNearbyEnemy: string | undefined;
    let nearestEnemyDistance = 4.4;
    for (const { runtime } of outlandsActors) {
      if (
        !runtime.dead
        || !runtime.enemyId
        || !defeatedEnemySet.has(runtime.enemyId)
        || lootedEnemySetRef.current.has(runtime.enemyId)
      ) continue;
      const distance = playerPosition.current.distanceTo(runtime.position);
      if (distance >= nearestEnemyDistance) continue;
      nearestEnemyDistance = distance;
      nextNearbyEnemy = runtime.enemyId;
    }
    if (nextNearbyEnemy !== nearbyEnemyRef.current) {
      nearbyEnemyRef.current = nextNearbyEnemy;
      setNearbyEnemyId(nextNearbyEnemy);
    }
    const extractionDistance = playerPosition.current.distanceTo(
      new THREE.Vector3(EXTRACTION_POSITION[0], 0, EXTRACTION_POSITION[2])
    );
    const nextNearExtraction = expeditionActiveRef.current && extractionDistance <= EXTRACTION_RADIUS;
    if (nextNearExtraction !== nearExtractionRef.current) {
      nearExtractionRef.current = nextNearExtraction;
      setNearExtraction(nextNearExtraction);
    }
    const nextExtractionAvailable = expeditionActiveRef.current
      && isAtExtractionCheckpoint(playerPosition.current.x, playerPosition.current.z);
    if (nextExtractionAvailable !== extractionAvailableRef.current) {
      extractionAvailableRef.current = nextExtractionAvailable;
      onExtractionAvailabilityChange?.(nextExtractionAvailable);
    }

    const locomoting = !drivingRef.current && (didMove || Boolean(clickTarget.current) || clickPath.current.length > 0);
    setMoving(locomoting);
    if (didMove && introViewRef.current) {
      introViewRef.current = false;
      setIntroView(false);
    }
    let jumpHeight = 0;
    let jumpMotion: CharacterMotion | null = null;
    if (!drivingRef.current && !playerDownedRef.current && jumpElapsedMs.current !== null) {
      jumpElapsedMs.current += Math.min(delta, 0.08) * 1000;
      const jumpProgress = jumpElapsedMs.current / JUMP_DURATION_MS;
      if (jumpProgress >= 1) {
        jumpElapsedMs.current = null;
      } else {
        jumpHeight = Math.sin(Math.PI * THREE.MathUtils.clamp(jumpProgress, 0, 1)) * JUMP_HEIGHT;
        jumpMotion = jumpProgress < 0.3 ? "jumpStart" : jumpProgress < 0.7 ? "jumpLoop" : "jumpLand";
      }
    }

    const currentlyAiming = cameraModeRef.current === "thirdPerson"
      ? aimingRef.current || thirdPersonFireHeld.current
      : keys.current.has("q");
    const currentlyShooting = now < shootingUntil.current;
    const currentlyReloading = reloadStateRef.current?.weapon === selectedWeaponRef.current
      && now < reloadStateRef.current.endsAt;
    playerUpperMotionRef.current = playerDownedRef.current
      ? null
      : currentlyReloading
      ? "reload"
      : currentlyShooting
        ? "shoot"
        : currentlyAiming
          ? "aim"
          : null;
    const nextMotion: CharacterMotion = playerDownedRef.current
      ? now < downedFallingUntilRef.current
        ? "death"
        : locomoting
          ? "crawl"
          : "crawlIdle"
      : jumpMotion
      ?? (keys.current.has("control")
        ? locomoting ? "crouchWalk" : "crouchIdle"
        : locomoting
          ? travelMode.current === "run" ? "run" : "walk"
          : activeInteriorRef.current ? "idle" : "armedIdle");
    updatePlayerMotion(nextMotion);

    renderPlayerPosition.copy(playerPosition.current);
    renderPlayerPosition.y = jumpHeight;
    renderPlayerRotation.current = playerRotation.current;
    cameraFollowPosition
      .copy(drivingRef.current ? carPosition.current : renderPlayerPosition)
      .sub(viewOrigin);
    if (drivingRef.current) {
      setRenderCarPosition(carPosition.current.clone());
      setRenderCarRotation(carRotation.current);
    }

    const rotationDelta = Math.abs(Math.atan2(
      Math.sin(playerRotation.current - lastRotationSent.current),
      Math.cos(playerRotation.current - lastRotationSent.current)
    ));
    const shouldSendMovement = didMove && (completedClickRoute || now - lastMoveSent.current > 120);
    const shouldSendAimRotation = !didMove
      && cameraModeRef.current === "thirdPerson"
      && aimingRef.current
      && rotationDelta > 0.035
      && now - lastMoveSent.current > 120;
    if (shouldSendMovement || shouldSendAimRotation) {
      lastMoveSent.current = now;
      lastRotationSent.current = playerRotation.current;
      onMove({
        x: playerPosition.current.x,
        y: 0,
        z: playerPosition.current.z,
        rotation: playerRotation.current,
        vehicle: drivingRef.current
      });
    }
  }, -2);

  function handleInteriorObjectInteract(
    resident: NeighborhoodResident,
    item: CatalogItem,
    x: number,
    z: number,
    rotation: number,
    size: [number, number, number]
  ) {
    if (drivingRef.current || cameraModeRef.current === "thirdPerson") return;
    if (keys.current.has("q")) {
      shootAt(houseLocalToWorld(new THREE.Vector3(x, 0, z), resident));
      return;
    }
    clickTarget.current = null;
    clickPath.current = [];
    pendingVisit.current = null;
    pendingInteraction.current = null;
    const start = playerPosition.current.clone();
    const entry = buildRouteToInteriorEntry(resident);
    if (!entry) return;
    const playerLocal = worldToHouseLocal(entry.cursor, resident).setY(0);
    const objectLocal = new THREE.Vector3(x, 0, z);
    const towardPlayer = playerLocal.clone().sub(objectLocal).setY(0);
    if (towardPlayer.lengthSq() < 0.001) towardPlayer.set(0, 0, 1);
    towardPlayer.normalize();
    const itemRight = new THREE.Vector3(Math.cos(rotation), 0, -Math.sin(rotation));
    const itemForward = new THREE.Vector3(Math.sin(rotation), 0, Math.cos(rotation));
    const directions = [
      towardPlayer,
      itemRight,
      itemRight.clone().multiplyScalar(-1),
      itemForward,
      itemForward.clone().multiplyScalar(-1)
    ];
    const grid = makeInteriorNavGrid(resident, catalog);
    let bestRoute: THREE.Vector3[] | null = null;
    let bestApproachPoint: THREE.Vector3 | null = null;
    let bestLength = Infinity;

    for (const direction of directions) {
      const normalized = direction.clone().normalize();
      const itemSpaceDirection = normalized.clone().applyAxisAngle(UP, -rotation);
      const supportDistance = Math.abs(itemSpaceDirection.x) * size[0] / 2
        + Math.abs(itemSpaceDirection.z) * size[2] / 2
        + 0.72;
      const candidateLocal = objectLocal.clone().addScaledVector(normalized, supportDistance);
      candidateLocal.x = THREE.MathUtils.clamp(candidateLocal.x, grid.minX, grid.maxX);
      candidateLocal.z = THREE.MathUtils.clamp(candidateLocal.z, grid.minZ, grid.maxZ);
      const candidateWorld = houseLocalToWorld(candidateLocal, resident).setY(0);
      const interiorRoute = findInteriorPath(entry.cursor, candidateWorld, resident, catalog, grid);
      if (!interiorRoute) continue;
      const route = entry.route.map((point) => point.clone());
      appendUniqueRoute(route, interiorRoute);
      const length = routeLength(start, route);
      if (length < bestLength) {
        bestLength = length;
        bestRoute = route;
        bestApproachPoint = candidateWorld;
      }
    }

    if (!bestRoute) {
      onToast("К предмету не получается подойти — путь перекрыт");
      return;
    }
    if (!bestApproachPoint) {
      onToast("К предмету не получается подойти — путь перекрыт");
      return;
    }
    startClickRoute(bestRoute, {
      itemId: item.id,
      action: item.type === "furniture" ? "use" : "look",
      residentUsername: resident.username,
      approachPoint: bestApproachPoint
    });
  }

  function handleGroundClick(event: ThreeEvent<MouseEvent>) {
    if (drivingRef.current || cameraModeRef.current === "thirdPerson" || !isPrimarySceneClick(event)) return;
    const worldPoint = event.point.clone().add(viewOrigin).setY(0);
    if (keys.current.has("q") && !buildMode) {
      shootAt(worldPoint.clone().setY(-0.12));
      return;
    }
    clickTarget.current = null;
    clickPath.current = [];
    pendingVisit.current = null;
    pendingInteraction.current = null;
    const currentInterior = activeInteriorRef.current;
    const targetInterior = residentAtPosition(worldPoint, worldResidents);

    if (targetInterior && targetInterior.username !== currentInterior?.username) {
      if (routeToResident(targetInterior)) {
        onToast(targetInterior.username === user.username ? "Идём домой" : `Идём в гости к ${targetInterior.username}`);
      }
      return;
    }

    if (currentInterior && targetInterior?.username === currentInterior.username) {
      const path = findInteriorPath(playerPosition.current, worldPoint, currentInterior, catalog);
      if (!path) {
        onToast("Не получается проложить путь между предметами");
        return;
      }
      startClickRoute(path, null, event.nativeEvent.shiftKey ? "run" : "walk");
      return;
    }

    if (currentInterior && targetInterior?.username !== currentInterior.username) {
      if (!isInteriorDoorClear(currentInterior, catalog)) {
        onToast("Путь к двери перекрыт предметами");
        return;
      }
      const innerDoor = interiorDoorApproach(currentInterior);
      const exitPath = findInteriorPath(playerPosition.current, innerDoor, currentInterior, catalog);
      if (!exitPath) {
        onToast("Путь к двери перекрыт предметами");
        return;
      }
      const route: THREE.Vector3[] = [];
      appendUniqueRoute(route, exitPath);
      appendUniqueRoute(route, [residentDoorPosition(currentInterior), worldPoint]);
      startClickRoute(route, null, event.nativeEvent.shiftKey ? "run" : "walk");
      return;
    }
    startClickRoute([worldPoint], null, event.nativeEvent.shiftKey ? "run" : "walk");
  }

  function handleInteriorFloorClick(event: ThreeEvent<MouseEvent>, resident: NeighborhoodResident) {
    if (drivingRef.current || cameraModeRef.current === "thirdPerson" || !isPrimarySceneClick(event)) return;
    clickTarget.current = null;
    clickPath.current = [];
    pendingVisit.current = null;
    pendingInteraction.current = null;
    const worldPoint = event.point.clone().add(viewOrigin).setY(0);
    if (keys.current.has("q") && !buildMode) {
      shootAt(worldPoint);
      return;
    }
    if (buildMode && resident.username === user.username && activeInteriorRef.current?.username === user.username) {
      const local = worldToHouseLocal(worldPoint, resident);
      onBuildMove(
        THREE.MathUtils.clamp(local.x, -7.6, 7.6),
        THREE.MathUtils.clamp(local.z, -7.6, 7.6)
      );
      return;
    }
    const path = findInteriorPath(playerPosition.current, worldPoint, resident, catalog);
    if (!path) {
      onToast("Не получается проложить путь между предметами");
      return;
    }
    startClickRoute(path, null, event.nativeEvent.shiftKey ? "run" : "walk");
  }

  function handleHouseEnter(resident: NeighborhoodResident) {
    if (cameraModeRef.current === "thirdPerson") return;
    if (drivingRef.current) {
      onToast("Сначала выйдите из машины возле дома");
      return;
    }
    if (keys.current.has("q")) {
      shootAt(residentDoorPosition(resident));
      return;
    }
    if (routeToResident(resident)) {
      onToast(resident.username === user.username ? "Идём домой" : `Идём в гости к ${resident.username}`);
    }
  }

  function handleOutlandsContainerClick(containerId: string, event: ThreeEvent<MouseEvent>) {
    if (cameraModeRef.current === "thirdPerson") return;
    if (keys.current.has("q")) {
      if (worldGroupRef.current) shootAt(worldGroupRef.current.worldToLocal(event.point.clone()));
      return;
    }
    if (nearbyContainerRef.current !== containerId) {
      const container = OUTLAND_CONTAINERS.find((entry) => entry.id === containerId);
      onToast(`Подойдите ближе к ${container?.name.toLowerCase() ?? "контейнеру"}`);
      return;
    }
    if (lootedContainerSet.has(containerId)) {
      onToast("Этот контейнер уже пуст");
      return;
    }
    if (!expeditionActiveRef.current) {
      onToast("Сначала выберите снаряжение и начните вылазку");
      return;
    }
    onLootContainer?.(containerId);
  }

  const controlledCarTransform = { position: renderCarPosition, rotation: renderCarRotation };
  const cameraResident = activeInterior ?? ownResident;
  const displayHomePosition = new THREE.Vector3(cameraResident.lot.x, 0, cameraResident.lot.z).sub(viewOrigin);
  const cameraHomeFront = frontVector(cameraResident.lot.rotation);
  const cameraBounds = {
    minX: WORLD_MIN_X - viewOrigin.x,
    maxX: WORLD_MAX_X - viewOrigin.x,
    minZ: WORLD_MIN_Z - viewOrigin.z,
    maxZ: WORLD_MAX_Z - viewOrigin.z
  };

  return (
    <>
      <color attach="background" args={["#9ed9f3"]} />
      <fog attach="fog" args={["#b9ddec", 58, 148]} />
      <Sky distance={450000} sunPosition={[18, 28, 12]} turbidity={3.5} rayleigh={0.72} mieCoefficient={0.006} mieDirectionalG={0.76} />
      <hemisphereLight args={["#dff5ff", "#587447", 1.55]} />
      <FollowingSun />
      <Sparkles count={100} scale={[78, 10, 128]} size={1.35} speed={0.18} color="#fff2fb" opacity={0.52} />
      <group ref={worldGroupRef} position={viewOffset}>
        <DistrictGeometry residents={worldResidents} />
        <OutlandsEnvironment
          activeExpedition={expeditionActive}
          lootedContainerIds={lootedContainerSet}
          nearbyContainerId={nearbyContainerId}
          nearExtraction={nearExtraction}
          onContainerClick={handleOutlandsContainerClick}
        />
        <mesh
          receiveShadow
          userData={{ aimSurface: true }}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.012, -120]}
          onClick={handleGroundClick}
        >
          <planeGeometry args={[340, 420]} />
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
            onInteract={handleInteriorObjectInteract}
            onSelectPlaced={onSelectPlaced}
          />
        ))}
        {npcActors.map(({ resident, runtime }) => {
          const npcOutfit = getCatalogItem(catalog, resident.avatar.outfit);
          const npcCharacter = getCatalogItem(catalog, resident.avatar.character);
          const npcPet = runtime.dead ? undefined : getCatalogItem(catalog, resident.avatar.pet);
          return (
            <Player
              key={`resident-${resident.plotId}`}
              username={runtime.dead ? `${resident.username} · повержен` : resident.username}
              color={npcOutfit?.color ?? resident.colors.roof}
              position={runtime.position}
              pet={npcPet}
              character={npcCharacter}
              outfit={npcOutfit}
              motionRef={runtime.motionRef}
              rotation={runtime.rotationRef.current}
              rotationRef={runtime.rotationRef}
              teleportNonce={runtime.respawnNonce}
              health={runtime.health}
              maxHealth={NPC_MAX_HEALTH}
              combatUsername={runtime.username}
              combatDead={runtime.dead}
              bloodMarks={runtime.bloodMarks}
              ragdollImpact={runtime.ragdollImpact}
              ragdollControllerRef={runtime.ragdollControllerRef}
              onCombatHit={(event) => {
                if (cameraModeRef.current === "thirdPerson" || !keys.current.has("q") || !isPrimarySceneClick(event)) return;
                event.stopPropagation();
                if (!worldGroupRef.current) return;
                shootAt(worldGroupRef.current.worldToLocal(event.point.clone()));
              }}
            />
          );
        })}
        {outlandsActors.map(({ definition, runtime }, index) => {
          const handleHit = (event: ThreeEvent<MouseEvent>) => {
            if (cameraModeRef.current === "thirdPerson" || !keys.current.has("q") || !isPrimarySceneClick(event)) return;
            event.stopPropagation();
            if (!worldGroupRef.current) return;
            shootAt(worldGroupRef.current.worldToLocal(event.point.clone()));
          };
          const corpsePrompt = runtime.dead && nearbyEnemyId === definition.id ? (
            <Html
              center
              position={[runtime.position.x, definition.kind === "quadShell" ? 1.75 : 1.25, runtime.position.z]}
              distanceFactor={12}
              style={{ pointerEvents: "none" }}
            >
              <div className="world-interact-label corpse-loot">
                <b>{lootedEnemySet.has(definition.id) ? "✓" : "E"}</b>
                <span>{lootedEnemySet.has(definition.id) ? "противник обыскан" : `обыскать · ${definition.name}`}</span>
              </div>
            </Html>
          ) : null;
          if (definition.kind === "eyeDrone" || definition.kind === "quadShell") {
            return (
              <group key={definition.id}>
                <OutlandsRobot
                  kind={definition.kind}
                  username={runtime.username}
                  displayName={expeditionScannerUntil && expeditionScannerUntil > Date.now()
                    ? `${definition.name} · СКАН`
                    : definition.name}
                  position={runtime.position}
                  rotationRef={runtime.rotationRef}
                  motionRef={runtime.robotMotionRef}
                  health={runtime.health}
                  maxHealth={runtime.maxHealth}
                  dead={runtime.dead}
                  faction={definition.faction}
                  onCombatHit={handleHit}
                />
                {corpsePrompt}
              </group>
            );
          }
          const visual = outlandsHumanVisuals[index % Math.max(1, outlandsHumanVisuals.length)] ?? ownResident;
          const outfit = getCatalogItem(catalog, visual.avatar.outfit);
          const character = getCatalogItem(catalog, visual.avatar.character);
          return (
            <group key={definition.id}>
              <Player
                username={runtime.dead
                  ? `${definition.name} · повержен`
                  : expeditionScannerUntil && expeditionScannerUntil > Date.now()
                    ? `${definition.name} · СКАН`
                    : definition.name}
                color={outfit?.color ?? "#9b4a3c"}
                position={runtime.position}
                character={character}
                outfit={outfit}
                motionRef={runtime.motionRef}
                weapon="rifle"
                rotation={runtime.rotationRef.current}
                rotationRef={runtime.rotationRef}
                teleportNonce={runtime.respawnNonce}
                health={runtime.health}
                maxHealth={runtime.maxHealth}
                combatUsername={runtime.username}
                combatDead={runtime.dead}
                bloodMarks={runtime.bloodMarks}
                ragdollImpact={runtime.ragdollImpact}
                ragdollControllerRef={runtime.ragdollControllerRef}
                onCombatHit={handleHit}
              />
              <OutlandsHumanVariantRig
                enemyId={definition.id}
                position={runtime.position}
                rotationRef={runtime.rotationRef}
                dead={runtime.dead}
              />
              {corpsePrompt}
            </group>
          );
        })}
        {expeditionSupportRobotUntil && expeditionSupportRobotUntil > Date.now() ? (
          <OutlandsRobot
            kind="eyeDrone"
            username="support:guardian"
            displayName="Союзный Страж"
            position={supportRobotPosition.current}
            rotationRef={supportRobotRotation}
            motionRef={supportRobotMotion}
            health={100}
            maxHealth={100}
            dead={false}
            faction="neutral"
          />
        ) : null}
        {CITY_TRADERS.map((trader, index) => {
          const traderVisual = outlandsHumanVisuals[index % Math.max(1, outlandsHumanVisuals.length)] ?? rangerVisual;
          return (
            <Player
              key={trader.id}
              username={`${trader.name} · ${trader.subtitle}`}
              color={trader.color}
              position={trader.position}
              character={getCatalogItem(catalog, traderVisual.avatar.character)}
              outfit={getCatalogItem(catalog, traderVisual.avatar.outfit)}
              motion="armedIdle"
              weapon={trader.id === "gunsmith" ? "rifle" : undefined}
              rotation={Math.PI}
              onClick={(event) => {
                event.stopPropagation();
                onOpenExpeditionPanel?.(trader.id === "artifacts" ? "traders" : trader.id === "quartermaster" ? "gear" : "traders");
                onToast(`${trader.name}: каталог открыт в панели вылазки`);
              }}
            />
          );
        })}
        <Player
          username="Рейнджер Мира · безопасна"
          color={getCatalogItem(catalog, rangerVisual.avatar.outfit)?.color ?? "#3cc59a"}
          position={rangerPosition}
          character={getCatalogItem(catalog, rangerVisual.avatar.character)}
          outfit={getCatalogItem(catalog, rangerVisual.avatar.outfit)}
          motion="armedIdle"
          weapon="rifle"
          rotation={Math.PI}
        />
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
            gear={expeditionActive ? expeditionGear : undefined}
            moving={moving}
            motion={playerMotion}
            motionRef={playerMotionRef}
            weapon={activeInterior || playerDownedRef.current ? undefined : selectedWeapon}
            muzzleRef={playerMuzzleRef}
            weaponAimTargetRef={playerAimTargetRef}
            weaponRecoilRef={recoilRef}
            actionNonceRef={shotNonceRef}
            upperMotionRef={playerUpperMotionRef}
            combatDead={playerMotion === "death" && playerDownedRef.current}
            ragdollImpact={playerRagdollImpact}
            rotation={renderPlayerRotation.current}
            rotationRef={playerRotation}
          />
        ) : null}
        <SurfaceImpactMarks marks={impactMarks} />
        {shotEffects.map((effect) => <ShotEffectView key={effect.id} effect={effect} />)}
        {impactEffects.map((effect) => <SurfaceImpactEffectView key={effect.id} effect={effect} />)}
        {bloodEffects.map((effect) => <BloodHitEffect key={effect.id} effect={effect} />)}
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
            rotation={player.position.rotation ?? 0}
          />
        ))}
      </group>
      <StreetCamera
        position={cameraFollowPosition}
        rotation={driving ? renderCarRotation : renderPlayerRotation.current}
        driving={driving}
        cameraMode={cameraMode}
        cameraYaw={cameraYaw}
        cameraPitch={cameraPitch}
        shoulderSide={shoulderSide}
        aiming={aiming}
        worldRoot={worldGroupRef}
        homePosition={displayHomePosition}
        homeFront={activeInterior ? cameraHomeFront : homeFront}
        neighborDirection={neighborDirection}
        intro={introView}
        inside={Boolean(activeInterior)}
        keys={keys}
        bounds={cameraBounds}
      />
    </>
  );
}

function ThirdPersonReticle({
  aiming,
  recoilRef
}: {
  aiming: boolean;
  recoilRef: RefObject<WeaponRecoilState>;
}) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let animationFrame = 0;
    const update = () => {
      const element = elementRef.current;
      if (element) {
        const bounds = (element.offsetParent as HTMLElement | null)?.getBoundingClientRect();
        const width = bounds?.width ?? window.innerWidth;
        const height = bounds?.height ?? window.innerHeight;
        const x = recoilRef.current.x * width * 0.5;
        const y = -recoilRef.current.y * height * 0.5;
        element.style.transform = `translate(calc(-50% + ${x.toFixed(2)}px), calc(-50% + ${y.toFixed(2)}px))`;
      }
      animationFrame = window.requestAnimationFrame(update);
    };
    animationFrame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [recoilRef]);

  return (
    <div ref={elementRef} className={aiming ? "third-person-reticle aiming" : "third-person-reticle"} aria-hidden="true">
      <span />
    </div>
  );
}

export function NeighborhoodScene(props: NeighborhoodSceneProps) {
  const [driving, setDriving] = useState(false);
  const [inside, setInside] = useState(() => {
    if (!props.initialPosition) return true;
    const position = new THREE.Vector3(props.initialPosition.x, 0, props.initialPosition.z);
    return Boolean(residentAtPosition(position, props.residents));
  });
  const [selectedWeapon, setSelectedWeapon] = useState<WeaponKind>("pistol");
  const selectedWeaponStateRef = useRef<WeaponKind>("pistol");
  selectedWeaponStateRef.current = selectedWeapon;
  const [ammoByWeapon, setAmmoByWeapon] = useState<WeaponAmmoState>(createWeaponAmmoState);
  const ammoRef = useRef(ammoByWeapon);
  const [reloadState, setReloadState] = useState<WeaponReloadState | null>(null);
  const reloadRef = useRef<WeaponReloadState | null>(null);
  const reloadTimerRef = useRef<number | null>(null);
  const [aiming, setAiming] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("strategy");
  const [pointerLocked, setPointerLocked] = useState(false);
  const [worldVitals, setWorldVitals] = useState<{ health: number; region: WorldRegion; shield: number }>({
    health: props.expeditionActive ? props.expeditionPlayerHealth ?? 100 : 100,
    region: "city",
    shield: props.expeditionActive ? props.expeditionPlayerShield ?? 0 : 0
  });
  const [downedState, setDownedState] = useState<PlayerDownedUiState>(() => {
    if (!props.expeditionActive || !props.expeditionDownedAt || !props.expeditionBleedOutAt) return null;
    const now = performance.now();
    return {
      fallingUntil: now + Math.max(0, props.expeditionDownedAt + DOWNED_FALL_MS - Date.now()),
      bleedOutAt: now + Math.max(0, props.expeditionBleedOutAt - Date.now())
    };
  });
  const [downedClock, setDownedClock] = useState(() => performance.now());
  const [surrenderNonce, setSurrenderNonce] = useState(0);
  const [hitFeedback, setHitFeedback] = useState<{ kind: PlayerHitFeedback; nonce: number } | null>(null);
  const hitFeedbackTimerRef = useRef<number | null>(null);
  const recoilRef = useRef<WeaponRecoilState>({ x: 0, y: 0, kick: 0 });
  const previousAmmoExpeditionActiveRef = useRef(false);
  const lastNoAmmoToastAtRef = useRef(0);

  const handleVitalsChange = useCallback((health: number, region: WorldRegion, shield: number) => {
    setWorldVitals((current) => current.health === health && current.region === region && current.shield === shield
      ? current
      : { health, region, shield });
  }, []);

  const handlePlayerHitFeedback = useCallback((kind: PlayerHitFeedback) => {
    if (hitFeedbackTimerRef.current !== null) window.clearTimeout(hitFeedbackTimerRef.current);
    setHitFeedback({ kind, nonce: performance.now() });
    hitFeedbackTimerRef.current = window.setTimeout(() => {
      hitFeedbackTimerRef.current = null;
      setHitFeedback(null);
    }, kind === "heal" ? 360 : 220);
  }, []);

  useEffect(() => {
    if (!downedState) return;
    setDownedClock(performance.now());
    const interval = window.setInterval(() => setDownedClock(performance.now()), 100);
    return () => window.clearInterval(interval);
  }, [downedState]);

  useEffect(() => () => {
    if (hitFeedbackTimerRef.current !== null) window.clearTimeout(hitFeedbackTimerRef.current);
  }, []);

  const cancelReload = useCallback(() => {
    if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = null;
    reloadRef.current = null;
    setReloadState(null);
  }, []);

  const startReload = useCallback((weapon: WeaponKind) => {
    const config = WEAPONS[weapon];
    if (props.expeditionActive && (props.expeditionAmmo ?? 0) <= 0) {
      const now = performance.now();
      if (now - lastNoAmmoToastAtRef.current > 900) {
        lastNoAmmoToastAtRef.current = now;
        props.onToast("Боеприпасы закончились — возвращайтесь к точке эвакуации");
      }
      return;
    }
    if (ammoRef.current[weapon] >= config.magazineSize) return;
    if (reloadRef.current?.weapon === weapon) return;
    if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
    const startedAt = performance.now();
    const nextReload = { weapon, startedAt, endsAt: startedAt + config.reloadMs };
    reloadRef.current = nextReload;
    setReloadState(nextReload);
    reloadTimerRef.current = window.setTimeout(() => {
      if (reloadRef.current?.startedAt !== startedAt || reloadRef.current.weapon !== weapon) return;
      const loadedRounds = props.expeditionActive
        ? Math.min(config.magazineSize, Math.max(0, props.expeditionAmmo ?? 0))
        : config.magazineSize;
      const nextAmmo = { ...ammoRef.current, [weapon]: loadedRounds };
      ammoRef.current = nextAmmo;
      setAmmoByWeapon(nextAmmo);
      reloadRef.current = null;
      reloadTimerRef.current = null;
      setReloadState(null);
    }, config.reloadMs);
  }, [props.expeditionActive, props.expeditionAmmo, props.onToast]);

  const consumeRound = useCallback((weapon: WeaponKind) => {
    if (reloadRef.current) return null;
    if (props.expeditionActive && (props.expeditionAmmo ?? 0) <= 0) {
      const now = performance.now();
      if (now - lastNoAmmoToastAtRef.current > 900) {
        lastNoAmmoToastAtRef.current = now;
        props.onToast("Боеприпасы закончились — возвращайтесь к точке эвакуации");
      }
      return null;
    }
    const current = ammoRef.current[weapon];
    if (current <= 0) {
      startReload(weapon);
      return null;
    }
    const remaining = current - 1;
    const nextAmmo = { ...ammoRef.current, [weapon]: remaining };
    ammoRef.current = nextAmmo;
    setAmmoByWeapon(nextAmmo);
    return remaining;
  }, [props.expeditionActive, props.expeditionAmmo, props.onToast, startReload]);

  const selectWeapon = useCallback((weapon: WeaponKind) => {
    if (props.expeditionActive && props.expeditionWeapon && weapon !== props.expeditionWeapon) return;
    if (selectedWeaponStateRef.current === weapon) return;
    selectedWeaponStateRef.current = weapon;
    cancelReload();
    setSelectedWeapon(weapon);
  }, [cancelReload, props.expeditionActive, props.expeditionWeapon]);

  useEffect(() => {
    if (props.expeditionActive && props.expeditionWeapon) {
      selectWeapon(props.expeditionWeapon);
    }
  }, [props.expeditionActive, props.expeditionWeapon, selectWeapon]);

  useEffect(() => {
    const justStarted = props.expeditionActive && !previousAmmoExpeditionActiveRef.current;
    previousAmmoExpeditionActiveRef.current = Boolean(props.expeditionActive);
    if (!justStarted) return;
    const nextAmmo = createWeaponAmmoState();
    const expeditionWeapon = props.expeditionWeapon ?? selectedWeaponStateRef.current;
    nextAmmo[expeditionWeapon] = Math.min(
      WEAPONS[expeditionWeapon].magazineSize,
      Math.max(0, props.expeditionAmmo ?? 0)
    );
    ammoRef.current = nextAmmo;
    setAmmoByWeapon(nextAmmo);
    cancelReload();
  }, [cancelReload, props.expeditionActive, props.expeditionAmmo, props.expeditionWeapon]);

  useEffect(() => () => {
    if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
  }, []);

  const weaponConfig = WEAPONS[selectedWeapon];
  const activeReload = reloadState?.weapon === selectedWeapon ? reloadState : null;
  const playerMaxHealth = 100 + (props.expeditionSkills?.survival ?? 0) * 10;
  const gearShieldCapacity = Object.values(props.expeditionGear ?? {}).reduce((total, gearId) => (
    total + (gearId ? EXPEDITION_GEAR[gearId].bonusShield : 0)
  ), 0);
  const shieldCapacity = Math.round(((props.shieldCount ?? 0) * EXPEDITION_SHIELD_PER_MODULE + gearShieldCapacity)
    * (1 + (props.expeditionSkills?.armor ?? 0) * 0.04));
  const fullRegionLabel = WORLD_REGION_LABELS[worldVitals.region];
  const downedSeconds = downedState ? Math.max(0, Math.ceil((downedState.bleedOutAt - downedClock) / 1000)) : 0;
  const downedFalling = Boolean(downedState && downedClock < downedState.fallingUntil);

  useEffect(() => {
    props.onExpeditionStatusChange?.({
      health: worldVitals.health,
      maxHealth: playerMaxHealth,
      shield: worldVitals.shield,
      downed: Boolean(downedState)
    });
  }, [downedState, playerMaxHealth, props.onExpeditionStatusChange, worldVitals.health, worldVitals.shield]);

  return (
    <>
      <Canvas
        shadows
        dpr={[1, 1.7]}
        camera={{ position: [16, 15, 20], fov: 48, near: 0.1, far: 600 }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <NeighborhoodWorld
          {...props}
          onDrivingChange={setDriving}
          selectedWeapon={selectedWeapon}
          onWeaponChange={selectWeapon}
          reloadState={reloadState}
          onConsumeRound={consumeRound}
          onReload={startReload}
          aiming={aiming}
          onAimingChange={setAiming}
          onInsideChange={setInside}
          cameraMode={cameraMode}
          onCameraModeChange={setCameraMode}
          onPointerLockChange={setPointerLocked}
          recoilRef={recoilRef}
          onVitalsChange={handleVitalsChange}
          onDownedStateChange={setDownedState}
          onPlayerHitFeedback={handlePlayerHitFeedback}
          surrenderNonce={surrenderNonce}
        />
      </Canvas>
      {hitFeedback ? (
        <div
          key={hitFeedback.nonce}
          className={`player-hit-flash ${hitFeedback.kind}`}
          aria-hidden="true"
          style={{
            position: "absolute",
            zIndex: 8,
            inset: 0,
            pointerEvents: "none",
            background: hitFeedback.kind === "health"
              ? "radial-gradient(circle, transparent 46%, rgba(150, 8, 32, .5) 100%)"
              : hitFeedback.kind === "shield"
                ? "radial-gradient(circle, transparent 52%, rgba(45, 212, 191, .38) 100%)"
                : "radial-gradient(circle, transparent 55%, rgba(74, 222, 128, .3) 100%)",
            boxShadow: hitFeedback.kind === "health" ? "inset 0 0 70px rgba(127, 0, 20, .42)" : "none"
          }}
        />
      ) : null}
      {downedState ? (
        <div
          className={`player-downed-overlay ${downedFalling ? "falling" : "crawling"}`}
          role="alert"
          style={{ position: "absolute", zIndex: 12, inset: 0, pointerEvents: "none", display: "grid", placeItems: "start center", paddingTop: 90 }}
        >
          <div
            className="player-downed-card"
            style={{ pointerEvents: "auto", width: "min(420px, calc(100% - 32px))", padding: "18px 20px", borderRadius: 16, border: "1px solid rgba(248,113,113,.72)", background: "rgba(35,10,17,.9)", color: "#fff", textAlign: "center", boxShadow: "0 18px 55px rgba(0,0,0,.4)", backdropFilter: "blur(12px)" }}
          >
            <strong className="player-downed-title" style={{ display: "block", fontSize: 22 }}>
              {downedFalling ? "Вы ранены — падаете" : "Вы тяжело ранены"}
            </strong>
            <span className="player-downed-copy" style={{ display: "block", margin: "7px 0 14px", color: "#fecaca", fontSize: 13 }}>
              {downedFalling ? "Через мгновение сможете ползти" : "WASD — медленно ползти до истечения времени"}
            </span>
            <div className="player-downed-timer" style={{ marginBottom: 14, fontSize: 30, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>
              0:{String(downedSeconds).padStart(2, "0")}
            </div>
            <button
              className="player-surrender-button"
              type="button"
              onClick={() => setSurrenderNonce((nonce) => nonce + 1)}
              style={{ border: "1px solid rgba(252,165,165,.75)", borderRadius: 9, padding: "9px 15px", background: "rgba(127,29,29,.72)", color: "#fff", fontWeight: 850, cursor: "pointer" }}
            >
              Сдаться и вернуться в город · G
            </button>
          </div>
        </div>
      ) : null}
      {cameraMode === "thirdPerson" ? (
        <>
          <ThirdPersonReticle aiming={aiming} recoilRef={recoilRef} />
          {!pointerLocked ? (
            <div className="pointer-lock-hint">Кликните по сцене, чтобы вернуть управление мышью</div>
          ) : null}
        </>
      ) : null}
      {!inside && worldVitals.region !== "city" ? (
        <div className="outlands-vitals" aria-label="Состояние экспедиции">
          <div className="outlands-vitals-heading">
            <span>{fullRegionLabel}</span>
            <b>{props.expeditionActive ? "ЭКСПЕДИЦИЯ" : "КПП ЗАКРЫТ"}</b>
          </div>
          <div className="outlands-health-row">
            <span>Здоровье</span>
            <strong>{Math.max(0, Math.round(worldVitals.health))} / {playerMaxHealth}</strong>
          </div>
          <div className="outlands-health-track"><i style={{ width: `${Math.max(0, Math.min(100, worldVitals.health / playerMaxHealth * 100))}%` }} /></div>
          {shieldCapacity > 0 ? (
            <>
              <div className="outlands-health-row outlands-shield-row">
                <span>Щит</span>
                <strong>{Math.ceil(worldVitals.shield)}</strong>
              </div>
              <div className="outlands-health-track outlands-shield-track"><i style={{ width: `${Math.max(0, Math.min(100, worldVitals.shield / Math.max(1, shieldCapacity) * 100))}%`, background: "linear-gradient(90deg, #22d3ee, #2dd4bf)" }} /></div>
            </>
          ) : null}
        </div>
      ) : null}
      {!driving && !inside && !downedState ? (
        <div className={aiming ? "weapon-hud aiming" : "weapon-hud"}>
          <div className="weapon-hud-title">
            <div className="weapon-hud-copy">
              <b>{activeReload ? "Перезарядка" : aiming ? "Режим прицеливания" : weaponConfig.label}</b>
              <span>{activeReload
                ? weaponConfig.label
                : aiming
                  ? cameraMode === "thirdPerson" ? "ЛКМ — огонь по центру прицела" : "кликните по точке или соседу"
                  : "1–5 — оружие · R — перезарядка"}</span>
            </div>
            <div className={activeReload ? "weapon-ammo reloading" : "weapon-ammo"}>
              <div><strong>{ammoByWeapon[selectedWeapon]}</strong><span>/ {weaponConfig.magazineSize}</span></div>
              <small>{activeReload
                ? "заряжаем магазин"
                : props.expeditionActive
                  ? `запас ${Math.max(0, (props.expeditionAmmo ?? 0) - ammoByWeapon[selectedWeapon])}`
                  : "магазины ∞"}</small>
            </div>
          </div>
          {activeReload ? (
            <div className="weapon-reload-track" aria-label="Перезарядка">
              <i key={activeReload.startedAt} style={{ animationDuration: `${activeReload.endsAt - activeReload.startedAt}ms` }} />
            </div>
          ) : null}
          <div className="weapon-hotbar">
            {WEAPON_ORDER.map((weapon, index) => (
              <button
                key={weapon}
                className={weapon === selectedWeapon ? "active" : ""}
                type="button"
                disabled={Boolean(props.expeditionActive && props.expeditionWeapon && weapon !== props.expeditionWeapon)}
                onClick={() => selectWeapon(weapon)}
                title={`${WEAPONS[weapon].label}: ${ammoByWeapon[weapon]} / ${WEAPONS[weapon].magazineSize}`}
              >
                <small>{index + 1}</small>
                <span>{WEAPONS[weapon].shortLabel}</span>
              </button>
            ))}
          </div>
          {props.expeditionActive ? (
            <div className="tactical-hotbar" aria-label="Тактические предметы">
              {EXPEDITION_GRENADE_IDS.map((itemId, index) => (
                <div key={itemId} className={`tactical-slot ${itemId}`} title={`${EXPEDITION_GRENADES[itemId].name}: клавиша ${index + 6}, бросок T`}>
                  <small>{index + 6}</small>
                  <span>{EXPEDITION_GRENADES[itemId].name}</span>
                  <b>×{props.expeditionTacticalCounts?.[itemId] ?? 0}</b>
                </div>
              ))}
              {EXPEDITION_ARTIFACT_IDS.map((itemId, index) => (
                <div key={itemId} className="tactical-slot artifact" title={EXPEDITION_ARTIFACTS[itemId].name}>
                  <small>{["Z", "X", "C"][index]}</small>
                  <span>{EXPEDITION_ARTIFACTS[itemId].effect === "nuke" ? "Солнце" : EXPEDITION_ARTIFACTS[itemId].effect === "support" ? "Страж" : "Сканер"}</span>
                  <b>×{props.expeditionTacticalCounts?.[itemId] ?? 0}</b>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={driving ? "street-controls driving" : cameraMode === "thirdPerson" ? "street-controls third-person" : "street-controls"}>
        <span className="control-key">WASD</span>
        <span>{driving ? "ехать и рулить" : cameraMode === "thirdPerson" ? "движение" : "камера"}</span>
        {!driving && cameraMode === "thirdPerson" ? (
          <>
            <span className="control-dot">·</span><span>мышь — обзор</span>
            <span className="control-dot">·</span><span><b>ПКМ</b> — прицел</span>
            {!inside ? <><span className="control-dot">·</span><span><b>ЛКМ</b> — огонь</span></> : null}
            {!inside ? <><span className="control-dot">·</span><span><b>колесо</b> — оружие</span></> : null}
            {!inside ? <><span className="control-dot">·</span><span><b>R</b> — перезарядка</span></> : null}
            <span className="control-dot">·</span><span><b>Shift</b> — бег</span>
            <span className="control-dot">·</span><span><b>Space</b> — прыжок</span>
            <span className="control-dot">·</span><span><b>Ctrl</b> — присесть</span>
            <span className="control-dot">·</span><span><b>B</b> — сменить плечо</span>
            <span className="control-dot">·</span><span><b>V</b> — обычная камера</span>
          </>
        ) : !driving ? (
          <>
            <span className="control-dot">·</span><span>клик — идти</span>
            <span className="control-dot">·</span><span><b>Shift</b> + клик — бег</span>
            <span className="control-dot">·</span><span><b>Space</b> — прыжок</span>
            <span className="control-dot">·</span><span><b>Ctrl</b> — присесть</span>
            {!inside ? <><span className="control-dot">·</span><span><b>Q</b> + клик — огонь</span></> : null}
            {!inside ? <><span className="control-dot">·</span><span><b>Q</b> + колесо — оружие</span></> : null}
            {!inside ? <><span className="control-dot">·</span><span><b>R</b> — перезарядка</span></> : null}
            <span className="control-dot">·</span><span><b>V</b> — от третьего лица</span>
          </>
        ) : null}
        {props.expeditionActive && !inside && !downedState ? (
          <>
            <span className="control-dot">·</span><span><b>H</b> — бинт ({props.bandageCount ?? 0})</span>
            <span className="control-dot">·</span><span><b>6–8</b> + <b>T</b> — граната</span>
            <span className="control-dot">·</span><span><b>Z / X / C</b> — артефакты</span>
          </>
        ) : null}
        <span className="control-dot">·</span>
        <span className="control-key">E</span>
        <span>{driving ? "выйти" : props.expeditionActive ? "обыскать / эвакуироваться" : "сесть в свою машину"}</span>
      </div>
    </>
  );
}
