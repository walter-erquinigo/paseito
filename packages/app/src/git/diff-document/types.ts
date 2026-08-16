import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import type { InlineReviewActions } from "@/review";
import type { FileReviewActions, ReviewableChangedLine } from "@/review";
import type { DiffContextRegion } from "@/git/diff-context-expansion";
import type { ReviewableDiffTarget } from "@/utils/diff-layout";
import type { ChangesSearchMatch, ChangesSearchResult } from "@/git/changes-search";
import type { ChangesLspController } from "@/git/use-changes-lsp";
import type { WorkspaceFileOpenOptions } from "@/workspace/file-open";

interface DiffDocumentBaseProps {
  files: ParsedDiffFile[];
  displayPreferences: {
    layout: "unified" | "split";
    wrapLines: boolean;
    codeFontSize: number;
    monoFontFamily: string;
  };
}

export interface WorkingDiffMode {
  kind: "working";
  reviewActions?: InlineReviewActions;
  /** Capability-gated orchestration stays at ChangesSurface; the document only renders it. */
  fileReviews?: FileReviewActions;
  onExpandContext?: (
    filePath: string,
    region: DiffContextRegion,
    direction: "up" | "down" | "all",
  ) => void | Promise<void>;
  onExpandFile?: (filePath: string) => void | Promise<void>;
  onActivate?: () => void;
  onFilePress?: (path: string) => void;
  focusPath?: string;
  focusRequestId?: number;
  focusLineStart?: number;
  focusLineEnd?: number;
  focusColumn?: number;
  focusReveal?: "center-if-hidden";
  workspaceFileDragScope?: { serverId: string; workspaceId: string };
  onOpenFile?: (path: string, options?: WorkspaceFileOpenOptions) => void;
  onOpenToSide?: (path: string) => void;
  onEditLine?: (line: ReviewableChangedLine) => void;
  onAddToChat?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onCopyRelativePath?: (path: string) => void;
  onReveal?: (path: string) => void;
  revealTargetName?: string;
  onDownload?: (path: string) => void;
  onDuplicate?: (path: string) => void;
  onRevert?: (path: string, oldPath?: string) => void;
  /** Search stays daemon-owned: the document receives matches, never a source corpus. */
  onSearch?: (query: string) => Promise<ChangesSearchResult>;
  searchSupported?: boolean;
  /** Loads a bounded hidden region before the canvas centers a text match. */
  onRevealSearchMatch?: (match: ChangesSearchMatch) => void | Promise<void>;
  /** The shared editor session controller. Only current-side canvas cells become targets. */
  lsp?: ChangesLspController;
}

export interface DiffReviewPresentation {
  selectedLineId: string | null;
  shortcutHint: string | null;
  onSelectLine: (line: ReviewableChangedLine) => void;
  onToggleLine: (line: ReviewableChangedLine) => void;
  onToggleFile: (path: string) => void;
  onExpandContext?: WorkingDiffMode["onExpandContext"];
  focusRequest: number;
}

export type DiffDocumentProps = DiffDocumentBaseProps &
  (
    | {
        mode: WorkingDiffMode;
        collapseState: {
          paths: readonly string[];
          onChange: (paths: string[]) => void;
        };
      }
    | { mode: { kind: "commit" }; collapseState?: never }
  );

export interface DiffTypography {
  family: string;
  size: number;
  lineHeight: number;
}

export interface DiffPalette {
  surface: string;
  headerSurface: string;
  border: string;
  foreground: string;
  foregroundMuted: string;
  addition: string;
  deletion: string;
  additionBackground: string;
  deletionBackground: string;
  emptyBackground: string;
  selection: string;
  syntax: Record<string, string>;
}

export interface DiffTokenRun {
  start: number;
  end: number;
  color: string;
}

export interface DiffFragment {
  start: number;
  end: number;
  text: string;
  width: number;
  top: number;
  baseline: number;
  graphemes: DiffGrapheme[];
}

export interface DiffGrapheme {
  start: number;
  end: number;
  text: string;
  width: number;
}

export interface DiffSourceIdentity {
  hunkIndex: number;
  lineIndex: number;
  side: "old" | "new";
}

export interface DiffCell {
  type: "add" | "remove" | "context" | "header" | "empty";
  content: string;
  lineNumber: number | null;
  tokens: DiffTokenRun[];
  fragments: DiffFragment[];
  reviewTarget: ReviewableDiffTarget | null;
  sourceIdentity: DiffSourceIdentity;
}

export interface DiffLineRow {
  kind: "line";
  index: number;
  fileIndex: number;
  path: string;
  top: number;
  height: number;
  cells: [DiffCell] | [DiffCell | null, DiffCell | null];
  reviewHeight: number;
}

export interface DiffStatusRow {
  kind: "status";
  index: number;
  fileIndex: number;
  path: string;
  top: number;
  height: number;
  label: string;
}

export type DiffRow = DiffLineRow | DiffStatusRow;

export interface DiffFileSection {
  file: ParsedDiffFile;
  fileIndex: number;
  path: string;
  top: number;
  headerHeight: number;
  bodyTop: number;
  bodyHeight: number;
  bottom: number;
  gutterWidth: number;
  contentWidth: number;
  rowStart: number;
  rowEnd: number;
  isCollapsed: boolean;
}

export interface DiffDocumentModel {
  files: DiffFileSection[];
  rows: DiffRow[];
  height: number;
  lineHeight: number;
  layout: "unified" | "split";
  wrapLines: boolean;
  viewportWidth: number;
}

export interface TextMeasurer {
  measure(text: string, weight?: "regular" | "semibold"): number;
  measureAdvances?(graphemes: readonly string[]): number[];
}

export interface BuildDiffDocumentModelInput {
  files: readonly ParsedDiffFile[];
  collapsedFilePaths: ReadonlySet<string>;
  layout: "unified" | "split";
  wrapLines: boolean;
  viewportWidth: number;
  typography: DiffTypography;
  measureText: TextMeasurer;
  palette: DiffPalette;
  reviewActions?: InlineReviewActions;
  /** Fixed space before line numbers for persistent per-line review indicators. */
  reviewIndicatorWidth?: number;
  labels: { binary: string; tooLarge: string };
  /** A geometry-compatible model whose unchanged file measurements may be reused. */
  reuseFrom?: readonly DiffDocumentModel[];
}

export interface DiffCharacterPosition {
  fileIndex: number;
  rowIndex: number;
  cellIndex: number;
  side: "old" | "new";
  /** UTF-16 source offset within the canonical cell content. */
  sourceOffset: number;
}

export type DiffHit =
  | { kind: "header"; path: string }
  | {
      kind: "cell";
      target: ReviewableDiffTarget | null;
      position: DiffCharacterPosition;
    };

export interface DiffSelection {
  anchor: DiffCharacterPosition;
  focus: DiffCharacterPosition;
}

export type DiffScrollAnchor =
  | { kind: "header"; path: string; viewportDelta: number }
  | {
      kind: "text";
      path: string;
      sourceIdentity: DiffSourceIdentity;
      cellOffset: number;
      viewportDelta: number;
    };

export type DiffSurfaceProps = DiffDocumentProps & {
  palette: DiffPalette;
  collapsedFilePaths: ReadonlySet<string>;
  onToggleFile: (path: string) => void;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  reviewPresentation?: DiffReviewPresentation;
};
