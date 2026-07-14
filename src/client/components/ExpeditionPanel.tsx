import {
  Backpack,
  BatteryCharging,
  Bomb,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Cpu,
  Crosshair,
  DoorOpen,
  FileText,
  Gauge,
  Hammer,
  HeartPulse,
  Package,
  PackageOpen,
  Radar,
  ScanLine,
  Shield,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Target,
  UserPlus,
  Users,
  Wrench,
  X,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  EXPEDITION_AMMO_PACK,
  EXPEDITION_ARTIFACT_IDS,
  EXPEDITION_ARTIFACTS,
  EXPEDITION_GEAR,
  EXPEDITION_GEAR_IDS,
  EXPEDITION_ITEMS,
  EXPEDITION_RECIPES,
  EXPEDITION_RECIPE_IDS,
  EXPEDITION_SKILLS,
  EXPEDITION_SKILL_IDS,
  EXPEDITION_TRADER_BUY_PRICES,
  EXPEDITION_TRADER_SELL_PRICES,
  EXPEDITION_WEAPONS,
  EXPEDITION_WEAPON_IDS,
  type ExpeditionArtifactId,
  type ExpeditionGearId,
  type ExpeditionGearSlot,
  type ExpeditionItemId,
  type ExpeditionProfile,
  type ExpeditionRecipeId,
  type ExpeditionRunSnapshot,
  type ExpeditionSkillId,
  type ExpeditionWeaponId,
  type ItemStack,
  type PartyInvite,
  type PartySnapshot
} from "../../shared/expedition";
import { ProgressionHub, type ProgressionTabId } from "./ProgressionHub";

export type ProgressionRarity = "common" | "uncommon" | "rare" | "epic";
export type ExpeditionEquipmentSlotId = ExpeditionGearSlot;

export type ProgressionSkillBranchId = "survival" | "technology" | "combat";

export type ProgressionSkillNode = {
  id: string;
  branch: ProgressionSkillBranchId;
  name: string;
  description: string;
  level: number;
  maxLevel: number;
  linkedSkillId?: ExpeditionSkillId;
  available?: boolean;
  prerequisite?: { label: string; met: boolean };
};

export type ExpeditionPanelProps = {
  profile: ExpeditionProfile;
  run: ExpeditionRunSnapshot | null;
  currentUsername: string;
  party: PartySnapshot | null;
  invites: PartyInvite[];
  outgoingInvites: PartyInvite[];
  canExtract: boolean;
  coins: number;
  playerHealth: number;
  playerMaxHealth: number;
  playerDowned: boolean;
  onlinePlayers: Array<{ username: string }>;
  busy?: boolean;
  onStart: () => void;
  onExtract: () => void;
  onAbandon: () => void;
  onSelectWeapon: (id: ExpeditionWeaponId) => void;
  onBuyWeapon: (id: ExpeditionWeaponId) => void;
  onBuyAmmo: () => void;
  onTraderBuy: (itemId: ExpeditionItemId) => void;
  onTraderSell: (itemId: ExpeditionItemId) => void;
  onUseBandage: () => void;
  onCraft: (id: ExpeditionRecipeId) => void;
  onUpgradeSkill: (id: ExpeditionSkillId) => void;
  onInvite: (username: string) => void;
  onAcceptInvite: (partyId: string) => void;
  onDeclineInvite: (partyId: string) => void;
  onLeaveParty: () => void;
  skillTreeNodes?: ProgressionSkillNode[];
  onEquipGear?: (slot: ExpeditionGearSlot, gearId: ExpeditionGearId | null) => void;
  onUpgradeTreeSkill?: (nodeId: string) => void;
  requestedTab?: ProgressionTabId;
};

const EQUIPMENT_SLOTS: Array<{
  id: ExpeditionEquipmentSlotId;
  label: string;
  hint: string;
  Icon: LucideIcon;
}> = [
  { id: "helmet", label: "Шлем", hint: "Защита головы и сенсоры", Icon: Radar },
  { id: "armor", label: "Броня", hint: "Основная защита корпуса", Icon: Shield },
  { id: "legs", label: "Ноги", hint: "Мобильность и переносимый вес", Icon: Gauge }
];

const BRANCH_META: Record<ProgressionSkillBranchId, {
  name: string;
  subtitle: string;
  Icon: LucideIcon;
}> = {
  survival: { name: "Выживание", subtitle: "Здоровье и полевая медицина", Icon: HeartPulse },
  technology: { name: "Технологии", subtitle: "Добыча, броня и сканирование", Icon: ScanLine },
  combat: { name: "Бой", subtitle: "Оружие и контроль взрывчатки", Icon: Target }
};

function itemQuantity(stacks: ItemStack[], itemId: ExpeditionItemId) {
  return stacks.reduce((total, stack) => (
    stack.itemId === itemId ? total + stack.quantity : total
  ), 0);
}

function formatPrice(value: number) {
  return value.toLocaleString("ru-RU");
}

function stackValue(stack: ItemStack) {
  return (EXPEDITION_TRADER_SELL_PRICES[stack.itemId] ?? 0) * stack.quantity;
}

function ItemArt({ itemId }: { itemId: ExpeditionItemId }) {
  let Icon: LucideIcon = Package;
  if (["scrap", "alloy", "weapon-parts"].includes(itemId)) Icon = Wrench;
  if (itemId === "explosive-compound" || itemId.startsWith("grenade-")) Icon = Bomb;
  if (itemId === "ceramic-plate" || itemId === "composite-vest") Icon = Shield;
  if (itemId === "scout-helmet" || itemId === "artifact-robot-beacon") Icon = Radar;
  if (itemId === "tactical-pants") Icon = Gauge;
  if (itemId === "artifact-nuke") Icon = Sparkles;
  if (itemId === "artifact-scanner") Icon = ScanLine;
  if (itemId === "power-cell") Icon = BatteryCharging;
  if (itemId === "robot-lens") Icon = ScanLine;
  if (itemId === "ammo") Icon = Crosshair;
  if (itemId === "medkit" || itemId === "bandage") Icon = HeartPulse;
  if (itemId === "electronics") Icon = Cpu;
  if (itemId === "shield-module") Icon = Shield;
  if (itemId === "rifle-blueprint") Icon = FileText;

  return (
    <span className={`progression-item-art progression-item-art-${itemId}`} aria-hidden="true">
      <i />
      <Icon size={25} strokeWidth={1.7} />
    </span>
  );
}

function InventoryGrid({
  stacks,
  emptyText,
  risk = false
}: {
  stacks: ItemStack[];
  emptyText: string;
  risk?: boolean;
}) {
  if (stacks.length === 0) return <div className="expedition-empty">{emptyText}</div>;

  return (
    <div className="progression-inventory-grid" role="list">
      {stacks.map((stack) => {
        const item = EXPEDITION_ITEMS[stack.itemId];
        return (
          <article
            className={`progression-item-tile expedition-rarity-${item.rarity}`}
            title={item.description}
            role="listitem"
            key={stack.itemId}
          >
            <ItemArt itemId={stack.itemId} />
            <span className="progression-item-rarity">{item.rarity}</span>
            <div className="progression-item-copy">
              <b>{item.name}</b>
              <small>{risk ? "потеряется при гибели" : "в домашнем хранилище"}</small>
            </div>
            <strong>×{stack.quantity}</strong>
            <em>{formatPrice(stackValue(stack))} <CircleDollarSign size={11} /></em>
          </article>
        );
      })}
    </div>
  );
}

function RecipeOutput({ recipeId }: { recipeId: ExpeditionRecipeId }) {
  const output = EXPEDITION_RECIPES[recipeId].output;
  if ("weaponId" in output) return <>{EXPEDITION_WEAPONS[output.weaponId].name}</>;
  return <>{EXPEDITION_ITEMS[output.itemId].name} ×{output.quantity}</>;
}

function ArtifactIcon({ artifactId }: { artifactId: ExpeditionArtifactId }) {
  const artifact = EXPEDITION_ARTIFACTS[artifactId];
  const kind = artifact.effect === "nuke" ? "charge" : artifact.effect === "support" ? "beacon" : "scanner";
  const Icon = kind === "charge" ? Bomb : kind === "beacon" ? Radar : ScanLine;
  return (
    <span className={`progression-artifact-art progression-artifact-${kind}`} aria-hidden="true">
      <i />
      <Icon size={31} />
    </span>
  );
}

export function ExpeditionPanel({
  profile,
  run,
  currentUsername,
  party,
  invites,
  outgoingInvites,
  canExtract,
  coins,
  playerHealth,
  playerMaxHealth,
  playerDowned,
  onlinePlayers,
  busy = false,
  onStart,
  onExtract,
  onAbandon,
  onSelectWeapon,
  onBuyWeapon,
  onBuyAmmo,
  onTraderBuy,
  onTraderSell,
  onUseBandage,
  onCraft,
  onUpgradeSkill,
  onInvite,
  onAcceptInvite,
  onDeclineInvite,
  onLeaveParty,
  skillTreeNodes,
  onEquipGear,
  onUpgradeTreeSkill,
  requestedTab
}: ExpeditionPanelProps) {
  const [activeTab, setActiveTab] = useState<ProgressionTabId>(requestedTab ?? "raid");
  const runId = run?.id;

  useEffect(() => {
    if (runId) setActiveTab("raid");
  }, [runId]);

  useEffect(() => {
    if (requestedTab) setActiveTab(requestedTab);
  }, [requestedTab]);

  const objective = run?.objective;
  const powerCells = objective?.powerCells ?? 0;
  const requiredPowerCells = objective?.requiredPowerCells ?? 1;
  const hostileKills = objective?.hostileKills ?? 0;
  const requiredHostileKills = objective?.requiredHostileKills ?? 2;
  const objectiveSteps = Math.max(1, requiredPowerCells + requiredHostileKills);
  const completedSteps = Math.min(powerCells, requiredPowerCells)
    + Math.min(hostileKills, requiredHostileKills);
  const objectiveProgress = Math.round(completedSteps / objectiveSteps * 100);
  const partyUsernames = new Set(
    (party?.members ?? []).map((member) => member.username.toLocaleLowerCase("ru-RU"))
  );
  const invitedUsernames = new Set(
    outgoingInvites.map((invite) => invite.toUsername.toLocaleLowerCase("ru-RU"))
  );
  const inviteCandidates = onlinePlayers.filter((player, index, players) => {
    const normalized = player.username.trim().toLocaleLowerCase("ru-RU");
    return normalized !== ""
      && !partyUsernames.has(normalized)
      && !invitedUsernames.has(normalized)
      && players.findIndex((candidate) => (
        candidate.username.trim().toLocaleLowerCase("ru-RU") === normalized
      )) === index;
  });
  const partyIsFull = (party?.members.length ?? 1) + outgoingInvites.length >= (party?.maxSize ?? 4);
  const currentMember = party?.members.find((member) => (
    member.username.toLocaleLowerCase("ru-RU") === currentUsername.toLocaleLowerCase("ru-RU")
  ));
  const canInvite = !party || currentMember?.isLeader === true;
  const backpackQuantity = run?.backpack.reduce((total, stack) => total + stack.quantity, 0) ?? 0;
  const backpackValue = run?.backpack.reduce((total, stack) => total + stackValue(stack), 0) ?? 0;
  const stashQuantity = profile.stash.reduce((total, stack) => total + stack.quantity, 0);
  const stashValue = profile.stash.reduce((total, stack) => total + stackValue(stack), 0);
  const bandageCount = run ? itemQuantity(run.backpack, "bandage") : 0;
  const canUseBandage = Boolean(run && bandageCount > 0 && !playerDowned && playerHealth < playerMaxHealth);
  const traderBuyEntries = Object.entries(EXPEDITION_TRADER_BUY_PRICES) as Array<[ExpeditionItemId, number]>;
  const gearBuyEntries = traderBuyEntries.filter(([itemId]) => EXPEDITION_ITEMS[itemId].category === "gear");
  const artifactBuyEntries = EXPEDITION_ARTIFACT_IDS.flatMap((artifactId) => {
    const price = EXPEDITION_TRADER_BUY_PRICES[artifactId];
    return price === undefined ? [] : [[artifactId, price] as const];
  });
  const supplierBuyEntries = traderBuyEntries.filter(([itemId]) => {
    const category = EXPEDITION_ITEMS[itemId].category;
    return category !== "gear" && category !== "artifact";
  });
  const traderSellStacks = profile.stash.filter((stack) => (
    stack.quantity > 0 && (EXPEDITION_TRADER_SELL_PRICES[stack.itemId] ?? 0) > 0
  ));
  const unlockedWeapons = EXPEDITION_WEAPON_IDS.filter((weaponId) => profile.unlockedWeapons.includes(weaponId));
  const lockedWeapons = EXPEDITION_WEAPON_IDS.filter((weaponId) => !profile.unlockedWeapons.includes(weaponId));
  const ownedGearIds = EXPEDITION_GEAR_IDS.filter((gearId) => itemQuantity(profile.stash, gearId) > 0);
  const equippedGearCount = Object.values(profile.equippedGear).filter(Boolean).length;

  const resolvedSkillNodes = useMemo<ProgressionSkillNode[]>(() => {
    if (skillTreeNodes) return skillTreeNodes;
    return EXPEDITION_SKILL_IDS.map((skillId) => {
      const skill = EXPEDITION_SKILLS[skillId];
      const requirements = Object.entries(skill.requires ?? {}) as Array<[ExpeditionSkillId, number]>;
      const requirementsMet = requirements.every(([requiredSkillId, level]) => (
        profile.skills[requiredSkillId] >= level
      ));
      const prerequisite = requirements.length > 0
        ? {
            label: requirements.map(([requiredSkillId, level]) => (
              `${EXPEDITION_SKILLS[requiredSkillId].name} ур. ${level}`
            )).join(" · "),
            met: requirementsMet
          }
        : undefined;

      return {
        id: skillId,
        linkedSkillId: skillId,
        branch: skill.branch,
        name: skill.name,
        description: `${skill.description} ${skill.bonusPerLevel} за уровень.`,
        level: profile.skills[skillId],
        maxLevel: skill.maxLevel,
        available: requirementsMet,
        prerequisite
      };
    });
  }, [profile.skills, skillTreeNodes]);

  function renderRaidTab() {
    return (
      <div className="progression-tab-stack">
        <section className={`progression-raid-banner ${run ? "is-live" : ""}`}>
          <div className="progression-raid-orbit" aria-hidden="true"><Crosshair size={34} /></div>
          <div>
            <span>{run ? "ОПЕРАЦИЯ АКТИВНА" : "КОНТРАКТ 01 // ЗАЛЕСЬЕ"}</span>
            <h2>{run ? "Вернитесь с добычей" : "Первый выход"}</h2>
            <p>{run ? "Снаряжение под риском. Эвакуация сохранит всё найденное." : "Найдите энергоячейку, уничтожьте угрозы и вернитесь через Северный КПП."}</p>
          </div>
          <div className="progression-raid-vitals">
            <span>HP</span>
            <b>{Math.max(0, Math.round(playerHealth))}/{playerMaxHealth}</b>
          </div>
        </section>

        <section className="expedition-card progression-objective-card">
          <div className="expedition-card-title">
            <Target size={18} />
            <span>Цели операции</span>
            <small>{objectiveProgress}%</small>
          </div>
          <div
            className="expedition-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={objectiveProgress}
          >
            <span style={{ width: `${objectiveProgress}%` }} />
          </div>
          <div className="expedition-objective-list">
            <div className={powerCells >= requiredPowerCells ? "expedition-objective-complete" : ""}>
              <BatteryCharging size={16} />
              <span>Энергоячейка</span>
              <b>{Math.min(powerCells, requiredPowerCells)} / {requiredPowerCells}</b>
            </div>
            <div className={hostileKills >= requiredHostileKills ? "expedition-objective-complete" : ""}>
              <Bot size={16} />
              <span>Опасные противники</span>
              <b>{Math.min(hostileKills, requiredHostileKills)} / {requiredHostileKills}</b>
            </div>
          </div>
          {run ? (
            <div className="expedition-run-actions">
              <button
                className="expedition-action expedition-action-primary"
                type="button"
                disabled={busy || !canExtract || playerDowned}
                onClick={onExtract}
              >
                <DoorOpen size={17} /> Эвакуироваться
              </button>
              <button
                className="expedition-action expedition-action-danger"
                type="button"
                disabled={busy}
                onClick={onAbandon}
              >
                <X size={16} /> Потерять рейд
              </button>
            </div>
          ) : (
            <button
              className="expedition-action expedition-action-primary expedition-action-wide"
              type="button"
              disabled={busy || Boolean(party && !currentMember?.isLeader)}
              onClick={onStart}
            >
              {party && !currentMember?.isLeader ? "Ждём запуска лидером" : party ? "Начать группой" : "Начать экспедицию"}
              <ChevronRight size={18} />
            </button>
          )}
          {run && !canExtract ? <div className="expedition-hint">Эвакуация откроется в зелёной зоне Северного КПП.</div> : null}
        </section>

        <section className="expedition-card progression-party-card">
          <div className="expedition-card-title">
            <Users size={18} />
            <span>Ударная группа</span>
            <small>{party?.members.length ?? 1}/{party?.maxSize ?? 4}</small>
          </div>
          <div className="progression-party-slots">
            {(party?.members ?? [{
              userId: "self",
              username: currentUsername,
              joinedAt: 0,
              isLeader: true,
              online: true
            }]).map((member) => (
              <div className="progression-party-slot is-filled" key={member.userId}>
                <span>{member.username.slice(0, 1).toUpperCase()}</span>
                <div><b>{member.username}</b><small>{member.isLeader ? "лидер" : member.online ? "готов" : "не в сети"}</small></div>
                <i className={member.online ? "expedition-online" : "expedition-offline"} />
              </div>
            ))}
            {Array.from({ length: Math.max(0, 4 - (party?.members.length ?? 1)) }, (_, index) => (
              <div className="progression-party-slot" key={`empty-${index}`}><UserPlus size={17} /><span>Свободно</span></div>
            ))}
          </div>
          {party ? (
            <button className="expedition-action expedition-action-muted expedition-action-wide" type="button" disabled={busy} onClick={onLeaveParty}>
              Покинуть группу
            </button>
          ) : null}

          {invites.length > 0 ? (
            <div className="expedition-invites">
              <span className="expedition-subtitle">Входящие приглашения</span>
              {invites.map((invite) => (
                <div className="expedition-invite" key={invite.id}>
                  <div><b>{invite.fromUsername}</b><span>зовёт вас в группу</span></div>
                  <div className="expedition-invite-actions">
                    <button type="button" aria-label={`Принять приглашение от ${invite.fromUsername}`} disabled={busy} onClick={() => onAcceptInvite(invite.partyId)}><Check size={16} /></button>
                    <button type="button" aria-label={`Отклонить приглашение от ${invite.fromUsername}`} disabled={busy} onClick={() => onDeclineInvite(invite.partyId)}><X size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="expedition-online-players">
            <span className="expedition-subtitle">Игроки онлайн</span>
            {outgoingInvites.length > 0 ? <div className="expedition-pending-note">Ожидаем: {outgoingInvites.map((invite) => invite.toUsername).join(", ")}</div> : null}
            {inviteCandidates.length > 0 ? inviteCandidates.map((player) => (
              <div className="expedition-online-player" key={player.username.toLocaleLowerCase("ru-RU")}>
                <span className="expedition-online" aria-hidden="true" />
                <b>{player.username}</b>
                <button type="button" disabled={busy || partyIsFull || !canInvite} onClick={() => onInvite(player.username)}><UserPlus size={15} /> Пригласить</button>
              </div>
            )) : <div className="expedition-empty">{canInvite ? "Нет доступных игроков" : "Приглашать может только лидер"}</div>}
          </div>
        </section>
      </div>
    );
  }

  function renderInventoryTab() {
    return (
      <div className="progression-tab-stack">
        <section className="progression-section-heading">
          <div><span>ХРАНИЛИЩЕ // 02</span><h2>Инвентарь</h2><p>Разделяйте защищённые запасы и добычу, которой рискуете в рейде.</p></div>
          <Backpack size={28} />
        </section>

        {run ? (
          <section className="expedition-card progression-risk-card">
            <div className="expedition-card-title"><ShieldAlert size={18} /><span>Рюкзак в рейде</span><small>ПОД РИСКОМ</small></div>
            <div className="expedition-inventory-summary">
              <div className="expedition-inventory-stat"><span>Единиц</span><b>{backpackQuantity}</b></div>
              <div className="expedition-inventory-stat"><span>Ценность</span><b>{formatPrice(backpackValue)}</b></div>
              <div className="expedition-inventory-stat expedition-inventory-coins"><span>Монеты</span><b><CircleDollarSign size={13} /> {formatPrice(run.carriedCoins)}</b></div>
            </div>
            <InventoryGrid stacks={run.backpack} emptyText="Рюкзак пока пуст" risk />
            {run.carriedWeaponIds.length > 0 ? (
              <div className="expedition-carried-weapons">
                <span className="expedition-subtitle">Оружие для эвакуации</span>
                <div className="expedition-carried-weapon-list">
                  {run.carriedWeaponIds.map((weaponId) => (
                    <div className="expedition-carried-weapon" key={weaponId}>
                      <Crosshair size={15} /><span><b>{EXPEDITION_WEAPONS[weaponId].name}</b><small>откроется после успешной эвакуации</small></span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <button className="expedition-action expedition-action-primary expedition-action-wide" type="button" disabled={busy || !canUseBandage} onClick={onUseBandage}>
              <HeartPulse size={16} /> {playerDowned ? "Бинт недоступен после падения" : playerHealth >= playerMaxHealth ? "Здоровье полное" : `Использовать бинт · ${bandageCount} шт.`}
            </button>
          </section>
        ) : (
          <div className="progression-idle-callout"><Shield size={20} /><div><b>Рейдовый рюкзак не сформирован</b><span>Боеприпасы и расходники будут перенесены сюда при запуске экспедиции.</span></div></div>
        )}

        <section className="expedition-card">
          <div className="expedition-card-title"><PackageOpen size={18} /><span>Домашний тайник</span><small>{stashQuantity} ед. · {formatPrice(stashValue)} мон.</small></div>
          <InventoryGrid stacks={profile.stash} emptyText="Тайник пуст — найдите добычу за городом" />
        </section>
      </div>
    );
  }

  function renderSkillsTab() {
    return (
      <div className="progression-tab-stack">
        <section className="progression-section-heading progression-skills-heading">
          <div><span>ПРОТОКОЛ РАЗВИТИЯ // 03</span><h2>Дерево навыков</h2><p>Открывайте узлы по порядку. Продвинутые умения требуют развития предыдущего узла.</p></div>
          <strong>{profile.skillPoints}<small>очков</small></strong>
        </section>
        <div className="progression-skill-branches">
          {(Object.keys(BRANCH_META) as ProgressionSkillBranchId[]).map((branchId) => {
            const meta = BRANCH_META[branchId];
            const nodes = resolvedSkillNodes.filter((node) => node.branch === branchId);
            return (
              <section className={`progression-skill-branch branch-${branchId}`} key={branchId}>
                <header><span><meta.Icon size={18} /></span><div><b>{meta.name}</b><small>{meta.subtitle}</small></div></header>
                <div className="progression-skill-path">
                  {nodes.map((node, index) => {
                    const maxed = node.level >= node.maxLevel;
                    const prerequisiteMet = node.prerequisite?.met ?? true;
                    const hasAction = Boolean(node.linkedSkillId || onUpgradeTreeSkill);
                    const available = node.available !== false && prerequisiteMet && hasAction;
                    return (
                      <article className={`progression-skill-node ${maxed ? "is-maxed" : ""} ${available ? "is-available" : "is-locked"}`} key={node.id}>
                        {index > 0 ? <i className="progression-skill-link" aria-hidden="true" /> : null}
                        <div className="progression-skill-node-top"><span>{index + 1}</span><div><b>{node.name}</b><small>Уровень {node.level}/{node.maxLevel}</small></div></div>
                        <p>{node.description}</p>
                        {node.prerequisite ? <em className={prerequisiteMet ? "is-met" : ""}>{prerequisiteMet ? <Check size={12} /> : <ShieldAlert size={12} />}{node.prerequisite.label}</em> : null}
                        <button
                          type="button"
                          disabled={busy || Boolean(run) || profile.skillPoints < 1 || maxed || !available}
                          onClick={() => {
                            if (node.linkedSkillId) onUpgradeSkill(node.linkedSkillId);
                            else onUpgradeTreeSkill?.(node.id);
                          }}
                        >
                          {maxed ? "ОСВОЕНО" : !prerequisiteMet ? "НУЖЕН ПРЕДЫДУЩИЙ УЗЕЛ" : available ? "УЛУЧШИТЬ · 1" : "НЕДОСТУПНО"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        {run ? <div className="expedition-hint">Распределение очков доступно после возвращения на базу.</div> : null}
      </div>
    );
  }

  function renderEquipmentTab() {
    return (
      <div className="progression-tab-stack">
        <section className="progression-section-heading"><div><span>КОМПЛЕКТ // 04</span><h2>Экипировка</h2><p>Соберите комплект перед выходом. Содержимое рейдового рюкзака остаётся под риском.</p></div><Shield size={28} /></section>

        <section className="expedition-card">
          <div className="expedition-card-title"><Shield size={18} /><span>Защитный комплект</span><small>{equippedGearCount}/3</small></div>
          <div className="progression-equipment-rig">
            <div className="progression-rig-silhouette" aria-hidden="true"><i className="rig-head" /><i className="rig-body" /><i className="rig-legs" /></div>
            <div className="progression-equipment-slots">
              {EQUIPMENT_SLOTS.map(({ id, label, hint, Icon }) => {
                const gearId = profile.equippedGear[id];
                const item = gearId ? EXPEDITION_GEAR[gearId] : null;
                const rarity = gearId ? EXPEDITION_ITEMS[gearId].rarity : null;
                return (
                  <article className={`progression-equipment-slot ${item ? `is-equipped expedition-rarity-${rarity}` : ""}`} key={id}>
                    <span><Icon size={19} /></span>
                    <div><small>{label}</small><b>{item?.name ?? "Пустой слот"}</b><em>{item ? `${Math.round(item.damageReduction * 100)}% снижения урона · +${item.bonusShield} щита` : hint}</em></div>
                    {item && onEquipGear ? <button type="button" disabled={busy || Boolean(run)} onClick={() => onEquipGear(id, null)}>Снять</button> : null}
                  </article>
                );
              })}
            </div>
          </div>
          {ownedGearIds.length > 0 ? (
            <div className="progression-gear-options">
              <span className="expedition-subtitle">Доступное снаряжение</span>
              {ownedGearIds.map((gearId) => {
                const item = EXPEDITION_GEAR[gearId];
                const selected = profile.equippedGear[item.slot] === gearId;
                return (
                  <button type="button" disabled={busy || Boolean(run) || !onEquipGear || selected} onClick={() => onEquipGear?.(item.slot, gearId)} key={gearId}>
                    <Shield size={15} /><span><b>{item.name}</b><small>{EXPEDITION_ITEMS[gearId].description}</small></span><em>{selected ? "Надето" : `${Math.round(item.damageReduction * 100)}% · +${item.bonusShield}`}</em>
                  </button>
                );
              })}
            </div>
          ) : <div className="expedition-hint">Купите защиту у оружейника или изготовьте её на домашнем верстаке.</div>}
        </section>

        <section className="expedition-card">
          <div className="expedition-card-title"><Crosshair size={18} /><span>Основное оружие</span><small>{EXPEDITION_WEAPONS[profile.selectedWeapon].name}</small></div>
          <div className="progression-weapon-grid">
            {unlockedWeapons.map((weaponId) => {
              const weapon = EXPEDITION_WEAPONS[weaponId];
              const selected = profile.selectedWeapon === weaponId;
              return (
                <article className={`progression-weapon-card ${selected ? "is-selected" : ""}`} key={weaponId}>
                  <div className="progression-weapon-art" aria-hidden="true"><Crosshair size={26} /><i /></div>
                  <div><span>{selected ? "АКТИВНО" : "ДОСТУПНО"}</span><b>{weapon.name}</b><small>{weapon.description}</small></div>
                  <div className="progression-weapon-stats"><span>УРОН <i style={{ width: `${Math.min(100, weapon.damage)}%` }} /></span><span>ДАЛЬНОСТЬ <i style={{ width: `${Math.min(100, weapon.range * 1.4)}%` }} /></span></div>
                  <button type="button" disabled={busy || Boolean(run) || selected} onClick={() => onSelectWeapon(weaponId)}>{selected ? <><Check size={14} /> Выбрано</> : "Выбрать"}</button>
                </article>
              );
            })}
          </div>
          {run ? <div className="expedition-hint">Менять комплект во время рейда нельзя.</div> : null}
        </section>

        <section className="expedition-card">
          <div className="expedition-card-title"><Hammer size={18} /><span>Домашний верстак</span></div>
          <div className="expedition-recipe-list">
            {EXPEDITION_RECIPE_IDS.map((recipeId) => {
              const recipe = EXPEDITION_RECIPES[recipeId];
              const hasIngredients = recipe.ingredients.every((ingredient) => itemQuantity(profile.stash, ingredient.itemId) >= ingredient.quantity);
              return (
                <div className="expedition-recipe" key={recipeId}>
                  <div className="expedition-recipe-copy"><b>{recipe.name}</b><span className="expedition-recipe-output">Результат: <RecipeOutput recipeId={recipeId} /></span><span className="expedition-recipe-ingredients">{recipe.ingredients.map((ingredient) => {
                    const enough = itemQuantity(profile.stash, ingredient.itemId) >= ingredient.quantity;
                    return <em className={enough ? "expedition-ingredient-ready" : ""} key={ingredient.itemId}>{EXPEDITION_ITEMS[ingredient.itemId].name} {ingredient.quantity}</em>;
                  })}</span></div>
                  <button className="expedition-recipe-action" type="button" disabled={busy || Boolean(run) || !hasIngredients} onClick={() => onCraft(recipeId)}>Создать</button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  function renderTradersTab() {
    return (
      <div className="progression-tab-stack progression-traders-tab">
        <section className="progression-section-heading"><div><span>ТОРГОВЫЙ ЯРУС // 05</span><h2>Торговцы</h2><p>Сравнивайте предложения специалистов. В рейде сделки заблокированы.</p></div><ShoppingCart size={28} /></section>
        {run ? <div className="progression-lockdown"><ShieldAlert size={19} /><span><b>Торговый канал заблокирован</b>Вернитесь на базу, чтобы проводить сделки.</span></div> : null}

        <section className="progression-vendor-card vendor-gunsmith">
          <header><span className="progression-vendor-avatar"><Wrench size={24} /></span><div><small>ОРУЖЕЙНИК // ВОЛЬФ</small><h3>«Металл помнит хорошего хозяина»</h3></div><em>ур. доверия 1</em></header>
          <div className="progression-vendor-offers">
            {lockedWeapons.map((weaponId) => {
              const weapon = EXPEDITION_WEAPONS[weaponId];
              return (
                <article key={weaponId}><span className="progression-offer-art"><Crosshair size={22} /></span><div><b>{weapon.name}</b><small>{weapon.description}</small></div><button type="button" disabled={busy || Boolean(run) || coins < weapon.price} onClick={() => onBuyWeapon(weaponId)}><CircleDollarSign size={13} /> {formatPrice(weapon.price)}</button></article>
              );
            })}
            {gearBuyEntries.map(([gearId, price]) => {
              const item = EXPEDITION_ITEMS[gearId];
              return (
                <article key={gearId}><ItemArt itemId={gearId} /><div><b>{item.name}</b><small>{item.description}</small></div><button type="button" disabled={busy || Boolean(run) || coins < price} onClick={() => onTraderBuy(gearId)}><CircleDollarSign size={13} /> {formatPrice(price)}</button></article>
              );
            })}
            {lockedWeapons.length === 0 && gearBuyEntries.length === 0 ? <div className="expedition-empty">Всё снаряжение из текущей поставки уже получено.</div> : null}
          </div>
        </section>

        <section className="progression-vendor-card vendor-supplier">
          <header><span className="progression-vendor-avatar"><PackageOpen size={24} /></span><div><small>СНАБЖЕНЕЦ // МИРА</small><h3>«Запас важнее красивой истории»</h3></div><em>поставка активна</em></header>
          <div className="progression-vendor-offers">
            <article><span className="progression-offer-art"><Crosshair size={22} /></span><div><b>Пачка боеприпасов ×{EXPEDITION_AMMO_PACK.quantity}</b><small>Универсальный боекомплект для следующей экспедиции.</small></div><button type="button" disabled={busy || Boolean(run) || coins < EXPEDITION_AMMO_PACK.price} onClick={onBuyAmmo}><CircleDollarSign size={13} /> {formatPrice(EXPEDITION_AMMO_PACK.price)}</button></article>
            {supplierBuyEntries.map(([itemId, price]) => {
              const item = EXPEDITION_ITEMS[itemId];
              return <article key={itemId}><ItemArt itemId={itemId} /><div><b>{item.name}</b><small>{item.description}</small></div><button type="button" disabled={busy || Boolean(run) || coins < price} onClick={() => onTraderBuy(itemId)}><CircleDollarSign size={13} /> {formatPrice(price)}</button></article>;
            })}
          </div>
          <div className="progression-vendor-buyback">
            <span className="expedition-subtitle">Приём добычи</span>
            {traderSellStacks.length > 0 ? traderSellStacks.map((stack) => (
              <button type="button" disabled={busy || Boolean(run)} onClick={() => onTraderSell(stack.itemId)} key={stack.itemId}>
                <span>{EXPEDITION_ITEMS[stack.itemId].name} <small>×{stack.quantity}</small></span><b>Продать 1 · {formatPrice(EXPEDITION_TRADER_SELL_PRICES[stack.itemId] ?? 0)}</b>
              </button>
            )) : <div className="expedition-empty">Нет предметов для продажи.</div>}
          </div>
        </section>

        <section className="progression-vendor-card vendor-artifacts">
          <header><span className="progression-vendor-avatar"><Radar size={24} /></span><div><small>АРТЕФАКТЫ // НОКС</small><h3>«Редкие сигналы не ждут дважды»</h3></div><em>особая поставка</em></header>
          <div className="progression-artifact-grid">
            {artifactBuyEntries.map(([artifactId, price]) => {
              const item = EXPEDITION_ITEMS[artifactId];
              const artifact = EXPEDITION_ARTIFACTS[artifactId];
              const owned = itemQuantity(profile.stash, artifactId);
              return (
                <article className={`expedition-rarity-${item.rarity}`} key={artifactId}>
                  <ArtifactIcon artifactId={artifactId} />
                  <span className="progression-item-rarity">{item.rarity}</span>
                  <div><b>{artifact.name}</b><small>{item.description} · {Math.round(artifact.durationMs / 1_000)} сек.</small>{owned > 0 ? <em>В тайнике: {owned}</em> : null}</div>
                  <button type="button" disabled={busy || Boolean(run) || coins < price} onClick={() => onTraderBuy(artifactId)}>
                    <CircleDollarSign size={13} /> {formatPrice(price)}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  const tabContent = activeTab === "raid"
    ? renderRaidTab()
    : activeTab === "inventory"
      ? renderInventoryTab()
      : activeTab === "skills"
        ? renderSkillsTab()
        : activeTab === "equipment"
          ? renderEquipmentTab()
          : renderTradersTab();

  return (
    <ProgressionHub
      activeTab={activeTab}
      callsign={currentUsername}
      coins={coins}
      runActive={Boolean(run)}
      busy={busy}
      onTabChange={setActiveTab}
    >
      {tabContent}
    </ProgressionHub>
  );
}
