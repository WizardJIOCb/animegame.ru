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
};

export type PlacedItem = {
  instanceId: string;
  itemId: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
};

export type ChatMessage = {
  id: string;
  homeOwner: string;
  from: string;
  text: string;
  createdAt: number;
};

export type User = {
  id: string;
  username: string;
  passwordHash: string;
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
  createdAt: number;
};

export type PublicUser = Omit<User, "passwordHash">;

export type DbShape = {
  users: User[];
  chats: ChatMessage[];
};
