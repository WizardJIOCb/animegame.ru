import {
  Backpack,
  Check,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  HeartPulse,
  Settings,
  Target,
  X
} from "lucide-react";
import { useState } from "react";
import type { ExpeditionRunSnapshot } from "../../shared/expedition";
import type { ProgressionTabId } from "./ProgressionHub";

export type HudPreferences = {
  questTracker: boolean;
  locationCard: boolean;
  weaponPanel: boolean;
  controlsHints: boolean;
};

export const DEFAULT_HUD_PREFERENCES: HudPreferences = {
  questTracker: true,
  locationCard: true,
  weaponPanel: true,
  controlsHints: true
};

export const HUD_PREFERENCES_STORAGE_KEY = "animegame_aegis_hud_v1";

export function readHudPreferences(): HudPreferences {
  if (typeof window === "undefined") return DEFAULT_HUD_PREFERENCES;
  try {
    const stored = JSON.parse(window.localStorage.getItem(HUD_PREFERENCES_STORAGE_KEY) ?? "{}") as Partial<HudPreferences>;
    return {
      questTracker: typeof stored.questTracker === "boolean" ? stored.questTracker : DEFAULT_HUD_PREFERENCES.questTracker,
      locationCard: typeof stored.locationCard === "boolean" ? stored.locationCard : DEFAULT_HUD_PREFERENCES.locationCard,
      weaponPanel: typeof stored.weaponPanel === "boolean" ? stored.weaponPanel : DEFAULT_HUD_PREFERENCES.weaponPanel,
      controlsHints: typeof stored.controlsHints === "boolean" ? stored.controlsHints : DEFAULT_HUD_PREFERENCES.controlsHints
    };
  } catch {
    return DEFAULT_HUD_PREFERENCES;
  }
}

type CompactExpeditionHudProps = {
  run: ExpeditionRunSnapshot | null;
  health: number;
  maxHealth: number;
  location: string;
  inviteCount: number;
  preferences: HudPreferences;
  onPreferencesChange: (preferences: HudPreferences) => void;
  onOpen: (tab: ProgressionTabId) => void;
};

const HUD_OPTION_META: Array<{
  key: keyof HudPreferences;
  label: string;
  hint: string;
}> = [
  { key: "questTracker", label: "Задания", hint: "Компактная цель рейда" },
  { key: "locationCard", label: "Локация и здоровье", hint: "Карточка региона справа сверху" },
  { key: "weaponPanel", label: "Оружие", hint: "Боезапас и быстрые слоты" },
  { key: "controlsHints", label: "Подсказки управления", hint: "Строка клавиш снизу" }
];

export function CompactExpeditionHud({
  run,
  health,
  maxHealth,
  location,
  inviteCount,
  preferences,
  onPreferencesChange,
  onOpen
}: CompactExpeditionHudProps) {
  const [showSettings, setShowSettings] = useState(false);
  const objective = run?.objective;
  const objectiveTotal = Math.max(1, (objective?.requiredPowerCells ?? 1) + (objective?.requiredHostileKills ?? 2));
  const objectiveDone = Math.min(objective?.powerCells ?? 0, objective?.requiredPowerCells ?? 1)
    + Math.min(objective?.hostileKills ?? 0, objective?.requiredHostileKills ?? 2);
  const progress = Math.round(objectiveDone / objectiveTotal * 100);

  function togglePreference(key: keyof HudPreferences) {
    onPreferencesChange({ ...preferences, [key]: !preferences[key] });
  }

  return (
    <div className="aegis-hud" aria-label="Интерфейс AEGIS">
      <div className="aegis-hud-actions">
        <button type="button" onClick={() => onOpen("inventory")} title="Инвентарь · I">
          <Backpack size={17} />
          <span>Инвентарь</span>
          <kbd>I</kbd>
        </button>
        <button className="aegis-hud-main" type="button" onClick={() => onOpen(run ? "raid" : "equipment")}>
          <Crosshair size={17} />
          <span>AEGIS</span>
          {inviteCount > 0 ? <b>{inviteCount}</b> : null}
        </button>
        <button
          className={showSettings ? "is-active" : ""}
          type="button"
          aria-expanded={showSettings}
          aria-label="Настроить интерфейс"
          onClick={() => setShowSettings((current) => !current)}
        >
          {showSettings ? <X size={17} /> : <Settings size={17} />}
        </button>
      </div>

      {showSettings ? (
        <section className="aegis-hud-settings" aria-label="Настройки HUD">
          <header><div><span>AEGIS // HUD</span><b>Что показывать в игре</b></div><Settings size={18} /></header>
          <div>
            {HUD_OPTION_META.map((option) => {
              const enabled = preferences[option.key];
              return (
                <button type="button" className={enabled ? "is-enabled" : ""} onClick={() => togglePreference(option.key)} key={option.key}>
                  <span>{enabled ? <Eye size={16} /> : <EyeOff size={16} />}</span>
                  <div><b>{option.label}</b><small>{option.hint}</small></div>
                  <i>{enabled ? <Check size={13} /> : null}</i>
                </button>
              );
            })}
          </div>
          <small>Настройки сохраняются на этом устройстве.</small>
        </section>
      ) : null}

      {preferences.questTracker ? (
        <button className={`aegis-quest-tracker ${run ? "is-live" : ""}`} type="button" onClick={() => onOpen("quests")}>
          <span className="aegis-quest-icon">{run ? <Target size={18} /> : <HeartPulse size={18} />}</span>
          <div>
            <small>{run ? `${location} · ЭКСПЕДИЦИЯ` : "КОНТРАКТ ДОСТУПЕН"}</small>
            <b>{run ? "Первый выход" : "Подготовиться к вылазке"}</b>
            <em>{run
              ? `Энергоячейка ${objective?.powerCells ?? 0}/${objective?.requiredPowerCells ?? 1} · Угрозы ${objective?.hostileKills ?? 0}/${objective?.requiredHostileKills ?? 2}`
              : "Выберите оружие, броню и расходники в AEGIS"}</em>
            <i><span style={{ width: `${run ? progress : 0}%` }} /></i>
          </div>
          <strong>{run
            ? preferences.locationCard ? `${Math.max(0, Math.round(health))}/${maxHealth}` : `${progress}%`
            : <ChevronRight size={17} />}</strong>
        </button>
      ) : null}
    </div>
  );
}
