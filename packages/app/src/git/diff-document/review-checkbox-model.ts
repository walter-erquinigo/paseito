export type ReviewCheckboxState = "unreviewed" | "mixed" | "reviewed";
export type ReviewCheckboxAppearance = "checkbox" | "dot";

export function reviewCheckboxVisibility(input: {
  state: ReviewCheckboxState;
  appearance?: ReviewCheckboxAppearance;
  alwaysVisible?: boolean;
  selected?: boolean;
  hovered?: boolean;
  focused?: boolean;
}): boolean {
  return (
    input.appearance === "dot" ||
    input.state !== "unreviewed" ||
    Boolean(input.alwaysVisible || input.selected || input.hovered || input.focused)
  );
}
