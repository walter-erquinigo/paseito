import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StackMenu } from "@/git/stack-menu";
import { GitActionsSplitButton } from "@/git/actions-split-button";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { useGitActions } from "@/git/use-actions";

interface WorkspaceActionsProps {
  serverId: string;
  cwd: string;
}

export function WorkspaceActions({ serverId, cwd }: WorkspaceActionsProps) {
  const { gitActions } = useGitActions({
    serverId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });

  return (
    <View style={styles.actions}>
      <GitActionsSplitButton gitActions={gitActions} />
      <StackMenu key={`${serverId}:${cwd}`} serverId={serverId} cwd={cwd} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], minWidth: 0 },
}));
