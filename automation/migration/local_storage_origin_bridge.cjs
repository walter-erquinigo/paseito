#!/usr/bin/env node
"use strict";

const REGISTRY_KEY = "@paseo:daemon-registry";
const REPLICA_KEY = "@paseo:replica-cache";

function parseObject(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  throw new Error(`${label} is invalid`);
}

function localHostProfile(targetServerId) {
  const now = new Date().toISOString();
  return {
    serverId: targetServerId,
    label: require("os").hostname(),
    lifecycle: {},
    connections: [{ id: "direct:localhost:6769", type: "directTcp", endpoint: "localhost:6769" }],
    preferredConnectionId: "direct:localhost:6769",
    createdAt: now,
    updatedAt: now,
  };
}

function localReplica(targetServerId) {
  return {
    serverId: targetServerId,
    agents: [],
    workspaces: [],
    projects: [],
    emptyProjects: [],
    timeline: null,
  };
}

function mergeByServerId(
  targetEntries,
  sourceEntries,
  targetServerId,
  localFallback,
  excludedServerIds,
) {
  const merged = new Map();
  for (const entry of targetEntries) {
    if (
      entry &&
      typeof entry.serverId === "string" &&
      (!excludedServerIds.has(entry.serverId) || entry.serverId === targetServerId)
    ) {
      merged.set(entry.serverId, entry);
    }
  }
  for (const entry of sourceEntries) {
    if (
      entry &&
      typeof entry.serverId === "string" &&
      entry.serverId !== targetServerId &&
      !excludedServerIds.has(entry.serverId)
    ) {
      merged.set(entry.serverId, entry);
    }
  }
  const local = merged.get(targetServerId) ?? localFallback;
  merged.delete(targetServerId);
  return [local, ...merged.values()];
}

function mergeSnapshots(source, target, sourceServerId, targetServerId) {
  const merged = { ...target, ...source };
  const sourceRegistry = source[REGISTRY_KEY]
    ? parseObject(source[REGISTRY_KEY], "source host registry")
    : [];
  const targetRegistry = target[REGISTRY_KEY]
    ? parseObject(target[REGISTRY_KEY], "target host registry")
    : [];
  if (!Array.isArray(sourceRegistry) || !Array.isArray(targetRegistry)) {
    throw new Error("host registry is not an array");
  }
  const obsoleteLocalIds = new Set([sourceServerId]);
  for (const profile of targetRegistry) {
    if (!profile || typeof profile.serverId !== "string" || profile.serverId === targetServerId) {
      continue;
    }
    const connections = Array.isArray(profile.connections) ? profile.connections : [];
    const isOldPaseitoLocal = connections.some(
      (connection) =>
        connection?.type === "directTcp" &&
        ["localhost:6769", "127.0.0.1:6769", "[::1]:6769"].includes(connection.endpoint),
    );
    if (isOldPaseitoLocal) obsoleteLocalIds.add(profile.serverId);
  }
  merged[REGISTRY_KEY] = JSON.stringify(
    mergeByServerId(
      targetRegistry,
      sourceRegistry,
      targetServerId,
      localHostProfile(targetServerId),
      obsoleteLocalIds,
    ),
  );
  const sourceReplica = source[REPLICA_KEY]
    ? parseObject(source[REPLICA_KEY], "source replica cache")
    : { version: 1, hosts: [] };
  const targetReplica = target[REPLICA_KEY]
    ? parseObject(target[REPLICA_KEY], "target replica cache")
    : { version: 1, hosts: [] };
  if (!Array.isArray(sourceReplica.hosts) || !Array.isArray(targetReplica.hosts)) {
    throw new Error("replica cache hosts are invalid");
  }
  merged[REPLICA_KEY] = JSON.stringify({
    ...sourceReplica,
    hosts: mergeByServerId(
      targetReplica.hosts,
      sourceReplica.hosts,
      targetServerId,
      localReplica(targetServerId),
      obsoleteLocalIds,
    ),
  });
  return merged;
}

async function readOrigin(window, scheme) {
  process.stderr.write(`bridge: loading ${scheme} origin\n`);
  await window.loadURL(`${scheme}://app`);
  const serialized = await window.webContents.executeJavaScript(`JSON.stringify(
    Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return [key, localStorage.getItem(key)];
    }))
  )`);
  return JSON.parse(serialized);
}

async function writeOrigin(window, scheme, values) {
  await window.loadURL(`${scheme}://app`);
  const serialized = JSON.stringify(values);
  const result = await window.webContents.executeJavaScript(`(() => {
    const values = JSON.parse(${JSON.stringify(serialized)});
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    return { count: localStorage.length, hasRegistry: localStorage.getItem(${JSON.stringify(REGISTRY_KEY)}) !== null };
  })()`);
  if (!result.hasRegistry) throw new Error("target host registry was not written");
  return result;
}

async function main() {
  const targetRoot = process.argv[2];
  const sourceServerId = process.argv[3];
  const targetServerId = process.argv[4];
  if (!targetRoot || !sourceServerId || !targetServerId)
    throw new Error("missing bridge arguments");

  const { app, BrowserWindow, protocol } = require("electron");
  protocol.registerSchemesAsPrivileged([
    { scheme: "paseo", privileges: { standard: true, secure: true } },
    { scheme: "paseito", privileges: { standard: true, secure: true } },
  ]);
  app.setPath("userData", targetRoot);
  process.stderr.write("bridge: waiting for Electron\n");
  await app.whenReady();
  const response = () =>
    new Response("<!doctype html><title>storage migration</title>", {
      headers: { "content-type": "text/html" },
    });
  protocol.handle("paseo", response);
  protocol.handle("paseito", response);
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  process.stderr.write("bridge: reading origins\n");
  const source = await readOrigin(window, "paseo");
  const target = await readOrigin(window, "paseito");
  const merged = mergeSnapshots(source, target, sourceServerId, targetServerId);
  const result = await writeOrigin(window, "paseito", merged);
  const hostCount = JSON.parse(merged[REGISTRY_KEY]).length;
  const replicaHostCount = JSON.parse(merged[REPLICA_KEY]).hosts.length;
  window.destroy();
  const summary = JSON.stringify({
    sourceKeys: Object.keys(source).length,
    targetKeys: result.count,
    hostCount,
    replicaHostCount,
  });
  process.stdout.write(`${summary}\n`, () => app.exit(0));
}

module.exports = { mergeSnapshots };

if (process.versions.electron) {
  main().catch((error) => {
    process.stderr.write(`Local storage origin migration failed: ${error.message}\n`);
    process.exitCode = 1;
    const electron = require("electron");
    if (electron.app?.isReady()) electron.app.quit();
  });
}
