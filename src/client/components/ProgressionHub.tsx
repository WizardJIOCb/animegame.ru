import {
  Backpack,
  ClipboardList,
  Coins,
  Crosshair,
  Radio,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Store,
  X
} from "lucide-react";
import type { ReactNode } from "react";

export const PROGRESSION_TAB_IDS = ["raid", "quests", "inventory", "equipment", "upgrades", "skills", "traders"] as const;
export type ProgressionTabId = typeof PROGRESSION_TAB_IDS[number];

const TAB_META = {
  raid: { label: "Рейд", Icon: Crosshair },
  quests: { label: "Задания", Icon: ClipboardList },
  inventory: { label: "Инвентарь", Icon: Backpack },
  equipment: { label: "Экипировка", Icon: Shield },
  upgrades: { label: "Модификации", Icon: SlidersHorizontal },
  skills: { label: "Навыки", Icon: Sparkles },
  traders: { label: "Торговцы", Icon: Store }
} satisfies Record<ProgressionTabId, { label: string; Icon: typeof Crosshair }>;

type ProgressionHubProps = {
  activeTab: ProgressionTabId;
  callsign: string;
  coins: number;
  runActive: boolean;
  busy?: boolean;
  children: ReactNode;
  onTabChange: (tab: ProgressionTabId) => void;
  onClose?: () => void;
};

export function ProgressionHub({
  activeTab,
  callsign,
  coins,
  runActive,
  busy = false,
  children,
  onTabChange,
  onClose
}: ProgressionHubProps) {
  return (
    <div className="progression-hub" aria-busy={busy}>
      <header className="progression-command-header">
        <div className="progression-command-mark" aria-hidden="true">
          <Radio size={20} />
          <i />
        </div>
        <div className="progression-command-copy">
          <span>AEGIS // ЦЕНТР ПОДГОТОВКИ</span>
          <b>{callsign}</b>
        </div>
        <div className="progression-command-meta">
          <span className={runActive ? "is-live" : ""}>{runActive ? "В РЕЙДЕ" : "НА БАЗЕ"}</span>
          <b><Coins size={13} /> {coins.toLocaleString("ru-RU")}</b>
        </div>
        {onClose ? (
          <button className="progression-command-close" type="button" onClick={onClose} aria-label="Закрыть AEGIS">
            <X size={19} />
            <kbd>Esc</kbd>
          </button>
        ) : null}
      </header>

      <nav className="progression-tabs" role="tablist" aria-label="Разделы центра подготовки">
        {PROGRESSION_TAB_IDS.map((tabId) => {
          const { label, Icon } = TAB_META[tabId];
          const selected = activeTab === tabId;
          return (
            <button
              className={selected ? "active" : ""}
              type="button"
              role="tab"
              id={`progression-tab-${tabId}`}
              aria-selected={selected}
              aria-controls={`progression-panel-${tabId}`}
              tabIndex={selected ? 0 : -1}
              key={tabId}
              onClick={() => onTabChange(tabId)}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div
        className="progression-hub-content"
        role="tabpanel"
        id={`progression-panel-${activeTab}`}
        aria-labelledby={`progression-tab-${activeTab}`}
      >
        {children}
      </div>
    </div>
  );
}
