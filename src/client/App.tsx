import { CarFront, Coins, Crosshair, DoorOpen, Hammer, Home, LogOut, Map as MapIcon, MessageCircle, Mic, MicOff, Minus, Plus, RotateCcw, RotateCw, Shield, Shirt, ShoppingBag, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AdminPanel } from "./components/AdminPanel";
import { CompactExpeditionHud, HUD_PREFERENCES_STORAGE_KEY, readHudPreferences, type HudPreferences } from "./components/AegisHud";
import { AuthScreen } from "./components/AuthScreen";
import { ExpeditionPanel } from "./components/ExpeditionPanel";
import type { ProgressionTabId } from "./components/ProgressionHub";
import { createGameAssetPlan, GameAssetGate } from "./components/GameAssetGate";
import { NeighborhoodPanel } from "./components/NeighborhoodPanel";
import {
  abandonExpedition,
  buy,
  buyExpeditionAmmo,
  buyExpeditionTraderItem,
  buyExpeditionWeapon,
  claimExpeditionQuest,
  claimNeighborhoodIncome,
  craftExpeditionItem,
  earn,
  equipExpeditionGear,
  extractExpedition,
  getCatalog,
  getExpeditionProfile,
  getHome,
  getNeighborhood,
  getPlayers,
  getToken,
  hitExpeditionEnemies,
  hitExpeditionEnemiesWithVehicle,
  login,
  lootExpeditionContainer,
  lootExpeditionEnemy,
  me,
  movePlacedItem,
  place,
  register,
  rotatePlacedItem,
  scalePlacedItem,
  sellExpeditionTraderItem,
  sellPlacedItem,
  setExpeditionLoadout,
  setToken,
  startExpedition,
  syncExpeditionPlayerStatus,
  updateHomeStyle,
  useExpeditionBandage,
  useExpeditionTactical,
  upgradeCareer,
  upgradeExpeditionSkill,
  upgradeExpeditionGear,
  upgradeExpeditionWeapon,
  upgradeHouse
} from "./api";
import { trackGoal, trackItemGoal, trackPurchase } from "./analytics";
import { GameScene } from "./game/GameScene";
import { NeighborhoodScene } from "./game/NeighborhoodScene";
import type { WorldRegion } from "./game/outlands";
import { EXPEDITION_ARTIFACT_IDS, EXPEDITION_GEAR, EXPEDITION_GRENADE_IDS, EXPEDITION_ITEMS, EXPEDITION_WEAPONS } from "../shared/expedition";
import type {
  ExpeditionContainerId,
  ExpeditionEnemyId,
  ExpeditionGearId,
  ExpeditionGearSlot,
  ExpeditionHitInput,
  ExpeditionItemId,
  ExpeditionProfile,
  ExpeditionQuestId,
  ExpeditionRecipeId,
  ExpeditionRunSnapshot,
  ExpeditionSkillId,
  ExpeditionTacticalId,
  ExpeditionTacticalTarget,
  ExpeditionVehicleHitInput,
  ExpeditionWeaponId,
  ExpeditionWeaponUpgradeStat,
  PartyInvite,
  PartyInvitesSnapshot,
  PartySnapshot
} from "../shared/expedition";
import type { Activity, CatalogItem, ChatMessage, HomeState, NeighborhoodResident, NeighborhoodState, PlacedItem, PublicUser, RemotePlayer } from "./types";

type Tab = "shop" | "work" | "visit" | "inventory" | "admin";
type SceneMode = "home" | "street";
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
  const [sceneMode, setSceneMode] = useState<SceneMode>("home");
  const [neighborhood, setNeighborhood] = useState<NeighborhoodState | null>(null);
  const [activeInteriorOwner, setActiveInteriorOwner] = useState<string | null>(null);
  const [neighborhoodVisitRequest, setNeighborhoodVisitRequest] = useState<{ username: string; requestId: number }>();
  const [neighborhoodBusy, setNeighborhoodBusy] = useState("");
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
  const [expeditionProfile, setExpeditionProfile] = useState<ExpeditionProfile | null>(null);
  const [expeditionRun, setExpeditionRun] = useState<ExpeditionRunSnapshot | null>(null);
  const [expeditionBusy, setExpeditionBusy] = useState("");
  const [pendingExpeditionShots, setPendingExpeditionShots] = useState(0);
  const [pendingExpeditionVehicleHits, setPendingExpeditionVehicleHits] = useState(0);
  const [expeditionHealPulse, setExpeditionHealPulse] = useState(0);
  const [expeditionPlayerStatus, setExpeditionPlayerStatus] = useState({
    health: 100,
    maxHealth: 100,
    shield: 0,
    downed: false
  });
  const [showExpeditionPanel, setShowExpeditionPanel] = useState(false);
  const [showUtilityPanel, setShowUtilityPanel] = useState(false);
  const [requestedExpeditionTab, setRequestedExpeditionTab] = useState<ProgressionTabId>();
  const [requestedExpeditionTabRevision, setRequestedExpeditionTabRevision] = useState(0);
  const [hudPreferences, setHudPreferences] = useState<HudPreferences>(readHudPreferences);
  const [worldRegion, setWorldRegion] = useState<WorldRegion>("city");
  const [canExtractExpedition, setCanExtractExpedition] = useState(false);
  const [party, setParty] = useState<PartySnapshot | null>(null);
  const [partyInvites, setPartyInvites] = useState<PartyInvite[]>([]);
  const [partyOutgoingInvites, setPartyOutgoingInvites] = useState<PartyInvite[]>([]);
  const [partyOnlinePlayers, setPartyOnlinePlayers] = useState<Array<{ userId: string; username: string }>>([]);
  const userRef = useRef<PublicUser | null>(null);
  const sceneModeRef = useRef<SceneMode>("home");
  const activeInteriorOwnerRef = useRef<string | null>(null);
  const streetPositionRef = useRef<{ x: number; y: number; z: number; rotation?: number; vehicle?: boolean } | undefined>(undefined);
  const socketRef = useRef<Socket | null>(null);
  const localVoiceStreamRef = useRef<MediaStream | null>(null);
  const voicePeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const voiceAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const voicePeerNamesRef = useRef<Map<string, string>>(new Map());
  const voiceCandidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const voiceActiveRef = useRef(false);
  const enemyHitQueueRef = useRef(Promise.resolve());
  const pendingExpeditionShotsRef = useRef(0);
  const pendingExpeditionVehicleHitsRef = useRef(0);
  const pendingContainersRef = useRef(new Set<ExpeditionContainerId>());
  const pendingEnemyLootRef = useRef(new Set<ExpeditionEnemyId>());
  const pendingBandageRef = useRef(false);
  const pendingTacticalRef = useRef(false);
  const expeditionPlayerStatusRef = useRef(expeditionPlayerStatus);
  const expeditionBusyRef = useRef("");
  const playerStatusSyncQueueRef = useRef(Promise.resolve());
  const lastSubmittedPlayerStatusRef = useRef("");
  const playerStatusRetryTimerRef = useRef<number | null>(null);
  const playerStatusRetryAttemptRef = useRef(0);
  const expeditionStatusHandlerRef = useRef<(status: {
    health: number;
    maxHealth: number;
    shield: number;
    downed: boolean;
  }) => void>(() => undefined);
  const expeditionRunRef = useRef<ExpeditionRunSnapshot | null>(null);
  const sessionVersionRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);

  function openExpeditionPanel(tab: ProgressionTabId = "raid") {
    setRequestedExpeditionTab(tab);
    setRequestedExpeditionTabRevision((revision) => revision + 1);
    setShowExpeditionPanel(true);
    setShowUtilityPanel(false);
    if (document.pointerLockElement) void document.exitPointerLock();
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(HUD_PREFERENCES_STORAGE_KEY, JSON.stringify(hudPreferences));
    } catch {
      // HUD preferences are non-critical when storage is unavailable.
    }
  }, [hudPreferences]);

  useEffect(() => {
    function handleAegisShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing = target?.isContentEditable
        || target?.tagName === "INPUT"
        || target?.tagName === "TEXTAREA"
        || target?.tagName === "SELECT";
      if (event.code === "Escape" && (showExpeditionPanel || showUtilityPanel)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setShowExpeditionPanel(false);
        setShowUtilityPanel(false);
        return;
      }
      if (editing) return;

      if (event.code === "KeyI" && !event.ctrlKey && !event.metaKey && !event.altKey && expeditionProfile) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openExpeditionPanel("inventory");
      } else if (showExpeditionPanel && [
        "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyR", "KeyT",
        "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyG", "KeyH", "Space",
        "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "Digit1", "Digit2",
        "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9",
        "Digit0", "Minus"
      ].includes(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    window.addEventListener("keydown", handleAegisShortcut, true);
    return () => window.removeEventListener("keydown", handleAegisShortcut, true);
  }, [expeditionProfile, showExpeditionPanel, showUtilityPanel]);

  function updateExpeditionRun(run: ExpeditionRunSnapshot | null) {
    if (run?.id !== expeditionRunRef.current?.id) {
      if (playerStatusRetryTimerRef.current !== null) {
        window.clearTimeout(playerStatusRetryTimerRef.current);
        playerStatusRetryTimerRef.current = null;
      }
      playerStatusRetryAttemptRef.current = 0;
      pendingExpeditionShotsRef.current = 0;
      setPendingExpeditionShots(0);
      pendingExpeditionVehicleHitsRef.current = 0;
      setPendingExpeditionVehicleHits(0);
      pendingEnemyLootRef.current.clear();
      pendingBandageRef.current = false;
      pendingTacticalRef.current = false;
      setExpeditionHealPulse(0);
      lastSubmittedPlayerStatusRef.current = "";
      const resetStatus = run
        ? {
          health: run.playerHealth,
          maxHealth: run.playerMaxHealth,
          shield: run.playerShield,
          downed: Boolean(run.downedAt)
        }
        : { health: 100, maxHealth: 100, shield: 0, downed: false };
      expeditionPlayerStatusRef.current = resetStatus;
      setExpeditionPlayerStatus(resetStatus);
    }
    expeditionRunRef.current = run;
    setExpeditionRun(run);
  }

  function restoreActiveExpeditionLocation(run: ExpeditionRunSnapshot | null) {
    if (!run) return;
    streetPositionRef.current = { ...run.playerPosition };
    activeInteriorOwnerRef.current = null;
    setActiveInteriorOwner(null);
    setSceneMode("street");
    sceneModeRef.current = "street";
  }

  function adjustPendingExpeditionShots(delta: number) {
    pendingExpeditionShotsRef.current = Math.max(0, pendingExpeditionShotsRef.current + delta);
    setPendingExpeditionShots(pendingExpeditionShotsRef.current);
  }

  function disconnectSocket() {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setPartyOnlinePlayers([]);
  }

  function captureSession() {
    const userId = userRef.current?.id;
    return userId ? { version: sessionVersionRef.current, userId } : null;
  }

  function isCurrentSession(session: { version: number; userId: string } | null) {
    return Boolean(session
      && session.version === sessionVersionRef.current
      && session.userId === userRef.current?.id);
  }

  const ownHome = user?.username === homeOwner;

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    sceneModeRef.current = sceneMode;
  }, [sceneMode]);

  useEffect(() => {
    const expirations = [...partyInvites, ...partyOutgoingInvites].map((invite) => invite.expiresAt);
    if (expirations.length === 0) return;
    const delay = Math.max(0, Math.min(...expirations) - Date.now() + 25);
    const timeout = window.setTimeout(() => {
      const now = Date.now();
      setPartyInvites((current) => current.filter((invite) => invite.expiresAt > now));
      setPartyOutgoingInvites((current) => current.filter((invite) => invite.expiresAt > now));
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [partyInvites, partyOutgoingInvites]);

  useEffect(() => {
    void bootstrap();
    return () => {
      sessionVersionRef.current += 1;
      stopVoice(false);
      disconnectSocket();
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
      const sessionVersion = sessionVersionRef.current + 1;
      sessionVersionRef.current = sessionVersion;
      try {
        const response = await me();
        if (sessionVersionRef.current !== sessionVersion) return;
        const [primaryLocation, expeditionState] = await Promise.all([
          fetchPrimaryLocation(response.user.username),
          getExpeditionProfile()
        ]);
        if (sessionVersionRef.current !== sessionVersion) return;
        commitPrimaryLocation(response.user.username, primaryLocation);
        setExpeditionProfile(expeditionState.profile);
        updateExpeditionRun(expeditionState.run);
        restoreActiveExpeditionLocation(expeditionState.run);
        userRef.current = response.user;
        setUser(response.user);
        connectSocket(response.user.username);
      } catch {
        if (sessionVersionRef.current !== sessionVersion) return;
        sessionVersionRef.current += 1;
        disconnectSocket();
        setToken(null);
        userRef.current = null;
        setUser(null);
        setHome(null);
        setExpeditionProfile(null);
        updateExpeditionRun(null);
        setCanExtractExpedition(false);
      }
    }
  }

  async function handleAuth(mode: "login" | "register", username: string, password: string) {
    const sessionVersion = sessionVersionRef.current + 1;
    sessionVersionRef.current = sessionVersion;
    disconnectSocket();
    setError("");
    try {
      const response = mode === "register" ? await register(username, password) : await login(username, password);
      if (sessionVersionRef.current !== sessionVersion) return;
      setToken(response.token);
      const [primaryLocation, expeditionState] = await Promise.all([
        fetchPrimaryLocation(response.user.username),
        getExpeditionProfile()
      ]);
      if (sessionVersionRef.current !== sessionVersion) return;
      const playersResponse = await getPlayers();
      if (sessionVersionRef.current !== sessionVersion) return;
      commitPrimaryLocation(response.user.username, primaryLocation);
      setExpeditionProfile(expeditionState.profile);
      updateExpeditionRun(expeditionState.run);
      restoreActiveExpeditionLocation(expeditionState.run);
      userRef.current = response.user;
      setUser(response.user);
      connectSocket(response.user.username);
      setPlayers(playersResponse.players);
      trackGoal(mode === "register" ? "auth_register" : "auth_login", { mode });
    } catch (authError) {
      if (sessionVersionRef.current !== sessionVersion) return;
      sessionVersionRef.current += 1;
      disconnectSocket();
      setToken(null);
      userRef.current = null;
      setUser(null);
      setHome(null);
      setExpeditionProfile(null);
      updateExpeditionRun(null);
      setCanExtractExpedition(false);
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

  function upsertPlacedItem(items: PlacedItem[], placed: PlacedItem) {
    return items.some((item) => item.instanceId === placed.instanceId)
      ? items.map((item) => item.instanceId === placed.instanceId ? placed : item)
      : [...items, placed];
  }

  function patchNeighborhoodResident(owner: string, update: (resident: NeighborhoodResident) => NeighborhoodResident, homeValue?: number) {
    setNeighborhood((current) => current ? {
      ...current,
      progress: owner === userRef.current?.username && homeValue !== undefined
        ? { ...current.progress, homeValue }
        : current.progress,
      residents: current.residents.map((resident) => resident.username === owner
        ? { ...update(resident), ...(homeValue !== undefined ? { homeValue } : {}) }
        : resident)
    } : current);
  }

  function connectSocket(owner: string) {
    socketRef.current?.disconnect();
    const socket = io("/", {
      auth: { token: getToken() }
    });

    socket.on("connect", () => {
      socket.emit("party:online-players");
      if (sceneModeRef.current === "street") {
        socket.emit("neighborhood:join");
        if (streetPositionRef.current) {
          socket.emit("neighborhood:move", streetPositionRef.current);
        }
        if (activeInteriorOwnerRef.current) {
          socket.emit("home:watch", activeInteriorOwnerRef.current);
        }
      } else {
        socket.emit("home:join", owner);
      }
    });
    socket.on("player:present", ({ players }: { players: RemotePlayer[] }) => {
      setRemotePlayers(players.reduce((nextPlayers, player) => upsertRemotePlayer(nextPlayers, player), [] as RemotePlayer[]));
    });
    socket.on("player:joined", (player: RemotePlayer) => {
      const username = player.username;
      setRemotePlayers((current) => upsertRemotePlayer(current, player));
      showToast(sceneModeRef.current === "street" ? `${username} вышел на улицу` : `${username} зашел в дом`);
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
    socket.on("home:snapshot", ({ owner, homeStyle, placedItems, homeValue, houseLevel, level, careerLevel, incomePerHour, colors, avatar }: {
      owner: string;
      homeStyle: NonNullable<PublicUser["homeStyle"]>;
      placedItems: PlacedItem[];
      homeValue: number;
      houseLevel: number;
      level: number;
      careerLevel: number;
      incomePerHour: number;
      colors: NeighborhoodResident["colors"];
      avatar: PublicUser["avatar"];
    }) => {
      setHome((current) => current?.owner === owner ? { ...current, avatar, homeStyle, placedItems } : current);
      patchNeighborhoodResident(owner, (resident) => ({
        ...resident,
        avatar,
        houseLevel,
        level,
        careerLevel,
        incomePerHour,
        colors,
        homeStyle,
        placedItems
      }), homeValue);
    });
    socket.on("home:placed", ({ owner, placed, homeValue }: { owner: string; placed: PlacedItem; homeValue: number }) => {
      setHome((current) => current?.owner === owner ? { ...current, placedItems: upsertPlacedItem(current.placedItems, placed) } : current);
      patchNeighborhoodResident(owner, (resident) => ({ ...resident, placedItems: upsertPlacedItem(resident.placedItems, placed) }), homeValue);
    });
    socket.on("home:itemUpdated", ({ owner, placed, homeValue }: { owner: string; placed: PlacedItem; homeValue: number }) => {
      setHome((current) => current?.owner === owner ? { ...current, placedItems: upsertPlacedItem(current.placedItems, placed) } : current);
      patchNeighborhoodResident(owner, (resident) => ({ ...resident, placedItems: upsertPlacedItem(resident.placedItems, placed) }), homeValue);
    });
    socket.on("home:itemSold", ({ owner, instanceId, homeValue }: { owner: string; instanceId: string; homeValue: number }) => {
      setHome((current) => current?.owner === owner ? { ...current, placedItems: current.placedItems.filter((item) => item.instanceId !== instanceId) } : current);
      patchNeighborhoodResident(owner, (resident) => ({ ...resident, placedItems: resident.placedItems.filter((item) => item.instanceId !== instanceId) }), homeValue);
      setSelectedPlacedId((current) => current === instanceId ? "" : current);
    });
    socket.on("home:styleUpdated", ({ owner, homeStyle }: { owner: string; homeStyle: NonNullable<PublicUser["homeStyle"]> }) => {
      setHome((current) => current?.owner === owner ? { ...current, homeStyle } : current);
      patchNeighborhoodResident(owner, (resident) => ({
        ...resident,
        homeStyle,
        colors: { ...resident.colors, walls: homeStyle.wallColor }
      }));
    });
    socket.on("world:interaction", ({ username, action }: { username: string; action: string }) => {
      showToast(`${username}: ${action}`);
    });
    socket.on("party:snapshot", (snapshot: PartySnapshot | null) => {
      setParty(snapshot);
    });
    socket.on("party:invites", ({ incoming, outgoing }: PartyInvitesSnapshot) => {
      setPartyInvites(incoming);
      setPartyOutgoingInvites(outgoing);
    });
    socket.on("party:online-players", ({ players: onlinePlayers }: {
      players: Array<{ userId: string; username: string }>;
    }) => {
      setPartyOnlinePlayers(onlinePlayers.filter((player) => player.userId !== userRef.current?.id));
    });
    socket.on("party:invited", (invite: PartyInvite) => {
      setPartyInvites((current) => [
        ...current.filter((entry) => entry.id !== invite.id && entry.partyId !== invite.partyId),
        invite
      ]);
      showToast(`${invite.fromUsername} приглашает вас в группу`);
    });
    socket.on("party:invite-sent", (invite: PartyInvite) => {
      setPartyOutgoingInvites((current) => [
        ...current.filter((entry) => entry.id !== invite.id && entry.toUserId !== invite.toUserId),
        invite
      ]);
      showToast(`Приглашение отправлено игроку ${invite.toUsername}`);
    });
    socket.on("party:invite-resolved", ({ inviteId }: { inviteId: string }) => {
      setPartyInvites((current) => current.filter((invite) => invite.id !== inviteId));
      setPartyOutgoingInvites((current) => current.filter((invite) => invite.id !== inviteId));
    });
    socket.on("party:error", ({ error: partyError }: { error: string }) => {
      showToast(partyError || "Не удалось изменить группу");
    });
    socket.on("expedition:started", ({ run, profile, partySize, leaderUsername }: {
      run: ExpeditionRunSnapshot;
      profile: ExpeditionProfile;
      partySize: number;
      leaderUsername: string;
    }) => {
      if (!userRef.current) return;
      setExpeditionProfile(profile);
      updateExpeditionRun(run);
      setCanExtractExpedition(false);
      setShowExpeditionPanel(false);
      showToast(partySize > 1
        ? `${leaderUsername} начал групповую экспедицию · участников: ${partySize}`
        : "Экспедиция начата");
      if (sceneModeRef.current !== "street") void openNeighborhood();
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
      trackGoal("voice_start");
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
    if (notifyServer) {
      trackGoal("voice_stop");
    }
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

  async function refreshDisplayedHome(owner: string) {
    const nextHome = await getHome(owner);
    setHomeOwner(owner);
    setHome(nextHome);
    setMessages(nextHome.chats);
    return nextHome;
  }

  async function fetchPrimaryLocation(owner: string) {
    const homePromise = getHome(owner);
    const neighborhoodPromise = getNeighborhood().catch(() => null);
    const [nextHome, nextNeighborhood] = await Promise.all([homePromise, neighborhoodPromise]);
    return { home: nextHome, neighborhood: nextNeighborhood };
  }

  function commitPrimaryLocation(
    owner: string,
    primaryLocation: { home: HomeState; neighborhood: NeighborhoodState | null }
  ) {
    const { home: nextHome, neighborhood: nextNeighborhood } = primaryLocation;
    setHomeOwner(owner);
    setHome(nextHome);
    setMessages(nextHome.chats);
    setRemotePlayers([]);

    if (nextNeighborhood) {
      setNeighborhood(nextNeighborhood);
      activeInteriorOwnerRef.current = owner;
      setActiveInteriorOwner(owner);
      setSceneMode("street");
      sceneModeRef.current = "street";
      trackGoal("neighborhood_primary_view", { residents: nextNeighborhood.residents.length });
      return;
    }

    setSceneMode("home");
    sceneModeRef.current = "home";
    activeInteriorOwnerRef.current = null;
    setActiveInteriorOwner(null);
  }

  async function visit(owner: string) {
    if (sceneModeRef.current === "street" && neighborhood) {
      setBuildMode(false);
      setSelectedPlacedId("");
      setNeighborhoodVisitRequest({ username: owner, requestId: Date.now() });
      trackGoal("visit_home_route", { own_home: owner === userRef.current?.username });
      return;
    }
    try {
      if (owner !== homeOwner) {
        stopVoice();
      }
      await loadHome(owner);
      setSceneMode("home");
      sceneModeRef.current = "home";
      socketRef.current?.emit("home:join", owner);
      trackGoal("visit_home", { own_home: owner === userRef.current?.username });
    } catch (visitError) {
      showToast(visitError instanceof Error ? visitError.message : "Не удалось войти в дом");
    }
  }

  async function openNeighborhood() {
    try {
      stopVoice();
      setBuildMode(false);
      setSelectedPlacedId("");
      const nextNeighborhood = await getNeighborhood();
      setNeighborhood(nextNeighborhood);
      setRemotePlayers([]);
      activeInteriorOwnerRef.current = userRef.current?.username ?? null;
      setActiveInteriorOwner(activeInteriorOwnerRef.current);
      setSceneMode("street");
      sceneModeRef.current = "street";
      socketRef.current?.emit("neighborhood:join");
      trackGoal("neighborhood_enter", { residents: nextNeighborhood.residents.length });
    } catch (neighborhoodError) {
      showToast(neighborhoodError instanceof Error ? neighborhoodError.message : "Не удалось открыть улицу");
    }
  }

  async function refreshNeighborhood() {
    const nextNeighborhood = await getNeighborhood();
    setNeighborhood(nextNeighborhood);
    return nextNeighborhood;
  }

  function handleNeighborhoodMove(position: { x: number; y: number; z: number; rotation?: number; vehicle?: boolean }) {
    streetPositionRef.current = position;
    socketRef.current?.emit("neighborhood:move", position);
  }

  function handleInteriorChange(owner: string | null) {
    if (owner !== activeInteriorOwnerRef.current) {
      stopVoice(false);
    }
    activeInteriorOwnerRef.current = owner;
    setActiveInteriorOwner(owner);
    socketRef.current?.emit("home:watch", owner);
    if (owner !== userRef.current?.username) {
      setBuildMode(false);
      setSelectedPlacedId("");
    }
    trackGoal(owner ? "seamless_home_enter" : "seamless_home_exit", owner ? { owner, own_home: owner === userRef.current?.username } : undefined);
  }

  async function handleClaimIncome() {
    if (neighborhoodBusy) return;
    setNeighborhoodBusy("income");
    try {
      const response = await claimNeighborhoodIncome();
      setUser(response.user);
      await refreshNeighborhood();
      showToast(response.claimed > 0 ? `Пассивный доход: +${response.claimed} монет` : "Доход ещё накапливается");
      trackGoal("income_claim", { amount: response.claimed });
    } catch (incomeError) {
      showToast(incomeError instanceof Error ? incomeError.message : "Не удалось забрать доход");
    } finally {
      setNeighborhoodBusy("");
    }
  }

  async function handleUpgradeCareer() {
    if (neighborhoodBusy) return;
    setNeighborhoodBusy("career");
    try {
      const response = await upgradeCareer();
      setUser(response.user);
      await refreshNeighborhood();
      showToast(`Карьера повышена · доход ${response.progress.incomePerHour} монет/час`);
      trackGoal("career_upgrade", { level: response.progress.careerLevel, spent: response.spent });
    } catch (careerError) {
      showToast(careerError instanceof Error ? careerError.message : "Не удалось повысить карьеру");
    } finally {
      setNeighborhoodBusy("");
    }
  }

  async function handleUpgradeHouse() {
    if (neighborhoodBusy) return;
    setNeighborhoodBusy("house");
    try {
      const response = await upgradeHouse();
      setUser(response.user);
      await refreshNeighborhood();
      showToast(`Новый этап стройки готов · дом ${response.progress.houseLevel} уровня`);
      trackGoal("house_upgrade", { level: response.progress.houseLevel, spent: response.spent });
    } catch (houseError) {
      showToast(houseError instanceof Error ? houseError.message : "Не удалось улучшить дом");
    } finally {
      setNeighborhoodBusy("");
    }
  }

  async function goOwnHome() {
    if (!user) {
      return;
    }
    await visit(user.username);
  }

  async function handleEarn(activityId: string) {
    if (sceneModeRef.current === "street") setNeighborhoodBusy(activityId);
    try {
      const response = await earn(activityId);
      setUser(response.user);
      if (sceneModeRef.current === "street") await refreshNeighborhood();
      trackGoal("earn_activity", {
        activity_id: response.activity.id,
        reward: response.activity.reward,
        duration_seconds: response.activity.seconds,
        xp: response.xpEarned ?? 0
      });
      const levelText = response.levelsGained ? ` · новый ${response.progress?.level} уровень!` : "";
      showToast(`+${response.activity.reward} монет · +${response.xpEarned ?? 0} XP${levelText}`);
    } catch (earnError) {
      showToast(earnError instanceof Error ? earnError.message : "Не удалось выполнить работу");
    } finally {
      if (sceneModeRef.current === "street") setNeighborhoodBusy("");
    }
  }

  async function handleBuy(itemId: string) {
    const ownedBefore = Boolean(user?.inventory.includes(itemId));
    const equippedBefore = itemId === user?.avatar.outfit || itemId === user?.avatar.character || itemId === user?.avatar.pet;
    const response = await buy(itemId);
    const placeable = ["furniture", "decor", "outdoor"].includes(response.item.type);
    const selectable = ["character", "clothing", "pet"].includes(response.item.type);
    if (!ownedBefore) {
      trackItemGoal("item_purchase", response.item, { placeable, selectable });
      trackPurchase(response.item, `buy-${Date.now()}-${response.item.id}`);
    } else if (selectable && equippedBefore && response.item.type !== "character") {
      trackItemGoal("item_unequip", response.item);
    } else if (selectable) {
      trackItemGoal("item_equip", response.item);
    }

    if (placeable && ownHome) {
      const x = Number((Math.random() * 6 - 3).toFixed(2));
      const z = Number((Math.random() * 5 - 1.5).toFixed(2));
      const placedResponse = await place(response.item.id, x, z, Math.random() * Math.PI);
      setUser(placedResponse.user);
      await refreshDisplayedHome(placedResponse.user.username);
      if (sceneModeRef.current === "street") {
        await refreshNeighborhood();
      } else {
        socketRef.current?.emit("home:join", placedResponse.user.username);
      }
      setSelectedPlacedId(placedResponse.placed.instanceId);
      setBuildMode(true);
      trackItemGoal("item_place", response.item, { source: "purchase", auto_place: true });
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
    await refreshDisplayedHome(response.user.username);
    if (sceneModeRef.current === "street") {
      await refreshNeighborhood();
    } else {
      socketRef.current?.emit("home:join", response.user.username);
    }
    const item = catalog.find((entry) => entry.id === itemId);
    if (item) {
      trackItemGoal("item_place", item, { source: "inventory", auto_place: false });
    }
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
    const item = catalog.find((entry) => entry.id === response.placed.itemId);
    if (item) {
      trackItemGoal("item_move", item);
    }
  }

  async function handleRotateSelected(direction: -1 | 1) {
    if (!selectedPlaced || !ownHome) {
      return;
    }

    const response = await rotatePlacedItem(selectedPlaced.instanceId, selectedPlaced.rotation + direction * Math.PI / 12);
    updatePlacedItem(response.placed);
    if (selectedPlacedCatalogItem) {
      trackItemGoal("item_rotate", selectedPlacedCatalogItem, { direction });
    }
  }

  async function handleScaleSelected(direction: -1 | 1) {
    if (!selectedPlaced || !ownHome) {
      return;
    }

    const currentScale = selectedPlaced.scale ?? 1;
    const nextScale = Math.max(0.5, Math.min(2.5, Number((currentScale + direction * 0.1).toFixed(2))));
    const response = await scalePlacedItem(selectedPlaced.instanceId, nextScale);
    updatePlacedItem(response.placed);
    if (selectedPlacedCatalogItem) {
      trackItemGoal("item_scale", selectedPlacedCatalogItem, { scale: nextScale });
    }
  }

  async function handleSellSelected() {
    if (!selectedPlaced || !ownHome) {
      return;
    }

    const response = await sellPlacedItem(selectedPlaced.instanceId);
    setUser(response.user);
    setHome((current) => current ? { ...current, placedItems: current.placedItems.filter((item) => item.instanceId !== response.placed.instanceId) } : current);
    setSelectedPlacedId("");
    if (selectedPlacedCatalogItem) {
      trackItemGoal("item_sell", selectedPlacedCatalogItem, { refund: response.refund });
    }
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
    if (sceneModeRef.current === "street") {
      await refreshNeighborhood();
    }
    trackGoal("home_style_change", {
      floor_changed: Boolean(nextStyle.floorColor),
      wall_changed: Boolean(nextStyle.wallColor)
    });
  }

  function handleMove(position: { x: number; y: number; z: number; rotation?: number }) {
    socketRef.current?.emit("player:move", position);
  }

  function handleInteract(itemId: string, action: string) {
    const item = catalog.find((entry) => entry.id === itemId);
    trackGoal("object_interaction", {
      item_id: item?.id ?? itemId,
      item_type: item?.type,
      action
    });
    socketRef.current?.emit("world:interact", { itemId, action: item ? `использует ${item.name}` : action });
    showToast(item ? `Вы используете: ${item.name}` : "Взаимодействие");
  }

  async function handleStartExpedition() {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy("start");
    try {
      const response = await startExpedition();
      if (!isCurrentSession(session)) return;
      const currentRunId = expeditionRunRef.current?.id;
      if (currentRunId && currentRunId !== response.run.id) return;
      setExpeditionProfile(response.profile);
      updateExpeditionRun(response.run);
      setCanExtractExpedition(false);
      setShowExpeditionPanel(false);
      if (sceneModeRef.current !== "street") {
        await openNeighborhood();
      }
      if (!isCurrentSession(session) || expeditionRunRef.current?.id !== response.run.id) return;
      showToast(response.partySize > 1
        ? `Групповая экспедиция начата · участников: ${response.partySize}`
        : "Экспедиция начата · выйдите из дома и пройдите через КПП");
      trackGoal("expedition_start", { weapon: response.run.selectedWeapon, party_size: response.partySize });
    } catch (expeditionError) {
      if (isCurrentSession(session)) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось начать экспедицию");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleSelectExpeditionWeapon(weaponId: ExpeditionWeaponId) {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy(`loadout:${weaponId}`);
    try {
      const response = await setExpeditionLoadout(weaponId);
      if (!isCurrentSession(session) || expeditionRunRef.current) return;
      setExpeditionProfile(response.profile);
      showToast(`${response.weapon.name} выбран для следующей вылазки`);
    } catch (expeditionError) {
      if (isCurrentSession(session) && !expeditionRunRef.current) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось изменить оружие");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleEquipExpeditionGear(slot: ExpeditionGearSlot, gearId: ExpeditionGearId | null) {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy(`gear:${slot}`);
    try {
      const response = await equipExpeditionGear(slot, gearId);
      if (!isCurrentSession(session) || expeditionRunRef.current) return;
      setExpeditionProfile(response.profile);
      showToast(response.equipped ? `${response.equipped.name} экипирован` : "Слот экипировки освобождён");
      trackGoal("expedition_gear_equip", { slot, gear: gearId ?? "none" });
    } catch (expeditionError) {
      if (isCurrentSession(session) && !expeditionRunRef.current) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось изменить экипировку");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleBuyExpeditionWeapon(weaponId: ExpeditionWeaponId) {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy(`buy:${weaponId}`);
    try {
      const response = await buyExpeditionWeapon(weaponId);
      if (!isCurrentSession(session) || expeditionRunRef.current) return;
      userRef.current = response.user;
      setUser(response.user);
      setExpeditionProfile(response.profile);
      showToast(`${response.weapon.name} куплен · −${response.spent.toLocaleString("ru-RU")} монет`);
      trackGoal("expedition_weapon_buy", { weapon: weaponId, price: response.spent });
    } catch (expeditionError) {
      if (isCurrentSession(session) && !expeditionRunRef.current) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось купить оружие");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleBuyExpeditionAmmo() {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy("buy:ammo");
    try {
      const response = await buyExpeditionAmmo();
      if (!isCurrentSession(session) || expeditionRunRef.current) return;
      userRef.current = response.user;
      setUser(response.user);
      setExpeditionProfile(response.profile);
      showToast(`Куплено патронов: ${response.purchased.quantity} · −${response.spent.toLocaleString("ru-RU")} монет`);
      trackGoal("expedition_ammo_buy", { quantity: response.purchased.quantity, price: response.spent });
    } catch (expeditionError) {
      if (isCurrentSession(session) && !expeditionRunRef.current) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось купить боеприпасы");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleTraderBuy(itemId: ExpeditionItemId) {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy(`trader:buy:${itemId}`);
    try {
      const response = await buyExpeditionTraderItem(itemId);
      if (!isCurrentSession(session) || expeditionRunRef.current) return;
      userRef.current = response.user;
      setUser(response.user);
      setExpeditionProfile(response.profile);
      showToast(`Куплено: ${EXPEDITION_ITEMS[itemId].name} · −${response.spent.toLocaleString("ru-RU")} монет`);
      trackGoal("expedition_trader_buy", { item: itemId, quantity: response.purchased.quantity, spent: response.spent });
    } catch (expeditionError) {
      if (isCurrentSession(session) && !expeditionRunRef.current) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось купить предмет");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleTraderSell(itemId: ExpeditionItemId) {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy(`trader:sell:${itemId}`);
    try {
      const response = await sellExpeditionTraderItem(itemId);
      if (!isCurrentSession(session) || expeditionRunRef.current) return;
      userRef.current = response.user;
      setUser(response.user);
      setExpeditionProfile(response.profile);
      showToast(`Продано: ${EXPEDITION_ITEMS[itemId].name} · +${response.earned.toLocaleString("ru-RU")} монет`);
      trackGoal("expedition_trader_sell", { item: itemId, quantity: response.sold.quantity, earned: response.earned });
    } catch (expeditionError) {
      if (isCurrentSession(session) && !expeditionRunRef.current) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось продать предмет");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleCraftExpeditionItem(recipeId: ExpeditionRecipeId) {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy(`craft:${recipeId}`);
    try {
      const response = await craftExpeditionItem(recipeId);
      if (!isCurrentSession(session) || expeditionRunRef.current) return;
      setExpeditionProfile(response.profile);
      showToast(`${response.recipe.name}: готово`);
      trackGoal("expedition_craft", { recipe: recipeId });
    } catch (expeditionError) {
      if (isCurrentSession(session) && !expeditionRunRef.current) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось изготовить предмет");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleUpgradeExpeditionSkill(skillId: ExpeditionSkillId) {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy(`skill:${skillId}`);
    try {
      const response = await upgradeExpeditionSkill(skillId);
      if (!isCurrentSession(session) || expeditionRunRef.current) return;
      setExpeditionProfile(response.profile);
      showToast(`${response.skill.name} повышен до ${response.profile.skills[skillId]} уровня`);
      trackGoal("expedition_skill_upgrade", { skill: skillId, level: response.profile.skills[skillId] });
    } catch (expeditionError) {
      if (isCurrentSession(session) && !expeditionRunRef.current) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось повысить навык");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleUpgradeExpeditionWeapon(weaponId: ExpeditionWeaponId, stat: ExpeditionWeaponUpgradeStat) {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy(`weapon-upgrade:${weaponId}:${stat}`);
    try {
      const response = await upgradeExpeditionWeapon(weaponId, stat);
      if (!isCurrentSession(session) || expeditionRunRef.current) return;
      userRef.current = response.user;
      setUser(response.user);
      setExpeditionProfile(response.profile);
      showToast(`${EXPEDITION_WEAPONS[weaponId].name}: модификация установлена · ур. ${response.level}`);
      trackGoal("expedition_weapon_upgrade", { weapon: weaponId, stat, level: response.level, spent: response.spent.coins });
    } catch (expeditionError) {
      if (isCurrentSession(session) && !expeditionRunRef.current) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось улучшить оружие");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleUpgradeExpeditionGear(gearId: ExpeditionGearId) {
    if (expeditionBusy || expeditionRun) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy(`gear-upgrade:${gearId}`);
    try {
      const response = await upgradeExpeditionGear(gearId);
      if (!isCurrentSession(session) || expeditionRunRef.current) return;
      userRef.current = response.user;
      setUser(response.user);
      setExpeditionProfile(response.profile);
      showToast(`${EXPEDITION_GEAR[gearId].name}: усиление ${response.level}/${5}`);
      trackGoal("expedition_gear_upgrade", { gear: gearId, level: response.level, spent: response.spent.coins });
    } catch (expeditionError) {
      if (isCurrentSession(session) && !expeditionRunRef.current) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось усилить экипировку");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleClaimExpeditionQuest(questId: ExpeditionQuestId) {
    if (expeditionBusy) return;
    const session = captureSession();
    if (!session) return;
    setExpeditionBusy(`quest:${questId}`);
    try {
      const response = await claimExpeditionQuest(questId);
      if (!isCurrentSession(session)) return;
      userRef.current = response.user;
      setUser(response.user);
      setExpeditionProfile(response.profile);
      showToast(`${response.quest.name}: награда получена`);
      trackGoal("expedition_quest_claim", { quest: questId });
    } catch (expeditionError) {
      if (isCurrentSession(session)) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось получить награду");
      }
    } finally {
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  async function handleLootExpeditionContainer(containerId: string) {
    const session = captureSession();
    const runId = expeditionRunRef.current?.id;
    if (!session || !runId || pendingContainersRef.current.has(containerId as ExpeditionContainerId)) return;
    const typedContainerId = containerId as ExpeditionContainerId;
    pendingContainersRef.current.add(typedContainerId);
    try {
      const response = await lootExpeditionContainer(typedContainerId);
      if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return;
      setExpeditionProfile(response.profile);
      updateExpeditionRun(response.run);
      const lootLabel = response.loot
        .map((stack) => `${EXPEDITION_ITEMS[stack.itemId].name} ×${stack.quantity}`)
        .join(" · ");
      const coinsLabel = response.coins > 0 ? ` · найдено ${response.coins} монет` : "";
      showToast(`${response.container.name}: ${lootLabel}${coinsLabel}`);
      trackGoal("expedition_container_loot", { container: containerId, items: response.loot.length });
    } catch (expeditionError) {
      if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось обыскать контейнер");
      }
    } finally {
      pendingContainersRef.current.delete(typedContainerId);
    }
  }

  async function handleLootExpeditionEnemy(enemyId: string) {
    const session = captureSession();
    const runId = expeditionRunRef.current?.id;
    const typedEnemyId = enemyId as ExpeditionEnemyId;
    if (!session || !runId || pendingEnemyLootRef.current.has(typedEnemyId)) return;
    pendingEnemyLootRef.current.add(typedEnemyId);
    try {
      const response = await lootExpeditionEnemy(typedEnemyId);
      if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return;
      setExpeditionProfile(response.profile);
      updateExpeditionRun(response.run);
      const recovered = response.loot
        .map((stack) => `${EXPEDITION_ITEMS[stack.itemId].name} ×${stack.quantity}`)
        .join(" · ");
      const coinsLabel = response.coins > 0 ? ` · ${response.coins} монет` : "";
      const weaponLabel = response.carriedWeapon
        ? ` · найдено оружие: ${EXPEDITION_WEAPONS[response.carriedWeapon].name}`
        : response.weaponDrop
          ? " · дубликат оружия разобран на детали"
          : "";
      showToast(`${response.enemy.name} обыскан: ${recovered}${coinsLabel}${weaponLabel}`);
      trackGoal("expedition_enemy_loot", {
        enemy: typedEnemyId,
        items: response.loot.length,
        coins: response.coins,
        weapon: response.carriedWeapon ?? undefined
      });
    } catch (expeditionError) {
      if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось обыскать противника");
      }
    } finally {
      pendingEnemyLootRef.current.delete(typedEnemyId);
    }
  }

  async function handleUseExpeditionBandage() {
    const session = captureSession();
    const runId = expeditionRunRef.current?.id;
    if (!session || !runId || expeditionBusyRef.current || pendingBandageRef.current) return false;
    const playerStatus = expeditionPlayerStatusRef.current;
    if (playerStatus.downed) {
      showToast("Нельзя использовать бинт, пока персонаж тяжело ранен");
      return false;
    }
    if (playerStatus.health >= playerStatus.maxHealth) {
      showToast("Здоровье уже полное");
      return false;
    }
    pendingBandageRef.current = true;
    expeditionBusyRef.current = "bandage";
    setExpeditionBusy("bandage");
    try {
      // Serialize healing with pending damage snapshots. Otherwise an older
      // player-status request could arrive after the bandage and overwrite the
      // restored health even though the item was already consumed.
      const bandageRequest = playerStatusSyncQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return null;
          let localStatus = { ...expeditionPlayerStatusRef.current };
          let serverRun = expeditionRunRef.current;
          if (!serverRun) return null;

          // Damage can arrive while this operation waits behind an older
          // status request. Flush that local deficit before asking the server
          // to consume the bandage, so a full-health server snapshot cannot
          // reject a legitimately injured player.
          if (
            localStatus.health < serverRun.playerHealth
            || localStatus.shield < serverRun.playerShield
            || (localStatus.downed && !serverRun.downedAt)
          ) {
            const statusResponse = await syncExpeditionPlayerStatus({
              health: localStatus.health,
              shield: localStatus.shield,
              downed: localStatus.downed
            });
            if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return null;
            updateExpeditionRun(statusResponse.run);
            serverRun = statusResponse.run;
            lastSubmittedPlayerStatusRef.current = "";
            playerStatusRetryAttemptRef.current = 0;
            if (playerStatusRetryTimerRef.current !== null) {
              window.clearTimeout(playerStatusRetryTimerRef.current);
              playerStatusRetryTimerRef.current = null;
            }
            localStatus = { ...expeditionPlayerStatusRef.current };
          }

          if (localStatus.downed || localStatus.health <= 0) {
            return { kind: "aborted" as const, status: localStatus };
          }
          const serverBaseline = {
            health: serverRun.playerHealth,
            shield: serverRun.playerShield
          };
          const response = await useExpeditionBandage();
          return {
            kind: "completed" as const,
            response,
            serverBaseline,
            observedAfterRequest: { ...expeditionPlayerStatusRef.current }
          };
        });
      playerStatusSyncQueueRef.current = bandageRequest.then(
        () => undefined,
        () => undefined
      );
      const completedBandage = await bandageRequest;
      if (!completedBandage) return false;
      if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return false;
      if (completedBandage.kind === "aborted") {
        pendingBandageRef.current = false;
        handleExpeditionPlayerStatus(completedBandage.status);
        return false;
      }
      const { response, serverBaseline, observedAfterRequest } = completedBandage;
      updateExpeditionRun(response.run);
      const healthLostWhileHealing = Math.max(0, serverBaseline.health - observedAfterRequest.health);
      const shieldLostWhileHealing = Math.max(0, serverBaseline.shield - observedAfterRequest.shield);
      const healedHealth = observedAfterRequest.downed
        ? 0
        : Math.max(0, response.run.playerHealth - healthLostWhileHealing);
      const nextStatus = {
        health: healedHealth,
        maxHealth: response.run.playerMaxHealth,
        shield: Math.max(0, response.run.playerShield - shieldLostWhileHealing),
        downed: observedAfterRequest.downed || healedHealth <= 0
      };
      pendingBandageRef.current = false;
      lastSubmittedPlayerStatusRef.current = "";
      handleExpeditionPlayerStatus(nextStatus);
      setExpeditionHealPulse((current) => current + 1);
      trackGoal("expedition_bandage_use", { heal: response.heal });
      return true;
    } catch (expeditionError) {
      if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось использовать бинт");
      }
      return false;
    } finally {
      pendingBandageRef.current = false;
      if (isCurrentSession(session) && expeditionBusyRef.current === "bandage") {
        expeditionBusyRef.current = "";
        setExpeditionBusy("");
      }
    }
  }

  async function handleUseExpeditionTactical(
    itemId: ExpeditionTacticalId,
    origin: { x: number; z: number },
    targets: ExpeditionTacticalTarget[]
  ) {
    const session = captureSession();
    const runId = expeditionRunRef.current?.id;
    if (!session || !runId || pendingTacticalRef.current || expeditionPlayerStatusRef.current.downed) return false;
    pendingTacticalRef.current = true;
    setExpeditionBusy(`tactical:${itemId}`);
    try {
      const response = await useExpeditionTactical(itemId, origin, targets);
      if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return false;
      setExpeditionProfile(response.profile);
      updateExpeditionRun(response.run);
      const defeated = response.hits.filter((hit) => hit.killed).length;
      const suffix = defeated > 0 ? ` · уничтожено целей: ${defeated}` : "";
      showToast(`${response.item.name} применён${suffix}`);
      trackGoal("expedition_tactical_use", { item: itemId, hits: response.hits.length, kills: defeated });
      return true;
    } catch (expeditionError) {
      if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось использовать предмет");
      }
      return false;
    } finally {
      pendingTacticalRef.current = false;
      if (isCurrentSession(session)) setExpeditionBusy("");
    }
  }

  const handleExpeditionPlayerStatus = useCallback((status: { health: number; maxHealth: number; shield: number; downed: boolean }) => {
    expeditionPlayerStatusRef.current = status;
    setExpeditionPlayerStatus((current) => (
      current.health === status.health
      && current.maxHealth === status.maxHealth
      && current.shield === status.shield
      && current.downed === status.downed
        ? current
        : status
    ));
    const run = expeditionRunRef.current;
    if (!run) return;
    // Damage that happens while a bandage request is in flight is reconciled
    // against the healed server snapshot by handleUseExpeditionBandage.
    if (pendingBandageRef.current) return;
    const needsServerSync = status.health < run.playerHealth
      || status.shield < run.playerShield
      || (status.downed && !run.downedAt);
    if (!needsServerSync) return;
    const signature = `${run.id}:${Math.round(status.health)}:${Math.round(status.shield)}:${status.downed ? 1 : 0}`;
    if (lastSubmittedPlayerStatusRef.current === signature) return;
    lastSubmittedPlayerStatusRef.current = signature;
    const runId = run.id;
    const session = captureSession();
    playerStatusSyncQueueRef.current = playerStatusSyncQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return;
        const response = await syncExpeditionPlayerStatus({
          health: status.health,
          shield: status.shield,
          downed: status.downed
        });
        if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return;
        updateExpeditionRun(response.run);
        const latestLocalStatus = expeditionPlayerStatusRef.current;
        const authoritativeStatus = {
          health: Math.min(response.run.playerHealth, latestLocalStatus.health),
          maxHealth: response.run.playerMaxHealth,
          shield: Math.min(response.run.playerShield, latestLocalStatus.shield),
          downed: Boolean(response.run.downedAt) || latestLocalStatus.downed
        };
        expeditionPlayerStatusRef.current = authoritativeStatus;
        setExpeditionPlayerStatus(authoritativeStatus);
        if (lastSubmittedPlayerStatusRef.current === signature) {
          lastSubmittedPlayerStatusRef.current = "";
        }
        playerStatusRetryAttemptRef.current = 0;
        if (playerStatusRetryTimerRef.current !== null) {
          window.clearTimeout(playerStatusRetryTimerRef.current);
          playerStatusRetryTimerRef.current = null;
        }
      })
      .catch((statusError) => {
        if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
          if (lastSubmittedPlayerStatusRef.current === signature) {
            lastSubmittedPlayerStatusRef.current = "";
          }
          playerStatusRetryAttemptRef.current += 1;
          const retryDelay = Math.min(
            8_000,
            (status.downed ? 400 : 900) * 2 ** Math.min(4, playerStatusRetryAttemptRef.current - 1)
          );
          if (playerStatusRetryTimerRef.current !== null) {
            window.clearTimeout(playerStatusRetryTimerRef.current);
          }
          playerStatusRetryTimerRef.current = window.setTimeout(() => {
            playerStatusRetryTimerRef.current = null;
            if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return;
            expeditionStatusHandlerRef.current({ ...expeditionPlayerStatusRef.current });
          }, retryDelay);
          showToast(statusError instanceof Error ? statusError.message : "Не удалось сохранить состояние персонажа");
        }
      });
  }, []);
  expeditionStatusHandlerRef.current = handleExpeditionPlayerStatus;

  function handleExpeditionShot(hits: ExpeditionHitInput[]) {
    const session = captureSession();
    const runId = expeditionRunRef.current?.id;
    if (!session || !runId) return;

    // Reserve a round immediately so a high-latency connection cannot fire more
    // visual shots than the authoritative expedition backpack contains.
    adjustPendingExpeditionShots(1);

    enemyHitQueueRef.current = enemyHitQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return;
        try {
          const response = await hitExpeditionEnemies(hits);
          if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return;
          setExpeditionProfile(response.profile);
          updateExpeditionRun(response.run);
          for (const result of response.hits) {
            if (!result.killed) continue;
            showToast(`${result.enemy.name} уничтожен · подойдите к останкам и нажмите E · цель ${response.run.objective.hostileKills}/${response.run.objective.requiredHostileKills}`);
            trackGoal("expedition_enemy_kill", { enemy: result.enemy.id, hostile: result.enemy.hostile });
          }
        } catch (expeditionError) {
          const message = expeditionError instanceof Error ? expeditionError.message : "Не удалось подтвердить попадание";
          if (isCurrentSession(session)
            && expeditionRunRef.current?.id === runId
            && !message.includes("уже были побеждены")
            && !message.includes("ещё не готово")) {
            showToast(message);
          }

          // A rejected shot may leave local enemy health ahead of the server.
          // Pull the authoritative snapshot before allowing the next prediction.
          if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
            try {
              const snapshot = await getExpeditionProfile();
              if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
                setExpeditionProfile(snapshot.profile);
                updateExpeditionRun(snapshot.run);
              }
            } catch {
              // The next successful shot/profile refresh will reconcile state.
            }
          }
        } finally {
          if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
            adjustPendingExpeditionShots(-1);
          }
        }
      });
  }

  function adjustPendingExpeditionVehicleHits(delta: number) {
    pendingExpeditionVehicleHitsRef.current = Math.max(0, pendingExpeditionVehicleHitsRef.current + delta);
    setPendingExpeditionVehicleHits(pendingExpeditionVehicleHitsRef.current);
  }

  function handleExpeditionVehicleHit(hits: ExpeditionVehicleHitInput[]) {
    const session = captureSession();
    const runId = expeditionRunRef.current?.id;
    if (!session || !runId || hits.length === 0) return;

    adjustPendingExpeditionVehicleHits(1);
    enemyHitQueueRef.current = enemyHitQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return;
        try {
          const response = await hitExpeditionEnemiesWithVehicle(hits);
          if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return;
          setExpeditionProfile(response.profile);
          updateExpeditionRun(response.run);
          for (const result of response.hits) {
            if (!result.killed) continue;
            showToast(`${result.enemy.name} сбит машиной · останки можно обыскать`);
            trackGoal("expedition_enemy_kill", {
              enemy: result.enemy.id,
              hostile: result.enemy.hostile,
              source: "vehicle"
            });
          }
        } catch (expeditionError) {
          const message = expeditionError instanceof Error
            ? expeditionError.message
            : "Не удалось подтвердить столкновение";
          if (isCurrentSession(session)
            && expeditionRunRef.current?.id === runId
            && !message.includes("ещё не зарегистрировано")) {
            showToast(message);
          }
          if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
            try {
              const snapshot = await getExpeditionProfile();
              if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
                setExpeditionProfile(snapshot.profile);
                updateExpeditionRun(snapshot.run);
              }
            } catch {
              // The next successful impact/profile refresh will reconcile state.
            }
          }
        } finally {
          if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
            adjustPendingExpeditionVehicleHits(-1);
          }
        }
      });
  }

  async function handleExtractExpedition() {
    const session = captureSession();
    const runId = expeditionRunRef.current?.id;
    if (expeditionBusyRef.current || !session || !runId) return;
    if (expeditionPlayerStatusRef.current.downed) {
      showToast("Нельзя эвакуироваться в тяжёлом состоянии");
      return;
    }
    expeditionBusyRef.current = "extract";
    setExpeditionBusy("extract");
    try {
      const response = await extractExpedition();
      if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return;
      userRef.current = response.user;
      setUser(response.user);
      setExpeditionProfile(response.profile);
      updateExpeditionRun(null);
      setCanExtractExpedition(false);
      setWorldRegion("city");
      const weaponText = response.extractedWeapons.length > 0
        ? ` Новое оружие: ${response.extractedWeapons.map((weaponId) => EXPEDITION_WEAPONS[weaponId].name).join(", ")}.`
        : "";
      const reward = response.reward.objectiveCompleted
        ? ` Задание выполнено: +${response.reward.objectiveCoins} монет, +${response.reward.xp} XP.`
        : " Основная цель не завершена, но добыча сохранена.";
      const foundCoins = response.reward.carriedCoins > 0
        ? ` Найдено в рейде: +${response.reward.carriedCoins} монет.`
        : "";
      showToast(`Эвакуация успешна · предметов: ${response.extracted.reduce((total, stack) => total + stack.quantity, 0)}.${foundCoins}${reward}${weaponText}`);
      trackGoal("expedition_extract", {
        objective_complete: response.reward.objectiveCompleted,
        extracted_items: response.extracted.length
      });
    } catch (expeditionError) {
      if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Эвакуация не удалась");
      }
    } finally {
      if (isCurrentSession(session) && expeditionBusyRef.current === "extract") {
        expeditionBusyRef.current = "";
        setExpeditionBusy("");
      }
    }
  }

  async function handleAbandonExpedition(defeated = false) {
    const session = captureSession();
    const runId = expeditionRunRef.current?.id;
    if (expeditionBusyRef.current || !session || !runId) return false;
    expeditionBusyRef.current = "abandon";
    setExpeditionBusy("abandon");
    try {
      const response = await abandonExpedition();
      if (!isCurrentSession(session) || expeditionRunRef.current?.id !== runId) return false;
      setExpeditionProfile(response.profile);
      updateExpeditionRun(null);
      setCanExtractExpedition(false);
      setWorldRegion("city");
      if (!defeated) {
        const lostWeapons = response.lostWeapons.length > 0 ? ` · оружия: ${response.lostWeapons.length}` : "";
        const lostCoins = response.lostCoins > 0 ? ` · монет: ${response.lostCoins}` : "";
        showToast(`Вылазка прервана · потеряно предметов: ${response.lost.reduce((total, stack) => total + stack.quantity, 0)}${lostCoins}${lostWeapons}`);
      }
      trackGoal(defeated ? "expedition_defeat" : "expedition_abandon", { lost_items: response.lost.length });
      return true;
    } catch (expeditionError) {
      if (isCurrentSession(session) && expeditionRunRef.current?.id === runId) {
        showToast(expeditionError instanceof Error ? expeditionError.message : "Не удалось завершить вылазку");
      }
      return false;
    } finally {
      if (isCurrentSession(session) && expeditionBusyRef.current === "abandon") {
        expeditionBusyRef.current = "";
        setExpeditionBusy("");
      }
    }
  }

  function handleWorldRegionChange(region: WorldRegion) {
    setWorldRegion(region);
  }

  function handlePartyInvite(username: string) {
    socketRef.current?.emit("party:invite", { username });
  }

  function handlePartyAccept(partyId: string) {
    socketRef.current?.emit("party:accept", { partyId });
  }

  function handlePartyDecline(partyId: string) {
    socketRef.current?.emit("party:decline", { partyId });
  }

  function handlePartyLeave() {
    socketRef.current?.emit("party:leave");
  }

  function sendChat() {
    if (!chatText.trim()) {
      return;
    }
    socketRef.current?.emit("chat:send", chatText);
    trackGoal("chat_send", { own_home: ownHome, length: chatText.trim().length });
    setChatText("");
  }

  function logout() {
    sessionVersionRef.current += 1;
    userRef.current = null;
    stopVoice();
    trackGoal("auth_logout");
    setToken(null);
    disconnectSocket();
    setUser(null);
    setHome(null);
    setHomeOwner("");
    setNeighborhood(null);
    activeInteriorOwnerRef.current = null;
    setActiveInteriorOwner(null);
    setNeighborhoodVisitRequest(undefined);
    setSceneMode("home");
    sceneModeRef.current = "home";
    streetPositionRef.current = undefined;
    setExpeditionProfile(null);
    updateExpeditionRun(null);
    expeditionBusyRef.current = "";
    setExpeditionBusy("");
    setShowExpeditionPanel(false);
    setShowUtilityPanel(false);
    setWorldRegion("city");
    setCanExtractExpedition(false);
    setParty(null);
    setPartyInvites([]);
    setPartyOutgoingInvites([]);
    setPartyOnlinePlayers([]);
    enemyHitQueueRef.current = Promise.resolve();
    pendingExpeditionVehicleHitsRef.current = 0;
    setPendingExpeditionVehicleHits(0);
    pendingContainersRef.current.clear();
  }

  function showToast(text: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(text);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast("");
    }, 2300);
  }

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    if (playerStatusRetryTimerRef.current !== null) window.clearTimeout(playerStatusRetryTimerRef.current);
  }, []);

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
  const selectedScale = selectedPlaced ? selectedPlaced.scale ?? 1 : 1;
  const ownNeighborhoodResident = neighborhood?.residents.find((resident) => resident.username === user?.username);
  const voiceLabel = voiceState === "connecting" ? "Connecting" : voiceState === "on" ? "Voice on" : "Voice";
  const gameAssetPlan = useMemo(
    () => createGameAssetPlan(catalog, home, neighborhood),
    [catalog, home, neighborhood]
  );

  if (!user || !home) {
    return <AuthScreen onSubmit={handleAuth} error={error} />;
  }

  const insideOwnHome = sceneMode === "street" && activeInteriorOwner === user.username;
  const showNeighborhoodPanel = showUtilityPanel && sceneMode === "street" && neighborhood !== null && !insideOwnHome;
  const showExpeditionModal = showExpeditionPanel && expeditionProfile !== null;
  const showWideSidePanel = showUtilityPanel;
  const canEditHome = ownHome && (sceneMode === "home" || insideOwnHome);
  const seamlessLocationTitle = activeInteriorOwner === user.username
    ? `Мой дом · ${ownNeighborhoodResident?.houseLevel ?? 1} ур.`
    : activeInteriorOwner
      ? `В гостях у ${activeInteriorOwner}`
      : "Улица · рядом с моим домом";
  const expeditionLocationTitle: Record<WorldRegion, string> = {
    city: "Город",
    checkpoint: "Северный КПП",
    forest: "Хвойный рубеж",
    depot: "Заброшенное депо",
    quarry: "Красный карьер",
    ruins: "Старый город",
    marsh: "Туманные топи",
    relay: "Релейная низина",
    fortress: "Небесная крепость",
    iceRidge: "Ледяной хребет",
    reactor: "Реактор Пустоты"
  };
  const appShellClassName = [
    "app-shell",
    `region-${worldRegion}`,
    hudPreferences.locationCard ? "" : "hud-location-hidden",
    hudPreferences.weaponPanel ? "" : "hud-weapon-hidden",
    hudPreferences.controlsHints ? "" : "hud-controls-hidden"
  ].filter(Boolean).join(" ");

  return (
    <GameAssetGate plan={gameAssetPlan} onExit={logout}>
      <main className={appShellClassName}>
      <section className="topbar">
        <div className="brand"><Home size={20} /> AnimeGame</div>
        <div className="home-title">
          {sceneMode === "street" ? (
            <>
              <span><MapIcon size={17} /> {seamlessLocationTitle}</span>
              {insideOwnHome ? (
                <button
                  className={buildMode ? "ghost-button active-build" : "ghost-button"}
                  onClick={() => {
                    const nextBuildMode = !buildMode;
                    setBuildMode(nextBuildMode);
                    trackGoal("build_mode", { enabled: nextBuildMode });
                    setSelectedPlacedId("");
                  }}
                >
                  <Hammer size={16} /> Обустроить
                </button>
              ) : null}
            </>
          ) : (
            <>
              <span>{ownHome ? "Мой дом" : `В гостях у ${homeOwner}`}</span>
              <button className="ghost-button street-button" onClick={openNeighborhood}><CarFront size={16} /> К участку</button>
              {!ownHome ? <button className="ghost-button" onClick={goOwnHome}><DoorOpen size={16} /> Домой</button> : null}
              {ownHome ? (
                <button
                  className={buildMode ? "ghost-button active-build" : "ghost-button"}
                  onClick={() => {
                    const nextBuildMode = !buildMode;
                    setBuildMode(nextBuildMode);
                    trackGoal("build_mode", { enabled: nextBuildMode });
                    setSelectedPlacedId("");
                  }}
                >
                  <Hammer size={16} /> Обустроить
                </button>
              ) : null}
            </>
          )}
        </div>
        <button
          className={showUtilityPanel ? "ghost-button utility-toggle active" : "ghost-button utility-toggle"}
          type="button"
          onClick={() => {
            setShowUtilityPanel((current) => !current);
            setShowExpeditionPanel(false);
          }}
          title={sceneMode === "street" ? "Город, соседи и экономика" : "Магазин, вещи и гости"}
        >
          <ShoppingBag size={17} /> {sceneMode === "street" ? "Город" : "Меню"}
        </button>
        <button
          className={showExpeditionModal ? "ghost-button expedition-toggle active" : "ghost-button expedition-toggle"}
          type="button"
          onClick={() => showExpeditionModal ? setShowExpeditionPanel(false) : openExpeditionPanel(expeditionRun ? "raid" : "equipment")}
          title="Открыть центр подготовки AEGIS · I — инвентарь"
        >
          <Crosshair size={17} /> AEGIS {expeditionRun ? "· рейд" : ""}
        </button>
        <div className="wallet"><Coins size={18} /> {user.coins}</div>
        <button className="icon-button" onClick={logout} title="Выйти"><LogOut size={18} /></button>
      </section>

      <section className={showWideSidePanel ? "game-layout street-layout" : "game-layout"}>
        <div className="scene-wrap">
          {sceneMode === "street" && neighborhood ? (
            <NeighborhoodScene
              user={user}
              home={home}
              catalog={catalog}
              residents={neighborhood.residents}
              remotePlayers={remotePlayers}
              initialPosition={streetPositionRef.current}
              buildMode={buildMode && insideOwnHome}
              selectedPlacedId={selectedPlacedId}
              visitRequest={neighborhoodVisitRequest}
              onMove={handleNeighborhoodMove}
              onInteriorChange={handleInteriorChange}
              onInteract={handleInteract}
              onSelectPlaced={setSelectedPlacedId}
              onBuildMove={handleBuildMove}
              onToast={showToast}
              expeditionActive={Boolean(expeditionRun)}
              expeditionWeapon={expeditionRun?.selectedWeapon}
              expeditionSkills={expeditionProfile?.skills}
              expeditionGear={expeditionProfile?.equippedGear}
              expeditionWeaponUpgrades={expeditionProfile?.weaponUpgrades}
              expeditionGearUpgrades={expeditionProfile?.gearUpgrades}
              expeditionTacticalCounts={expeditionRun
                ? Object.fromEntries([...EXPEDITION_GRENADE_IDS, ...EXPEDITION_ARTIFACT_IDS].map((itemId) => [
                    itemId,
                    expeditionRun.backpack.reduce((total, stack) => stack.itemId === itemId ? total + stack.quantity : total, 0)
                  ]))
                : undefined}
              expeditionSupportRobotUntil={expeditionRun?.supportRobotUntil}
              expeditionScannerUntil={expeditionRun?.scannerUntil}
              lootedContainerIds={expeditionRun?.lootedContainerIds ?? []}
              lootedEnemyIds={expeditionRun?.lootedEnemyIds ?? []}
              defeatedEnemyIds={expeditionRun?.killedEnemyIds ?? []}
              enemyHealth={expeditionRun?.enemyHealth}
              expeditionSyncPending={pendingExpeditionShots > 0 || pendingExpeditionVehicleHits > 0}
              expeditionAmmo={expeditionRun
                ? Math.max(0, expeditionRun.backpack.reduce((total, stack) => (
                  stack.itemId === "ammo" ? total + stack.quantity : total
                ), 0) - pendingExpeditionShots)
                : undefined}
              bandageCount={expeditionRun?.backpack.reduce((total, stack) => (
                stack.itemId === "bandage" ? total + stack.quantity : total
              ), 0) ?? 0}
              shieldCount={expeditionRun?.backpack.reduce((total, stack) => (
                stack.itemId === "shield-module" ? total + stack.quantity : total
              ), 0) ?? 0}
              expeditionHealPulse={expeditionHealPulse}
              expeditionPlayerHealth={expeditionRun?.playerHealth}
              expeditionPlayerShield={expeditionRun?.playerShield}
              expeditionDownedAt={expeditionRun?.downedAt}
              expeditionBleedOutAt={expeditionRun?.bleedOutAt}
              onWorldRegionChange={handleWorldRegionChange}
              onExtractionAvailabilityChange={setCanExtractExpedition}
              onLootContainer={(containerId) => void handleLootExpeditionContainer(containerId)}
              onLootEnemy={(enemyId) => void handleLootExpeditionEnemy(enemyId)}
              onUseBandage={handleUseExpeditionBandage}
              onUseTactical={handleUseExpeditionTactical}
              onOpenExpeditionPanel={(tab) => {
                openExpeditionPanel(tab === "gear" ? "equipment" : tab ?? "raid");
              }}
              onExpeditionShot={handleExpeditionShot}
              onExpeditionVehicleHit={handleExpeditionVehicleHit}
              onExtract={() => void handleExtractExpedition()}
              onPlayerDefeated={() => handleAbandonExpedition(true)}
              onPlayerSurrender={() => handleAbandonExpedition(true)}
              onExpeditionStatusChange={handleExpeditionPlayerStatus}
            />
          ) : (
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
          )}
          {expeditionProfile ? (
            <CompactExpeditionHud
              run={expeditionRun}
              health={expeditionPlayerStatus.health}
              maxHealth={expeditionPlayerStatus.maxHealth}
              location={expeditionLocationTitle[worldRegion]}
              inviteCount={partyInvites.filter((invite) => invite.expiresAt > Date.now()).length}
              preferences={hudPreferences}
              onPreferencesChange={setHudPreferences}
              onOpen={openExpeditionPanel}
            />
          ) : null}
          {sceneMode === "home" || insideOwnHome ? (
            <div className={sceneMode === "street" ? "scene-hint street-scene-hint" : "scene-hint"}>
              {buildMode && canEditHome
                ? "Стройка: выберите предмет и кликните по полу. Правая кнопка двигает камеру."
                : insideOwnHome
                  ? "Вы внутри дома. Пройдите через открытую дверь, чтобы выйти прямо на улицу."
                  : "Клик по полу: идти. Клик по предмету: взаимодействовать."}
            </div>
          ) : null}
          {buildMode && canEditHome ? (
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
              <button onClick={() => handleScaleSelected(-1)} disabled={!selectedPlaced || selectedScale <= 0.5} title="Scale down">
                <Minus size={16} /> Scale
              </button>
              <button onClick={() => handleScaleSelected(1)} disabled={!selectedPlaced || selectedScale >= 2.5} title="Scale up">
                <Plus size={16} /> {Math.round(selectedScale * 100)}%
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
          {toast ? <div className="toast" role="status" aria-live="polite">{toast}</div> : null}
        </div>

        {showUtilityPanel ? <aside className={showNeighborhoodPanel ? "side-panel neighborhood-side-panel utility-drawer" : "side-panel utility-drawer"}>
          {showNeighborhoodPanel && neighborhood ? (
            <NeighborhoodPanel
              user={user}
              neighborhood={neighborhood}
              activities={activities}
              busyAction={neighborhoodBusy}
              onEarn={handleEarn}
              onClaimIncome={handleClaimIncome}
              onUpgradeCareer={handleUpgradeCareer}
              onUpgradeHouse={handleUpgradeHouse}
              onVisit={visit}
            />
          ) : (
            <>
          <nav className="tabs">
            <button className={tab === "shop" ? "active" : ""} onClick={() => setTab("shop")}><ShoppingBag size={17} /> Магазин</button>
            <button className={tab === "work" ? "active" : ""} onClick={() => setTab("work")}><Hammer size={17} /> Работа</button>
            <button className={tab === "visit" ? "active" : ""} onClick={() => setTab("visit")}><Users size={17} /> Гости</button>
            <button className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}><Shirt size={17} /> Вещи</button>
            {user.isAdmin ? <button className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}><Shield size={17} /> Admin</button> : null}
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
                  const lockedOwned = owned && !selectable;
                  const unaffordable = !owned && user.coins < item.price;
                  const cardClassName = [
                    "shop-card",
                    owned ? "owned" : "",
                    equipped ? "equipped" : "",
                    unaffordable ? "unaffordable" : ""
                  ].filter(Boolean).join(" ");
                  return (
                    <button
                      key={item.id}
                      className={cardClassName}
                      onClick={() => handleBuy(item.id)}
                      disabled={lockedOwned || unaffordable}
                    >
                      <span className="item-emoji">{item.emoji}</span>
                      <span className="item-name">{item.name}</span>
                      {equipped ? <span className="item-meta equipped">{removableEquipped ? "снять" : "выбрано"}</span> : null}
                      <span className="item-meta">
                        {owned
                          ? selectable ? "выбрать" : "куплено"
                          : unaffordable
                            ? `не хватает ${(item.price - user.coins).toLocaleString("ru-RU")}`
                            : `${rarityLabel(item.rarity)} · ${item.price.toLocaleString("ru-RU")} монет`}
                      </span>
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
                    <button
                      key={`${item.id}-${index}`}
                      className={placeable ? "shop-card" : "shop-card unavailable"}
                      onClick={() => placeable && handlePlace(item.id)}
                      disabled={!placeable}
                    >
                      <span className="item-emoji">{item.emoji}</span>
                      <span className="item-name">{item.name}</span>
                      <span className="item-meta">{placeable ? "поставить дома" : item.type}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {tab === "admin" && user.isAdmin ? (
            <div className="panel-body admin-body">
              <AdminPanel
                currentUser={user}
                onCatalogUpdate={setCatalog}
                onActivitiesUpdate={setActivities}
                onCurrentUserUpdate={setUser}
                onToast={showToast}
              />
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
            </>
          )}
        </aside> : null}
      </section>
      {showExpeditionModal && expeditionProfile ? (
        <div className="aegis-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowExpeditionPanel(false);
        }}>
          <section className="aegis-modal-shell" role="dialog" aria-modal="true" aria-label="Центр подготовки AEGIS">
            <ExpeditionPanel
              profile={expeditionProfile}
              run={expeditionRun}
              currentUsername={user.username}
              party={party}
              invites={partyInvites.filter((invite) => invite.expiresAt > Date.now())}
              outgoingInvites={partyOutgoingInvites.filter((invite) => invite.expiresAt > Date.now())}
              canExtract={sceneMode === "street" && canExtractExpedition}
              coins={user.coins}
              onlinePlayers={partyOnlinePlayers}
              busy={Boolean(expeditionBusy)}
              onStart={() => void handleStartExpedition()}
              onExtract={() => void handleExtractExpedition()}
              onAbandon={() => void handleAbandonExpedition()}
              onSelectWeapon={(weaponId) => void handleSelectExpeditionWeapon(weaponId)}
              onBuyWeapon={(weaponId) => void handleBuyExpeditionWeapon(weaponId)}
              onBuyAmmo={() => void handleBuyExpeditionAmmo()}
              onTraderBuy={(itemId) => void handleTraderBuy(itemId)}
              onTraderSell={(itemId) => void handleTraderSell(itemId)}
              onUseBandage={() => void handleUseExpeditionBandage()}
              playerHealth={expeditionPlayerStatus.health}
              playerMaxHealth={expeditionPlayerStatus.maxHealth}
              playerDowned={expeditionPlayerStatus.downed}
              onCraft={(recipeId) => void handleCraftExpeditionItem(recipeId)}
              onUpgradeSkill={(skillId) => void handleUpgradeExpeditionSkill(skillId)}
              onUpgradeWeapon={(weaponId, stat) => void handleUpgradeExpeditionWeapon(weaponId, stat)}
              onUpgradeGear={(gearId) => void handleUpgradeExpeditionGear(gearId)}
              onClaimQuest={(questId) => void handleClaimExpeditionQuest(questId)}
              onEquipGear={(slot, gearId) => void handleEquipExpeditionGear(slot, gearId)}
              requestedTab={requestedExpeditionTab}
              requestedTabRevision={requestedExpeditionTabRevision}
              onClose={() => setShowExpeditionPanel(false)}
              onInvite={handlePartyInvite}
              onAcceptInvite={handlePartyAccept}
              onDeclineInvite={handlePartyDecline}
              onLeaveParty={handlePartyLeave}
            />
          </section>
        </div>
      ) : null}
      </main>
    </GameAssetGate>
  );
}
