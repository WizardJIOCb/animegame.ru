import type { CatalogItem, ItemType } from "../types";
import { generatedCharacterCatalog } from "./generatedCharacterCatalog";
import { generatedModelCatalog } from "./generatedModelCatalog";
import { generatedOutdoorCatalog } from "./generatedOutdoorCatalog";

const palette = [
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#6366f1",
  "#06b6d4",
  "#10b981",
  "#84cc16",
  "#facc15",
  "#fb7185",
  "#14b8a6",
  "#f59e0b"
];

const makeItems = (
  type: ItemType,
  entries: Array<[string, string, number, CatalogItem["rarity"], string, CatalogItem["size"]?]>
): CatalogItem[] =>
  entries.map(([id, name, price, rarity, emoji, size], index) => ({
    id,
    type,
    name,
    price,
    rarity,
    emoji,
    color: palette[index % palette.length],
    size
  }));

export const catalog: CatalogItem[] = [
  ...generatedCharacterCatalog,
  ...generatedModelCatalog,
  ...generatedOutdoorCatalog,
  ...makeItems("furniture", [
    ["bed-cloud", "Кровать Облако", 260, "common", "🛏", [2.6, 0.7, 1.7]],
    ["bed-neon", "Неоновая кровать", 820, "epic", "🛏", [2.8, 0.8, 1.8]],
    ["sofa-mochi", "Диван Моти", 340, "common", "🛋", [2.4, 0.75, 1]],
    ["sofa-starlight", "Диван Звездный", 960, "epic", "🛋", [2.7, 0.8, 1]],
    ["desk-streamer", "Стол стримера", 430, "rare", "🖥", [1.8, 0.8, 0.8]],
    ["pc-rgb", "RGB компьютер", 700, "rare", "💻", [0.9, 1, 0.55]],
    ["fridge-mini", "Мини-холодильник", 280, "common", "🧊", [0.8, 1.5, 0.8]],
    ["kitchen-cute", "Кухня Кавай", 990, "epic", "🍳", [2.4, 1.2, 0.8]],
    ["bath-round", "Круглая ванна", 760, "rare", "🛁", [1.6, 0.65, 1.2]],
    ["wardrobe-glass", "Стеклянный шкаф", 520, "rare", "🚪", [1.1, 1.9, 0.55]],
    ["mirror-heart", "Зеркало Сердце", 300, "common", "🪞", [0.8, 1.7, 0.2]],
    ["table-boba", "Столик Boba", 240, "common", "🧋", [1.1, 0.55, 1.1]],
    ["chair-cat", "Кресло Ушки", 310, "common", "🪑", [0.8, 0.9, 0.8]],
    ["chair-royal", "Королевское кресло", 1100, "legendary", "👑", [1.1, 1.25, 1]],
    ["arcade-pixel", "Аркадный автомат", 650, "rare", "🕹", [0.9, 1.8, 0.8]],
    ["piano-dream", "Пианино Мечты", 1200, "legendary", "🎹", [1.8, 1.1, 0.8]],
    ["plant-luna", "Лунное растение", 220, "common", "🪴", [0.65, 1.2, 0.65]],
    ["lamp-orbit", "Лампа Орбита", 370, "rare", "💡", [0.45, 1.6, 0.45]],
    ["rug-sakura", "Ковер Сакура", 180, "common", "🌸", [2.2, 0.05, 1.5]],
    ["shelf-figure", "Полка фигурок", 460, "rare", "🧸", [1.5, 1.6, 0.4]]
  ]),
  ...makeItems("decor", [
    ["poster-idol", "Постер Айдола", 90, "common", "🎤", [0.9, 1.2, 0.05]],
    ["poster-mecha", "Постер Меха", 120, "common", "🤖", [0.9, 1.2, 0.05]],
    ["neon-kitsune", "Неон Kitsune", 440, "rare", "✨", [1.3, 0.8, 0.08]],
    ["wall-clock", "Часы Таймскип", 160, "common", "🕒", [0.6, 0.6, 0.06]],
    ["bonsai-glow", "Светящийся бонсай", 390, "rare", "🌳", [0.7, 0.9, 0.7]],
    ["aquarium-mini", "Мини-аквариум", 580, "rare", "🐠", [1, 0.75, 0.45]],
    ["crystal-set", "Набор кристаллов", 520, "epic", "💎", [0.9, 0.45, 0.5]],
    ["books-manga", "Стопка манги", 130, "common", "📚", [0.55, 0.35, 0.45]],
    ["tea-set", "Чайный набор", 150, "common", "🍵", [0.7, 0.25, 0.45]],
    ["floor-stars", "Звездная плитка", 300, "rare", "⭐", [1, 0.04, 1]]
  ]),
  ...makeItems("clothing", [
    ["hoodie-pink", "Розовое худи", 180, "common", "👕"],
    ["hoodie-black", "Черное худи", 180, "common", "👕"],
    ["dress-sakura", "Платье Сакура", 420, "rare", "👗"],
    ["dress-night", "Платье Ночь", 700, "epic", "👗"],
    ["jacket-cyber", "Кибер-куртка", 540, "rare", "🧥"],
    ["kimono-summer", "Летнее кимоно", 680, "epic", "👘"],
    ["school-blue", "Школьная форма", 260, "common", "🎒"],
    ["idol-stage", "Костюм айдола", 920, "epic", "🎀"],
    ["armor-neo", "Neo броня", 1300, "legendary", "🛡"],
    ["sneakers-cloud", "Кроссовки Облако", 220, "common", "👟"],
    ["boots-star", "Ботинки Звезда", 390, "rare", "🥾"],
    ["hat-bunny", "Шапка с ушками", 210, "common", "🧢"],
    ["cap-gamer", "Кепка Gamer", 160, "common", "🧢"],
    ["glasses-round", "Круглые очки", 150, "common", "👓"],
    ["wings-light", "Крылья света", 1500, "legendary", "🪽"],
    ["scarf-moon", "Шарф Луны", 340, "rare", "🧣"],
    ["hair-silver", "Серебряная прическа", 500, "rare", "💇"],
    ["hair-rose", "Розовая прическа", 500, "rare", "💇"],
    ["hair-violet", "Фиолетовая прическа", 620, "epic", "💇"],
    ["mask-cat", "Маска котика", 290, "common", "🎭"]
  ]),
  ...makeItems("pet", [
    ["pet-shiba", "Шиба Ину", 650, "rare", "🐕"],
    ["pet-cat-mochi", "Кот Моти", 560, "rare", "🐈"],
    ["pet-bunny", "Зайка Луна", 480, "common", "🐇"],
    ["pet-fox", "Лисенок Кицунэ", 980, "epic", "🦊"],
    ["pet-dragon", "Мини-дракон", 1800, "legendary", "🐉"],
    ["pet-owl", "Совенок Ночь", 740, "rare", "🦉"],
    ["pet-panda", "Панда Боба", 1100, "epic", "🐼"],
    ["pet-slime", "Слайм Пудинг", 360, "common", "🟢"],
    ["pet-robot", "Робо-питомец", 870, "epic", "🤖"],
    ["pet-star", "Звездный дух", 1600, "legendary", "🌟"]
  ]),
  ...makeItems("activity", [
    ["job-stream", "Стримить", 0, "common", "🎥"],
    ["job-cafe", "Смена в кафе", 0, "common", "☕"],
    ["job-art", "Рисовать арты", 0, "common", "🎨"],
    ["job-code", "Фриланс-кодинг", 0, "rare", "⌨"],
    ["job-idol", "Выступить на сцене", 0, "epic", "🎤"]
  ])
];

const hoodiePink = catalog.find((item) => item.id === "hoodie-pink");
if (hoodiePink) {
  hoodiePink.name = "Pink Street Top";
  hoodiePink.clothingModelUrl = undefined;
  hoodiePink.clothingModelScale = undefined;
  hoodiePink.clothingPaintStyle = "pink-street-top";
}

export const starterItems = [
  "quaternius-superhero-female",
  "quaternius-superhero-male",
  "kenney-beddouble",
  "kenney-desk",
  "kaykit-armchair",
  "kenney-rugrectangle",
  "hoodie-pink"
];

export const activities = [
  { id: "job-stream", name: "Стримить", reward: 90, seconds: 30 },
  { id: "job-cafe", name: "Смена в кафе", reward: 120, seconds: 45 },
  { id: "job-art", name: "Рисовать арты", reward: 150, seconds: 60 },
  { id: "job-code", name: "Фриланс-кодинг", reward: 220, seconds: 90 },
  { id: "job-idol", name: "Выступить на сцене", reward: 320, seconds: 120 }
];
