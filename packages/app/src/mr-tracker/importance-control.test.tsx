/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme, translations } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8 },
    fontSize: { xs: 11 },
    fontWeight: { medium: "500" },
    borderRadius: { md: 6, lg: 8 },
    borderWidth: { 1: 1 },
    opacity: { 50: 0.5 },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface0: "#000",
      surface3: "#333",
      borderAccent: "#555",
    },
  },
  translations: {
    "mrTracker.importance.important": "Important",
    "mrTracker.importance.ignored": "Ignore",
    "mrTracker.importanceHints.important": "Keep this MR visible in the Important filter.",
    "mrTracker.importanceHints.ignored": "Hide this MR when the Important filter is active.",
  } as Record<string, string>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => translations[key] ?? key }),
}));

vi.mock("react-native", () => ({
  View: ({ children, testID }: React.PropsWithChildren<{ testID?: string }>) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: React.PropsWithChildren) => React.createElement("span", null, children),
  Pressable: ({
    accessibilityHint,
    accessibilityRole,
    accessibilityState,
    children,
    disabled,
    onPress,
    testID,
  }: React.PropsWithChildren<{
    accessibilityHint?: string;
    accessibilityRole?: string;
    accessibilityState?: { selected?: boolean; disabled?: boolean };
    disabled?: boolean;
    onPress?: () => void;
    testID?: string;
  }>) =>
    React.createElement(
      "button",
      {
        "aria-description": accessibilityHint,
        "aria-disabled": accessibilityState?.disabled,
        "aria-selected": accessibilityState?.selected,
        "data-testid": testID,
        disabled,
        onClick: onPress,
        role: accessibilityRole,
        type: "button",
      },
      children,
    ),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (value: typeof theme) => unknown) => factory(theme),
  },
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({ uniProps, ...props }: Record<string, unknown>) =>
      React.createElement(Component, {
        ...props,
        ...(uniProps as (value: typeof theme) => Record<string, unknown>)(theme),
      }),
}));

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": name });
  return {
    CircleMinus: createIcon("CircleMinus"),
    Star: createIcon("Star"),
  };
});

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({
    children,
    delayDuration,
    enabledOnDesktop,
    enabledOnMobile,
  }: React.PropsWithChildren<{
    delayDuration: number;
    enabledOnDesktop: boolean;
    enabledOnMobile: boolean;
  }>) =>
    React.createElement(
      "span",
      {
        "data-delay": delayDuration,
        "data-desktop": enabledOnDesktop,
        "data-mobile": enabledOnMobile,
        "data-tooltip-root": true,
      },
      children,
    ),
  TooltipTrigger: ({ children, disabled }: React.PropsWithChildren<{ disabled?: boolean }>) =>
    React.createElement("span", { "data-trigger-disabled": disabled }, children),
  TooltipContent: ({ children }: React.PropsWithChildren) =>
    React.createElement("span", { "data-tooltip-content": true }, children),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { ImportanceControl } from "./importance-control";

describe("ImportanceControl", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("pairs every triage label with a concise desktop tooltip and accessibility hint", () => {
    act(() =>
      root.render(<ImportanceControl value="important" disabled={false} onChange={vi.fn()} />),
    );

    const expected = [
      ["important", "Important", "Keep this MR visible in the Important filter."],
      ["ignored", "Ignore", "Hide this MR when the Important filter is active."],
    ] as const;
    const tooltipRoots = container.querySelectorAll('[data-tooltip-root="true"]');
    expect(tooltipRoots).toHaveLength(2);

    expected.forEach(([value, label, hint], index) => {
      const button = container.querySelector(`[data-testid="mr-importance-${value}"]`);
      expect(button?.textContent).toBe(label);
      expect(button?.getAttribute("aria-description")).toBe(hint);
      expect(tooltipRoots[index]?.getAttribute("data-delay")).toBe("300");
      expect(tooltipRoots[index]?.getAttribute("data-desktop")).toBe("true");
      expect(tooltipRoots[index]?.getAttribute("data-mobile")).toBe("false");
      expect(tooltipRoots[index]?.querySelector('[data-tooltip-content="true"]')?.textContent).toBe(
        hint,
      );
    });
  });

  it("keeps selection and press behavior unchanged", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(<ImportanceControl value="important" disabled={false} onChange={onChange} />),
    );

    const important = container.querySelector('[data-testid="mr-importance-important"]');
    const ignored = container.querySelector('[data-testid="mr-importance-ignored"]');
    expect(important?.getAttribute("aria-selected")).toBe("true");
    expect(ignored?.getAttribute("aria-selected")).toBe("false");

    act(() => ignored?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("ignored");
  });

  it("disables both options and tooltip triggers while an update is pending", () => {
    const onChange = vi.fn();
    act(() => root.render(<ImportanceControl value="ignored" disabled onChange={onChange} />));

    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    }
    expect(container.querySelectorAll('[data-trigger-disabled="true"]')).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
  });
});
