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

export type WeaponKind = "pistol" | "rifle" | "rocket" | "laser" | "sniper";

export type WeaponConfig = {
  label: string;
  shortLabel: string;
  damage: number;
  range: number;
  cooldownMs: number;
  color: string;
  tracerWidth: number;
  blastRadius?: number;
};

export const WEAPON_ORDER: WeaponKind[] = ["pistol", "rifle", "rocket", "laser", "sniper"];

type WeaponModelConfig = {
  url: string;
  scale: number;
  position: [number, number, number];
  rotation: [number, number, number];
};

export const WEAPON_MODELS: Record<WeaponKind, WeaponModelConfig> = {
  // The models point along their local X axis, while the Quaternius hand aims
  // along local Y with Z as up. Keep this extra quarter-turn so sights and
  // magazines stay upright instead of rolling onto their side.
  pistol: {
    url: "/assets/models/quaternius-weapons/pistol.gltf",
    scale: 0.37,
    position: [0.01, 0.035, 0.005],
    rotation: [Math.PI / 2, -Math.PI / 2, 0]
  },
  rifle: {
    url: "/assets/models/quaternius-weapons/rifle.gltf",
    scale: 0.42,
    position: [0.02, 0.035, 0.01],
    rotation: [Math.PI / 2, -Math.PI / 2, 0]
  },
  rocket: {
    url: "/assets/models/quaternius-weapons/rocket-launcher.gltf",
    scale: 0.4,
    position: [0.06, 0.015, 0.055],
    rotation: [Math.PI / 2, Math.PI / 2, 0]
  },
  laser: {
    url: "/assets/models/quaternius-weapons/laser.gltf",
    scale: 0.38,
    position: [0.02, 0.035, 0.01],
    rotation: [Math.PI / 2, -Math.PI / 2, 0]
  },
  sniper: {
    url: "/assets/models/quaternius-weapons/sniper.gltf",
    scale: 0.35,
    position: [0.025, 0.03, 0.02],
    rotation: [Math.PI / 2, -Math.PI / 2, 0]
  }
};

export const WEAPONS: Record<WeaponKind, WeaponConfig> = {
  pistol: {
    label: "Пистолет",
    shortLabel: "Пистолет",
    damage: 40,
    range: 28,
    cooldownMs: 330,
    color: "#ffd166",
    tracerWidth: 0.018
  },
  rifle: {
    label: "Автомат",
    shortLabel: "Автомат",
    damage: 28,
    range: 36,
    cooldownMs: 125,
    color: "#ff9f43",
    tracerWidth: 0.022
  },
  rocket: {
    label: "Ракетница",
    shortLabel: "Ракетница",
    damage: 120,
    range: 32,
    cooldownMs: 1050,
    color: "#ff5d5d",
    tracerWidth: 0.075,
    blastRadius: 3.4
  },
  laser: {
    label: "Лазер",
    shortLabel: "Лазер",
    damage: 55,
    range: 42,
    cooldownMs: 210,
    color: "#5ef2ff",
    tracerWidth: 0.036
  },
  sniper: {
    label: "Снайперская винтовка",
    shortLabel: "Снайперка",
    damage: 110,
    range: 70,
    cooldownMs: 900,
    color: "#d8b4fe",
    tracerWidth: 0.014
  }
};

export function isLocomotionMotion(motion: CharacterMotion) {
  return motion === "walk" || motion === "run" || motion === "crouchWalk";
}
