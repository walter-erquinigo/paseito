/* eslint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop -- The recursive controlled rule editor binds callbacks to immutable tree nodes; its children are not memoized. */
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChevronDown, ChevronLeft, Plus, Trash2, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import type {
  MRAutomationCondition,
  MRAutomationFieldDescriptor,
  MRAutomationOperationDescriptor,
  MRAutomationOutcome,
  MRAutomationPredicateDescriptor,
  MRAutomationPreviewResult,
  MRAutomationRule,
  MRAutomationViewState,
} from "./automation-types";

interface MRAutomationPanelProps {
  automation: MRAutomationViewState;
  onClose(): void;
  onSave(rules: MRAutomationRule[]): Promise<void>;
  onPreview(rule: MRAutomationRule): Promise<MRAutomationPreviewResult[]>;
  mode?: "panel" | "sheet";
}

type PanelPage = "rules" | "activity";

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createRule(name: string): MRAutomationRule {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: newId("rule"),
    revision: 1,
    name,
    enabled: false,
    scope: "owned",
    condition: { id: newId("condition"), kind: "all", children: [] },
    outcomes: [],
    createdAt: now,
    updatedAt: now,
  };
}

function defaultConfig(fields: readonly MRAutomationFieldDescriptor[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => {
      if (field.type === "boolean") return [field.key, false];
      if (field.type === "multi-select" || field.type === "gitlab-users") return [field.key, []];
      if (field.type === "select") return [field.key, field.options[0]?.value ?? ""];
      return [field.key, ""];
    }),
  );
}

function hasFieldValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return Boolean(value.trim());
  return value !== undefined && value !== null;
}

function configIsValid(
  fields: readonly MRAutomationFieldDescriptor[],
  config: Record<string, unknown>,
): boolean {
  return fields.every((field) => !field.required || hasFieldValue(config[field.key]));
}

function conditionIsValid(
  condition: MRAutomationCondition,
  predicates: readonly MRAutomationPredicateDescriptor[],
): boolean {
  if (condition.kind === "predicate") {
    const descriptor = predicates.find((value) => value.id === condition.contributionId);
    return Boolean(descriptor && configIsValid(descriptor.fields, condition.config));
  }
  if (condition.kind === "not") return conditionIsValid(condition.child, predicates);
  return (
    condition.children.length > 0 &&
    condition.children.every((child) => conditionIsValid(child, predicates))
  );
}

function isRuleValid(
  rule: MRAutomationRule,
  predicates: readonly MRAutomationPredicateDescriptor[],
  operations: readonly MRAutomationOperationDescriptor[],
): boolean {
  if (!rule.name.trim() || !conditionIsValid(rule.condition, predicates) || !rule.outcomes.length) {
    return false;
  }
  return rule.outcomes.every((outcome) => {
    const operation = operations.find((value) => value.id === outcome.operationId);
    return Boolean(
      operation &&
      operation.allowedPresentations.includes(outcome.presentation) &&
      configIsValid(operation.fields, outcome.config) &&
      (outcome.presentation === "automatic" || outcome.label?.trim()),
    );
  });
}

export function MRAutomationPanel({
  automation,
  onClose,
  onSave,
  onPreview,
  mode = "panel",
}: MRAutomationPanelProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState<PanelPage>("rules");
  const [draft, setDraft] = useState<MRAutomationRule | null>(null);
  const [preview, setPreview] = useState<MRAutomationPreviewResult[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveRules = useCallback(
    async (rules: MRAutomationRule[]) => {
      setPending(true);
      setError(null);
      try {
        await onSave(rules);
      } catch (value) {
        setError(value instanceof Error ? value.message : String(value));
        throw value;
      } finally {
        setPending(false);
      }
    },
    [onSave],
  );
  const handleCreate = useCallback(() => {
    setDraft(createRule(t("mrTracker.automation.newRule")));
    setPreview(null);
  }, [t]);
  const handleEdit = useCallback((rule: MRAutomationRule) => {
    setDraft(structuredClone(rule));
    setPreview(null);
  }, []);
  const handleSaveDraft = useCallback(async () => {
    if (!draft || !isRuleValid(draft, automation.predicates, automation.operations)) return;
    const existing = automation.rules.find((rule) => rule.id === draft.id);
    const saved: MRAutomationRule = {
      ...draft,
      revision: existing ? existing.revision + 1 : 1,
      createdAt: existing?.createdAt ?? draft.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await saveRules([...automation.rules.filter((rule) => rule.id !== saved.id), saved]);
    setDraft(null);
    setPreview(null);
  }, [automation.operations, automation.predicates, automation.rules, draft, saveRules]);
  const handleToggle = useCallback(
    (rule: MRAutomationRule, enabled: boolean) => {
      const updated = automation.rules.map((candidate) =>
        candidate.id === rule.id
          ? {
              ...candidate,
              enabled,
              revision: candidate.revision + 1,
              updatedAt: new Date().toISOString(),
            }
          : candidate,
      );
      void saveRules(updated);
    },
    [automation.rules, saveRules],
  );
  const handleDelete = useCallback(
    (ruleId: string) => {
      void saveRules(automation.rules.filter((rule) => rule.id !== ruleId));
      setDraft(null);
    },
    [automation.rules, saveRules],
  );
  const handlePreview = useCallback(async () => {
    if (!draft || !isRuleValid(draft, automation.predicates, automation.operations)) return;
    setPending(true);
    setError(null);
    try {
      setPreview(await onPreview(draft));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setPending(false);
    }
  }, [automation.operations, automation.predicates, draft, onPreview]);

  if (draft) {
    return (
      <RuleEditor
        rule={draft}
        predicates={automation.predicates}
        operations={automation.operations}
        preview={preview}
        pending={pending}
        error={error}
        onChange={setDraft}
        onBack={() => setDraft(null)}
        onDelete={() => handleDelete(draft.id)}
        onPreview={handlePreview}
        onSave={handleSaveDraft}
      />
    );
  }

  let pageContent;
  if (page === "rules") {
    pageContent = automation.rules.length ? (
      automation.rules.map((rule) => (
        <RuleListRow
          key={rule.id}
          rule={rule}
          pending={pending}
          onEdit={() => handleEdit(rule)}
          onToggle={(enabled) => handleToggle(rule, enabled)}
        />
      ))
    ) : (
      <Text style={styles.empty}>{t("mrTracker.automation.noRules")}</Text>
    );
  } else {
    pageContent = automation.receipts.length ? (
      automation.receipts.toReversed().map((receipt) => (
        <View key={receipt.id} style={styles.receipt}>
          <Text style={styles.receiptTitle}>{receipt.status}</Text>
          <Text style={styles.hint}>
            {receipt.mergeRequestId} · {new Date(receipt.startedAt).toLocaleString()}
          </Text>
          {receipt.error ? <Text style={styles.error}>{receipt.error}</Text> : null}
        </View>
      ))
    ) : (
      <Text style={styles.empty}>{t("mrTracker.automation.noActivity")}</Text>
    );
  }

  return (
    <View style={[styles.panel, mode === "sheet" && styles.sheet]} testID="mr-automation-panel">
      <View style={styles.panelHeader}>
        <View style={styles.pageTabs}>
          <PageTab
            selected={page === "rules"}
            label={t("mrTracker.automation.rules")}
            onPress={() => setPage("rules")}
          />
          <PageTab
            selected={page === "activity"}
            label={t("mrTracker.automation.activity")}
            onPress={() => setPage("activity")}
          />
        </View>
        {page === "rules" ? (
          <Button size="xs" variant="ghost" leftIcon={Plus} onPress={handleCreate}>
            {t("mrTracker.automation.add")}
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          leftIcon={X}
          accessibilityLabel={t("mrTracker.automation.collapse")}
          onPress={onClose}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView contentContainerStyle={styles.panelContent}>{pageContent}</ScrollView>
    </View>
  );
}

function PageTab({
  selected,
  label,
  onPress,
}: {
  selected: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pageTab, selected && styles.pageTabSelected]}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.pageTabText, selected && styles.pageTabTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function RuleListRow({
  rule,
  pending,
  onEdit,
  onToggle,
}: {
  rule: MRAutomationRule;
  pending: boolean;
  onEdit(): void;
  onToggle(value: boolean): void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.ruleRow}>
      <Pressable
        onPress={onEdit}
        style={styles.ruleRowContent}
        accessibilityRole="button"
        accessibilityLabel={rule.name}
        testID={`mr-automation-rule-${rule.id}`}
      >
        <Text style={styles.ruleTitle}>{rule.name}</Text>
        <Text style={styles.hint} numberOfLines={2}>
          {rule.outcomes.length}{" "}
          {t(
            rule.outcomes.length === 1
              ? "mrTracker.automation.outcome"
              : "mrTracker.automation.outcomes",
          )}
        </Text>
      </Pressable>
      <Switch
        value={rule.enabled}
        disabled={pending}
        onValueChange={onToggle}
        accessibilityLabel={`${rule.name} enabled`}
      />
    </View>
  );
}

function RuleEditor({
  rule,
  predicates,
  operations,
  preview,
  pending,
  error,
  onChange,
  onBack,
  onDelete,
  onPreview,
  onSave,
}: {
  rule: MRAutomationRule;
  predicates: MRAutomationPredicateDescriptor[];
  operations: MRAutomationOperationDescriptor[];
  preview: MRAutomationPreviewResult[] | null;
  pending: boolean;
  error: string | null;
  onChange(value: MRAutomationRule): void;
  onBack(): void;
  onDelete(): void;
  onPreview(): void;
  onSave(): void;
}) {
  const { t } = useTranslation();
  const updateCondition = useCallback(
    (condition: MRAutomationCondition) => onChange({ ...rule, condition }),
    [onChange, rule],
  );
  const addOutcome = useCallback(() => {
    const operation = operations[0];
    if (!operation) return;
    const presentation = operation.allowedPresentations[0] ?? "button";
    onChange({
      ...rule,
      outcomes: [
        ...rule.outcomes,
        {
          id: newId("outcome"),
          presentation,
          label: presentation === "automatic" ? undefined : operation.title,
          requireConfirmation: operation.kind === "mutation",
          executionPolicy: presentation === "automatic" ? "per_transition" : undefined,
          operationId: operation.id,
          config: defaultConfig(operation.fields),
        },
      ],
    });
  }, [onChange, operations, rule]);
  const matchCount = preview?.filter((entry) => entry.state === "match").length ?? 0;
  const unknownCount = preview?.filter((entry) => entry.state === "unknown").length ?? 0;
  const valid = isRuleValid(rule, predicates, operations);
  return (
    <View style={styles.panel} testID="mr-automation-editor">
      <View style={styles.panelHeader}>
        <Button size="xs" variant="ghost" leftIcon={ChevronLeft} onPress={onBack}>
          {t("mrTracker.automation.rules")}
        </Button>
        <Text style={styles.editorTitle}>{t("mrTracker.automation.editRule")}</Text>
        <Switch
          value={rule.enabled}
          onValueChange={(enabled) => onChange({ ...rule, enabled })}
          accessibilityLabel={t("mrTracker.automation.enabled")}
        />
      </View>
      <ScrollView contentContainerStyle={styles.editorContent}>
        <View style={styles.fieldBlock}>
          <Text style={styles.label}>{t("mrTracker.automation.name")}</Text>
          <FormTextInput
            key={`${rule.id}-name`}
            initialValue={rule.name}
            onChangeText={(name) => onChange({ ...rule, name })}
            placeholder={t("mrTracker.automation.namePlaceholder")}
          />
        </View>
        <Text style={styles.sectionLabel}>{t("mrTracker.automation.when")}</Text>
        <ConditionEditor
          value={rule.condition}
          predicates={predicates}
          onChange={updateCondition}
        />
        <Text style={styles.sectionLabel}>{t("mrTracker.automation.thenOutcome")}</Text>
        <View style={styles.outcomeList}>
          {rule.outcomes.map((outcome) => (
            <OutcomeEditor
              key={outcome.id}
              value={outcome}
              operations={operations}
              onChange={(value) =>
                onChange({
                  ...rule,
                  outcomes: rule.outcomes.map((candidate) =>
                    candidate.id === value.id ? value : candidate,
                  ),
                })
              }
              onRemove={() =>
                onChange({
                  ...rule,
                  outcomes: rule.outcomes.filter((candidate) => candidate.id !== outcome.id),
                })
              }
            />
          ))}
          <Button size="sm" variant="outline" leftIcon={Plus} onPress={addOutcome}>
            {t("mrTracker.automation.addOutcome")}
          </Button>
        </View>
        {preview ? (
          <View style={styles.preview}>
            <Text style={styles.ruleTitle}>
              {t("mrTracker.automation.previewMatches", {
                matches: matchCount,
                total: preview.length,
              })}
            </Text>
            {unknownCount ? (
              <Text style={styles.error}>
                {t("mrTracker.automation.previewUnknown", { count: unknownCount })}
              </Text>
            ) : null}
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.editorFooter}>
        <Button size="sm" variant="ghost" leftIcon={Trash2} onPress={onDelete} disabled={pending}>
          {t("mrTracker.automation.delete")}
        </Button>
        <View style={styles.footerSpacer} />
        <Button size="sm" variant="outline" onPress={onPreview} disabled={pending || !valid}>
          {t("mrTracker.automation.preview")}
        </Button>
        <Button size="sm" onPress={onSave} disabled={pending || !valid}>
          {t("mrTracker.automation.save")}
        </Button>
      </View>
    </View>
  );
}

function ConditionEditor({
  value,
  predicates,
  onChange,
  onRemove,
}: {
  value: MRAutomationCondition;
  predicates: MRAutomationPredicateDescriptor[];
  onChange(value: MRAutomationCondition): void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  if (value.kind === "predicate") {
    const descriptor = predicates.find((candidate) => candidate.id === value.contributionId);
    return (
      <View style={styles.conditionCard}>
        <View style={styles.conditionHeader}>
          <DescriptorPicker
            value={value.contributionId}
            descriptors={predicates}
            onChange={(next) =>
              onChange({
                id: value.id,
                kind: "predicate",
                contributionId: next.id,
                config: defaultConfig(next.fields),
              })
            }
          />
          {onRemove ? (
            <Button
              size="xs"
              variant="ghost"
              leftIcon={Trash2}
              accessibilityLabel={t("mrTracker.automation.removeCondition")}
              onPress={onRemove}
            />
          ) : null}
        </View>
        {descriptor?.fields.map((field) => (
          <ConfigField
            key={field.key}
            field={field}
            value={value.config[field.key]}
            onChange={(next) =>
              onChange({ ...value, config: { ...value.config, [field.key]: next } })
            }
          />
        ))}
      </View>
    );
  }
  if (value.kind === "not") {
    return (
      <View style={styles.conditionGroup}>
        <View style={styles.conditionHeader}>
          <Text style={styles.groupLabel}>{t("mrTracker.automation.not")}</Text>
          {onRemove ? (
            <Button
              size="xs"
              variant="ghost"
              leftIcon={Trash2}
              accessibilityLabel={t("mrTracker.automation.removeGroup")}
              onPress={onRemove}
            />
          ) : null}
        </View>
        <ConditionEditor
          value={value.child}
          predicates={predicates}
          onChange={(child) => onChange({ ...value, child })}
        />
      </View>
    );
  }
  const addPredicate = () => {
    const descriptor = predicates[0];
    if (!descriptor) return;
    onChange({
      ...value,
      children: [
        ...value.children,
        {
          id: newId("condition"),
          kind: "predicate",
          contributionId: descriptor.id,
          config: defaultConfig(descriptor.fields),
        },
      ],
    });
  };
  const addGroup = (kind: "all" | "any" | "not") => {
    const descriptor = predicates[0];
    if (!descriptor) return;
    const predicate: MRAutomationCondition = {
      id: newId("condition"),
      kind: "predicate",
      contributionId: descriptor.id,
      config: defaultConfig(descriptor.fields),
    };
    const child: MRAutomationCondition =
      kind === "not"
        ? { id: newId("condition"), kind: "not", child: predicate }
        : { id: newId("condition"), kind, children: [predicate] };
    onChange({ ...value, children: [...value.children, child] });
  };
  return (
    <View style={styles.conditionGroup}>
      <View style={styles.conditionHeader}>
        <DropdownValue
          label={
            value.kind === "all"
              ? t("mrTracker.automation.allConditions")
              : t("mrTracker.automation.anyCondition")
          }
          options={[
            { value: "all", label: t("mrTracker.automation.allConditions") },
            { value: "any", label: t("mrTracker.automation.anyCondition") },
          ]}
          onChange={(kind) => onChange({ ...value, kind: kind as "all" | "any" })}
        />
        {onRemove ? (
          <Button
            size="xs"
            variant="ghost"
            leftIcon={Trash2}
            accessibilityLabel={t("mrTracker.automation.removeGroup")}
            onPress={onRemove}
          />
        ) : null}
      </View>
      <View style={styles.conditionChildren}>
        {value.children.map((child, index) => (
          <ConditionEditor
            key={child.id ?? child.kind}
            value={child}
            predicates={predicates}
            onChange={(next) =>
              onChange({
                ...value,
                children: value.children.map((candidate, childIndex) =>
                  childIndex === index ? next : candidate,
                ),
              })
            }
            onRemove={() =>
              onChange({
                ...value,
                children: value.children.filter((_candidate, childIndex) => childIndex !== index),
              })
            }
          />
        ))}
      </View>
      <View style={styles.addRow}>
        <Button size="xs" variant="outline" leftIcon={Plus} onPress={addPredicate}>
          {t("mrTracker.automation.condition")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger style={styles.addGroupTrigger}>
            <Text style={styles.addGroupText}>{t("mrTracker.automation.group")}</Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" width={180}>
            <DropdownMenuItem onSelect={() => addGroup("all")}>
              {t("mrTracker.automation.allGroup")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addGroup("any")}>
              {t("mrTracker.automation.anyGroup")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addGroup("not")}>
              {t("mrTracker.automation.notGroup")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    </View>
  );
}

function OutcomeEditor({
  value,
  operations,
  onChange,
  onRemove,
}: {
  value: MRAutomationOutcome;
  operations: MRAutomationOperationDescriptor[];
  onChange(value: MRAutomationOutcome): void;
  onRemove(): void;
}) {
  const { t } = useTranslation();
  const descriptor = operations.find((candidate) => candidate.id === value.operationId);
  let presentationLabel = t("mrTracker.automation.showLink");
  if (value.presentation === "automatic") {
    presentationLabel = t("mrTracker.automation.runAutomatically");
  } else if (value.presentation === "button") {
    presentationLabel = t("mrTracker.automation.showAction");
  }
  return (
    <View style={styles.conditionCard}>
      <View style={styles.conditionHeader}>
        <DropdownValue
          label={presentationLabel}
          options={[
            { value: "automatic", label: t("mrTracker.automation.runAutomatically") },
            { value: "button", label: t("mrTracker.automation.showAction") },
            { value: "link", label: t("mrTracker.automation.showLink") },
          ].filter((option) =>
            operations.some((operation) =>
              operation.allowedPresentations.includes(option.value as never),
            ),
          )}
          onChange={(presentation) => {
            const nextPresentation = presentation as MRAutomationOutcome["presentation"];
            const operation = operations.find((candidate) =>
              candidate.allowedPresentations.includes(nextPresentation),
            );
            if (!operation) return;
            onChange({
              ...value,
              presentation: nextPresentation,
              label: nextPresentation === "automatic" ? undefined : value.label || operation.title,
              executionPolicy:
                nextPresentation === "automatic"
                  ? (value.executionPolicy ?? "per_transition")
                  : undefined,
              operationId: operation.id,
              config: defaultConfig(operation.fields),
            });
          }}
        />
        <Button
          size="xs"
          variant="ghost"
          leftIcon={Trash2}
          accessibilityLabel={t("mrTracker.automation.removeOutcome")}
          onPress={onRemove}
        />
      </View>
      <DescriptorPicker
        value={value.operationId}
        descriptors={operations.filter((operation) =>
          operation.allowedPresentations.includes(value.presentation),
        )}
        onChange={(operation) =>
          onChange({
            ...value,
            operationId: operation.id,
            config: defaultConfig(operation.fields),
          })
        }
      />
      {value.presentation !== "automatic" ? (
        <ConfigField
          field={{
            key: "label",
            type: "text",
            label: t("mrTracker.automation.buttonLabel"),
            required: true,
          }}
          value={value.label ?? ""}
          onChange={(label) => onChange({ ...value, label: String(label) })}
        />
      ) : null}
      {descriptor?.fields.map((field) => (
        <ConfigField
          key={field.key}
          field={field}
          value={value.config[field.key]}
          onChange={(next) =>
            onChange({ ...value, config: { ...value.config, [field.key]: next } })
          }
        />
      ))}
      {descriptor?.kind === "mutation" && value.presentation === "button" ? (
        <View style={styles.switchRow}>
          <Text style={styles.label}>{t("mrTracker.automation.requireConfirmation")}</Text>
          <Switch
            value={value.requireConfirmation !== false}
            onValueChange={(requireConfirmation) => onChange({ ...value, requireConfirmation })}
          />
        </View>
      ) : null}
      {descriptor?.kind === "mutation" && value.presentation === "automatic" ? (
        <View style={styles.switchRow}>
          <Text style={styles.label}>{t("mrTracker.automation.runOncePerMergeRequest")}</Text>
          <Switch
            value={value.executionPolicy === "once_per_merge_request"}
            onValueChange={(runOnce) =>
              onChange({
                ...value,
                executionPolicy: runOnce ? "once_per_merge_request" : "per_transition",
              })
            }
          />
        </View>
      ) : null}
    </View>
  );
}

function DescriptorPicker<T extends { id: string; title: string }>({
  value,
  descriptors,
  onChange,
}: {
  value: string;
  descriptors: T[];
  onChange(value: T): void;
}) {
  const { t } = useTranslation();
  const current = descriptors.find((descriptor) => descriptor.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger style={styles.dropdownTrigger}>
        <Text style={styles.dropdownText} numberOfLines={1}>
          {current?.title ?? t("mrTracker.automation.missingContribution")}
        </Text>
        <ChevronDown size={13} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={280}>
        {descriptors.map((descriptor) => (
          <DropdownMenuItem
            key={descriptor.id}
            selected={descriptor.id === value}
            onSelect={() => onChange(descriptor)}
          >
            {descriptor.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DropdownValue({
  label,
  options,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger style={styles.dropdownTrigger}>
        <Text style={styles.dropdownText}>{label}</Text>
        <ChevronDown size={13} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={220}>
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConfigField({
  field,
  value,
  onChange,
}: {
  field: MRAutomationFieldDescriptor;
  value: unknown;
  onChange(value: unknown): void;
}) {
  const { t } = useTranslation();
  if (field.type === "boolean") {
    return (
      <View style={styles.switchRow}>
        <Text style={styles.label}>{field.label}</Text>
        <Switch value={value === true} onValueChange={onChange} />
      </View>
    );
  }
  if (field.type === "select") {
    const selected = field.options.find((option) => option.value === value) ?? field.options[0];
    return (
      <View style={styles.fieldBlock}>
        <Text style={styles.label}>{field.label}</Text>
        <DropdownValue
          label={selected?.label ?? t("mrTracker.automation.select")}
          options={field.options}
          onChange={onChange}
        />
      </View>
    );
  }
  const array = field.type === "gitlab-users" || field.type === "multi-select";
  let initialValue = "";
  if (array && Array.isArray(value)) initialValue = value.join(", ");
  else if (!array && (typeof value === "string" || typeof value === "number")) {
    initialValue = String(value);
  }
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>{field.label}</Text>
      <FormTextInput
        initialValue={initialValue}
        placeholder={"placeholder" in field ? field.placeholder : undefined}
        multiline={field.type === "multiline" || field.type === "json"}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(text) => {
          if (array) {
            onChange(
              text
                .split(",")
                .map((entry) => entry.trim().replace(/^@/, ""))
                .filter(Boolean),
            );
          } else if (field.type === "number") onChange(Number(text));
          else onChange(text);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    width: 400,
    minWidth: 360,
    maxWidth: 520,
    flexShrink: 0,
    backgroundColor: theme.colors.surface1,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  sheet: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    flex: 1,
    borderLeftWidth: 0,
  },
  panelHeader: {
    minHeight: 48,
    paddingHorizontal: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  panelContent: { padding: theme.spacing[3], gap: theme.spacing[2] },
  editorContent: { padding: theme.spacing[3], gap: theme.spacing[3] },
  pageTabs: { flexDirection: "row", flex: 1, gap: theme.spacing[1] },
  pageTab: { paddingHorizontal: theme.spacing[2], paddingVertical: theme.spacing[1] },
  pageTabSelected: { borderBottomWidth: 2, borderBottomColor: theme.colors.accent },
  pageTabText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  pageTabTextSelected: { color: theme.colors.foreground, fontWeight: "600" },
  ruleRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
  },
  ruleRowContent: { flex: 1, gap: 3 },
  ruleTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    padding: 24,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    margin: theme.spacing[2],
  },
  receipt: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    gap: 4,
  },
  receiptTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textTransform: "capitalize",
  },
  editorTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  fieldBlock: { gap: theme.spacing[1] },
  conditionGroup: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  conditionCard: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    gap: theme.spacing[2],
  },
  conditionHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  conditionChildren: { gap: theme.spacing[2], paddingLeft: theme.spacing[2] },
  groupLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  addRow: { flexDirection: "row", gap: theme.spacing[2] },
  addGroupTrigger: {
    minHeight: 30,
    paddingHorizontal: theme.spacing[2],
    alignItems: "center",
    justifyContent: "center",
  },
  addGroupText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  dropdownTrigger: {
    flex: 1,
    minHeight: 32,
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  dropdownText: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  outcomeList: { gap: theme.spacing[2] },
  preview: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    gap: 4,
  },
  editorFooter: {
    minHeight: 56,
    padding: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  footerSpacer: { flex: 1 },
}));
