import { useCallback, useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useMRTrackerSettingsMutation, useMRTrackerState } from "./client";

export function MRTrackerSettingsSection() {
  const { t } = useTranslation();
  const { state, isLoading, error: loadError } = useMRTrackerState();
  const { save, clearToken, isSaving, error: saveError } = useMRTrackerSettingsMutation();
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [authors, setAuthors] = useState("");
  const [includeReviewerMRs, setIncludeReviewerMRs] = useState(true);
  const [tokenType, setTokenType] = useState<"private-token" | "bearer">("private-token");
  const [accessToken, setAccessToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setBaseUrl(state.settings.gitLabBaseUrl);
    setUsername(state.settings.gitLabUsername);
    setAuthors(state.settings.authors.join(", "));
    setIncludeReviewerMRs(state.settings.includeReviewerMergeRequests);
    setTokenType(state.settings.tokenType);
  }, [state]);

  const handleSave = useCallback(async () => {
    setNotice(null);
    try {
      await save({
        gitLabBaseUrl: baseUrl,
        gitLabUsername: username,
        authors: authors
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        includeReviewerMergeRequests: includeReviewerMRs,
        tokenType,
        ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
      });
      setAccessToken("");
      setNotice(t("settings.mrTracker.saved"));
    } catch {
      // The mutation exposes the sanitized error below the form.
    }
  }, [accessToken, authors, baseUrl, includeReviewerMRs, save, t, tokenType, username]);

  const handleClear = useCallback(async () => {
    setNotice(null);
    try {
      await clearToken();
      setAccessToken("");
      setNotice(t("settings.mrTracker.cleared"));
    } catch {
      // The mutation exposes the sanitized error below the form.
    }
  }, [clearToken, t]);
  const handlePrivateToken = useCallback(() => setTokenType("private-token"), []);
  const handleBearerToken = useCallback(() => setTokenType("bearer"), []);

  if (isLoading) {
    return <Text style={styles.muted}>{t("common.loading")}</Text>;
  }

  const error = saveError ?? loadError;
  return (
    <View style={styles.container}>
      <SettingsSection title={t("settings.mrTracker.gitLabTitle")}>
        <View style={settingsStyles.card}>
          <SettingsField
            label={t("settings.mrTracker.baseUrl")}
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="https://gitlab.example.com"
          />
          <SettingsField
            label={t("settings.mrTracker.username")}
            value={username}
            onChangeText={setUsername}
            placeholder={t("settings.mrTracker.usernamePlaceholder")}
            bordered
          />
          <SettingsField
            label={t("settings.mrTracker.token")}
            hint={t("settings.mrTracker.tokenSecurityHint")}
            value={accessToken}
            onChangeText={setAccessToken}
            placeholder={
              state?.hasToken
                ? t("settings.mrTracker.tokenSaved")
                : t("settings.mrTracker.tokenPlaceholder")
            }
            secureTextEntry
            bordered
          />
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.mrTracker.tokenType")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.mrTracker.tokenTypeHint")}</Text>
            </View>
            <View style={styles.buttonRow}>
              <Button
                size="sm"
                variant={tokenType === "private-token" ? "secondary" : "ghost"}
                onPress={handlePrivateToken}
              >
                Private-Token
              </Button>
              <Button
                size="sm"
                variant={tokenType === "bearer" ? "secondary" : "ghost"}
                onPress={handleBearerToken}
              >
                Bearer
              </Button>
            </View>
          </View>
        </View>
      </SettingsSection>

      <SettingsSection title={t("settings.mrTracker.monitoringTitle")}>
        <View style={settingsStyles.card}>
          <SettingsField
            label={t("settings.mrTracker.authors")}
            hint={t("settings.mrTracker.authorsHint")}
            value={authors}
            onChangeText={setAuthors}
            placeholder="alice, bob"
          />
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.mrTracker.reviewerMRs")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.mrTracker.reviewerMRsHint")}</Text>
            </View>
            <Switch value={includeReviewerMRs} onValueChange={setIncludeReviewerMRs} />
          </View>
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.mrTracker.refreshCadence")}</Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.mrTracker.refreshCadenceHint")}
              </Text>
            </View>
            <Text style={styles.muted}>{t("settings.mrTracker.everyTwoMinutes")}</Text>
          </View>
        </View>
      </SettingsSection>

      {error ? <Text style={styles.error}>{error.message}</Text> : null}
      {notice ? <Text style={styles.success}>{notice}</Text> : null}
      <View style={styles.actions}>
        {state?.hasToken ? (
          <Button variant="ghost" onPress={handleClear} disabled={isSaving}>
            {t("settings.mrTracker.clearToken")}
          </Button>
        ) : null}
        <Button onPress={handleSave} disabled={isSaving}>
          {isSaving ? t("settings.mrTracker.saving") : t("settings.mrTracker.save")}
        </Button>
      </View>
    </View>
  );
}

function SettingsField({
  label,
  hint,
  bordered,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & { label: string; hint?: string; bordered?: boolean }) {
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
      </View>
      <TextInput {...inputProps} autoCapitalize="none" autoCorrect={false} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { gap: theme.spacing[6] },
  input: {
    width: 300,
    maxWidth: "50%",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface3,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  buttonRow: { flexDirection: "row", gap: theme.spacing[1] },
  muted: { color: theme.colors.foregroundMuted },
  error: { color: theme.colors.statusDanger },
  success: { color: theme.colors.statusSuccess },
}));
