import { useGLTF } from "@react-three/drei";
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode
} from "react";
import { CORE_GAME_MODEL_URLS } from "../game/combat";
import { OUTLAND_MODEL_URLS } from "../game/outlands";
import type { CatalogItem, HomeState, NeighborhoodState, PublicUser } from "../types";

type ManifestFile = {
  url: string;
  bytes: number | null;
};

type ManifestRoot = {
  complete: boolean;
  files: ManifestFile[];
};

type GameAssetManifest = {
  version: number;
  revision: string;
  roots: Record<string, ManifestRoot>;
};

type ResolvedFile = {
  key: string;
  url: string;
  bytes: number;
};

export type GameAssetPlan = {
  downloadRoots: string[];
  warmupRoots: string[];
  signature: string;
};

type LoaderPhase = "discovering" | "downloading" | "preparing" | "ready" | "error";

type LoaderProgress = {
  phase: LoaderPhase;
  loadedBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  currentUrl: string;
  currentFileLoaded: number;
  currentFileTotal: number;
  warmLoaded: number;
  warmTotal: number;
  error?: string;
};

type GameAssetGateProps = {
  plan: GameAssetPlan;
  children: ReactNode;
  onExit: () => void;
};

const MANIFEST_URL = "/assets/game-asset-manifest.json";
const MANIFEST_REVISION_STORAGE_KEY = "animegame.asset-manifest-revision";
const DOWNLOAD_CONCURRENCY = 4;
const WARMUP_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 45_000;
const EMPTY_PROGRESS: LoaderProgress = {
  phase: "discovering",
  loadedBytes: 0,
  totalBytes: 0,
  completedFiles: 0,
  totalFiles: 0,
  currentUrl: "",
  currentFileLoaded: 0,
  currentFileTotal: 0,
  warmLoaded: 0,
  warmTotal: 0
};

const downloadedFiles = new Set<string>();
const downloadedRoots = new Set<string>();
const rootFileKeys = new Map<string, string[]>();
const warmedRoots = new Set<string>();
const warmedRootSources = new Map<string, string>();
let manifestPromise: Promise<GameAssetManifest> | undefined;
let activeManifestRevision = "";

function canonicalUrl(url: string) {
  return new URL(url, window.location.href).href;
}

function manifestKey(url: string) {
  return new URL(url, window.location.href).pathname;
}

function preferredConcurrency(desktop: number) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return window.matchMedia("(max-width: 700px)").matches || connection?.saveData ? 1 : desktop;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  parentSignal?: AbortSignal,
  timeoutMs = FETCH_TIMEOUT_MS
) {
  const controller = new AbortController();
  let timedOut = false;
  const handleParentAbort = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener("abort", handleParentAbort, { once: true });
  }
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error(`Превышено время ожидания файла ${assetName(url)}`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", handleParentAbort);
  }
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  url: string
) {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          void reader.cancel().catch(() => undefined);
          reject(new Error(`Загрузка файла ${assetName(url)} остановилась`));
        }, FETCH_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
    }
  }
}

async function readResponseBytes(response: Response, url: string) {
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await readStreamChunk(reader, url);
    if (chunk.done) {
      break;
    }
    chunks.push(chunk.value);
    totalBytes += chunk.value.byteLength;
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function storedManifestRevision() {
  try {
    return window.localStorage.getItem(MANIFEST_REVISION_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberManifestRevision(revision: string) {
  try {
    window.localStorage.setItem(MANIFEST_REVISION_STORAGE_KEY, revision);
  } catch {
    // The HTTP cache still works when storage is unavailable.
  }
}

function addUrl(target: Set<string>, url?: string) {
  const trimmed = url?.trim();
  if (trimmed) {
    target.add(trimmed);
  }
}

function planHash(downloadRoots: string[], warmupRoots: string[]) {
  let hash = 2166136261;
  for (const value of [...downloadRoots, "|", ...warmupRoots]) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${downloadRoots.length}-${warmupRoots.length}-${(hash >>> 0).toString(36)}`;
}

export function createGameAssetPlan(
  catalog: CatalogItem[],
  home: HomeState | null,
  neighborhood: NeighborhoodState | null
): GameAssetPlan {
  const downloadRoots = new Set<string>();
  const warmupRoots = new Set<string>();
  const catalogById = new Map(catalog.map((item) => [item.id, item]));

  for (const url of CORE_GAME_MODEL_URLS) {
    addUrl(downloadRoots, url);
    addUrl(warmupRoots, url);
  }

  for (const url of OUTLAND_MODEL_URLS) {
    addUrl(downloadRoots, url);
    addUrl(warmupRoots, url);
  }

  for (const item of catalog) {
    addUrl(downloadRoots, item.modelUrl);
    addUrl(downloadRoots, item.clothingModelUrl);

    if (item.type === "character" || item.type === "pet") {
      addUrl(warmupRoots, item.modelUrl);
    }
    if (item.clothingModelUrl) {
      addUrl(warmupRoots, item.clothingModelUrl);
    }
  }

  const warmCatalogItem = (itemId?: string) => {
    if (!itemId) {
      return;
    }
    const item = catalogById.get(itemId);
    addUrl(warmupRoots, item?.modelUrl);
    addUrl(warmupRoots, item?.clothingModelUrl);
  };

  const warmAvatar = (avatar?: PublicUser["avatar"]) => {
    warmCatalogItem(avatar?.character);
    warmCatalogItem(avatar?.outfit);
    warmCatalogItem(avatar?.hair);
    warmCatalogItem(avatar?.pet);
  };

  if (home) {
    warmAvatar(home.avatar);
    for (const placedItem of home.placedItems) {
      warmCatalogItem(placedItem.itemId);
    }
  }

  for (const resident of neighborhood?.residents ?? []) {
    warmAvatar(resident.avatar);
    for (const placedItem of resident.placedItems) {
      warmCatalogItem(placedItem.itemId);
    }
  }

  const sortedDownloads = [...downloadRoots].sort();
  const sortedWarmups = [...warmupRoots].sort();
  return {
    downloadRoots: sortedDownloads,
    warmupRoots: sortedWarmups,
    signature: planHash(sortedDownloads, sortedWarmups)
  };
}

async function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetchWithTimeout(MANIFEST_URL, { cache: "no-store" }, undefined, 30_000)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Манифест моделей недоступен (${response.status})`);
        }
        const manifest = JSON.parse(
          new TextDecoder().decode(await readResponseBytes(response, MANIFEST_URL))
        ) as GameAssetManifest;
        if (manifest.version !== 1 || !manifest.roots || Array.isArray(manifest.roots) || typeof manifest.revision !== "string") {
          throw new Error("Манифест моделей имеет неверный формат");
        }
        if (activeManifestRevision && activeManifestRevision !== manifest.revision) {
          for (const url of warmedRootSources.values()) {
            useGLTF.clear(url);
          }
          downloadedFiles.clear();
          downloadedRoots.clear();
          rootFileKeys.clear();
          warmedRoots.clear();
          warmedRootSources.clear();
        }
        activeManifestRevision = manifest.revision;
        return manifest;
      })
      .catch((error) => {
        manifestPromise = undefined;
        throw error;
      });
  }
  return manifestPromise;
}

async function responseSize(url: string, signal: AbortSignal) {
  const head = await fetchWithTimeout(url, { method: "HEAD", cache: "no-store" }, signal);
  if (head.ok) {
    const contentLengthHeader = head.headers.get("content-length");
    const contentLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength >= 0) {
      return contentLength;
    }
  }

  const response = await fetchWithTimeout(url, { cache: "force-cache" }, signal);
  if (!response.ok) {
    throw new Error(`Не удалось открыть ${assetName(url)} (${response.status})`);
  }
  return (await readResponseBytes(response, url)).byteLength;
}

async function discoverUnlistedRoot(rootUrl: string, signal: AbortSignal): Promise<ResolvedFile[]> {
  const rootAbsolute = canonicalUrl(rootUrl);
  const root = new URL(rootAbsolute);
  const dependencyUrls = new Set<string>();
  let rootBytes: number;

  if (root.pathname.toLowerCase().endsWith(".gltf")) {
    const response = await fetchWithTimeout(rootAbsolute, { cache: "force-cache" }, signal);
    if (!response.ok) {
      throw new Error(`Не удалось открыть ${assetName(rootUrl)} (${response.status})`);
    }
    const sourceBytes = await readResponseBytes(response, rootAbsolute);
    const source = new TextDecoder().decode(sourceBytes);
    rootBytes = sourceBytes.byteLength;
    const gltf = JSON.parse(source) as {
      buffers?: Array<{ uri?: string }>;
      images?: Array<{ uri?: string }>;
    };
    for (const dependency of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (dependency.uri && !dependency.uri.startsWith("data:")) {
        dependencyUrls.add(new URL(dependency.uri, rootAbsolute).href);
      }
    }
  } else {
    rootBytes = await responseSize(rootAbsolute, signal);
  }

  const dependencies = await Promise.all([...dependencyUrls].map(async (url) => ({
    key: canonicalUrl(url),
    url,
    bytes: await responseSize(url, signal)
  })));
  return [{ key: rootAbsolute, url: rootUrl, bytes: rootBytes }, ...dependencies];
}

async function resolveRootFiles(
  rootUrl: string,
  manifestRoots: Map<string, ManifestRoot>,
  signal: AbortSignal
): Promise<ResolvedFile[]> {
  const rootEntry = manifestRoots.get(manifestKey(rootUrl));
  if (!rootEntry) {
    return discoverUnlistedRoot(rootUrl, signal);
  }

  const missingFile = rootEntry.files.find((file) => file.bytes === null);
  if (!rootEntry.complete || missingFile) {
    throw new Error(`Для модели ${assetName(rootUrl)} отсутствует файл ${assetName(missingFile?.url ?? rootUrl)}`);
  }

  const rootPath = manifestKey(rootUrl);
  return rootEntry.files.map((file) => {
    const url = manifestKey(file.url) === rootPath ? rootUrl : file.url;
    return {
      key: canonicalUrl(url),
      url,
      bytes: file.bytes as number
    };
  });
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
  onFirstError?: () => void
) {
  let cursor = 0;
  let firstError: unknown;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (firstError === undefined) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      try {
        await task(items[index]);
      } catch (error) {
        if (firstError === undefined) {
          firstError = error;
          onFirstError?.();
        }
      }
    }
  });
  await Promise.all(workers);
  if (firstError !== undefined) {
    throw firstError;
  }
}

async function downloadPlan(
  plan: GameAssetPlan,
  signal: AbortSignal,
  onProgress: (progress: LoaderProgress) => void,
  forceRefresh: boolean
) {
  onProgress({ ...EMPTY_PROGRESS, phase: "discovering" });
  const manifest = await loadManifest();
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const manifestRoots = new Map(
    Object.entries(manifest.roots).map(([url, root]) => [manifestKey(url), root])
  );
  const requestCache: RequestCache = !forceRefresh && storedManifestRevision() === manifest.revision
    ? "force-cache"
    : "reload";
  const rootFiles = await Promise.all(
    plan.downloadRoots.map((root) => resolveRootFiles(root, manifestRoots, signal))
  );
  plan.downloadRoots.forEach((root, index) => {
    rootFileKeys.set(canonicalUrl(root), rootFiles[index].map((file) => file.key));
  });
  const fileMap = new Map<string, ResolvedFile>();
  for (const file of rootFiles.flat()) {
    const previous = fileMap.get(file.key);
    if (!previous || file.bytes > previous.bytes) {
      fileMap.set(file.key, file);
    }
  }

  const files = [...fileMap.values()].sort((left, right) => right.bytes - left.bytes || left.url.localeCompare(right.url));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const pendingFiles = files.filter((file) => !downloadedFiles.has(file.key));
  let loadedBytes = files.reduce((sum, file) => sum + (downloadedFiles.has(file.key) ? file.bytes : 0), 0);
  let completedFiles = files.length - pendingFiles.length;
  const activeFiles = new Map<string, { file: ResolvedFile; loaded: number }>();
  let latestFileKey = "";
  let lastPublishAt = 0;

  const publish = (force = false) => {
    if (signal.aborted) {
      return;
    }
    const now = performance.now();
    if (!force && now - lastPublishAt < 45) {
      return;
    }
    lastPublishAt = now;
    const current = activeFiles.get(latestFileKey)
      ?? (activeFiles.values().next().value as { file: ResolvedFile; loaded: number } | undefined);
    onProgress({
      ...EMPTY_PROGRESS,
      phase: "downloading",
      loadedBytes: Math.min(loadedBytes, totalBytes),
      totalBytes,
      completedFiles,
      totalFiles: files.length,
      currentUrl: current?.file.url ?? "",
      currentFileLoaded: current ? Math.min(current.loaded, current.file.bytes) : 0,
      currentFileTotal: current?.file.bytes ?? 0
    });
  };

  publish(true);
  const batchController = new AbortController();
  const abortBatch = () => batchController.abort();
  if (signal.aborted) {
    batchController.abort();
  } else {
    signal.addEventListener("abort", abortBatch, { once: true });
  }
  try {
    await runConcurrent(pendingFiles, preferredConcurrency(DOWNLOAD_CONCURRENCY), async (file) => {
      if (batchController.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const active = { file, loaded: 0 };
      activeFiles.set(file.key, active);
      latestFileKey = file.key;
      publish(true);

      const response = await fetchWithTimeout(file.url, { cache: requestCache }, batchController.signal);
      if (!response.ok) {
        throw new Error(`Не удалось скачать ${assetName(file.url)} (${response.status})`);
      }

      if (response.body) {
        const reader = response.body.getReader();
        const cancelReader = () => void reader.cancel().catch(() => undefined);
        batchController.signal.addEventListener("abort", cancelReader, { once: true });
        try {
          while (true) {
            const chunk = await readStreamChunk(reader, file.url);
            if (chunk.done) {
              break;
            }
            const previouslyCounted = Math.min(active.loaded, file.bytes);
            active.loaded += chunk.value.byteLength;
            loadedBytes += Math.min(active.loaded, file.bytes) - previouslyCounted;
            latestFileKey = file.key;
            publish();
          }
        } finally {
          batchController.signal.removeEventListener("abort", cancelReader);
        }
      } else {
        const body = await response.arrayBuffer();
        active.loaded = body.byteLength;
        loadedBytes += Math.min(body.byteLength, file.bytes);
      }

      if (active.loaded !== file.bytes) {
        throw new Error(`Размер файла ${assetName(file.url)} не совпадает с манифестом`);
      }
      downloadedFiles.add(file.key);
      completedFiles += 1;
      activeFiles.delete(file.key);
      if (latestFileKey === file.key) {
        latestFileKey = activeFiles.keys().next().value ?? "";
      }
      publish(true);
    }, abortBatch);
  } finally {
    signal.removeEventListener("abort", abortBatch);
  }

  for (const root of plan.downloadRoots) {
    downloadedRoots.add(canonicalUrl(root));
  }
  rememberManifestRevision(manifest.revision);

  const pendingWarmups = plan.warmupRoots.filter((root) => !warmedRoots.has(canonicalUrl(root)));
  onProgress({
    ...EMPTY_PROGRESS,
    phase: "preparing",
    loadedBytes: totalBytes,
    totalBytes,
    completedFiles: files.length,
    totalFiles: files.length,
    warmLoaded: 0,
    warmTotal: pendingWarmups.length
  });
}

function assetName(url: string) {
  try {
    const pathname = new URL(url, window.location.href).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).pop() ?? pathname);
  } catch {
    return url;
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 Б";
  }
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

function WarmAsset({ url, onLoaded }: { url: string; onLoaded: (url: string) => void }) {
  useGLTF(url);
  useEffect(() => {
    onLoaded(url);
  }, [onLoaded, url]);
  return null;
}

class WarmupErrorBoundary extends Component<{
  url: string;
  onError: (url: string, error: Error) => void;
  children: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(this.props.url, error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function LoaderScreen({
  progress,
  onRetry,
  onExit
}: {
  progress: LoaderProgress;
  onRetry: () => void;
  onExit: () => void;
}) {
  const downloadRatio = progress.totalBytes > 0 ? progress.loadedBytes / progress.totalBytes : 0;
  const warmRatio = progress.warmTotal > 0 ? progress.warmLoaded / progress.warmTotal : 1;
  const percent = progress.phase === "preparing"
    ? Math.round(94 + warmRatio * 6)
    : Math.round(Math.max(0, Math.min(1, downloadRatio)) * 94);
  const phaseLabel = progress.phase === "discovering"
    ? "Собираем список моделей…"
    : progress.phase === "preparing"
      ? "Готовим модели для сцены…"
      : progress.phase === "error"
        ? "Загрузка остановлена"
        : "Скачиваем 3D-модели…";

  return (
    <div className="asset-loader-screen">
      <div className="asset-loader-glow asset-loader-glow-one" />
      <div className="asset-loader-glow asset-loader-glow-two" />
      <section className="asset-loader-card">
        <div className="asset-loader-brand">
          <span className="asset-loader-logo">A</span>
          <span>AnimeGame</span>
        </div>

        {progress.phase === "error" ? (
          <div className="asset-loader-error" role="alert">
            <span className="asset-loader-error-icon">!</span>
            <h1>Не удалось загрузить модели</h1>
            <p>{progress.error ?? "Проверьте подключение к интернету и попробуйте ещё раз."}</p>
            <div className="asset-loader-error-actions">
              <button type="button" onClick={onRetry}>Повторить</button>
              <button type="button" className="secondary" onClick={onExit}>Вернуться ко входу</button>
            </div>
          </div>
        ) : (
          <>
            <div className="asset-loader-heading">
              <div>
                <span className="asset-loader-kicker">Подготавливаем игру</span>
                <h1 role="status" aria-live="polite">{phaseLabel}</h1>
              </div>
              <strong>{percent}%</strong>
            </div>

            <div
              className={`asset-loader-track ${progress.phase === "discovering" ? "indeterminate" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.phase === "discovering" ? undefined : percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>

            <div className="asset-loader-stats">
              <div>
                <span>Загружено</span>
                <b>{formatBytes(progress.loadedBytes)} <small>из {formatBytes(progress.totalBytes)}</small></b>
              </div>
              <div>
                <span>Файлы</span>
                <b>{progress.completedFiles} <small>из {progress.totalFiles}</small></b>
              </div>
            </div>

            <div className="asset-loader-current">
              <span>{progress.phase === "preparing" ? "Обработка моделей" : "Текущий файл"}</span>
              <div>
                <b>{progress.phase === "preparing"
                  ? `${progress.warmLoaded} из ${progress.warmTotal}`
                  : progress.currentUrl
                    ? assetName(progress.currentUrl)
                    : "Подготовка очереди…"}</b>
                {progress.currentUrl && progress.phase === "downloading" ? (
                  <small>{formatBytes(progress.currentFileLoaded)} / {formatBytes(progress.currentFileTotal)}</small>
                ) : null}
              </div>
            </div>

            <p className="asset-loader-note">После загрузки игра запустится автоматически. Модели сохранятся в кэше браузера.</p>
          </>
        )}
      </section>
    </div>
  );
}

export function GameAssetGate({ plan, children, onExit }: GameAssetGateProps) {
  const [progress, setProgress] = useState<LoaderProgress>(EMPTY_PROGRESS);
  const [attempt, setAttempt] = useState(0);
  const [readyChildren, setReadyChildren] = useState<ReactNode>(null);
  const [cacheVersion, refreshCacheState] = useReducer((value: number) => value + 1, 0);
  const failedWarmUrls = useRef(new Set<string>());

  const rootsDownloaded = plan.downloadRoots.every((root) => downloadedRoots.has(canonicalUrl(root)));
  const planReady = rootsDownloaded && plan.warmupRoots.every((root) => warmedRoots.has(canonicalUrl(root)));

  useEffect(() => {
    if (planReady) {
      setReadyChildren(() => children);
    }
  }, [children, planReady]);

  useEffect(() => {
    if (planReady) {
      return;
    }

    const controller = new AbortController();
    failedWarmUrls.current.clear();
    const start = async () => {
      try {
        if (!plan.downloadRoots.every((root) => downloadedRoots.has(canonicalUrl(root)))) {
          await downloadPlan(plan, controller.signal, setProgress, attempt > 0);
        } else {
          const pendingWarmups = plan.warmupRoots.filter((root) => !warmedRoots.has(canonicalUrl(root)));
          setProgress((current) => ({
            ...current,
            phase: "preparing",
            warmLoaded: 0,
            warmTotal: pendingWarmups.length
          }));
        }
        refreshCacheState();
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setProgress((current) => ({
          ...current,
          phase: "error",
          error: error instanceof Error ? error.message : "Неизвестная ошибка загрузки"
        }));
      }
    };
    void start();
    return () => controller.abort();
  }, [attempt, plan.signature, planReady]);

  useEffect(() => {
    if (progress.phase !== "preparing") {
      return;
    }
    if (plan.warmupRoots.every((root) => warmedRoots.has(canonicalUrl(root)))) {
      setProgress((current) => ({ ...current, phase: "ready" }));
      refreshCacheState();
    }
  }, [cacheVersion, plan.signature, progress.phase, plan.warmupRoots]);

  useEffect(() => {
    if (progress.phase !== "preparing") {
      return;
    }
    const timeout = window.setTimeout(() => {
      setProgress((current) => current.phase === "preparing" ? {
        ...current,
        phase: "error",
        error: "Подготовка моделей заняла слишком много времени"
      } : current);
    }, 120_000);
    return () => window.clearTimeout(timeout);
  }, [attempt, plan.signature, progress.phase]);

  const handleWarmLoaded = useCallback((url: string) => {
    const key = canonicalUrl(url);
    if (warmedRoots.has(key)) {
      return;
    }
    warmedRoots.add(key);
    warmedRootSources.set(key, url);
    setProgress((current) => ({
      ...current,
      warmLoaded: Math.min(current.warmLoaded + 1, current.warmTotal)
    }));
    refreshCacheState();
  }, []);

  const handleWarmError = useCallback((url: string, error: Error) => {
    failedWarmUrls.current.add(url);
    setProgress((current) => ({
      ...current,
      phase: "error",
      error: `Не удалось подготовить ${assetName(url)}: ${error.message}`
    }));
  }, []);

  const handleRetry = useCallback(() => {
    const retryUrls = new Set([
      ...failedWarmUrls.current,
      ...plan.warmupRoots.filter((url) => !warmedRoots.has(canonicalUrl(url)))
    ]);
    for (const url of retryUrls) {
      useGLTF.clear(url);
      const rootKey = canonicalUrl(url);
      downloadedRoots.delete(rootKey);
      for (const fileKey of rootFileKeys.get(rootKey) ?? []) {
        downloadedFiles.delete(fileKey);
      }
    }
    failedWarmUrls.current.clear();
    setProgress(EMPTY_PROGRESS);
    setAttempt((value) => value + 1);
  }, [plan.warmupRoots]);

  const warmupBatch = useMemo(() => {
    if (progress.phase !== "preparing") {
      return [];
    }
    return plan.warmupRoots
      .filter((root) => !warmedRoots.has(canonicalUrl(root)))
      .slice(0, preferredConcurrency(WARMUP_CONCURRENCY));
  }, [cacheVersion, plan.signature, plan.warmupRoots, progress.phase]);

  return (
    <>
      {planReady || readyChildren ? (
        <div className="asset-gate-scene" inert={!planReady} aria-hidden={!planReady}>
          {planReady ? children : readyChildren}
        </div>
      ) : null}
      {!planReady ? <LoaderScreen progress={progress} onRetry={handleRetry} onExit={onExit} /> : null}
      {!planReady && progress.phase === "preparing" ? (
        <div className="asset-loader-warmup" aria-hidden="true">
          {warmupBatch.map((url) => (
            <WarmupErrorBoundary key={`${attempt}:${url}`} url={url} onError={handleWarmError}>
              <Suspense fallback={null}>
                <WarmAsset url={url} onLoaded={handleWarmLoaded} />
              </Suspense>
            </WarmupErrorBoundary>
          ))}
        </div>
      ) : null}
    </>
  );
}
