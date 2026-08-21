import { app, BrowserWindow, Notification } from "electron";
import log from "electron-log/main";
import { getDesktopSettingsStore } from "../../settings/desktop-settings-electron.js";
import { createMRTrackerStore, createMRTrackerTokenStore } from "./store.js";
import { createMRAutomationStore } from "./automation-store.js";
import { MRAutomationEngine } from "./automation-engine.js";
import { DesktopMRPluginManager } from "./desktop-plugins.js";
import { MRTrackerService } from "./service.js";
import type { MRTrackerNotification, MRTrackerViewState } from "./types.js";

let service: MRTrackerService | null = null;
let desktopPlugins: DesktopMRPluginManager | null = null;
const activeNotifications = new Set<Notification>();

function broadcastState(state: MRTrackerViewState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("paseo:event:mr-tracker-state-changed", state);
    }
  }
}

function focusWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  const window =
    BrowserWindow.getFocusedWindow() ?? windows.find((entry) => entry.isVisible()) ?? windows[0];
  if (!window || window.isDestroyed()) return null;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

async function showNotification(input: MRTrackerNotification): Promise<void> {
  if (!Notification.isSupported()) return;
  const settings = await getDesktopSettingsStore().get();
  const notification = new Notification({
    title: input.title,
    body: input.body,
    silent: !settings.notifications.playSound,
  });
  activeNotifications.add(notification);
  notification.on("click", () => {
    const window = focusWindow();
    window?.webContents.send("paseo:event:mr-tracker-notification-click", {
      mergeRequestId: input.mergeRequestId,
    });
    activeNotifications.delete(notification);
  });
  notification.on("close", () => activeNotifications.delete(notification));
  notification.show();
}

export function getDesktopMRTrackerService(): MRTrackerService {
  const userDataPath = app.getPath("userData");
  desktopPlugins ??= new DesktopMRPluginManager(userDataPath);
  service ??= new MRTrackerService({
    store: createMRTrackerStore(userDataPath),
    tokenStore: createMRTrackerTokenStore(userDataPath),
    automationEngine: new MRAutomationEngine({
      store: createMRAutomationStore(userDataPath),
      contributions: desktopPlugins,
    }),
    onStateChanged: broadcastState,
    onNotification: (notification) => {
      void showNotification(notification).catch((error) => {
        log.error("[mr-tracker] failed to display notification", error);
      });
    },
  });
  return service;
}

export function getDesktopMRPluginManager(): DesktopMRPluginManager {
  const userDataPath = app.getPath("userData");
  desktopPlugins ??= new DesktopMRPluginManager(userDataPath);
  return desktopPlugins;
}

export function startDesktopMRTracker(): void {
  void getDesktopMRTrackerService()
    .start()
    .catch((error) => log.error("[mr-tracker] failed to start", error));
}
