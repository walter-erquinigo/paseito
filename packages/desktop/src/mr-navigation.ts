import { parseMRDeepLink, type MRDeepLinkTarget } from "@getpaseo/protocol/mr-deep-link";
import type { MRTrackerTab } from "./features/mr-tracker/types.js";

export interface MRNavigationPayload {
  mergeRequestId?: string;
  tab?: MRTrackerTab;
  revision: number;
  error?: string;
}

export function parseMRDeepLinkFromArgv(argv: string[]): MRDeepLinkTarget | null {
  for (const arg of argv) {
    const target = parseMRDeepLink(arg);
    if (target) return target;
  }
  return null;
}

export class MRNavigationInbox {
  private readonly readyWindows = new Set<number>();
  private readonly pendingByWindow = new Map<number, MRNavigationPayload>();

  windowLoading(webContentsId: number): void {
    this.readyWindows.delete(webContentsId);
  }

  windowReady(webContentsId: number): MRNavigationPayload | null {
    this.readyWindows.add(webContentsId);
    const pending = this.pendingByWindow.get(webContentsId) ?? null;
    this.pendingByWindow.delete(webContentsId);
    return pending;
  }

  deliverOrQueue(webContentsId: number, payload: MRNavigationPayload): MRNavigationPayload | null {
    if (this.readyWindows.has(webContentsId)) return payload;
    this.pendingByWindow.set(webContentsId, payload);
    return null;
  }

  removeWindow(webContentsId: number): void {
    this.readyWindows.delete(webContentsId);
    this.pendingByWindow.delete(webContentsId);
  }
}
