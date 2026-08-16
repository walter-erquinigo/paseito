export type ReviewCheckboxState = "unreviewed" | "mixed" | "reviewed";

export function reviewCheckboxVisibility(input: {
  state: ReviewCheckboxState;
  alwaysVisible?: boolean;
  selected?: boolean;
  hovered?: boolean;
  focused?: boolean;
}): boolean {
  return (
    input.state !== "unreviewed" ||
    Boolean(input.alwaysVisible || input.selected || input.hovered || input.focused)
  );
}
