import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
  type EditingTextInputProps,
} from "@/components/ui/text-input";
import { Switch } from "@/components/ui/switch";
import { Plus, X } from "lucide-react-native";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { searchMRTrackerUsers, useMRTrackerSettingsMutation, useMRTrackerState } from "./client";
import {
  openMRTrackerSettingsForm,
  type MRTrackerSettingsFormModel,
  type MRTrackerSettingsFormState,
} from "./settings-form-model";
import type { GitLabUserSummary, MRTrackerSettings } from "./types";

export function MRTrackerSettingsSection() {
  const { t } = useTranslation();
  const { state, isLoading, error: loadError } = useMRTrackerState();
  if (isLoading) {
    return <Text style={styles.muted}>{t("common.loading")}</Text>;
  }
  if (!state) {
    return (
      <Text style={styles.error}>{loadError?.message ?? t("mrTracker.errors.actionFailed")}</Text>
    );
  }
  return (
    <MRTrackerSettingsForm
      key={`${state.settings.gitLabBaseUrl}:${state.settings.gitLabUsername}`}
      settings={state.settings}
      hasToken={state.hasToken}
      loadError={loadError}
    />
  );
}

function MRTrackerSettingsForm({
  settings,
  hasToken,
  loadError,
}: {
  settings: MRTrackerSettings;
  hasToken: boolean;
  loadError: Error | null;
}) {
  const { t } = useTranslation();
  const { save, clearToken, isSaving, error: saveError } = useMRTrackerSettingsMutation();
  const [model] = useState(() => openMRTrackerSettingsForm(settings));
  const form = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => () => model.close(), [model]);

  const handleSave = useCallback(async () => {
    setNotice(null);
    try {
      await save({
        gitLabBaseUrl: form.gitLabBaseUrl,
        gitLabUsername: form.gitLabUsername,
        authors: form.authors
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        activityUsers: form.activityUsers,
        includeReviewerMergeRequests: form.includeReviewerMergeRequests,
        tokenType: form.tokenType,
        ...(form.accessToken.trim() ? { accessToken: form.accessToken.trim() } : {}),
      });
      model.setAccessToken("");
      setNotice(t("settings.mrTracker.saved"));
    } catch {
      // The mutation exposes the sanitized error below the form.
    }
  }, [form, model, save, t]);

  const handleClear = useCallback(async () => {
    setNotice(null);
    try {
      await clearToken();
      model.setAccessToken("");
      setNotice(t("settings.mrTracker.cleared"));
    } catch {
      // The mutation exposes the sanitized error below the form.
    }
  }, [clearToken, model, t]);
  const handlePrivateToken = useCallback(() => model.setTokenType("private-token"), [model]);
  const handleBearerToken = useCallback(() => model.setTokenType("bearer"), [model]);

  const error = saveError ?? loadError;
  return (
    <View style={styles.container}>
      <SettingsSection title={t("settings.mrTracker.gitLabTitle")}>
        <View style={settingsStyles.card}>
          <SettingsField
            label={t("settings.mrTracker.baseUrl")}
            value={form.gitLabBaseUrl}
            onChangeText={model.setGitLabBaseUrl}
            placeholder="https://gitlab.example.com"
          />
          <SettingsField
            label={t("settings.mrTracker.username")}
            value={form.gitLabUsername}
            onChangeText={model.setGitLabUsername}
            placeholder={t("settings.mrTracker.usernamePlaceholder")}
            bordered
          />
          <SettingsField
            label={t("settings.mrTracker.token")}
            hint={t("settings.mrTracker.tokenSecurityHint")}
            value={form.accessToken}
            onChangeText={model.setAccessToken}
            placeholder={
              hasToken
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
                variant={form.tokenType === "private-token" ? "secondary" : "ghost"}
                onPress={handlePrivateToken}
              >
                Private-Token
              </Button>
              <Button
                size="sm"
                variant={form.tokenType === "bearer" ? "secondary" : "ghost"}
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
            value={form.authors}
            onChangeText={model.setAuthors}
            placeholder="alice, bob"
          />
          <ActivityUserPicker model={model} form={form} />
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.mrTracker.reviewerMRs")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.mrTracker.reviewerMRsHint")}</Text>
            </View>
            <Switch
              value={form.includeReviewerMergeRequests}
              onValueChange={model.setIncludeReviewerMergeRequests}
            />
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
        {hasToken ? (
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

function ActivityUserPicker({
  model,
  form,
}: {
  model: MRTrackerSettingsFormModel;
  form: MRTrackerSettingsFormState;
}) {
  const { t } = useTranslation();
  const anchorRef = useRef<View | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GitLabUserSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<Error | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      void searchMRTrackerUsers({
        query: trimmed,
        gitLabBaseUrl: form.gitLabBaseUrl,
        tokenType: form.tokenType,
        ...(form.accessToken.trim() ? { accessToken: form.accessToken.trim() } : {}),
      })
        .then((users) => {
          if (!cancelled) setResults(users);
          return users;
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setResults([]);
            setSearchError(
              error instanceof Error ? error : new Error(t("settings.mrTracker.userSearchFailed")),
            );
          }
          return undefined;
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.accessToken, form.gitLabBaseUrl, form.tokenType, query, t]);

  const options = useMemo(
    () =>
      results.map((user) => ({
        id: String(user.id),
        label: user.name || user.username,
        description: `@${user.username}`,
      })),
    [results],
  );
  const handleSelect = useCallback(
    (id: string) => {
      const user = results.find((entry) => String(entry.id) === id);
      if (user) model.addActivityUser(user);
    },
    [model, results],
  );
  const renderOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, active, onPress }) => (
      <ComboboxItem
        label={option.label}
        description={option.description}
        active={active}
        selected={form.activityUsers.some((user) => String(user.id) === option.id)}
        onPress={onPress}
      />
    ),
    [form.activityUsers],
  );
  const handleSearchQueryChange = useCallback((value: string) => setQuery(value), []);
  const handleOpen = useCallback(() => setOpen(true), []);

  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.mrTracker.activityUsers")}</Text>
        <Text style={settingsStyles.rowHint}>{t("settings.mrTracker.activityUsersHint")}</Text>
      </View>
      <View ref={anchorRef} collapsable={false} style={styles.userPickerControl}>
        <View style={styles.selectedUsers}>
          {form.activityUsers.map((user) => (
            <SelectedActivityUser key={user.id} user={user} model={model} />
          ))}
        </View>
        <Button size="sm" variant="outline" leftIcon={Plus} onPress={handleOpen}>
          {t("settings.mrTracker.addActivityUser")}
        </Button>
        {searchError ? <Text style={styles.error}>{searchError.message}</Text> : null}
        <Combobox
          options={options}
          value=""
          onSelect={handleSelect}
          renderOption={renderOption}
          onSearchQueryChange={handleSearchQueryChange}
          searchable
          title={t("settings.mrTracker.activityUsers")}
          searchPlaceholder={t("settings.mrTracker.activityUserSearch")}
          emptyText={activityUserPickerEmptyText(isSearching, query, t)}
          open={open}
          onOpenChange={setOpen}
          anchorRef={anchorRef}
          keepOpenOnSelect
          desktopMinWidth={360}
        />
      </View>
    </View>
  );
}

function activityUserPickerEmptyText(isSearching: boolean, query: string, t: TFunction): string {
  if (isSearching) return t("settings.mrTracker.searchingUsers");
  if (query.trim().length < 2) return t("settings.mrTracker.activityUserSearchHint");
  return t("settings.mrTracker.noActivityUsers");
}

function SelectedActivityUser({
  user,
  model,
}: {
  user: GitLabUserSummary;
  model: MRTrackerSettingsFormModel;
}) {
  const { t } = useTranslation();
  const handleRemove = useCallback(() => model.removeActivityUser(user.id), [model, user.id]);
  return (
    <View style={styles.selectedUser}>
      <View style={styles.selectedUserText}>
        <Text style={styles.selectedUserName} numberOfLines={1}>
          {user.name || user.username}
        </Text>
        <Text style={styles.selectedUserUsername} numberOfLines={1}>
          @{user.username}
        </Text>
      </View>
      <Button
        size="xs"
        variant="ghost"
        leftIcon={X}
        accessibilityLabel={t("settings.mrTracker.removeActivityUser", {
          name: user.name || user.username,
        })}
        onPress={handleRemove}
      />
    </View>
  );
}

interface SettingsFieldProps extends EditingTextInputProps {
  label: string;
  hint?: string;
  bordered?: boolean;
  value: string;
}

function SettingsField({ label, hint, bordered, value, ...inputProps }: SettingsFieldProps) {
  const inputRef = useRef<EditingTextInputHandle>(null);
  useEffect(() => inputRef.current?.replaceText(value), [value]);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
      </View>
      <TextInput
        {...inputProps}
        ref={inputRef}
        initialValue={value}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
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
  userPickerControl: {
    width: 300,
    maxWidth: "50%",
    gap: theme.spacing[2],
    alignItems: "flex-start",
  },
  selectedUsers: { alignSelf: "stretch", gap: theme.spacing[1] },
  selectedUser: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface3,
  },
  selectedUserText: { minWidth: 0, flex: 1 },
  selectedUserName: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  selectedUserUsername: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted },
  error: { color: theme.colors.statusDanger },
  success: { color: theme.colors.statusSuccess },
}));
