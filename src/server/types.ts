export type ItemType = "furniture" | "clothing" | "pet" | "decor" | "activity";

export type CatalogItem = {
  id: string;
  type: ItemType;
  name: string;
  price: number;
  color: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  emoji: string;
  size?: [number, number, number];
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
    outfit: string;
    hair: string;
    pet?: string;
  };
  createdAt: number;
};

export type PublicUser = Omit<User, "passwordHash">;

export type DbShape = {
  users: User[];
  chats: ChatMessage[];
};

