import type { CatalogItem } from "./types";

const METRIKA_ID = 109964525;

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsParams = Record<string, AnalyticsValue>;

declare global {
  interface Window {
    ym?: (counterId: number, method: "reachGoal", goal: string, params?: AnalyticsParams) => void;
    dataLayer?: Array<Record<string, unknown>>;
  }
}

function cleanParams(params: AnalyticsParams = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null)
  ) as AnalyticsParams;
}

export function trackGoal(goal: string, params?: AnalyticsParams) {
  const payload = cleanParams(params);
  window.ym?.(METRIKA_ID, "reachGoal", goal, payload);
  window.dataLayer?.push({
    event: `animegame_${goal}`,
    ...payload
  });
}

export function trackItemGoal(goal: string, item: CatalogItem, params?: AnalyticsParams) {
  trackGoal(goal, {
    item_id: item.id,
    item_type: item.type,
    item_rarity: item.rarity,
    price: item.price,
    ...params
  });
}

export function trackPurchase(item: CatalogItem, orderId: string) {
  window.dataLayer?.push({
    ecommerce: {
      currencyCode: "coins",
      purchase: {
        actionField: {
          id: orderId,
          revenue: item.price
        },
        products: [
          {
            id: item.id,
            name: item.name,
            category: item.type,
            price: item.price,
            quantity: 1
          }
        ]
      }
    }
  });
}
