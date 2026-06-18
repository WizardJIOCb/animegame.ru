import { Coins, DoorOpen, Hammer, Home, LogOut, MessageCircle, RotateCw, Shirt, ShoppingBag, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AuthScreen } from "./components/AuthScreen";
import { buy, earn, getCatalog, getHome, getPlayers, getToken, login, me, movePlacedItem, place, register, rotatePlacedItem, sellPlacedItem, setToken, updateHomeStyle } from "./api";
import { GameScene } from "./game/GameScene";
import type { Activity, CatalogItem, ChatMessage, HomeState, PlacedItem, PublicUser, RemotePlayer } from "./types";

type Tab = "shop" | "work" | "visit" | "inventory";

const floorSwatches = ["#252633", "#29333f", "#24362e", "#463b31", "#302b46", "#3b2d35"];
const wallSwatches = ["#303346", "#263849", "#2c4039", "#4a3941", "#3b3453", "#44382f"];

function rarityLabel(rarity: CatalogItem["rarity"]) {
  return {
    common: "обычное",
    rare: "редкое",
    epic: "эпик",
    legendary: "легенда"
  }[rarity];
}

export default function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [players, setPlayers] = useState<Array<{ username: string; coins: number }>>([]);
  const [home, setHome] = useState<HomeState | null>(null);
  const [homeOwner, setHomeOwner] = useState("");
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayer[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [tab, setTab] = useState<Tab>("shop");
  const [filter, setFilter] = useState<CatalogItem["type"] | "all">("all");
  const [buildMode, setBuildMode] = useState(false);
  const [selectedPlacedId, setSelectedPlacedId] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const socketRef = useRef<Socket | null>(null);

  const ownHome = user?.username === homeOwner;

  useEffect(() => {
    void bootstrap();
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  async function bootstrap() {
    const [{ catalog: nextCatalog, activities: nextActivities }, playersResponse] = await Promise.all([
      getCatalog(),
      getPlayers()
    ]);
    setCatalog(nextCatalog);
    setActivities(nextActivities);
    setPlayers(playersResponse.players);

    if (getToken()) {
      try {
        const response = await me();
        setUser(response.user);
        await loadHome(response.user.username);
        connectSocket(response.user.username);
      } catch {
        setToken(null);
      }
    }
  }

  async function handleAuth(mode: "login" | "register", username: string, password: string) {
    setError("");
    try {
      const response = mode === "register" ? await register(username, password) : await login(username, password);
      setToken(response.token);
      setUser(response.user);
      await loadHome(response.user.username);
      connectSocket(response.user.username);
      const playersResponse = await getPlayers();
      setPlayers(playersResponse.players);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Не получилось войти");
    }
  }

  function connectSocket(owner: string) {
    socketRef.current?.disconnect();
    const socket = io("/", {
      auth: { token: getToken() }
    });

    socket.on("connect", () => {
      socket.emit("home:join", owner);
    });
    socket.on("player:joined", ({ username }: { username: string }) => {
      showToast(`${username} зашел в дом`);
    });
    socket.on("player:left", ({ username }: { username: string }) => {
      setRemotePlayers((current) => current.filter((player) => player.username !== username));
      showToast(`${username} вышел`);
    });
    socket.on("player:moved", (payload: RemotePlayer) => {
      setRemotePlayers((current) => {
        const exists = current.some((player) => player.username === payload.username);
        return exists
          ? current.map((player) => (player.username === payload.username ? payload : player))
          : [...current, payload];
      });
    });
    socket.on("chat:message", (message: ChatMessage) => {
      setMessages((current) => [...current.slice(-80), message]);
    });
    socket.on("home:placed", (placed: PlacedItem) => {
      setHome((current) => current ? { ...current, placedItems: [...current.placedItems, placed] } : current);
    });
    socket.on("home:itemUpdated", (placed: PlacedItem) => {
      updatePlacedItem(placed);
    });
    socket.on("home:itemSold", ({ instanceId }: { instanceId: string }) => {
      setHome((current) => current ? { ...current, placedItems: current.placedItems.filter((item) => item.instanceId !== instanceId) } : current);
      setSelectedPlacedId((current) => current === instanceId ? "" : current);
    });
    socket.on("home:styleUpdated", (homeStyle: PublicUser["homeStyle"]) => {
      setHome((current) => current ? { ...current, homeStyle } : current);
    });
    socket.on("world:interaction", ({ username, action }: { username: string; action: string }) => {
      showToast(`${username}: ${action}`);
    });

    socketRef.current = socket;
  }

  async function loadHome(owner: string) {
    const nextHome = await getHome(owner);
    setHomeOwner(owner);
    setHome(nextHome);
    setMessages(nextHome.chats);
    setRemotePlayers([]);
  }

  async function visit(owner: string) {
    await loadHome(owner);
    socketRef.current?.emit("home:join", owner);
  }

  async function goOwnHome() {
    if (!user) {
      return;
    }
    await visit(user.username);
  }

  async function handleEarn(activityId: string) {
    const response = await earn(activityId);
    setUser(response.user);
    showToast(`+${response.activity.reward} монет: ${response.activity.name}`);
  }

  async function handleBuy(itemId: string) {
    const response = await buy(itemId);
    setUser(response.user);
    showToast(`Куплено: ${response.item.name}`);
  }

  async function handlePlace(itemId: string) {
    const x = Number((Math.random() * 6 - 3).toFixed(2));
    const z = Number((Math.random() * 5 - 1.5).toFixed(2));
    const response = await place(itemId, x, z, Math.random() * Math.PI);
    setUser(response.user);
    await loadHome(response.user.username);
    socketRef.current?.emit("home:join", response.user.username);
    showToast("Предмет поставлен дома");
  }

  function updatePlacedItem(placed: PlacedItem) {
    setHome((current) => {
      if (!current) {
        return current;
      }

      const exists = current.placedItems.some((item) => item.instanceId === placed.instanceId);
      return {
        ...current,
        placedItems: exists
          ? current.placedItems.map((item) => item.instanceId === placed.instanceId ? placed : item)
          : [...current.placedItems, placed]
      };
    });
  }

  async function handleBuildMove(x: number, z: number) {
    if (!selectedPlacedId || !ownHome) {
      return;
    }

    const response = await movePlacedItem(selectedPlacedId, x, z);
    updatePlacedItem(response.placed);
  }

  async function handleRotateSelected() {
    if (!selectedPlaced || !ownHome) {
      return;
    }

    const response = await rotatePlacedItem(selectedPlaced.instanceId, selectedPlaced.rotation + Math.PI / 12);
    updatePlacedItem(response.placed);
  }

  async function handleSellSelected() {
    if (!selectedPlaced || !ownHome) {
      return;
    }

    const response = await sellPlacedItem(selectedPlaced.instanceId);
    setUser(response.user);
    setHome((current) => current ? { ...current, placedItems: current.placedItems.filter((item) => item.instanceId !== response.placed.instanceId) } : current);
    setSelectedPlacedId("");
    showToast(`Sold +${response.refund}`);
  }

  async function handleStyleChange(nextStyle: Partial<NonNullable<PublicUser["homeStyle"]>>) {
    if (!ownHome || !home) {
      return;
    }

    const currentStyle = home.homeStyle ?? { floorColor: "#252633", wallColor: "#303346" };
    const response = await updateHomeStyle(
      nextStyle.floorColor ?? currentStyle.floorColor,
      nextStyle.wallColor ?? currentStyle.wallColor
    );
    setUser(response.user);
    setHome((current) => current ? { ...current, homeStyle: response.homeStyle } : current);
  }

  function handleMove(position: { x: number; y: number; z: number; rotation?: number }) {
    socketRef.current?.emit("player:move", position);
  }

  function handleInteract(itemId: string, action: string) {
    const item = catalog.find((entry) => entry.id === itemId);
    socketRef.current?.emit("world:interact", { itemId, action: item ? `использует ${item.name}` : action });
    showToast(item ? `Вы используете: ${item.name}` : "Взаимодействие");
  }

  function sendChat() {
    if (!chatText.trim()) {
      return;
    }
    socketRef.current?.emit("chat:send", chatText);
    setChatText("");
  }

  function logout() {
    setToken(null);
    socketRef.current?.disconnect();
    setUser(null);
    setHome(null);
    setHomeOwner("");
  }

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(""), 2300);
  }

  const shopItems = useMemo(() => {
    return catalog.filter((item) => item.type !== "activity" && (filter === "all" || item.type === filter));
  }, [catalog, filter]);

  const inventoryItems = useMemo(() => {
    if (!user) {
      return [];
    }
    return user.inventory.map((itemId) => catalog.find((item) => item.id === itemId)).filter(Boolean) as CatalogItem[];
  }, [catalog, user]);

  const selectedPlaced = useMemo(() => {
    return home?.placedItems.find((item) => item.instanceId === selectedPlacedId);
  }, [home, selectedPlacedId]);

  const selectedPlacedCatalogItem = useMemo(() => {
    return selectedPlaced ? catalog.find((item) => item.id === selectedPlaced.itemId) : undefined;
  }, [catalog, selectedPlaced]);

  const selectedSellValue = selectedPlacedCatalogItem ? Math.floor(selectedPlacedCatalogItem.price * 0.7) : 0;

  if (!user || !home) {
    return <AuthScreen onSubmit={handleAuth} error={error} />;
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div className="brand"><Home size={20} /> AnimeGame</div>
        <div className="home-title">
          <span>{ownHome ? "Мой дом" : `В гостях у ${homeOwner}`}</span>
          {!ownHome ? <button className="ghost-button" onClick={goOwnHome}><DoorOpen size={16} /> Домой</button> : null}
          {ownHome ? (
            <button
              className={buildMode ? "ghost-button active-build" : "ghost-button"}
              onClick={() => {
                setBuildMode((current) => !current);
                setSelectedPlacedId("");
              }}
            >
              <Hammer size={16} /> Build
            </button>
          ) : null}
        </div>
        <div className="wallet"><Coins size={18} /> {user.coins}</div>
        <button className="icon-button" onClick={logout} title="Выйти"><LogOut size={18} /></button>
      </section>

      <section className="game-layout">
        <div className="scene-wrap">
          <GameScene
            user={user}
            home={home}
            catalog={catalog}
            remotePlayers={remotePlayers}
            buildMode={buildMode && ownHome}
            selectedPlacedId={selectedPlacedId}
            onMove={handleMove}
            onInteract={handleInteract}
            onSelectPlaced={setSelectedPlacedId}
            onBuildMove={handleBuildMove}
          />
          <div className="scene-hint">
            {buildMode && ownHome
              ? "Build: click an item, click floor to move it. Right mouse pans camera."
              : "Клик по полу: идти. Клик по предмету: взаимодействовать."}
          </div>
          {buildMode && ownHome ? (
            <div className="build-toolbar">
              <div className="build-selection">
                <b>{selectedPlacedCatalogItem ? selectedPlacedCatalogItem.name : "Select item"}</b>
                <span>{selectedPlacedCatalogItem ? `Sell value: ${selectedSellValue}` : "Click an object in your home"}</span>
              </div>
              <button onClick={handleRotateSelected} disabled={!selectedPlaced}>
                <RotateCw size={16} /> Rotate
              </button>
              <button className="sell-button" onClick={handleSellSelected} disabled={!selectedPlaced}>
                <Trash2 size={16} /> Sell
              </button>
              <div className="style-swatches" aria-label="Floor colors">
                <span>Floor</span>
                {floorSwatches.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={home.homeStyle?.floorColor === color ? "swatch active" : "swatch"}
                    style={{ backgroundColor: color }}
                    title={`Floor ${color}`}
                    onClick={() => handleStyleChange({ floorColor: color })}
                  />
                ))}
              </div>
              <div className="style-swatches" aria-label="Wall colors">
                <span>Walls</span>
                {wallSwatches.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={home.homeStyle?.wallColor === color ? "swatch active" : "swatch"}
                    style={{ backgroundColor: color }}
                    title={`Walls ${color}`}
                    onClick={() => handleStyleChange({ wallColor: color })}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {toast ? <div className="toast">{toast}</div> : null}
        </div>

        <aside className="side-panel">
          <nav className="tabs">
            <button className={tab === "shop" ? "active" : ""} onClick={() => setTab("shop")}><ShoppingBag size={17} /> Магазин</button>
            <button className={tab === "work" ? "active" : ""} onClick={() => setTab("work")}><Hammer size={17} /> Работа</button>
            <button className={tab === "visit" ? "active" : ""} onClick={() => setTab("visit")}><Users size={17} /> Гости</button>
            <button className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}><Shirt size={17} /> Вещи</button>
          </nav>

          {tab === "shop" ? (
            <div className="panel-body">
              <div className="filter-row">
                {(["all", "furniture", "decor", "outdoor", "clothing", "character", "pet"] as const).map((nextFilter) => (
                  <button key={nextFilter} className={filter === nextFilter ? "active" : ""} onClick={() => setFilter(nextFilter)}>
                    {nextFilter === "all" ? "всё" : nextFilter}
                  </button>
                ))}
              </div>
              <div className="item-grid">
                {shopItems.map((item) => {
                  const owned = user.inventory.includes(item.id);
                  const selectable = ["character", "clothing", "pet"].includes(item.type);
                  return (
                    <button
                      key={item.id}
                      className="shop-card"
                      onClick={() => handleBuy(item.id)}
                      disabled={(owned && !selectable) || user.coins < item.price}
                    >
                      <span className="item-emoji">{item.emoji}</span>
                      <span className="item-name">{item.name}</span>
                      <span className="item-meta">{owned && selectable ? "выбрать" : `${rarityLabel(item.rarity)} · ${item.price} монет`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {tab === "work" ? (
            <div className="panel-body stack">
              {activities.map((activity) => (
                <button className="wide-card" key={activity.id} onClick={() => handleEarn(activity.id)}>
                  <span>{activity.name}</span>
                  <b>+{activity.reward}</b>
                </button>
              ))}
            </div>
          ) : null}

          {tab === "visit" ? (
            <div className="panel-body stack">
              {players.map((player) => (
                <button className="wide-card" key={player.username} onClick={() => visit(player.username)}>
                  <span>{player.username}</span>
                  <b>{player.coins} монет</b>
                </button>
              ))}
            </div>
          ) : null}

          {tab === "inventory" ? (
            <div className="panel-body">
              <div className="item-grid">
                {inventoryItems.map((item, index) => {
                  const placeable = ownHome && ["furniture", "decor", "outdoor"].includes(item.type);
                  return (
                    <button key={`${item.id}-${index}`} className="shop-card" onClick={() => placeable && handlePlace(item.id)} disabled={!placeable}>
                      <span className="item-emoji">{item.emoji}</span>
                      <span className="item-name">{item.name}</span>
                      <span className="item-meta">{placeable ? "поставить дома" : item.type}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="chat-box">
            <div className="chat-title"><MessageCircle size={17} /> Чат дома</div>
            <div className="messages">
              {messages.slice(-8).map((message) => (
                <div key={message.id} className="message">
                  <b>{message.from}</b>
                  <span>{message.text}</span>
                </div>
              ))}
            </div>
            <div className="chat-input">
              <input value={chatText} onChange={(event) => setChatText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && sendChat()} placeholder="Написать..." />
              <button onClick={sendChat}>Send</button>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
