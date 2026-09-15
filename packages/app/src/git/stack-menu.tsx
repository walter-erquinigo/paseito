import { useCallback, useMemo, useState } from "react";
import { Text, View, type GestureResponderEvent } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceStackBranch } from "@getpaseo/protocol/workspace-stack";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuHint,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  toolbarLabelTriggerStyle,
  toolbarLabelTriggerTextStyle,
} from "@/components/ui/toolbar-label-trigger";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { openExternalUrl } from "@/utils/open-external-url";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";

interface StackMenuProps {
  serverId: string;
  cwd: string;
}
interface StackContentProps extends StackMenuProps {
  client: DaemonClient;
}

export function StackMenu({ serverId, cwd }: StackMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceStack === true,
  );
  let content = <DropdownMenuHint>{t("workspace.git.stack.disconnected")}</DropdownMenuHint>;
  if (connected && client) {
    content = supported ? (
      <StackContent key={`${serverId}:${cwd}`} serverId={serverId} cwd={cwd} client={client} />
    ) : (
      <DropdownMenuHint>{t("workspace.git.stack.updateHost")}</DropdownMenuHint>
    );
  }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        style={toolbarLabelTriggerStyle}
        testID="workspace-stack-trigger"
        accessibilityLabel={t("workspace.git.stack.title")}
      >
        <Text style={toolbarLabelTriggerTextStyle(open)}>{t("workspace.git.stack.title")} ▾</Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        minWidth={320}
        width={520}
        maxHeight={480}
        scrollable
        testID="workspace-stack-menu"
      >
        {open ? content : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StackContent({ serverId, cwd, client }: StackContentProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["workspaceStack", serverId, cwd];
  const query = useFetchQuery({
    queryKey,
    queryFn: async () => {
      const response = await client.getWorkspaceStack(cwd);
      if (response.error) throw new Error(response.error.message);
      return response.stack;
    },
    staleTimeMs: 0,
    dataShape: "value",
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const switchBranch = useMutation({
    mutationFn: async (branch: string) => {
      const response = await client.checkoutSwitchBranch(cwd, branch);
      if (!response.success)
        throw new Error(response.error?.message ?? t("workspace.git.stack.switchFailed"));
    },
    onSuccess: async () => {
      await Promise.all([
        invalidateCheckoutGitQueriesForClient(queryClient, { serverId, cwd }),
        queryClient.invalidateQueries({ queryKey }),
      ]);
    },
  });
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  if (query.isError) {
    return (
      <>
        <DropdownMenuHint>{query.error.message}</DropdownMenuHint>
        <DropdownMenuItem onSelect={refresh} closeOnSelect={false}>
          {t("workspace.git.stack.retry")}
        </DropdownMenuItem>
      </>
    );
  }
  if (query.isPending)
    return <DropdownMenuHint>{t("workspace.git.stack.loading")}</DropdownMenuHint>;
  const stack = query.data;
  if (!stack) return <DropdownMenuHint>{t("workspace.git.stack.empty")}</DropdownMenuHint>;
  return (
    <>
      <DropdownMenuLabel>{stack.prefix}</DropdownMenuLabel>
      <DropdownMenuHint>
        {t("workspace.git.stack.base", { branch: stack.branches[0]?.parent })}
      </DropdownMenuHint>
      {switchBranch.error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {switchBranch.error.message}
        </Text>
      ) : null}
      {stack.branches.map((branch) => (
        <StackRow
          key={branch.name}
          branch={branch}
          current={branch.name === stack.currentBranch}
          serverId={serverId}
          cwd={cwd}
          client={client}
          busy={switchBranch.isPending || query.isFetching}
          pending={switchBranch.isPending && switchBranch.variables === branch.name}
          onSelect={switchBranch.mutate}
        />
      ))}
      <DropdownMenuItem
        onSelect={refresh}
        closeOnSelect={false}
        disabled={switchBranch.isPending}
        status={query.isFetching ? "pending" : "idle"}
        pendingLabel={t("workspace.git.stack.loading")}
      >
        {t("workspace.git.stack.refresh")}
      </DropdownMenuItem>
    </>
  );
}

interface StackRowProps extends StackContentProps {
  branch: WorkspaceStackBranch;
  current: boolean;
  busy: boolean;
  pending: boolean;
  onSelect(branch: string): void;
}

function StackRow({
  branch,
  current,
  busy,
  pending,
  onSelect,
  serverId,
  cwd,
  client,
}: StackRowProps) {
  const { t } = useTranslation();
  const link = useFetchQuery({
    queryKey: ["workspaceStackChangeRequest", serverId, cwd, branch.name, branch.sha],
    queryFn: async () => {
      const response = await client.getWorkspaceStackChangeRequest({
        cwd,
        branch: branch.name,
        sha: branch.sha,
      });
      if (response.error) throw new Error(response.error.message);
      return response.changeRequest;
    },
    staleTimeMs: 60_000,
    dataShape: "value",
    retry: false,
  });
  const openLink = useMutation({ mutationFn: openExternalUrl });
  const selectBranch = useCallback(() => onSelect(branch.name), [onSelect, branch.name]);
  const { refetch: refetchLink } = link;
  const { mutate: openUrl } = openLink;
  const retryLink = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      void refetchLink();
    },
    [refetchLink],
  );
  const pressLink = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      if (link.data) openUrl(link.data.url);
    },
    [link.data, openUrl],
  );
  const trailing = useMemo(() => {
    let linkControl = <Text style={styles.muted}>{t("workspace.git.stack.noMr")}</Text>;
    if (link.isPending)
      linkControl = <Text style={styles.muted}>{t("workspace.git.stack.findingMr")}</Text>;
    if (link.isError)
      linkControl = (
        <Button
          variant="ghost"
          size="xs"
          accessibilityLabel={t("workspace.git.stack.retryMr", { branch: branch.name })}
          onPress={retryLink}
        >
          {t("workspace.git.stack.retry")}
        </Button>
      );
    if (link.data) {
      const { number } = link.data;
      linkControl = (
        <Button
          variant="ghost"
          size="xs"
          disabled={openLink.isPending}
          accessibilityLabel={t("workspace.git.stack.openMr", { branch: branch.name, number })}
          onPress={pressLink}
        >
          !{number} ↗
        </Button>
      );
    }
    return <View style={styles.link}>{linkControl}</View>;
  }, [
    t,
    branch.name,
    link.isPending,
    link.isError,
    link.data,
    openLink.isPending,
    retryLink,
    pressLink,
  ]);
  const leading = useMemo(
    () => (
      <View style={styles.marker}>
        <Text style={styles.muted}>{current ? "→" : ""}</Text>
      </View>
    ),
    [current],
  );
  return (
    <>
      <DropdownMenuItem
        testID={`workspace-stack-branch-${branch.name}`}
        selected={current}
        description={current ? t("workspace.git.stack.current") : branch.subject}
        onSelect={current ? undefined : selectBranch}
        closeOnSelect={false}
        disabled={busy}
        status={pending ? "pending" : "idle"}
        pendingLabel={t("workspace.git.stack.switching", { branch: branch.name })}
        tooltip={branch.name}
        trailing={trailing}
        leading={leading}
      >
        {branch.name}
      </DropdownMenuItem>
      {link.error ? <Text style={styles.error}>{link.error.message}</Text> : null}
      {openLink.error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {openLink.error.message}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  marker: { width: theme.spacing[4], alignItems: "center" },
  link: { width: 88, alignItems: "flex-end", flexShrink: 0 },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
}));
