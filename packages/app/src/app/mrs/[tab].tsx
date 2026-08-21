import { Redirect, useLocalSearchParams } from "expo-router";
import { getIsElectronRuntime } from "@/constants/layout";
import { MRTrackerScreen } from "@/mr-tracker/screen";
import { buildOpenProjectRoute, isMRTrackerTabSlug } from "@/utils/host-routes";

export default function MRTrackerRoute() {
  const params = useLocalSearchParams<{ tab?: string; mr?: string }>();
  if (!getIsElectronRuntime()) {
    return <Redirect href={buildOpenProjectRoute()} />;
  }

  const rawTab = typeof params.tab === "string" ? params.tab : "";
  const tab = isMRTrackerTabSlug(rawTab) ? rawTab : "all";
  const focusId = typeof params.mr === "string" ? params.mr : undefined;
  return <MRTrackerScreen tab={tab} focusId={focusId} />;
}
