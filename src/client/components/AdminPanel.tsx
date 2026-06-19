import { useEffect, useMemo, useState } from "react";
import {
  getAdminOverview,
  updateAdminActivity,
  updateAdminCatalogItem,
  updateAdminUser,
  type AdminOverview,
  type AdminUser
} from "../api";
import type { Activity, CatalogItem, PublicUser } from "../types";

type AdminSection = "overview" | "users" | "items" | "activities";

type AdminPanelProps = {
  currentUser: PublicUser;
  onCatalogUpdate: (catalog: CatalogItem[]) => void;
  onActivitiesUpdate: (activities: Activity[]) => void;
  onCurrentUserUpdate: (user: PublicUser) => void;
  onToast: (text: string) => void;
};

const itemTypes: CatalogItem["type"][] = ["furniture", "decor", "outdoor", "clothing", "character", "pet", "activity"];
const rarities: CatalogItem["rarity"][] = ["common", "rare", "epic", "legendary"];

function sizeToText(size?: CatalogItem["size"]) {
  return size ? size.join(", ") : "";
}

function textToSize(text: string) {
  const parts = text.split(",").map((part) => Number(part.trim()));
  return parts.length === 3 && parts.every(Number.isFinite) ? parts as [number, number, number] : undefined;
}

export function AdminPanel({ currentUser, onCatalogUpdate, onActivitiesUpdate, onCurrentUserUpdate, onToast }: AdminPanelProps) {
  const [section, setSection] = useState<AdminSection>("overview");
  const [data, setData] = useState<AdminOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedActivityId, setSelectedActivityId] = useState("");
  const [itemDraft, setItemDraft] = useState<Partial<CatalogItem>>({});
  const [activityDraft, setActivityDraft] = useState<Partial<Activity>>({});

  useEffect(() => {
    void load();
  }, []);

  const selectedItem = useMemo(() => data?.catalog.find((item) => item.id === selectedItemId), [data, selectedItemId]);
  const selectedActivity = useMemo(() => data?.activities.find((activity) => activity.id === selectedActivityId), [data, selectedActivityId]);
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data?.catalog.filter((item) => (
      !query
      || item.name.toLowerCase().includes(query)
      || item.id.toLowerCase().includes(query)
      || item.type.toLowerCase().includes(query)
    )) ?? [];
  }, [data, search]);

  useEffect(() => {
    if (!selectedItem && data?.catalog.length) {
      setSelectedItemId(data.catalog[0].id);
    }
  }, [data, selectedItem]);

  useEffect(() => {
    if (!selectedActivity && data?.activities.length) {
      setSelectedActivityId(data.activities[0].id);
    }
  }, [data, selectedActivity]);

  useEffect(() => {
    if (selectedItem) {
      setItemDraft({ ...selectedItem, size: selectedItem.size });
    }
  }, [selectedItem]);

  useEffect(() => {
    if (selectedActivity) {
      setActivityDraft({ ...selectedActivity });
    }
  }, [selectedActivity]);

  async function load() {
    setBusy(true);
    try {
      const overview = await getAdminOverview();
      setData(overview);
      onCatalogUpdate(overview.catalog);
      onActivitiesUpdate(overview.activities);
    } finally {
      setBusy(false);
    }
  }

  async function saveUser(adminUser: AdminUser, patch: Partial<Pick<AdminUser, "coins" | "isAdmin">>) {
    const response = await updateAdminUser(adminUser.id, patch);
    setData((current) => current ? {
      ...current,
      users: current.users.map((user) => user.id === response.user.id ? {
        ...user,
        coins: response.user.coins,
        isAdmin: Boolean(response.user.isAdmin)
      } : user)
    } : current);
    if (response.user.id === currentUser.id) {
      onCurrentUserUpdate(response.user);
    }
    onToast("Admin: user saved");
  }

  async function saveItem() {
    if (!selectedItem) {
      return;
    }
    const response = await updateAdminCatalogItem(selectedItem.id, {
      name: itemDraft.name,
      type: itemDraft.type,
      price: Number(itemDraft.price ?? selectedItem.price),
      rarity: itemDraft.rarity,
      color: itemDraft.color,
      emoji: itemDraft.emoji,
      size: textToSize(String(itemDraft.size ?? sizeToText(selectedItem.size))),
      modelUrl: itemDraft.modelUrl,
      modelScale: itemDraft.modelScale === undefined ? undefined : Number(itemDraft.modelScale)
    });
    setData((current) => current ? { ...current, catalog: response.catalog } : current);
    onCatalogUpdate(response.catalog);
    onToast("Admin: item saved");
  }

  async function saveActivity() {
    if (!selectedActivity) {
      return;
    }
    const response = await updateAdminActivity(selectedActivity.id, {
      name: activityDraft.name,
      reward: Number(activityDraft.reward ?? selectedActivity.reward),
      seconds: Number(activityDraft.seconds ?? selectedActivity.seconds)
    });
    setData((current) => current ? { ...current, activities: response.activities } : current);
    onActivitiesUpdate(response.activities);
    onToast("Admin: activity saved");
  }

  return (
    <div className="admin-panel">
      <div className="admin-head">
        <b>Admin</b>
        <button onClick={load} disabled={busy}>{busy ? "Loading" : "Refresh"}</button>
      </div>
      <div className="admin-sections">
        {(["overview", "users", "items", "activities"] as const).map((nextSection) => (
          <button key={nextSection} className={section === nextSection ? "active" : ""} onClick={() => setSection(nextSection)}>
            {nextSection === "overview" ? "Обзор" : nextSection === "users" ? "Пользователи" : nextSection === "items" ? "Предметы" : "Работы"}
          </button>
        ))}
      </div>

      {!data ? <div className="admin-empty">Loading admin data...</div> : null}

      {data && section === "overview" ? (
        <div className="admin-grid">
          <div><span>Users</span><b>{data.stats.users}</b></div>
          <div><span>Items</span><b>{data.stats.catalogItems}</b></div>
          <div><span>Jobs</span><b>{data.stats.activities}</b></div>
          <div><span>Chat</span><b>{data.stats.chats}</b></div>
        </div>
      ) : null}

      {data && section === "users" ? (
        <div className="admin-list">
          {data.users.map((adminUser) => (
            <div className="admin-row" key={adminUser.id}>
              <div>
                <b>{adminUser.username}</b>
                <span>{adminUser.inventoryCount} inv · {adminUser.placedCount} placed</span>
              </div>
              <input
                type="number"
                value={adminUser.coins}
                onChange={(event) => setData((current) => current ? {
                  ...current,
                  users: current.users.map((user) => user.id === adminUser.id ? { ...user, coins: Number(event.target.value) } : user)
                } : current)}
              />
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={adminUser.isAdmin}
                  onChange={(event) => void saveUser(adminUser, { isAdmin: event.target.checked })}
                  disabled={adminUser.username.toLowerCase() === "rodion"}
                />
                admin
              </label>
              <button onClick={() => saveUser(adminUser, { coins: adminUser.coins })}>Save</button>
            </div>
          ))}
        </div>
      ) : null}

      {data && section === "items" ? (
        <div className="admin-editor">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item..." />
          <select value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}>
            {filteredItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
          </select>
          {selectedItem ? (
            <>
              <label>Name<input value={String(itemDraft.name ?? "")} onChange={(event) => setItemDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
              <label>Price<input type="number" value={Number(itemDraft.price ?? 0)} onChange={(event) => setItemDraft((draft) => ({ ...draft, price: Number(event.target.value) }))} /></label>
              <label>Type<select value={itemDraft.type ?? selectedItem.type} onChange={(event) => setItemDraft((draft) => ({ ...draft, type: event.target.value as CatalogItem["type"] }))}>{itemTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label>Rarity<select value={itemDraft.rarity ?? selectedItem.rarity} onChange={(event) => setItemDraft((draft) => ({ ...draft, rarity: event.target.value as CatalogItem["rarity"] }))}>{rarities.map((rarity) => <option key={rarity}>{rarity}</option>)}</select></label>
              <label>Emoji<input value={String(itemDraft.emoji ?? "")} onChange={(event) => setItemDraft((draft) => ({ ...draft, emoji: event.target.value }))} /></label>
              <label>Color<input value={String(itemDraft.color ?? "")} onChange={(event) => setItemDraft((draft) => ({ ...draft, color: event.target.value }))} /></label>
              <label>Size x,y,z<input value={Array.isArray(itemDraft.size) ? sizeToText(itemDraft.size) : String(itemDraft.size ?? "")} onChange={(event) => setItemDraft((draft) => ({ ...draft, size: event.target.value as unknown as CatalogItem["size"] }))} /></label>
              <label>Model URL<input value={String(itemDraft.modelUrl ?? "")} onChange={(event) => setItemDraft((draft) => ({ ...draft, modelUrl: event.target.value }))} /></label>
              <label>Model Scale<input type="number" step="0.1" value={Number(itemDraft.modelScale ?? selectedItem.modelScale ?? 1)} onChange={(event) => setItemDraft((draft) => ({ ...draft, modelScale: Number(event.target.value) }))} /></label>
              <button className="admin-save" onClick={saveItem}>Save item</button>
            </>
          ) : null}
        </div>
      ) : null}

      {data && section === "activities" ? (
        <div className="admin-editor">
          <select value={selectedActivityId} onChange={(event) => setSelectedActivityId(event.target.value)}>
            {data.activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
          </select>
          {selectedActivity ? (
            <>
              <label>Name<input value={String(activityDraft.name ?? "")} onChange={(event) => setActivityDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
              <label>Reward<input type="number" value={Number(activityDraft.reward ?? 0)} onChange={(event) => setActivityDraft((draft) => ({ ...draft, reward: Number(event.target.value) }))} /></label>
              <label>Seconds<input type="number" value={Number(activityDraft.seconds ?? 1)} onChange={(event) => setActivityDraft((draft) => ({ ...draft, seconds: Number(event.target.value) }))} /></label>
              <button className="admin-save" onClick={saveActivity}>Save job</button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
