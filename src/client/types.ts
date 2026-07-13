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

export type PublicUser = {
  id: string;
  username: string;
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
  progress?: UserProgress;
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

export type NeighborhoodResident = {
  plotId: number;
  username: string;
  isNpc: boolean;
  level: number;
  careerLevel: number;
  houseLevel: number;
  homeValue: number;
  incomePerHour: number;
  colors: {
    walls: string;
    roof: string;
    trim: string;
  };
  carColor?: string;
  avatar: PublicUser["avatar"];
  homeStyle: NonNullable<PublicUser["homeStyle"]>;
  placedItems: PlacedItem[];
  lot: {
    x: number;
    z: number;
    rotation: number;
  };
};

export type NeighborhoodState = {
  residents: NeighborhoodResident[];
  progress: NeighborhoodProgress;
  generatedAt: number;
};

export type HomeState = {
  owner: string;
  avatar: PublicUser["avatar"];
  placedItems: PlacedItem[];
  inventory: string[];
  chats: ChatMessage[];
  homeStyle?: PublicUser["homeStyle"];
};

export type RemotePlayer = {
  id?: string;
  username: string;
  position: { x: number; y: number; z: number; rotation?: number; vehicle?: boolean };
  avatar?: PublicUser["avatar"];
};
