import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const publicDirectory = path.join(projectDirectory, "public");
const assetsDirectory = path.join(publicDirectory, "assets");
const scanDirectories = [
  path.join(assetsDirectory, "animations"),
  path.join(assetsDirectory, "models"),
];
const outputPath = path.join(assetsDirectory, "game-asset-manifest.json");

const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

async function listModelRoots(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareStrings(left.name, right.name));

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listModelRoots(entryPath)));
      continue;
    }

    if (entry.isFile() && /\.(?:glb|gltf)$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function assertInsideAssets(filePath, description) {
  const relativePath = path.relative(assetsDirectory, filePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${description} is outside public/assets: ${filePath}`);
  }

  return relativePath;
}

function toAssetUrl(filePath) {
  const relativePath = assertInsideAssets(filePath, "Asset");
  return `/assets/${relativePath.split(path.sep).join("/")}`;
}

function resolveExternalUri(rootPath, uri) {
  if (/^data:/i.test(uri)) {
    return null;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(uri) || uri.startsWith("//")) {
    throw new Error(`Remote dependency is not supported in ${toAssetUrl(rootPath)}: ${uri}`);
  }

  if (/[?#]/.test(uri)) {
    throw new Error(`Dependency query strings and fragments are not supported in ${toAssetUrl(rootPath)}: ${uri}`);
  }

  let decodedUri;
  try {
    decodedUri = decodeURIComponent(uri.replaceAll("\\", "/"));
  } catch {
    throw new Error(`Dependency URI is not valid percent-encoding in ${toAssetUrl(rootPath)}: ${uri}`);
  }

  const dependencyPath = decodedUri.startsWith("/assets/")
    ? path.resolve(publicDirectory, `.${decodedUri}`)
    : path.resolve(path.dirname(rootPath), decodedUri);

  assertInsideAssets(
    dependencyPath,
    `Dependency ${JSON.stringify(uri)} of ${toAssetUrl(rootPath)}`,
  );
  return dependencyPath;
}

async function readGltfDependencies(rootPath) {
  let document;
  try {
    const source = (await readFile(rootPath, "utf8")).replace(/^\uFEFF/, "");
    document = JSON.parse(source);
  } catch (error) {
    throw new Error(`Cannot parse ${toAssetUrl(rootPath)}: ${error.message}`, { cause: error });
  }

  const uris = [
    ...(Array.isArray(document.buffers) ? document.buffers : []),
    ...(Array.isArray(document.images) ? document.images : []),
  ]
    .map((resource) => resource?.uri)
    .filter((uri) => typeof uri === "string");

  const dependencyPaths = new Set();
  for (const uri of uris) {
    const dependencyPath = resolveExternalUri(rootPath, uri);
    if (dependencyPath) {
      dependencyPaths.add(dependencyPath);
    }
  }

  return [...dependencyPaths].sort((left, right) =>
    compareStrings(toAssetUrl(left), toAssetUrl(right)),
  );
}

const fileMetadataByPath = new Map();

async function getFileMetadata(filePath, referencedBy) {
  const cached = fileMetadataByPath.get(filePath);
  if (cached) {
    return cached;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(
        `Cannot read dependency ${toAssetUrl(filePath)} referenced by ${toAssetUrl(referencedBy)}`,
        { cause: error },
      );
    }

    const metadata = {
      path: filePath,
      url: toAssetUrl(filePath),
      bytes: null,
    };
    fileMetadataByPath.set(filePath, metadata);
    return metadata;
  }

  if (!fileStat.isFile()) {
    throw new Error(
      `Dependency ${toAssetUrl(filePath)} referenced by ${toAssetUrl(referencedBy)} is not a file`,
    );
  }

  const metadata = {
    path: filePath,
    url: toAssetUrl(filePath),
    bytes: fileStat.size,
  };
  fileMetadataByPath.set(filePath, metadata);
  return metadata;
}

async function createRootEntry(rootPath) {
  const extension = path.extname(rootPath).toLowerCase();
  const dependencyPaths = extension === ".gltf" ? await readGltfDependencies(rootPath) : [];
  const filePaths = [rootPath, ...dependencyPaths.filter((filePath) => filePath !== rootPath)];
  const files = [];

  for (const filePath of filePaths) {
    const metadata = await getFileMetadata(filePath, rootPath);
    files.push({ url: metadata.url, bytes: metadata.bytes });
  }

  return {
    url: toAssetUrl(rootPath),
    complete: files.every((file) => file.bytes !== null),
    files,
  };
}

async function calculateRevision(payload) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(payload));

  const uniqueFiles = [...fileMetadataByPath.values()].sort((left, right) =>
    compareStrings(left.url, right.url),
  );
  for (const file of uniqueFiles) {
    if (file.bytes === null) {
      continue;
    }

    hash.update("\0");
    hash.update(file.url);
    hash.update("\0");
    hash.update(await readFile(file.path));
  }

  return `sha256-${hash.digest("hex")}`;
}

async function main() {
  const rootPaths = (
    await Promise.all(scanDirectories.map((directory) => listModelRoots(directory)))
  )
    .flat()
    .sort((left, right) => compareStrings(toAssetUrl(left), toAssetUrl(right)));

  const rootEntries = [];
  for (const rootPath of rootPaths) {
    rootEntries.push(await createRootEntry(rootPath));
  }

  const uniqueFiles = [...fileMetadataByPath.values()];
  const missingFiles = uniqueFiles.filter((file) => file.bytes === null);
  const roots = Object.fromEntries(
    rootEntries.map(({ url, complete, files }) => [url, { complete, files }]),
  );
  const payload = {
    version: 1,
    missingFileCount: missingFiles.length,
    roots,
  };
  const manifest = {
    version: payload.version,
    revision: await calculateRevision(payload),
    missingFileCount: payload.missingFileCount,
    roots: payload.roots,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(
    `Generated ${path.relative(projectDirectory, outputPath)}: ${rootEntries.length} roots, ` +
      `${uniqueFiles.length} files (${manifest.missingFileCount} missing), ` +
      `${uniqueFiles.reduce((total, file) => total + (file.bytes ?? 0), 0)} known bytes, ` +
      manifest.revision,
  );

  for (const file of missingFiles) {
    console.warn(`Missing external glTF dependency: ${file.url}`);
  }
}

await main();
