export type CharacterMotion =
  | "idle"
  | "armedIdle"
  | "walk"
  | "run"
  | "jumpStart"
  | "jumpLoop"
  | "jumpLand"
  | "crouchIdle"
  | "crouchWalk"
  | "aim"
  | "shoot"
  | "death";

export type UpperBodyMotion = "aim" | "shoot";

export type WeaponRecoilState = {
  x: number;
  y: number;
  kick: number;
};

export type WeaponKind = "pistol" | "rifle" | "rocket" | "laser" | "sniper";

export type BodyPart =
  | "head"
  | "chest"
  | "abdomen"
  | "pelvis"
  | "leftUpperArm"
  | "leftLowerArm"
  | "leftHand"
  | "rightUpperArm"
  | "rightLowerArm"
  | "rightHand"
  | "leftThigh"
  | "leftCalf"
  | "leftFoot"
  | "rightThigh"
  | "rightCalf"
  | "rightFoot";

export type RagdollImpact = {
  nonce: number;
  kind: "bullet" | "explosion";
  bodyPart: BodyPart;
  boneName: string;
  point: [number, number, number];
  velocity: [number, number, number];
};

export type WeaponConfig = {
  label: string;
  shortLabel: string;
  damage: number;
  range: number;
  cooldownMs: number;
  color: string;
  tracerWidth: number;
  impactImpulse: number;
  recoilPitch: number;
  recoilYaw: number;
  recoilKick: number;
  blastRadius?: number;
  blastImpulse?: number;
};

export const WEAPON_ORDER: WeaponKind[] = ["pistol", "rifle", "rocket", "laser", "sniper"];

type WeaponModelConfig = {
  url: string;
  scale: number;
  gripNudge: [number, number, number];
  rotation: [number, number, number];
  muzzlePosition: [number, number, number];
  barrelAxis: [number, number, number];
};

export const WEAPON_MODELS: Record<WeaponKind, WeaponModelConfig> = {
  // The models point along their local X axis, while the Quaternius hand aims
  // along local Y with Z as up. Keep this extra quarter-turn so sights and
  // magazines stay upright instead of rolling onto their side.
  pistol: {
    url: "/assets/models/quaternius-weapons/pistol.gltf",
    scale: 0.37,
    gripNudge: [0, 0, 0],
    rotation: [Math.PI / 2, -Math.PI / 2, 0],
    muzzlePosition: [-0.7, 0.2587, 0],
    barrelAxis: [-1, 0, 0]
  },
  rifle: {
    url: "/assets/models/quaternius-weapons/rifle.gltf",
    scale: 0.42,
    gripNudge: [0, 0, 0.005],
    rotation: [Math.PI / 2, -Math.PI / 2, 0],
    muzzlePosition: [-1.05, 0.2455, -0.0023],
    barrelAxis: [-1, 0, 0]
  },
  rocket: {
    url: "/assets/models/quaternius-weapons/rocket-launcher.gltf",
    scale: 0.4,
    gripNudge: [0, -0.02, 0.05],
    rotation: [Math.PI / 2, Math.PI / 2, 0],
    muzzlePosition: [0.55, 0.3683, 0],
    barrelAxis: [1, 0, 0]
  },
  laser: {
    url: "/assets/models/quaternius-weapons/laser.gltf",
    scale: 0.38,
    gripNudge: [0, 0, 0.005],
    rotation: [Math.PI / 2, -Math.PI / 2, 0],
    muzzlePosition: [-0.93, 0.054, -0.012],
    barrelAxis: [-1, 0, 0]
  },
  sniper: {
    url: "/assets/models/quaternius-weapons/sniper.gltf",
    scale: 0.35,
    gripNudge: [0, -0.003, 0.01],
    rotation: [Math.PI / 2, -Math.PI / 2, 0],
    muzzlePosition: [-1.62, 0.2293, -0.0214],
    barrelAxis: [-1, 0, 0]
  }
};

export const CHARACTER_ANIMATION_URL = "/assets/animations/quaternius-universal/UAL1_Standard.glb";
export const TOWN_CAR_MODEL_URL = "/assets/models/custom/town-car.glb";
export const CORE_GAME_MODEL_URLS = [
  CHARACTER_ANIMATION_URL,
  TOWN_CAR_MODEL_URL,
  ...Object.values(WEAPON_MODELS).map((weapon) => weapon.url)
];

export const WEAPONS: Record<WeaponKind, WeaponConfig> = {
  pistol: {
    label: "Пистолет",
    shortLabel: "Пистолет",
    damage: 40,
    range: 28,
    cooldownMs: 330,
    color: "#ffd166",
    tracerWidth: 0.018,
    impactImpulse: 2.8,
    recoilPitch: 0.018,
    recoilYaw: 0.011,
    recoilKick: 0.045
  },
  rifle: {
    label: "Автомат",
    shortLabel: "Автомат",
    damage: 28,
    range: 36,
    cooldownMs: 125,
    color: "#ff9f43",
    tracerWidth: 0.022,
    impactImpulse: 2.35,
    recoilPitch: 0.011,
    recoilYaw: 0.012,
    recoilKick: 0.036
  },
  rocket: {
    label: "Ракетница",
    shortLabel: "Ракетница",
    damage: 120,
    range: 32,
    cooldownMs: 1050,
    color: "#ff5d5d",
    tracerWidth: 0.075,
    impactImpulse: 5.4,
    recoilPitch: 0.028,
    recoilYaw: 0.018,
    recoilKick: 0.075,
    blastRadius: 3.4,
    blastImpulse: 6.8
  },
  laser: {
    label: "Лазер",
    shortLabel: "Лазер",
    damage: 55,
    range: 42,
    cooldownMs: 210,
    color: "#5ef2ff",
    tracerWidth: 0.036,
    impactImpulse: 3.6,
    recoilPitch: 0.009,
    recoilYaw: 0.008,
    recoilKick: 0.025
  },
  sniper: {
    label: "Снайперская винтовка",
    shortLabel: "Снайперка",
    damage: 110,
    range: 70,
    cooldownMs: 900,
    color: "#d8b4fe",
    tracerWidth: 0.014,
    impactImpulse: 5.2,
    recoilPitch: 0.034,
    recoilYaw: 0.017,
    recoilKick: 0.082
  }
};

export function isLocomotionMotion(motion: CharacterMotion) {
  return motion === "walk" || motion === "run" || motion === "crouchWalk";
}
