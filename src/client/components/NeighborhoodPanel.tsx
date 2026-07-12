import { Banknote, BriefcaseBusiness, DoorOpen, Hammer, House, TrendingUp, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import type { Activity, NeighborhoodState, PublicUser } from "../types";

type NeighborhoodPanelProps = {
  user: PublicUser;
  neighborhood: NeighborhoodState;
  activities: Activity[];
  busyAction: string;
  onEarn: (activityId: string) => void;
  onClaimIncome: () => void;
  onUpgradeCareer: () => void;
  onUpgradeHouse: () => void;
  onVisit: (username: string) => void;
};

function money(value: number) {
  return value.toLocaleString("ru-RU");
}

export function NeighborhoodPanel({
  user,
  neighborhood,
  activities,
  busyAction,
  onEarn,
  onClaimIncome,
  onUpgradeCareer,
  onUpgradeHouse,
  onVisit
}: NeighborhoodPanelProps) {
  const { progress, residents } = neighborhood;
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    setClock(Date.now());
    if (progress.workAvailableAt <= Date.now()) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [progress.workAvailableAt]);
  const workSecondsLeft = Math.max(0, Math.ceil((progress.workAvailableAt - clock) / 1000));
  const totalXp = progress.xp + progress.xpToNext;
  const xpPercent = totalXp > 0 ? Math.min(100, progress.xp / totalXp * 100) : 100;
  const homeRanking = [...residents].sort((left, right) => right.homeValue - left.homeValue);
  const incomeRanking = [...residents].sort((left, right) => right.incomePerHour - left.incomePerHour);
  const homeRank = homeRanking.findIndex((resident) => resident.username === user.username) + 1;
  const incomeRank = incomeRanking.findIndex((resident) => resident.username === user.username) + 1;
  const careerLocked = progress.nextCareerRequiredLevel !== null && user.coins >= (progress.nextCareerCost ?? Infinity)
    ? progress.level < progress.nextCareerRequiredLevel
    : false;
  const houseLocked = progress.nextHouseRequiredLevel !== null && user.coins >= (progress.nextHouseCost ?? Infinity)
    ? progress.level < progress.nextHouseRequiredLevel
    : false;

  return (
    <div className="neighborhood-panel">
      <section className="district-hero">
        <div className="district-level-badge">{progress.level}</div>
        <div className="district-level-copy">
          <span>Уровень персонажа</span>
          <b>{progress.xp} XP · до следующего {progress.xpToNext}</b>
          <div className="xp-track"><span style={{ width: `${xpPercent}%` }} /></div>
        </div>
      </section>

      <div className="district-rank-row">
        <div><Trophy size={17} /><span>Дом</span><b>#{homeRank || "—"}</b></div>
        <div><TrendingUp size={17} /><span>Доход</span><b>#{incomeRank || "—"}</b></div>
      </div>

      <section className="district-jobs">
        <div className="neighbors-title"><BriefcaseBusiness size={18} /> Подработки · монеты и XP</div>
        <div className="quick-jobs">
          {activities.map((activity) => (
            <button key={activity.id} onClick={() => onEarn(activity.id)} disabled={busyAction !== "" || workSecondsLeft > 0}>
              <span>{activity.name}</span>
              <b>+{activity.reward}</b>
              <small>{workSecondsLeft > 0 ? `следующая работа через ${workSecondsLeft} сек.` : `занятость ${activity.seconds} сек.`}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="progress-card income-card">
        <div className="progress-card-head">
          <span className="progress-icon"><Banknote size={20} /></span>
          <div><b>Пассивный доход</b><span>{money(progress.incomePerHour)} монет / час</span></div>
        </div>
        <button
          className="district-action primary"
          onClick={onClaimIncome}
          disabled={busyAction !== "" || progress.pendingIncome < 1}
        >
          Забрать {money(progress.pendingIncome)} монет
        </button>
      </section>

      <section className="progress-card">
        <div className="progress-card-head">
          <span className="progress-icon career"><BriefcaseBusiness size={20} /></span>
          <div><b>Карьера · {progress.careerLevel} ур.</b><span>Повышает доход каждый час</span></div>
        </div>
        {progress.nextCareerCost === null ? (
          <div className="max-level">Карьера развита полностью</div>
        ) : (
          <button
            className="district-action"
            onClick={onUpgradeCareer}
            disabled={busyAction !== "" || user.coins < progress.nextCareerCost || careerLocked}
          >
            <TrendingUp size={16} /> Повысить за {money(progress.nextCareerCost)}
            <small>нужен {progress.nextCareerRequiredLevel} уровень</small>
          </button>
        )}
      </section>

      <section className="progress-card">
        <div className="progress-card-head">
          <span className="progress-icon house"><House size={20} /></span>
          <div><b>Дом · {progress.houseLevel} ур.</b><span>Стоимость: {money(progress.homeValue)} монет</span></div>
        </div>
        {progress.nextHouseCost === null ? (
          <div className="max-level">Дом достроен полностью</div>
        ) : (
          <button
            className="district-action"
            onClick={onUpgradeHouse}
            disabled={busyAction !== "" || user.coins < progress.nextHouseCost || houseLocked}
          >
            <Hammer size={16} /> Строить за {money(progress.nextHouseCost)}
            <small>нужен {progress.nextHouseRequiredLevel} уровень</small>
          </button>
        )}
      </section>

      <section className="neighbors-section">
        <div className="neighbors-title"><Trophy size={18} /> Рейтинг домов</div>
        <div className="neighbor-list">
          {homeRanking.map((resident, index) => (
            <button
              key={resident.plotId}
              className={resident.username === user.username ? "neighbor-row current" : "neighbor-row"}
              onClick={() => onVisit(resident.username)}
            >
              <span className={`rank-place place-${index + 1}`}>{index + 1}</span>
              <span className="neighbor-avatar" style={{ background: resident.colors.walls }}>{resident.username.slice(0, 1).toUpperCase()}</span>
              <span className="neighbor-copy">
                <b>{resident.username}{resident.isNpc ? <small> NPC</small> : null}</b>
                <em>дом {resident.houseLevel} ур. · доход {money(resident.incomePerHour)}/ч</em>
              </span>
              <span className="neighbor-value">{money(resident.homeValue)}</span>
              <DoorOpen className="visit-icon" size={15} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
