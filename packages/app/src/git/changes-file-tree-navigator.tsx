import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { PanelRightClose, PanelRightOpen } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DiffStat } from "@/components/diff-stat";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { TreeChevron, TreeIndentGuides, treeRowPaddingLeft } from "@/components/tree-primitives";
import { type DiffTreeFileRow, type DiffTreeFolderRow } from "@/git/diff-tree";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import {
  buildChangesFileTreeRows,
  getChangesFileStatus,
  type ChangesFileStatus,
} from "@/git/changes-file-tree-navigation";
import { useTranslation } from "react-i18next";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { Theme } from "@/styles/theme";

export const CHANGES_FILE_TREE_WIDTH = 240;
export const CHANGES_FILE_TREE_MIN_PANE_WIDTH = 800;

interface ChangesFileTreeNavigatorProps {
  files: ParsedDiffFile[];
  selectedPath: string | null;
  collapsedFolders: string[];
  onActivateFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onCollapse: () => void;
}

interface ChangesFileTreeToggleProps {
  collapsed: boolean;
  onToggle: () => void;
}

const foregroundMutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedPanelRightClose = withUnistyles(PanelRightClose);
const ThemedPanelRightOpen = withUnistyles(PanelRightOpen);

function navigatorButtonStyle({ pressed }: PressableStateCallbackType) {
  return [styles.iconButton, pressed && styles.iconButtonPressed];
}

function fileStatusCode(status: ChangesFileStatus): "A" | "D" | "M" {
  if (status === "added") {
    return "A";
  }
  if (status === "deleted") {
    return "D";
  }
  return "M";
}

function fileStatusStyle(status: ChangesFileStatus) {
  if (status === "added") {
    return styles.addedStatus;
  }
  if (status === "deleted") {
    return styles.deletedStatus;
  }
  return styles.modifiedStatus;
}

function ChangesFileTreeFolderRow({
  row,
  collapsed,
  onToggle,
}: {
  row: DiffTreeFolderRow;
  collapsed: boolean;
  onToggle: (path: string) => void;
}) {
  const toggle = useCallback(() => onToggle(row.dirPath), [onToggle, row.dirPath]);
  const rowStyle = useMemo(
    () => [styles.treeRow, inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(row.depth) })],
    [row.depth],
  );
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [rowStyle, pressed && styles.treeRowPressed],
    [rowStyle],
  );

  return (
    <View testID={`changes-file-tree-folder-${row.dirPath}`} style={styles.rowContainer}>
      <TreeIndentGuides depth={row.depth} />
      <Pressable
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={toggle}
        style={pressableStyle}
        testID={`changes-file-tree-folder-${row.dirPath}-toggle`}
      >
        <View style={styles.rowMain}>
          <TreeChevron expanded={!collapsed} />
          <Text numberOfLines={1} style={styles.folderName}>
            {row.displayName}
          </Text>
        </View>
        <DiffStat additions={row.additions} deletions={row.deletions} />
      </Pressable>
    </View>
  );
}

function ChangesFileTreeFileRow({
  row,
  selected,
  onActivate,
}: {
  row: DiffTreeFileRow;
  selected: boolean;
  onActivate: (path: string) => void;
}) {
  const { t } = useTranslation();
  const path = row.file.path;
  const name = path.split("/").findLast(Boolean) ?? path;
  const status = getChangesFileStatus(row.file);
  const statusLabel = t(`workspace.git.diff.fileStatus.${status}`);
  const activate = useCallback(() => onActivate(path), [onActivate, path]);
  const rowStyle = useMemo(
    () => [styles.treeRow, inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(row.depth) })],
    [row.depth],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      rowStyle,
      selected && styles.selectedFileRow,
      pressed && styles.treeRowPressed,
    ],
    [rowStyle, selected],
  );

  return (
    <View testID={`changes-file-tree-file-${path}`} style={styles.rowContainer}>
      <TreeIndentGuides depth={row.depth} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${path}, ${statusLabel}`}
        accessibilityState={accessibilityState}
        aria-selected={selected}
        onPress={activate}
        style={pressableStyle}
        testID={`changes-file-tree-file-${path}-activate`}
      >
        <View style={styles.rowMain}>
          <MaterialFileIcon fileName={name} size={16} />
          <Text numberOfLines={1} style={styles.fileName}>
            {name}
          </Text>
        </View>
        <Text
          accessibilityLabel={statusLabel}
          style={fileStatusStyle(status)}
          testID={`changes-file-tree-file-${path}-status`}
        >
          {fileStatusCode(status)}
        </Text>
        <DiffStat
          additions={row.file.additions}
          deletions={row.file.deletions}
          testID={`changes-file-tree-file-${path}-stat`}
        />
      </Pressable>
    </View>
  );
}

export function ChangesFileTreeToggle({ collapsed, onToggle }: ChangesFileTreeToggleProps) {
  const { t } = useTranslation();
  const label = t(
    collapsed ? "workspace.git.diff.showFileNavigator" : "workspace.git.diff.hideFileNavigator",
  );
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      onPress={onToggle}
      style={navigatorButtonStyle}
      testID="working-diff-toggle-file-tree"
    >
      {collapsed ? (
        <ThemedPanelRightOpen size={14} uniProps={foregroundMutedIconColorMapping} />
      ) : (
        <ThemedPanelRightClose size={14} uniProps={foregroundMutedIconColorMapping} />
      )}
    </Pressable>
  );
}

export function ChangesFileTreeNavigator({
  files,
  selectedPath,
  collapsedFolders,
  onActivateFile,
  onToggleFolder,
  onCollapse,
}: ChangesFileTreeNavigatorProps) {
  const { t } = useTranslation();
  const collapsedFolderSet = useMemo(() => new Set(collapsedFolders), [collapsedFolders]);
  const rows = useMemo(() => {
    return buildChangesFileTreeRows(files, collapsedFolderSet);
  }, [collapsedFolderSet, files]);

  return (
    <View style={styles.navigator} testID="changes-file-tree-navigator">
      <View style={styles.header} testID="changes-file-tree-header">
        <Text style={styles.headerTitle}>{t("workspace.git.diff.fileNavigator")}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.git.diff.hideFileNavigator")}
          onPress={onCollapse}
          style={navigatorButtonStyle}
          testID="changes-file-tree-collapse"
        >
          <ThemedPanelRightClose size={14} uniProps={foregroundMutedIconColorMapping} />
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {rows.map((row) =>
          row.kind === "folder" ? (
            <ChangesFileTreeFolderRow
              key={`folder-${row.dirPath}`}
              row={row}
              collapsed={collapsedFolderSet.has(row.dirPath)}
              onToggle={onToggleFolder}
            />
          ) : (
            <ChangesFileTreeFileRow
              key={`file-${row.file.path}`}
              row={row}
              selected={row.file.path === selectedPath}
              onActivate={onActivateFile}
            />
          ),
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  navigator: {
    width: CHANGES_FILE_TREE_WIDTH,
    minWidth: CHANGES_FILE_TREE_WIDTH,
    maxWidth: CHANGES_FILE_TREE_WIDTH,
    minHeight: 0,
    backgroundColor: theme.colors.surface1,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  header: {
    height: 36,
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  iconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  iconButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: theme.spacing[1],
  },
  rowContainer: {
    position: "relative",
  },
  treeRow: {
    minHeight: 32,
    paddingRight: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  treeRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  selectedFileRow: {
    backgroundColor: theme.colors.surface3,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  folderName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  fileName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  addedStatus: {
    color: theme.colors.diffAddition,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  deletedStatus: {
    color: theme.colors.diffDeletion,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  modifiedStatus: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
