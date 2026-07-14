import {
  Backpack,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Crosshair,
  DoorOpen,
  Hammer,
  PackageOpen,
  Radio,
  ShieldAlert,
  Sparkles,
  UserPlus,
  Users,
  X
} from "lucide-react";
import {
  EXPEDITION_ITEMS,
  EXPEDITION_AMMO_PACK,
  EXPEDITION_RECIPES,
  EXPEDITION_RECIPE_IDS,
  EXPEDITION_SKILLS,
  EXPEDITION_SKILL_IDS,
  EXPEDITION_WEAPONS,
  EXPEDITION_WEAPON_IDS,
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

export type ExpeditionPanelProps = {
  profile: ExpeditionProfile;
  run: ExpeditionRunSnapshot | null;
  currentUsername: string;
  party: PartySnapshot | null;
  invites: PartyInvite[];
  outgoingInvites: PartyInvite[];
  canExtract: boolean;
  onlinePlayers: Array<{ username: string }>;
  busy?: boolean;
  onStart: () => void;
  onExtract: () => void;
  onAbandon: () => void;
  onSelectWeapon: (id: ExpeditionWeaponId) => void;
  onBuyWeapon: (id: ExpeditionWeaponId) => void;
  onBuyAmmo: () => void;
  onCraft: (id: ExpeditionRecipeId) => void;
  onUpgradeSkill: (id: ExpeditionSkillId) => void;
  onInvite: (username: string) => void;
  onAcceptInvite: (partyId: string) => void;
  onDeclineInvite: (partyId: string) => void;
  onLeaveParty: () => void;
};

function itemQuantity(stacks: ItemStack[], itemId: ExpeditionItemId) {
  return stacks.reduce((total, stack) => (
    stack.itemId === itemId ? total + stack.quantity : total
  ), 0);
}

function formatPrice(value: number) {
  return value.toLocaleString("ru-RU");
}

function ItemStacks({ stacks, emptyText }: { stacks: ItemStack[]; emptyText: string }) {
  if (stacks.length === 0) {
    return <div className="expedition-empty">{emptyText}</div>;
  }

  return (
    <div className="expedition-stack-list">
      {stacks.map((stack) => {
        const item = EXPEDITION_ITEMS[stack.itemId];
        return (
          <div className={`expedition-stack expedition-rarity-${item.rarity}`} key={stack.itemId}>
            <span className="expedition-stack-marker" aria-hidden="true" />
            <span className="expedition-stack-name">{item.name}</span>
            <b className="expedition-stack-quantity">×{stack.quantity}</b>
          </div>
        );
      })}
    </div>
  );
}

function RecipeOutput({ recipeId }: { recipeId: ExpeditionRecipeId }) {
  const output = EXPEDITION_RECIPES[recipeId].output;
  if ("weaponId" in output) {
    return <>{EXPEDITION_WEAPONS[output.weaponId].name}</>;
  }
  return <>{EXPEDITION_ITEMS[output.itemId].name} ×{output.quantity}</>;
}

export function ExpeditionPanel({
  profile,
  run,
  currentUsername,
  party,
  invites,
  outgoingInvites,
  canExtract,
  onlinePlayers,
  busy = false,
  onStart,
  onExtract,
  onAbandon,
  onSelectWeapon,
  onBuyWeapon,
  onBuyAmmo,
  onCraft,
  onUpgradeSkill,
  onInvite,
  onAcceptInvite,
  onDeclineInvite,
  onLeaveParty
}: ExpeditionPanelProps) {
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
  const currentMember = party?.members.find((member) => member.username.toLocaleLowerCase("ru-RU") === currentUsername.toLocaleLowerCase("ru-RU"));
  const canInvite = !party || currentMember?.isLeader === true;

  return (
    <div className="expedition-panel">
      <section className={`expedition-hero ${run ? "expedition-hero-active" : ""}`}>
        <div className="expedition-hero-icon" aria-hidden="true">
          {run ? <Radio size={22} /> : <ShieldAlert size={22} />}
        </div>
        <div className="expedition-hero-copy">
          <span>{run ? "Экспедиция идёт" : "Вылазка за город"}</span>
          <b>{run ? "Соберите добычу и вернитесь живым" : "Подготовьте снаряжение перед выходом"}</b>
        </div>
        <span className={`expedition-status ${run ? "expedition-status-live" : ""}`}>
          {run ? "В рейде" : "На базе"}
        </span>
      </section>

      <section className="expedition-card expedition-objective-card">
        <div className="expedition-card-title">
          <Crosshair size={18} />
          <span>Задание: первый выход</span>
          {objective?.complete ? <Check className="expedition-objective-done" size={18} /> : null}
        </div>
        <p className="expedition-card-description">
          Найдите энергоячейку и обезвредьте опасных противников за пределами города.
        </p>
        <div className="expedition-progress-track" aria-label={`Выполнено ${objectiveProgress}%`}>
          <span style={{ width: `${objectiveProgress}%` }} />
        </div>
        <div className="expedition-objective-list">
          <div className={powerCells >= requiredPowerCells ? "expedition-objective-complete" : ""}>
            <PackageOpen size={16} />
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
              disabled={busy || !canExtract}
              onClick={onExtract}
              title={canExtract ? "Сохранить добычу и вернуться домой" : "Сначала вернитесь к Северному КПП"}
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
            {party && !currentMember?.isLeader ? "Ждём запуска лидером" : party ? "Начать экспедицию группой" : "Начать экспедицию"} <ChevronRight size={18} />
          </button>
        )}
        {run && !canExtract ? <div className="expedition-hint">Для эвакуации вернитесь в зелёную зону Северного КПП.</div> : null}
      </section>

      <section className="expedition-card">
        <div className="expedition-card-title">
          <Sparkles size={18} />
          <span>Навыки выживальщика</span>
          <small>{profile.skillPoints} очк.</small>
        </div>
        <div className="expedition-skill-list">
          {EXPEDITION_SKILL_IDS.map((skillId) => {
            const skill = EXPEDITION_SKILLS[skillId];
            const level = profile.skills[skillId];
            return (
              <div className="expedition-skill" key={skillId}>
                <div className="expedition-skill-copy">
                  <b>{skill.name}</b>
                  <span>{skill.description} {skill.bonusPerLevel} за уровень.</span>
                  <i>{Array.from({ length: skill.maxLevel }, (_, index) => (
                    <em className={index < level ? "active" : ""} key={index} />
                  ))}</i>
                </div>
                <button
                  className="expedition-skill-action"
                  type="button"
                  disabled={busy || Boolean(run) || profile.skillPoints < 1 || level >= skill.maxLevel}
                  onClick={() => onUpgradeSkill(skillId)}
                >
                  {level >= skill.maxLevel ? "Макс." : `Ур. ${level + 1}`}
                </button>
              </div>
            );
          })}
        </div>
        {run ? <div className="expedition-hint">Распределять очки навыков можно после возвращения на базу.</div> : null}
      </section>

      <section className="expedition-card">
        <div className="expedition-card-title">
          <Crosshair size={18} />
          <span>Оружие для выхода</span>
        </div>
        <div className="expedition-weapon-list">
          {EXPEDITION_WEAPON_IDS.map((weaponId) => {
            const weapon = EXPEDITION_WEAPONS[weaponId];
            const unlocked = profile.unlockedWeapons.includes(weaponId);
            const selected = profile.selectedWeapon === weaponId;
            return (
              <div
                className={`expedition-weapon ${selected ? "expedition-weapon-selected" : ""}`}
                key={weaponId}
              >
                <div className="expedition-weapon-copy">
                  <b>{weapon.name}</b>
                  <span>{weapon.description}</span>
                </div>
                {unlocked ? (
                  <button
                    className="expedition-weapon-action"
                    type="button"
                    disabled={busy || Boolean(run) || selected}
                    onClick={() => onSelectWeapon(weaponId)}
                  >
                    {selected ? <><Check size={14} /> Выбрано</> : "Выбрать"}
                  </button>
                ) : (
                  <button
                    className="expedition-weapon-action expedition-weapon-buy"
                    type="button"
                    disabled={busy || Boolean(run)}
                    onClick={() => onBuyWeapon(weaponId)}
                  >
                    <CircleDollarSign size={14} /> {formatPrice(weapon.price)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {run ? <div className="expedition-hint">Менять комплект можно после возвращения домой.</div> : null}
      </section>

      <section className="expedition-card">
        <div className="expedition-card-title">
          <Backpack size={18} />
          <span>Рюкзак в рейде</span>
          <small>{run?.backpack.reduce((total, stack) => total + stack.quantity, 0) ?? 0} ед.</small>
        </div>
        <ItemStacks stacks={run?.backpack ?? []} emptyText={run ? "Рюкзак пока пуст" : "Начните экспедицию, чтобы собирать добычу"} />
      </section>

      <section className="expedition-card">
        <div className="expedition-card-title">
          <PackageOpen size={18} />
          <span>Домашний тайник</span>
        </div>
        <ItemStacks stacks={profile.stash} emptyText="В тайнике пока ничего нет" />
        <button
          className="expedition-action expedition-action-muted expedition-action-wide expedition-ammo-buy"
          type="button"
          disabled={busy || Boolean(run)}
          onClick={onBuyAmmo}
        >
          <CircleDollarSign size={16} /> Купить {EXPEDITION_AMMO_PACK.quantity} патронов · {formatPrice(EXPEDITION_AMMO_PACK.price)}
        </button>
      </section>

      <section className="expedition-card">
        <div className="expedition-card-title">
          <Hammer size={18} />
          <span>Верстак</span>
        </div>
        <div className="expedition-recipe-list">
          {EXPEDITION_RECIPE_IDS.map((recipeId) => {
            const recipe = EXPEDITION_RECIPES[recipeId];
            const hasIngredients = recipe.ingredients.every((ingredient) => (
              itemQuantity(profile.stash, ingredient.itemId) >= ingredient.quantity
            ));
            return (
              <div className="expedition-recipe" key={recipeId}>
                <div className="expedition-recipe-copy">
                  <b>{recipe.name}</b>
                  <span className="expedition-recipe-output">Получите: <RecipeOutput recipeId={recipeId} /></span>
                  <span className="expedition-recipe-ingredients">
                    {recipe.ingredients.map((ingredient) => {
                      const enough = itemQuantity(profile.stash, ingredient.itemId) >= ingredient.quantity;
                      return (
                        <em className={enough ? "expedition-ingredient-ready" : ""} key={ingredient.itemId}>
                          {EXPEDITION_ITEMS[ingredient.itemId].name} {ingredient.quantity}
                        </em>
                      );
                    })}
                  </span>
                </div>
                <button
                  className="expedition-recipe-action"
                  type="button"
                  disabled={busy || Boolean(run) || !hasIngredients}
                  onClick={() => onCraft(recipeId)}
                >
                  Создать
                </button>
              </div>
            );
          })}
        </div>
        {run ? <div className="expedition-hint">Верстак доступен только на базе.</div> : null}
      </section>

      <section className="expedition-card expedition-party-card">
        <div className="expedition-card-title">
          <Users size={18} />
          <span>Группа</span>
          <small>{party?.members.length ?? 1} / {party?.maxSize ?? 4}</small>
        </div>
        {party ? (
          <div className="expedition-party-members">
            {party.members.map((member) => (
              <div className="expedition-party-member" key={member.userId}>
                <span className={member.online ? "expedition-online" : "expedition-offline"} aria-hidden="true" />
                <span>{member.username}</span>
                {member.isLeader ? <b>Лидер</b> : null}
              </div>
            ))}
            <button
              className="expedition-action expedition-action-muted expedition-action-wide"
              type="button"
              disabled={busy}
              onClick={onLeaveParty}
            >
              Покинуть группу
            </button>
          </div>
        ) : (
          <div className="expedition-empty">Вы пока без группы. Пригласите игроков перед выходом.</div>
        )}

        {invites.length > 0 ? (
          <div className="expedition-invites">
            <span className="expedition-subtitle">Входящие приглашения</span>
            {invites.map((invite) => (
              <div className="expedition-invite" key={invite.id}>
                <div>
                  <b>{invite.fromUsername}</b>
                  <span>зовёт вас в группу</span>
                </div>
                <div className="expedition-invite-actions">
                  <button
                    type="button"
                    aria-label={`Принять приглашение от ${invite.fromUsername}`}
                    disabled={busy}
                    onClick={() => onAcceptInvite(invite.partyId)}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Отклонить приглашение от ${invite.fromUsername}`}
                    disabled={busy}
                    onClick={() => onDeclineInvite(invite.partyId)}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="expedition-online-players">
          <span className="expedition-subtitle">Игроки онлайн</span>
          {outgoingInvites.length > 0 ? (
            <div className="expedition-pending-note">Ожидаем ответ: {outgoingInvites.map((invite) => invite.toUsername).join(", ")}</div>
          ) : null}
          {inviteCandidates.length > 0 ? inviteCandidates.map((player) => (
            <div className="expedition-online-player" key={player.username.toLocaleLowerCase("ru-RU")}>
              <span className="expedition-online" aria-hidden="true" />
              <b>{player.username}</b>
              <button
                type="button"
                disabled={busy || partyIsFull || !canInvite}
                onClick={() => onInvite(player.username)}
              >
                <UserPlus size={15} /> Пригласить
              </button>
            </div>
          )) : (
            <div className="expedition-empty">{canInvite ? "Нет доступных игроков для приглашения" : "Приглашать может только лидер группы"}</div>
          )}
        </div>
      </section>
    </div>
  );
}
