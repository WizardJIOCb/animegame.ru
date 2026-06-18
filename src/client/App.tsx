import { Coins, DoorOpen, Hammer, Home, LogOut, MessageCircle, Mic, MicOff, RotateCcw, RotateCw, Shirt, ShoppingBag, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AuthScreen } from "./components/AuthScreen";
import { buy, earn, getCatalog, getHome, getPlayers, getToken, login, me, movePlacedItem, place, register, rotatePlacedItem, sellPlacedItem, setToken, updateHomeStyle } from "./api";
import { GameScene } from "./game/GameScene";
import type { Activity, CatalogItem, ChatMessage, HomeState, PlacedItem, PublicUser, RemotePlayer } from "./types";

type Tab = "shop" | "work" | "visit" | "inventory";
type VoiceState = "off" | "connecting" | "on";
type VoicePeerInfo = { id: string; username: string };
type VoiceSignal =
  | { type: "description"; description: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit };

const voiceRtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ]
};

const floorSwatches = ["#9b6a3c", "#6f472a", "#c08a4a", "#8f7a5d", "#4f4a43", "#2f3437"];
const wallSwatches = ["#d8d1c3", "#b7c7b0", "#aebdca", "#c7b1a8", "#8f7356", "#3f4448"];

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
  const [voiceState, setVoiceState] = useState<VoiceState>("off");
  const [voiceError, setVoiceError] = useState("");
  const [remoteVoicePeers, setRemoteVoicePeers] = useState<VoicePeerInfo[]>([]);
  const userRef = useRef<PublicUser | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localVoiceStreamRef = useRef<MediaStream | null>(null);
  const voicePeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const voiceAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const voicePeerNamesRef = useRef<Map<string, string>>(new Map());
  const voiceCandidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const voiceActiveRef = useRef(false);

  const ownHome = user?.username === homeOwner;

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    void bootstrap();
    return () => {
      stopVoice(false);
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
        userRef.current = response.user;
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
      userRef.current = response.user;
      setUser(response.user);
      await loadHome(response.user.username);
      connectSocket(response.user.username);
      const playersResponse = await getPlayers();
      setPlayers(playersResponse.players);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Не получилось войти");
    }
  }

  function upsertRemotePlayer(players: RemotePlayer[], nextPlayer: RemotePlayer) {
    if (nextPlayer.username === userRef.current?.username) {
      return players;
    }

    const matches = (player: RemotePlayer) => player.username === nextPlayer.username;
    const exists = players.some(matches);
    if (!exists) {
      return [...players, nextPlayer];
    }

    return players.map((player) => matches(player) ? { ...nextPlayer, avatar: nextPlayer.avatar ?? player.avatar } : player);
  }

  function connectSocket(owner: string) {
    socketRef.current?.disconnect();
    const socket = io("/", {
      auth: { token: getToken() }
    });

    socket.on("connect", () => {
      socket.emit("home:join", owner);
    });
    socket.on("player:present", ({ players }: { players: RemotePlayer[] }) => {
      setRemotePlayers((current) => players.reduce((nextPlayers, player) => upsertRemotePlayer(nextPlayers, player), current));
    });
    socket.on("player:joined", (player: RemotePlayer) => {
      const username = player.username;
      setRemotePlayers((current) => upsertRemotePlayer(current, player));
      showToast(`${username} зашел в дом`);
    });
    socket.on("player:left", ({ username }: { id?: string; username: string }) => {
      setRemotePlayers((current) => current.filter((player) => player.username !== username));
      showToast(`${username} вышел`);
    });
    socket.on("player:moved", (payload: RemotePlayer) => {
      setRemotePlayers((current) => upsertRemotePlayer(current, payload));
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
    socket.on("voice:users", ({ users }: { users: VoicePeerInfo[] }) => {
      users.forEach((peer) => {
        void createVoicePeer(peer, true);
      });
    });
    socket.on("voice:userJoined", (peer: VoicePeerInfo) => {
      rememberVoicePeer(peer);
      showToast(`${peer.username} joined voice`);
    });
    socket.on("voice:userLeft", (peer: VoicePeerInfo) => {
      closeVoicePeer(peer.id);
      showToast(`${peer.username} left voice`);
    });
    socket.on("voice:signal", ({ from, signal }: { from: VoicePeerInfo; signal: VoiceSignal }) => {
      void handleVoiceSignal(from, signal);
    });

    socketRef.current = socket;
  }

  async function toggleVoice() {
    if (voiceState === "connecting") {
      return;
    }

    if (voiceActiveRef.current) {
      stopVoice();
      return;
    }

    await startVoice();
  }

  async function startVoice() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Voice is not supported in this browser");
      return;
    }

    try {
      setVoiceError("");
      setVoiceState("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      localVoiceStreamRef.current = stream;
      voiceActiveRef.current = true;
      setVoiceState("on");
      socketRef.current?.emit("voice:join");
      showToast("Voice chat enabled");
    } catch {
      voiceActiveRef.current = false;
      setVoiceState("off");
      setVoiceError("Microphone access denied");
    }
  }

  function stopVoice(notifyServer = true) {
    if (notifyServer) {
      socketRef.current?.emit("voice:leave");
    }

    voiceActiveRef.current = false;
    localVoiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    localVoiceStreamRef.current = null;
    voicePeersRef.current.forEach((peer) => peer.close());
    voicePeersRef.current.clear();
    voiceCandidateQueueRef.current.clear();
    voicePeerNamesRef.current.clear();
    voiceAudioRefs.current.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    });
    voiceAudioRefs.current.clear();
    setRemoteVoicePeers([]);
    setVoiceState("off");
  }

  function rememberVoicePeer(peer: VoicePeerInfo) {
    voicePeerNamesRef.current.set(peer.id, peer.username);
    setRemoteVoicePeers((current) => {
      if (current.some((entry) => entry.id === peer.id)) {
        return current.map((entry) => entry.id === peer.id ? peer : entry);
      }
      return [...current, peer];
    });
  }

  function closeVoicePeer(peerId: string) {
    voicePeersRef.current.get(peerId)?.close();
    voicePeersRef.current.delete(peerId);
    voiceCandidateQueueRef.current.delete(peerId);
    voicePeerNamesRef.current.delete(peerId);
    const audio = voiceAudioRefs.current.get(peerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      voiceAudioRefs.current.delete(peerId);
    }
    setRemoteVoicePeers((current) => current.filter((entry) => entry.id !== peerId));
  }

  async function createVoicePeer(remotePeer: VoicePeerInfo, initiator: boolean) {
    if (!voiceActiveRef.current || remotePeer.id === socketRef.current?.id) {
      return null;
    }

    rememberVoicePeer(remotePeer);
    const existingPeer = voicePeersRef.current.get(remotePeer.id);
    if (existingPeer) {
      return existingPeer;
    }

    const peer = new RTCPeerConnection(voiceRtcConfig);
    voicePeersRef.current.set(remotePeer.id, peer);
    localVoiceStreamRef.current?.getTracks().forEach((track) => {
      peer.addTrack(track, localVoiceStreamRef.current!);
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("voice:signal", {
          to: remotePeer.id,
          signal: { type: "candidate", candidate: event.candidate.toJSON() } satisfies VoiceSignal
        });
      }
    };

    peer.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) {
        return;
      }

      let audio = voiceAudioRefs.current.get(remotePeer.id);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("playsinline", "true");
        audio.dataset.voiceUser = remotePeer.username;
        audio.style.display = "none";
        document.body.appendChild(audio);
        voiceAudioRefs.current.set(remotePeer.id, audio);
      }
      if (audio.srcObject !== stream) {
        audio.srcObject = stream;
      }
      void audio.play().catch(() => undefined);
      rememberVoicePeer(remotePeer);
    };

    peer.onconnectionstatechange = () => {
      if (["closed", "disconnected", "failed"].includes(peer.connectionState)) {
        closeVoicePeer(remotePeer.id);
      }
    };

    if (initiator) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socketRef.current?.emit("voice:signal", {
        to: remotePeer.id,
        signal: { type: "description", description: offer } satisfies VoiceSignal
      });
    }

    return peer;
  }

  async function handleVoiceSignal(from: VoicePeerInfo, signal: VoiceSignal) {
    if (!voiceActiveRef.current) {
      return;
    }

    const peer = await createVoicePeer(from, false);
    if (!peer) {
      return;
    }

    if (signal.type === "description") {
      await peer.setRemoteDescription(signal.description);
      const queuedCandidates = voiceCandidateQueueRef.current.get(from.id) ?? [];
      voiceCandidateQueueRef.current.delete(from.id);
      await Promise.all(queuedCandidates.map((candidate) => peer.addIceCandidate(candidate).catch(() => undefined)));

      if (signal.description.type === "offer") {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socketRef.current?.emit("voice:signal", {
          to: from.id,
          signal: { type: "description", description: answer } satisfies VoiceSignal
        });
      }
      return;
    }

    if (!peer.remoteDescription) {
      const queue = voiceCandidateQueueRef.current.get(from.id) ?? [];
      queue.push(signal.candidate);
      voiceCandidateQueueRef.current.set(from.id, queue);
      return;
    }

    await peer.addIceCandidate(signal.candidate).catch(() => undefined);
  }

  async function loadHome(owner: string) {
    const nextHome = await getHome(owner);
    setHomeOwner(owner);
    setHome(nextHome);
    setMessages(nextHome.chats);
    setRemotePlayers([]);
  }

  async function visit(owner: string) {
    if (owner !== homeOwner) {
      stopVoice();
    }
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
    const placeable = ["furniture", "decor", "outdoor"].includes(response.item.type);
    if (placeable && ownHome) {
      const x = Number((Math.random() * 6 - 3).toFixed(2));
      const z = Number((Math.random() * 5 - 1.5).toFixed(2));
      const placedResponse = await place(response.item.id, x, z, Math.random() * Math.PI);
      setUser(placedResponse.user);
      await loadHome(placedResponse.user.username);
      socketRef.current?.emit("home:join", placedResponse.user.username);
      setSelectedPlacedId(placedResponse.placed.instanceId);
      setBuildMode(true);
      showToast(`Куплено и поставлено: ${response.item.name}`);
      return;
    }

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

  async function handleRotateSelected(direction: -1 | 1) {
    if (!selectedPlaced || !ownHome) {
      return;
    }

    const response = await rotatePlacedItem(selectedPlaced.instanceId, selectedPlaced.rotation + direction * Math.PI / 12);
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
    stopVoice();
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
  const voiceLabel = voiceState === "connecting" ? "Connecting" : voiceState === "on" ? "Voice on" : "Voice";

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
              <button onClick={() => handleRotateSelected(-1)} disabled={!selectedPlaced} title="Rotate left">
                <RotateCcw size={16} /> Left
              </button>
              <button onClick={() => handleRotateSelected(1)} disabled={!selectedPlaced} title="Rotate right">
                <RotateCw size={16} /> Right
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
                  const equipped = item.id === user.avatar.outfit || item.id === user.avatar.character || item.id === user.avatar.pet;
                  const removableEquipped = equipped && item.type !== "character";
                  return (
                    <button
                      key={item.id}
                      className={equipped ? "shop-card equipped" : "shop-card"}
                      onClick={() => handleBuy(item.id)}
                      disabled={(owned && !selectable) || user.coins < item.price}
                    >
                      <span className="item-emoji">{item.emoji}</span>
                      <span className="item-name">{item.name}</span>
                      {equipped ? <span className="item-meta equipped">{removableEquipped ? "снять" : "выбрано"}</span> : null}
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
            <div className="voice-row">
              <button
                className={voiceState === "on" ? "voice-button active" : "voice-button"}
                onClick={toggleVoice}
                disabled={voiceState === "connecting"}
                title={voiceState === "on" ? "Turn voice off" : "Turn voice on"}
              >
                {voiceState === "on" ? <Mic size={16} /> : <MicOff size={16} />}
                {voiceLabel}
              </button>
              {(voiceError || voiceState === "on" || remoteVoicePeers.length > 0) ? (
                <span className="voice-status">
                  {voiceError || (remoteVoicePeers.length > 0 ? `Connected: ${remoteVoicePeers.map((peer) => peer.username).join(", ")}` : "Voice room is open")}
                </span>
              ) : null}
            </div>
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
