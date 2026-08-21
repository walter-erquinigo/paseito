import { useEffect } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { getDesktopHost } from "@/desktop/host";
import { useStableEvent } from "@/hooks/use-stable-event";
import { buildMRTrackerRoute, isMRTrackerTabSlug } from "@/utils/host-routes";

interface OpenMREventPayload {
  mergeRequestId?: unknown;
  tab?: unknown;
  revision?: unknown;
  error?: unknown;
}

export function MRNavigationListener() {
  const router = useRouter();
  const openMR = useStableEvent((payload: OpenMREventPayload | null) => {
    const error = typeof payload?.error === "string" ? payload.error.trim() : "";
    if (error) {
      router.navigate(buildMRTrackerRoute("all"));
      Alert.alert("Unable to open MR", error);
      return;
    }

    const mergeRequestId =
      typeof payload?.mergeRequestId === "string" ? payload.mergeRequestId.trim() : "";
    const rawTab = typeof payload?.tab === "string" ? payload.tab : "";
    const revision = typeof payload?.revision === "number" ? payload.revision : Date.now();
    if (!mergeRequestId || !isMRTrackerTabSlug(rawTab)) return;
    router.navigate(buildMRTrackerRoute(rawTab, mergeRequestId, revision));
  });

  useEffect(() => {
    const host = getDesktopHost();
    const ready = host?.mrNavigation?.ready;
    if (typeof host?.events?.on !== "function" || typeof ready !== "function") return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = async () => {
      let dispose: (() => void) | null = null;
      try {
        dispose = await listenToDesktopEvent<OpenMREventPayload>("open-mr", openMR);
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
        const pending = await ready();
        if (!disposed && pending) openMR(pending);
      } catch {
        dispose?.();
        if (unlisten === dispose) unlisten = null;
        if (!disposed) retryTimer = setTimeout(() => void connect(), 1_000);
      }
    };

    void connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      unlisten?.();
    };
  }, [openMR]);

  return null;
}
