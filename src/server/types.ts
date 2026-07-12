export type ItemType = "furniture" | "clothing" | "pet" | "decor" | "outdoor" | "character" | "activity";

export type CatalogItem = {
  id: string;
  type: ItemType;
  name: string;
  price: number;
  color: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  emoji: string;
  size?: [number, number, number];
  modelUrl?: string;
  modelScale?: number;
  clothingModelUrl?: string;
  clothingModelScale?: number;
  clothingPaintStyle?: string;
};

export type PlacedItem = {
  instanceId: string;
  itemId: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale?: number;
};

export type Activity = {
  id: string;
  name: string;
  reward: number;
  seconds: number;
};

export type ChatMessage = {
  id: string;
  homeOwner: string;
  from: string;
  text: string;
  createdAt: number;
};

export type UserProgress = {
  level: number;
  xp: number;
  careerLevel: number;
  houseLevel: number;
  incomePerHour: number;
  lastIncomeClaimAt: number;
  workAvailableAt: number;
};

export type NeighborhoodHouseColors = {
  walls: string;
  roof: string;
  trim: string;
};

export type NeighborhoodLot = {
  x: number;
  z: number;
  rotation: number;
};

export type NeighborhoodResident = {
  plotId: number;
  username: string;
  isNpc: boolean;
  level: number;
  careerLevel: number;
  houseLevel: number;
  homeValue: number;
  incomePerHour: number;
  colors: NeighborhoodHouseColors;
  avatar: User["avatar"];
  lot: NeighborhoodLot;
};

export type NeighborhoodProgress = {
  level: number;
  xp: number;
  xpToNext: number;
  careerLevel: number;
  houseLevel: number;
  homeValue: number;
  incomePerHour: number;
  pendingIncome: number;
  nextCareerCost: number | null;
  nextCareerRequiredLevel: number | null;
  nextHouseCost: number | null;
  nextHouseRequiredLevel: number | null;
  workAvailableAt: number;
};

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin?: boolean;
  coins: number;
  inventory: string[];
  placedItems: PlacedItem[];
  avatar: {
    outfit?: string;
    hair: string;
    character?: string;
    pet?: string;
  };
  homeStyle?: {
    floorColor: string;
    wallColor: string;
  };
  progress: UserProgress;
  createdAt: number;
};

export type PublicUser = Omit<User, "passwordHash">;

export type DbShape = {
  users: User[];
  chats: ChatMessage[];
  content?: {
    catalogItems?: Record<string, Partial<CatalogItem>>;
    activities?: Record<string, Partial<Activity>>;
  };
};
