import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";

interface DesktopPlugin {
  id: string;
  path: string;
  enabled: boolean;
  status: "disabled" | "loading" | "running" | "failed";
  error: string | null;
}

interface DesktopPluginLog {
  sequence: number;
  timestamp: string;
  stream: "stdout" | "stderr";
  message: string;
}

type Action = "reload" | "enable" | "disable" | "remove" | "logs";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function DesktopPluginRow({
  plugin,
  pending,
  onAction,
}: {
  plugin: DesktopPlugin;
  pending: boolean;
  onAction(action: Action, plugin: DesktopPlugin): Promise<void>;
}) {
  const { t } = useTranslation();
  let variant: "success" | "error" | "muted" = "muted";
  if (plugin.status === "running") variant = "success";
  else if (plugin.status === "failed") variant = "error";
  const handleLogs = useCallback(() => void onAction("logs", plugin), [onAction, plugin]);
  const handleReload = useCallback(() => void onAction("reload", plugin), [onAction, plugin]);
  const handleToggle = useCallback(
    () => void onAction(plugin.enabled ? "disable" : "enable", plugin),
    [onAction, plugin],
  );
  const handleRemove = useCallback(() => void onAction("remove", plugin), [onAction, plugin]);
  return (
    <View style={styles.pluginRow}>
      <View style={settingsStyles.rowContent}>
        <View style={styles.pluginTitle}>
          <Text style={settingsStyles.rowTitle}>{plugin.id}</Text>
          <StatusBadge label={t(`settings.plugins.status.${plugin.status}`)} variant={variant} />
        </View>
        <Text style={settingsStyles.rowHint}>{plugin.path}</Text>
        {plugin.error ? <Text style={styles.error}>{plugin.error}</Text> : null}
      </View>
      <View style={styles.actions}>
        <Button variant="outline" size="sm" disabled={pending} onPress={handleLogs}>
          {t("settings.plugins.logs.action")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !plugin.enabled}
          onPress={handleReload}
        >
          {t("settings.plugins.actions.reload")}
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onPress={handleToggle}>
          {t(`settings.plugins.actions.${plugin.enabled ? "disable" : "enable"}`)}
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onPress={handleRemove}>
          {t("settings.plugins.actions.remove")}
        </Button>
      </View>
    </View>
  );
}

export function DesktopMRPluginsSection() {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<DesktopPlugin[]>([]);
  const [directory, setDirectory] = useState("");
  const [pluginId, setPluginId] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ pluginId: string; entries: DesktopPluginLog[] } | null>(null);

  const refresh = useCallback(async () => {
    setPlugins(await invokeDesktopCommand<DesktopPlugin[]>("desktop_mr_plugin_list"));
  }, []);

  useEffect(() => {
    void refresh().catch((value) => setError(errorMessage(value)));
  }, [refresh]);

  const install = useCallback(async () => {
    const path = directory.trim();
    if (!path) return;
    setPending("install");
    setError(null);
    try {
      await invokeDesktopCommand("desktop_mr_plugin_install", {
        directory: path,
        id: pluginId.trim() || undefined,
      });
      setDirectory("");
      setPluginId("");
      setResetKey((value) => value + 1);
      await refresh();
    } catch (value) {
      setError(errorMessage(value));
    } finally {
      setPending(null);
    }
  }, [directory, pluginId, refresh]);

  const act = useCallback(
    async (action: Action, plugin: DesktopPlugin) => {
      if (action === "remove") {
        const confirmed = await confirmDialog({
          title: t("settings.plugins.removeConfirmTitle", { id: plugin.id }),
          message: t("settings.plugins.removeConfirmMessage"),
          confirmLabel: t("settings.plugins.actions.remove"),
          destructive: true,
        });
        if (!confirmed) return;
      }
      setPending(`${action}:${plugin.id}`);
      setError(null);
      try {
        if (action === "logs") {
          const entries = await invokeDesktopCommand<DesktopPluginLog[]>("desktop_mr_plugin_logs", {
            id: plugin.id,
          });
          setLogs({ pluginId: plugin.id, entries });
        } else {
          await invokeDesktopCommand(`desktop_mr_plugin_${action}`, { id: plugin.id });
          await refresh();
        }
      } catch (value) {
        setError(errorMessage(value));
      } finally {
        setPending(null);
      }
    },
    [refresh, t],
  );

  return (
    <SettingsSection title={t("settings.plugins.desktopTitle")}>
      <Alert
        variant="warning"
        title={t("settings.plugins.trustedTitle")}
        description={t("settings.plugins.desktopTrustedDescription")}
      />
      <View style={[settingsStyles.card, styles.install]}>
        <Field label={t("settings.plugins.directoryLabel")}>
          <FormTextInput
            initialValue=""
            resetKey={resetKey}
            onChangeText={setDirectory}
            placeholder={t("settings.plugins.desktopDirectoryPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
        <Field label={t("settings.plugins.idLabel")} hint={t("settings.plugins.idHint")}>
          <FormTextInput
            initialValue=""
            resetKey={resetKey}
            onChangeText={setPluginId}
            placeholder={t("settings.plugins.idPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />
        </Field>
        <Button onPress={install} disabled={!directory.trim() || Boolean(pending)}>
          {pending === "install" ? t("settings.plugins.installing") : t("settings.plugins.install")}
        </Button>
      </View>
      {error ? <Alert variant="error" title={error} /> : null}
      <View style={settingsStyles.card}>
        {plugins.length ? (
          plugins.map((plugin) => (
            <DesktopPluginRow
              key={plugin.id}
              plugin={plugin}
              pending={Boolean(pending)}
              onAction={act}
            />
          ))
        ) : (
          <View style={styles.empty}>
            <Text style={settingsStyles.rowHint}>{t("settings.plugins.states.empty")}</Text>
          </View>
        )}
      </View>
      {logs ? (
        <View style={[settingsStyles.card, styles.logs]}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.plugins.logs.title", { id: logs.pluginId })}
          </Text>
          {logs.entries.length ? (
            logs.entries.map((entry) => (
              <Text key={entry.sequence} style={styles.logLine}>
                {entry.timestamp} {entry.stream} {entry.message}
              </Text>
            ))
          ) : (
            <Text style={settingsStyles.rowHint}>{t("settings.plugins.logs.empty")}</Text>
          )}
        </View>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  install: { padding: theme.spacing[4], gap: theme.spacing[3] },
  pluginRow: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  pluginTitle: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  empty: { padding: theme.spacing[4], alignItems: "center" },
  logs: { padding: theme.spacing[4], gap: theme.spacing[2] },
  logLine: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
