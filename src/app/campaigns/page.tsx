"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { FancySelect } from "@/components/ui/fancy-select";
import { AppSidebar } from "@/components/ui/app-sidebar";

const dagre = require("dagre");

type ConditionMatchMode = "all" | "any";
type FieldOperator = "equals" | "notEquals" | "contains" | "notContains";
type HistoryEventType = "send" | "delivery" | "open" | "click" | "bounce" | "complaint";
type HistorySubjectMatch = "exact" | "contains";
type WorkflowPort = "next" | "true" | "false";

interface FieldCondition {
  id: string;
  kind: "field";
  field: string;
  operator: FieldOperator;
  value: string;
}

interface HistoryCondition {
  id: string;
  kind: "history";
  subject: string;
  eventType: HistoryEventType;
  subjectMatch: HistorySubjectMatch;
}

type RecipientCondition = FieldCondition | HistoryCondition;

interface SendAudience {
  mode: "manual" | "rules";
  manualTo: string;
  matchMode: ConditionMatchMode;
  conditions: RecipientCondition[];
}

interface SendNode {
  kind: "send";
  id: string;
  label: string;
  from: string;
  subject: string;
  html: string;
  audience: SendAudience;
}

interface DelayNode {
  kind: "delay";
  id: string;
  label: string;
  delayDays: number;
  delayHours: number;
}

interface RuleNode {
  kind: "rule";
  id: string;
  label: string;
  matchMode: ConditionMatchMode;
  conditions: RecipientCondition[];
}

type WorkflowNode = SendNode | DelayNode | RuleNode;

interface WorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  port: WorkflowPort;
}

interface CampaignDraft {
  campaignId: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface SavedCampaign extends CampaignDraft {
  createdAt: string;
  updatedAt: string;
}

interface RulesEditorProps {
  matchMode: ConditionMatchMode;
  conditions: RecipientCondition[];
  fieldKeys: string[];
  subjectHints: string[];
  idPrefix: string;
  onChangeMatchMode: (mode: ConditionMatchMode) => void;
  onChangeConditions: (conditions: RecipientCondition[]) => void;
}

const CAMPAIGNS_STORAGE_KEY = "send-again-campaign-workflows-v5";
const NODE_WIDTH = 248;
const NODE_HEIGHT = 116;

const FIELD_OPERATORS: Array<{ value: FieldOperator; label: string }> = [
  { value: "equals", label: "is" },
  { value: "notEquals", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "notContains", label: "does not contain" },
];

const HISTORY_EVENTS: HistoryEventType[] = [
  "send",
  "delivery",
  "open",
  "click",
  "bounce",
  "complaint",
];

const HISTORY_MATCH_OPTIONS: Array<{ value: HistorySubjectMatch; label: string }> = [
  { value: "exact", label: "is" },
  { value: "contains", label: "contains" },
];

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createConditionId(): string {
  return uid("cond");
}

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeNumber(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function normalizeNumberFromUnknown(value: unknown, fallback: number): number {
  return normalizeNumber(String(value ?? fallback), fallback);
}

function normalizeMatchMode(value: unknown): ConditionMatchMode {
  return value === "any" ? "any" : "all";
}

function normalizeFieldOperator(value: unknown): FieldOperator {
  if (
    value === "equals" ||
    value === "notEquals" ||
    value === "contains" ||
    value === "notContains"
  ) {
    return value;
  }
  return "equals";
}

function normalizeHistoryEventType(value: unknown): HistoryEventType {
  if (
    value === "send" ||
    value === "delivery" ||
    value === "open" ||
    value === "click" ||
    value === "bounce" ||
    value === "complaint"
  ) {
    return value;
  }
  return "open";
}

function normalizeHistorySubjectMatch(value: unknown): HistorySubjectMatch {
  return value === "contains" ? "contains" : "exact";
}

function normalizePort(value: unknown): WorkflowPort {
  if (value === "true" || value === "false" || value === "next") return value;
  return "next";
}

function makeFieldCondition(
  field = "verified",
  value = "true",
  id: string = createConditionId()
): FieldCondition {
  return {
    id,
    kind: "field",
    field,
    operator: "equals",
    value,
  };
}

function makeHistoryCondition(
  subject = "",
  eventType: HistoryEventType = "open",
  subjectMatch: HistorySubjectMatch = "exact",
  id: string = createConditionId()
): HistoryCondition {
  return {
    id,
    kind: "history",
    subject,
    eventType,
    subjectMatch,
  };
}

function makeDefaultAudience(): SendAudience {
  return {
    mode: "rules",
    manualTo: "",
    matchMode: "all",
    conditions: [makeFieldCondition("verified", "true")],
  };
}

function createSendNode(overrides: Partial<SendNode> = {}): SendNode {
  const defaultAudience = makeDefaultAudience();
  const overrideAudience: Partial<SendAudience> = overrides.audience ?? {};
  return {
    kind: "send",
    id: uid("send"),
    label: "Send email",
    from: "",
    subject: "",
    html: "<p>Hello {{email}},</p>\n<p>Your message...</p>",
    audience: {
      ...defaultAudience,
      ...overrideAudience,
      conditions: Array.isArray(overrideAudience.conditions)
        ? overrideAudience.conditions
        : defaultAudience.conditions,
    },
    ...overrides,
  };
}

function createDelayNode(overrides: Partial<DelayNode> = {}): DelayNode {
  return {
    kind: "delay",
    id: uid("delay"),
    label: "Delay",
    delayDays: 3,
    delayHours: 0,
    ...overrides,
  };
}

function createRuleNode(overrides: Partial<RuleNode> = {}): RuleNode {
  return {
    kind: "rule",
    id: uid("rule"),
    label: "Rule",
    matchMode: "all",
    conditions: [makeFieldCondition("verified", "true")],
    ...overrides,
  };
}

function createEdge(overrides: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return {
    id: uid("edge"),
    fromNodeId: "",
    toNodeId: "",
    port: "next",
    ...overrides,
  };
}

function isSendNode(node: WorkflowNode): node is SendNode {
  return node.kind === "send";
}

function isDelayNode(node: WorkflowNode): node is DelayNode {
  return node.kind === "delay";
}

function isRuleNode(node: WorkflowNode): node is RuleNode {
  return node.kind === "rule";
}

function nodeKindLabel(node: WorkflowNode): string {
  if (isSendNode(node)) return "Send";
  if (isDelayNode(node)) return "Delay";
  return "Rule";
}

function nodeSummary(node: WorkflowNode): string {
  if (isSendNode(node)) {
    if (node.subject.trim()) return `Subject: ${node.subject.trim()}`;
    return "No subject yet";
  }
  if (isDelayNode(node)) {
    return `Wait ${node.delayDays}d ${node.delayHours}h`;
  }
  if (node.conditions.length === 0) {
    return "No rules yet";
  }
  return `${node.matchMode === "all" ? "Match all" : "Match any"} · ${node.conditions.length} rule${
    node.conditions.length === 1 ? "" : "s"
  }`;
}

function portLabel(port: WorkflowPort): string {
  if (port === "true") return "true";
  if (port === "false") return "false";
  return "next";
}

function edgeColor(port: WorkflowPort): string {
  if (port === "true") return "#16a34a";
  if (port === "false") return "#e11d48";
  return "#64748b";
}

function normalizeRecipientCondition(raw: unknown): RecipientCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const condition = raw as Record<string, unknown>;
  const kind = normalizeString(condition.kind);

  if (kind === "field") {
    return {
      id: normalizeString(condition.id, createConditionId()),
      kind: "field",
      field: normalizeString(condition.field, "verified"),
      operator: normalizeFieldOperator(condition.operator),
      value: normalizeString(condition.value, ""),
    };
  }

  if (kind === "history") {
    return {
      id: normalizeString(condition.id, createConditionId()),
      kind: "history",
      subject: normalizeString(condition.subject, ""),
      eventType: normalizeHistoryEventType(condition.eventType),
      subjectMatch: normalizeHistorySubjectMatch(condition.subjectMatch),
    };
  }

  return null;
}

function normalizeConditions(raw: unknown): RecipientCondition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((condition) => normalizeRecipientCondition(condition))
    .filter((condition): condition is RecipientCondition => !!condition);
}

function normalizeSendAudience(raw: unknown, legacyTo = ""): SendAudience {
  const defaults = makeDefaultAudience();
  if (!raw || typeof raw !== "object") {
    if (legacyTo.trim()) {
      return {
        ...defaults,
        mode: "manual",
        manualTo: legacyTo,
      };
    }
    return defaults;
  }

  const audience = raw as Record<string, unknown>;
  const mode =
    audience.mode === "manual" || audience.mode === "rules"
      ? audience.mode
      : legacyTo.trim()
        ? "manual"
        : "rules";

  const conditions = normalizeConditions(audience.conditions);
  return {
    mode,
    manualTo: normalizeString(audience.manualTo, legacyTo),
    matchMode: normalizeMatchMode(audience.matchMode),
    conditions: conditions.length > 0 ? conditions : defaults.conditions,
  };
}

function normalizeSendNode(raw: unknown): SendNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  if (normalizeString(node.kind) !== "send") return null;

  const legacyTo = normalizeString(node.to, "");
  return createSendNode({
    id: normalizeString(node.id, uid("send")),
    label: normalizeString(node.label, "Send email"),
    from: normalizeString(node.from, ""),
    subject: normalizeString(node.subject, ""),
    html: normalizeString(node.html, "<p>Hello {{email}},</p>\n<p>Your message...</p>"),
    audience: normalizeSendAudience(node.audience, legacyTo),
  });
}

function normalizeDelayNode(raw: unknown): DelayNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  const kind = normalizeString(node.kind);
  if (kind !== "delay" && kind !== "wait") return null;

  return createDelayNode({
    id: normalizeString(node.id, uid("delay")),
    label: normalizeString(node.label, "Delay"),
    delayDays: normalizeNumberFromUnknown(node.delayDays, 0),
    delayHours: normalizeNumberFromUnknown(node.delayHours, 0),
  });
}

function normalizeRuleNode(raw: unknown): RuleNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  if (normalizeString(node.kind) !== "rule") return null;

  const conditions = normalizeConditions(node.conditions);
  return createRuleNode({
    id: normalizeString(node.id, uid("rule")),
    label: normalizeString(node.label, "Rule"),
    matchMode: normalizeMatchMode(node.matchMode),
    conditions: conditions.length > 0 ? conditions : [makeFieldCondition("verified", "true")],
  });
}

function normalizeNode(raw: unknown): WorkflowNode | null {
  const send = normalizeSendNode(raw);
  if (send) return send;

  const delay = normalizeDelayNode(raw);
  if (delay) return delay;

  const rule = normalizeRuleNode(raw);
  if (rule) return rule;

  return null;
}

function normalizeEdge(raw: unknown, nodeIds: Set<string>): WorkflowEdge | null {
  if (!raw || typeof raw !== "object") return null;
  const edge = raw as Record<string, unknown>;
  const fromNodeId = normalizeString(edge.fromNodeId, "");
  const toNodeId = normalizeString(edge.toNodeId, "");
  if (!fromNodeId || !toNodeId) return null;
  if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return null;

  return createEdge({
    id: normalizeString(edge.id, uid("edge")),
    fromNodeId,
    toNodeId,
    port: normalizePort(edge.port),
  });
}

function legacyPredicatesToConditions(
  rawPredicates: unknown[],
  sendMetaByLegacyId: Map<string, { label: string; subject: string }>
): { matchMode: ConditionMatchMode; conditions: RecipientCondition[] } {
  const conditions: RecipientCondition[] = [];
  let sawVerified = false;

  for (const rawPredicate of rawPredicates) {
    if (!rawPredicate || typeof rawPredicate !== "object") continue;
    const predicate = rawPredicate as Record<string, unknown>;
    const kind = normalizeString(predicate.kind);

    if (kind === "field_equals" && normalizeString(predicate.field) === "verified") {
      const value = normalizeString(predicate.value, "true");
      sawVerified = true;
      conditions.push(makeFieldCondition("verified", value === "false" ? "false" : "true"));
      continue;
    }

    if (kind === "opened") {
      const legacySendId = normalizeString(predicate.sendNodeId, "");
      const meta = sendMetaByLegacyId.get(legacySendId);
      const subject = meta?.subject?.trim() || meta?.label?.trim() || "";
      if (!subject) continue;
      conditions.push(makeHistoryCondition(subject, "open", "exact"));
    }
  }

  if (conditions.length === 0 && sawVerified) {
    conditions.push(makeFieldCondition("verified", "true"));
  }

  return {
    matchMode: "all",
    conditions,
  };
}

function normalizeCampaignV5(raw: Record<string, unknown>): CampaignDraft | null {
  if (!Array.isArray(raw.nodes)) return null;
  const nodes = raw.nodes
    .map((node) => normalizeNode(node))
    .filter((node): node is WorkflowNode => !!node);
  if (nodes.length === 0) return null;

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(raw.edges)
    ? raw.edges
        .map((edge) => normalizeEdge(edge, nodeIds))
        .filter((edge): edge is WorkflowEdge => !!edge)
    : [];

  return {
    campaignId: normalizeString(raw.campaignId, uid("cmp")),
    name: normalizeString(raw.name, "Campaign"),
    nodes,
    edges,
  };
}

function migrateLegacyCampaign(raw: Record<string, unknown>): CampaignDraft | null {
  if (!Array.isArray(raw.nodes)) return null;

  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const oldToNewId = new Map<string, string>();
  const sendMetaByLegacyId = new Map<string, { label: string; subject: string }>();

  for (const rawNode of raw.nodes) {
    if (!rawNode || typeof rawNode !== "object") continue;
    const node = rawNode as Record<string, unknown>;
    const kind = normalizeString(node.kind);

    if (kind === "send") {
      const send = normalizeSendNode(node);
      if (!send) continue;
      nodes.push(send);
      const legacyId = normalizeString(node.id, "");
      if (legacyId) {
        oldToNewId.set(legacyId, send.id);
        sendMetaByLegacyId.set(legacyId, {
          label: send.label,
          subject: send.subject,
        });
      }
      continue;
    }

    if (kind === "wait" || kind === "delay") {
      const delay = normalizeDelayNode(node);
      if (!delay) continue;
      nodes.push(delay);
      const legacyId = normalizeString(node.id, "");
      if (legacyId) {
        oldToNewId.set(legacyId, delay.id);
      }
    }
  }

  for (const rawNode of raw.nodes) {
    if (!rawNode || typeof rawNode !== "object") continue;
    const node = rawNode as Record<string, unknown>;
    if (normalizeString(node.kind) !== "conditional") continue;

    const sourceLegacyId = normalizeString(node.sourceStepId, "");
    const sourceNewId = oldToNewId.get(sourceLegacyId) ?? "";
    const sourceNode = sourceNewId ? nodes.find((item) => item.id === sourceNewId) : null;
    if (!sourceNode || !isSendNode(sourceNode)) continue;

    const delayNode = createDelayNode({
      label: normalizeString(node.label, "Delay"),
      delayDays: normalizeNumberFromUnknown(node.delayDays, 0),
      delayHours: normalizeNumberFromUnknown(node.delayHours, 0),
    });

    const conditionalRules: RecipientCondition[] = [];
    if (Boolean(node.requireOpen) && sourceNode.subject.trim()) {
      conditionalRules.push(makeHistoryCondition(sourceNode.subject.trim(), "open", "exact"));
    }
    if (Boolean(node.requireVerified)) {
      conditionalRules.push(makeFieldCondition("verified", "true"));
    }

    const ruleNode = createRuleNode({
      label: "Rule",
      matchMode: "all",
      conditions: conditionalRules.length > 0 ? conditionalRules : [makeFieldCondition("verified", "true")],
    });

    const thenSendRaw = node.thenSend;
    const followSend =
      normalizeSendNode({
        kind: "send",
        ...(typeof thenSendRaw === "object" && thenSendRaw ? thenSendRaw : {}),
      }) ??
      createSendNode({
        label: "Send email",
      });

    nodes.push(delayNode, ruleNode, followSend);
    edges.push(
      createEdge({
        fromNodeId: sourceNode.id,
        toNodeId: delayNode.id,
        port: "next",
      })
    );
    edges.push(
      createEdge({
        fromNodeId: delayNode.id,
        toNodeId: ruleNode.id,
        port: "next",
      })
    );
    edges.push(
      createEdge({
        fromNodeId: ruleNode.id,
        toNodeId: followSend.id,
        port: "true",
      })
    );
  }

  if (Array.isArray(raw.edges)) {
    for (const rawEdge of raw.edges) {
      if (!rawEdge || typeof rawEdge !== "object") continue;
      const edge = rawEdge as Record<string, unknown>;
      const fromLegacyId = normalizeString(edge.fromNodeId, "");
      const toLegacyId = normalizeString(edge.toNodeId, "");
      const fromNodeId = oldToNewId.get(fromLegacyId) ?? "";
      const toNodeId = oldToNewId.get(toLegacyId) ?? "";
      if (!fromNodeId || !toNodeId) continue;

      const rawPredicates = Array.isArray(edge.predicates) ? edge.predicates : [];
      if (rawPredicates.length === 0) {
        edges.push(
          createEdge({
            fromNodeId,
            toNodeId,
            port: "next",
          })
        );
        continue;
      }

      const converted = legacyPredicatesToConditions(rawPredicates, sendMetaByLegacyId);
      const ruleNode = createRuleNode({
        label: "Rule",
        matchMode: normalizeMatchMode(edge.matchMode ?? converted.matchMode),
        conditions: converted.conditions.length > 0 ? converted.conditions : [makeFieldCondition()],
      });
      nodes.push(ruleNode);
      edges.push(
        createEdge({
          fromNodeId,
          toNodeId: ruleNode.id,
          port: "next",
        })
      );
      edges.push(
        createEdge({
          fromNodeId: ruleNode.id,
          toNodeId,
          port: "true",
        })
      );
    }
  }

  if (nodes.length === 0) return null;
  return {
    campaignId: normalizeString(raw.campaignId, uid("cmp")),
    name: normalizeString(raw.name, "Campaign"),
    nodes,
    edges,
  };
}

function normalizeCampaign(raw: unknown): CampaignDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const campaign = raw as Record<string, unknown>;

  const hasV5Node =
    Array.isArray(campaign.nodes) &&
    campaign.nodes.some((node) => {
      if (!node || typeof node !== "object") return false;
      const kind = normalizeString((node as Record<string, unknown>).kind);
      return kind === "rule" || kind === "delay";
    });

  const hasV5Edge =
    Array.isArray(campaign.edges) &&
    campaign.edges.some(
      (edge) => !!edge && typeof edge === "object" && typeof (edge as Record<string, unknown>).port === "string"
    );

  if (hasV5Node || hasV5Edge) {
    return normalizeCampaignV5(campaign);
  }

  return migrateLegacyCampaign(campaign);
}

function campaignListFromStorage(raw: string): SavedCampaign[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];

  const list: SavedCampaign[] = [];
  for (const item of parsed) {
    const normalized = normalizeCampaign(item);
    if (!normalized) continue;
    list.push({
      ...normalized,
      createdAt: normalizeString((item as { createdAt?: unknown })?.createdAt, new Date().toISOString()),
      updatedAt: normalizeString((item as { updatedAt?: unknown })?.updatedAt, new Date().toISOString()),
    });
  }
  return list;
}

function defaultCampaign(): CampaignDraft {
  const send1 = createSendNode({
    label: "First email",
    subject: "Welcome!",
  });
  const delay1 = createDelayNode({
    label: "Wait 3 days",
    delayDays: 3,
    delayHours: 0,
  });
  const rule1 = createRuleNode({
    label: "Opened first email?",
    matchMode: "all",
    conditions: [makeHistoryCondition(send1.subject, "open", "exact")],
  });
  const send2 = createSendNode({
    label: "Follow-up email",
    subject: "Just following up",
  });
  const delay2 = createDelayNode({
    label: "Wait 10 days",
    delayDays: 10,
    delayHours: 0,
  });
  const rule2 = createRuleNode({
    label: "Opened both + verified?",
    matchMode: "all",
    conditions: [
      makeHistoryCondition(send1.subject, "open", "exact"),
      makeHistoryCondition(send2.subject, "open", "exact"),
      makeFieldCondition("verified", "true"),
    ],
  });
  const send3 = createSendNode({
    label: "Final follow-up",
    subject: "Thanks for your interest",
  });

  return {
    campaignId: uid("cmp"),
    name: "Welcome workflow",
    nodes: [send1, delay1, rule1, send2, delay2, rule2, send3],
    edges: [
      createEdge({
        fromNodeId: send1.id,
        toNodeId: delay1.id,
        port: "next",
      }),
      createEdge({
        fromNodeId: delay1.id,
        toNodeId: rule1.id,
        port: "next",
      }),
      createEdge({
        fromNodeId: rule1.id,
        toNodeId: send2.id,
        port: "true",
      }),
      createEdge({
        fromNodeId: send2.id,
        toNodeId: delay2.id,
        port: "next",
      }),
      createEdge({
        fromNodeId: delay2.id,
        toNodeId: rule2.id,
        port: "next",
      }),
      createEdge({
        fromNodeId: rule2.id,
        toNodeId: send3.id,
        port: "true",
      }),
    ],
  };
}

function nodeIcon(node: WorkflowNode) {
  if (isSendNode(node)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="m4 8 8 6 8-6" />
      </svg>
    );
  }
  if (isDelayNode(node)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 8.5V12l2.8 2.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M4 6h7v5H4z" />
      <path d="M13 13h7v5h-7z" />
      <path d="M11 8h4v2h-4z" />
      <path d="M11 15h2v2h-2z" />
    </svg>
  );
}

function RulesEditor({
  matchMode,
  conditions,
  fieldKeys,
  subjectHints,
  idPrefix,
  onChangeMatchMode,
  onChangeConditions,
}: RulesEditorProps) {
  const fieldDatalistId = `${idPrefix}-field-keys`;
  const subjectDatalistId = `${idPrefix}-subjects`;

  function replaceCondition(id: string, next: RecipientCondition) {
    onChangeConditions(conditions.map((condition) => (condition.id === id ? next : condition)));
  }

  function patchCondition(id: string, patch: Partial<RecipientCondition>) {
    onChangeConditions(
      conditions.map((condition) =>
        condition.id === id ? ({ ...condition, ...patch } as RecipientCondition) : condition
      )
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-700">Rules</p>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => onChangeMatchMode("all")}
            className={`rounded-full border px-2 py-1 text-[11px] ${
              matchMode === "all"
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 bg-white text-gray-700"
            }`}
          >
            Match all
          </button>
          <button
            type="button"
            onClick={() => onChangeMatchMode("any")}
            className={`rounded-full border px-2 py-1 text-[11px] ${
              matchMode === "any"
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 bg-white text-gray-700"
            }`}
          >
            Match any
          </button>
          <button
            type="button"
            onClick={() => onChangeConditions([...conditions, makeFieldCondition(fieldKeys[0] ?? "verified")])}
            className="rounded-full border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700"
          >
            + Field
          </button>
          <button
            type="button"
            onClick={() => onChangeConditions([...conditions, makeHistoryCondition("", "open", "exact")])}
            className="rounded-full border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700"
          >
            + History
          </button>
        </div>
      </div>

      {conditions.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">No rules yet.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {conditions.map((condition) => (
            <div key={condition.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      replaceCondition(
                        condition.id,
                        makeFieldCondition(fieldKeys[0] ?? "verified", "true", condition.id)
                      )
                    }
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      condition.kind === "field"
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-300 bg-white text-gray-700"
                    }`}
                  >
                    Field
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      replaceCondition(condition.id, makeHistoryCondition("", "open", "exact", condition.id))
                    }
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      condition.kind === "history"
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-300 bg-white text-gray-700"
                    }`}
                  >
                    History
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onChangeConditions(conditions.filter((item) => item.id !== condition.id))}
                  className="text-[11px] text-red-600"
                >
                  Remove
                </button>
              </div>

              {condition.kind === "field" ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-gray-500">Field</span>
                    <input
                      list={fieldDatalistId}
                      value={condition.field}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        patchCondition(condition.id, { field: event.target.value })
                      }
                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                      placeholder="verified"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-gray-500">Operator</span>
                    <FancySelect
                      wrapperClassName="w-full"
                      className="h-8 border-gray-300 text-xs"
                      value={condition.operator}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                        patchCondition(condition.id, {
                          operator: normalizeFieldOperator(event.target.value),
                        })
                      }
                    >
                      {FIELD_OPERATORS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </FancySelect>
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-gray-500">Value</span>
                    <input
                      value={condition.value}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        patchCondition(condition.id, { value: event.target.value })
                      }
                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                      placeholder="true"
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-gray-500">Subject</span>
                    <input
                      list={subjectDatalistId}
                      value={condition.subject}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        patchCondition(condition.id, { subject: event.target.value })
                      }
                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                      placeholder="Welcome!"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-gray-500">Match</span>
                    <FancySelect
                      wrapperClassName="w-full"
                      className="h-8 border-gray-300 text-xs"
                      value={condition.subjectMatch}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                        patchCondition(condition.id, {
                          subjectMatch: normalizeHistorySubjectMatch(event.target.value),
                        })
                      }
                    >
                      {HISTORY_MATCH_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </FancySelect>
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-gray-500">Event</span>
                    <FancySelect
                      wrapperClassName="w-full"
                      className="h-8 border-gray-300 text-xs"
                      value={condition.eventType}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                        patchCondition(condition.id, {
                          eventType: normalizeHistoryEventType(event.target.value),
                        })
                      }
                    >
                      {HISTORY_EVENTS.map((event) => (
                        <option key={event} value={event}>
                          {event}
                        </option>
                      ))}
                    </FancySelect>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <datalist id={fieldDatalistId}>
        {fieldKeys.map((field) => (
          <option key={field} value={field} />
        ))}
      </datalist>
      <datalist id={subjectDatalistId}>
        {subjectHints.map((subject) => (
          <option key={subject} value={subject} />
        ))}
      </datalist>
    </div>
  );
}

export function CampaignsShell({ embedded = false }: { embedded?: boolean }) {
  const [campaigns, setCampaigns] = useState<SavedCampaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(defaultCampaign());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  const fieldKeys = useMemo(() => ["verified"], []);

  useEffect(() => {
    setIsClient(true);
    const saved = window.localStorage.getItem(CAMPAIGNS_STORAGE_KEY);
    if (!saved) return;
    try {
      setCampaigns(campaignListFromStorage(saved));
    } catch {
      // ignore bad payloads
    }
  }, []);

  useEffect(() => {
    if (!isClient) return;
    window.localStorage.setItem(CAMPAIGNS_STORAGE_KEY, JSON.stringify(campaigns));
  }, [campaigns, isClient]);

  useEffect(() => {
    if (!activeCampaignId || !isClient) return;
    if (draft.campaignId !== activeCampaignId) return;

    setCampaigns((current) =>
      current.map((campaign) =>
        campaign.campaignId === activeCampaignId
          ? { ...campaign, ...draft, updatedAt: new Date().toISOString() }
          : campaign
      )
    );
  }, [activeCampaignId, draft, isClient]);

  const orderedCampaigns = useMemo(() => {
    const list = [...campaigns];
    list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return list;
  }, [campaigns]);

  const nodeById = useMemo(() => new Map(draft.nodes.map((node) => [node.id, node])), [draft.nodes]);
  const incomingEdgesByNode = useMemo(() => {
    const byNode = new Map<string, WorkflowEdge[]>();
    for (const edge of draft.edges) {
      const list = byNode.get(edge.toNodeId) ?? [];
      list.push(edge);
      byNode.set(edge.toNodeId, list);
    }
    return byNode;
  }, [draft.edges]);
  const outgoingEdgesByNode = useMemo(() => {
    const byNode = new Map<string, WorkflowEdge[]>();
    for (const edge of draft.edges) {
      const list = byNode.get(edge.fromNodeId) ?? [];
      list.push(edge);
      byNode.set(edge.fromNodeId, list);
    }
    return byNode;
  }, [draft.edges]);

  const sendNodes = useMemo(
    () => draft.nodes.filter((node): node is SendNode => isSendNode(node)),
    [draft.nodes]
  );
  const delayNodes = useMemo(
    () => draft.nodes.filter((node): node is DelayNode => isDelayNode(node)),
    [draft.nodes]
  );
  const ruleNodes = useMemo(
    () => draft.nodes.filter((node): node is RuleNode => isRuleNode(node)),
    [draft.nodes]
  );
  const subjectHints = useMemo(
    () =>
      Array.from(
        new Set(
          sendNodes
            .map((node) => node.subject.trim())
            .filter(Boolean)
        )
      ),
    [sendNodes]
  );

  useEffect(() => {
    setDraft((current) => {
      const localNodeById = new Map(current.nodes.map((node) => [node.id, node]));
      const dedupe = new Set<string>();
      let changed = false;

      const nextEdges: WorkflowEdge[] = [];
      for (const edge of current.edges) {
        const fromNode = localNodeById.get(edge.fromNodeId);
        const toNode = localNodeById.get(edge.toNodeId);
        if (!fromNode || !toNode || fromNode.id === toNode.id) {
          changed = true;
          continue;
        }

        const allowedPorts: WorkflowPort[] = isRuleNode(fromNode) ? ["true", "false"] : ["next"];
        const normalizedPort = (allowedPorts.includes(edge.port) ? edge.port : allowedPorts[0]) as WorkflowPort;
        if (normalizedPort !== edge.port) {
          changed = true;
        }

        const key = `${edge.fromNodeId}:${normalizedPort}`;
        if (dedupe.has(key)) {
          changed = true;
          continue;
        }
        dedupe.add(key);

        nextEdges.push({ ...edge, port: normalizedPort });
      }

      return changed ? { ...current, edges: nextEdges } : current;
    });
  }, [draft.nodes, draft.edges]);

  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedNodeId(draft.nodes[0]?.id ?? null);
      return;
    }
    const exists = draft.nodes.some((node) => node.id === selectedNodeId);
    if (!exists) {
      setSelectedNodeId(draft.nodes[0]?.id ?? null);
    }
  }, [draft.nodes, selectedNodeId]);

  const selectedNode = useMemo(() => {
    return draft.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [draft.nodes, selectedNodeId]);

  const getTransitionTargetId = useCallback(
    (fromNodeId: string, port: WorkflowPort): string => {
      const target = (outgoingEdgesByNode.get(fromNodeId) ?? []).find((edge) => edge.port === port);
      return target?.toNodeId ?? "";
    },
    [outgoingEdgesByNode]
  );

  const setTransition = useCallback((fromNodeId: string, port: WorkflowPort, toNodeId: string) => {
    setDraft((current) => {
      const validFrom = current.nodes.some((node) => node.id === fromNodeId);
      const validTo = toNodeId === "" || current.nodes.some((node) => node.id === toNodeId);
      if (!validFrom || !validTo || fromNodeId === toNodeId) return current;

      const nextEdges = current.edges.filter(
        (edge) => !(edge.fromNodeId === fromNodeId && edge.port === port)
      );
      if (!toNodeId) {
        return { ...current, edges: nextEdges };
      }
      return {
        ...current,
        edges: [...nextEdges, createEdge({ fromNodeId, toNodeId, port })],
      };
    });
  }, []);

  const createCampaign = useCallback(() => {
    const now = new Date().toISOString();
    const fresh = defaultCampaign();
    const created: SavedCampaign = {
      ...fresh,
      name: `Campaign ${campaigns.length + 1}`,
      createdAt: now,
      updatedAt: now,
    };

    setCampaigns((current) => [created, ...current]);
    setActiveCampaignId(created.campaignId);
    setDraft(created);
    setSelectedNodeId(created.nodes[0]?.id ?? null);
  }, [campaigns.length]);

  const openCampaign = useCallback(
    (campaignId: string) => {
      const campaignToEdit = campaigns.find((campaign) => campaign.campaignId === campaignId);
      if (!campaignToEdit) return;
      setActiveCampaignId(campaignId);
      setDraft(campaignToEdit);
      setSelectedNodeId(campaignToEdit.nodes[0]?.id ?? null);
    },
    [campaigns]
  );

  const closeBuilder = useCallback(() => {
    setActiveCampaignId(null);
    setSelectedNodeId(null);
  }, []);

  const deleteCampaign = useCallback(
    (campaignId: string) => {
      setCampaigns((current) => current.filter((campaign) => campaign.campaignId !== campaignId));
      if (activeCampaignId === campaignId) {
        setActiveCampaignId(null);
        setDraft(defaultCampaign());
        setSelectedNodeId(null);
      }
    },
    [activeCampaignId]
  );

  const updateCampaignName = useCallback((name: string) => {
    setDraft((current) => ({ ...current, name }));
  }, []);

  const updateSendNode = useCallback((id: string, patch: Partial<SendNode>) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        isSendNode(node) && node.id === id ? { ...node, ...patch } : node
      ),
    }));
  }, []);

  const updateSendAudience = useCallback((id: string, updater: (audience: SendAudience) => SendAudience) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        isSendNode(node) && node.id === id
          ? {
              ...node,
              audience: updater(node.audience),
            }
          : node
      ),
    }));
  }, []);

  const updateDelayNode = useCallback((id: string, patch: Partial<DelayNode>) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        isDelayNode(node) && node.id === id ? { ...node, ...patch } : node
      ),
    }));
  }, []);

  const updateRuleNode = useCallback((id: string, patch: Partial<RuleNode>) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        isRuleNode(node) && node.id === id ? { ...node, ...patch } : node
      ),
    }));
  }, []);

  const addNode = useCallback(
    (kind: WorkflowNode["kind"]) => {
      const node =
        kind === "send" ? createSendNode() : kind === "delay" ? createDelayNode() : createRuleNode();

      setDraft((current) => {
        const nextNodes = [...current.nodes, node];
        const sourceId =
          selectedNodeId && current.nodes.some((item) => item.id === selectedNodeId)
            ? selectedNodeId
            : current.nodes.at(-1)?.id ?? "";
        if (!sourceId) {
          return { ...current, nodes: nextNodes };
        }

        const sourceNode = current.nodes.find((item) => item.id === sourceId);
        if (!sourceNode) {
          return { ...current, nodes: nextNodes };
        }

        const fromEdges = current.edges.filter((edge) => edge.fromNodeId === sourceNode.id);
        if (isRuleNode(sourceNode)) {
          const trueUsed = fromEdges.some((edge) => edge.port === "true");
          const falseUsed = fromEdges.some((edge) => edge.port === "false");
          if (trueUsed && falseUsed) {
            return { ...current, nodes: nextNodes };
          }
          const port: WorkflowPort = trueUsed ? "false" : "true";
          return {
            ...current,
            nodes: nextNodes,
            edges: [...current.edges, createEdge({ fromNodeId: sourceNode.id, toNodeId: node.id, port })],
          };
        }

        const nextUsed = fromEdges.some((edge) => edge.port === "next");
        if (nextUsed) {
          return { ...current, nodes: nextNodes };
        }
        return {
          ...current,
          nodes: nextNodes,
          edges: [...current.edges, createEdge({ fromNodeId: sourceNode.id, toNodeId: node.id, port: "next" })],
        };
      });

      setSelectedNodeId(node.id);
    },
    [selectedNodeId]
  );

  const deleteNode = useCallback((id: string) => {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== id),
      edges: current.edges.filter((edge) => edge.fromNodeId !== id && edge.toNodeId !== id),
    }));
    setSelectedNodeId((current) => (current === id ? null : current));
  }, []);

  const loadExample = useCallback(() => {
    setDraft((current) => {
      const sample = defaultCampaign();
      return {
        ...sample,
        campaignId: current.campaignId,
        name: current.name,
      };
    });
  }, []);

  const layout = useMemo(() => {
    const graph = new dagre.graphlib.Graph({ multigraph: true });
    graph.setGraph({
      rankdir: "TB",
      ranksep: 120,
      nodesep: 64,
      edgesep: 32,
      marginx: 48,
      marginy: 40,
      acyclicer: "greedy",
    });
    graph.setDefaultEdgeLabel(() => ({}));

    for (const node of draft.nodes) {
      graph.setNode(node.id, {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    }

    for (const edge of draft.edges) {
      graph.setEdge(
        edge.fromNodeId,
        edge.toNodeId,
        {
          minlen: edge.port === "false" ? 2 : 1,
          weight: edge.port === "next" ? 4 : 2,
        },
        edge.id
      );
    }

    dagre.layout(graph);

    const positions = new Map<string, { x: number; y: number }>();
    let maxX = 0;
    let maxY = 0;
    for (const node of draft.nodes) {
      const point = graph.node(node.id) as { x: number; y: number } | undefined;
      const x = point ? point.x - NODE_WIDTH / 2 : 48;
      const y = point ? point.y - NODE_HEIGHT / 2 : 40;
      positions.set(node.id, { x, y });
      maxX = Math.max(maxX, x + NODE_WIDTH);
      maxY = Math.max(maxY, y + NODE_HEIGHT);
    }

    const graphBounds = graph.graph() as { width?: number; height?: number };
    return {
      positions,
      width: Math.max(900, Math.ceil((graphBounds.width ?? maxX) + 80)),
      height: Math.max(420, Math.ceil((graphBounds.height ?? maxY) + 80)),
    };
  }, [draft.nodes, draft.edges]);

  function renderTextField(
    label: string,
    value: string,
    onChange: (value: string) => void,
    placeholder = ""
  ) {
    return (
      <label className="space-y-1 block">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <input
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          value={value}
          placeholder={placeholder}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        />
      </label>
    );
  }

  function renderNumberField(label: string, value: number, onChange: (value: number) => void) {
    return (
      <label className="space-y-1 block">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <input
          type="number"
          min={0}
          step={1}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onChange(normalizeNumber(event.target.value, 0))
          }
        />
      </label>
    );
  }

  function renderTextareaField(
    label: string,
    value: string,
    onChange: (value: string) => void,
    rows = 4
  ) {
    return (
      <label className="space-y-1 block">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <textarea
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          rows={rows}
          value={value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        />
      </label>
    );
  }

  const sidebar = (
    <AppSidebar
      brand="Email Campaign"
      userEmail="Campaign workspace"
      controls={
        <div className="px-3 mt-4 mb-4">
          <button
            type="button"
            onClick={createCampaign}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-100"
          >
            New campaign
          </button>
        </div>
      }
      items={[
        { id: "compose", label: "Compose", href: "/", active: false },
        { id: "contacts", label: "Contacts", href: "/", active: false },
        { id: "history", label: "History", href: "/", active: false },
        { id: "campaigns", label: "Campaigns", href: "/campaigns", active: true },
        { id: "settings", label: "Settings", href: "/", active: false },
      ]}
      footer={<span className="text-xs text-gray-500">{campaigns.length} campaigns</span>}
    />
  );

  const content = (
    <div className="flex flex-1 min-w-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1600px] p-4">
        {activeCampaignId === null ? (
          <div className="mx-auto w-full max-w-3xl">
            <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[.16em] text-gray-500">Campaigns</p>
                <h1 className="text-xl font-semibold">Email Campaigns</h1>
              </div>
              <button
                type="button"
                onClick={createCampaign}
                className="rounded-full border border-gray-900 bg-gray-900 px-4 py-1.5 text-sm text-white"
              >
                Create new campaign
              </button>
            </header>

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">Campaign list</p>
              {orderedCampaigns.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">
                  No campaigns yet. Create one to get started.
                </p>
              ) : (
                <div className="mt-3 grid gap-2">
                  {orderedCampaigns.map((campaign) => {
                    const sendCount = campaign.nodes.filter((node) => node.kind === "send").length;
                    const delayCount = campaign.nodes.filter((node) => node.kind === "delay").length;
                    const ruleCount = campaign.nodes.filter((node) => node.kind === "rule").length;
                    return (
                      <div
                        key={campaign.campaignId}
                        className="rounded-xl border border-gray-200 bg-gray-50 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-gray-900">{campaign.name}</p>
                            <p className="text-xs text-gray-500">
                              Updated {campaign.updatedAt.slice(0, 10)} · {sendCount} send · {delayCount} delay ·{" "}
                              {ruleCount} rule
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openCampaign(campaign.campaignId);
                              }}
                              className="rounded-full border border-gray-900 bg-gray-900 px-3 py-1 text-xs text-white"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                deleteCampaign(campaign.campaignId);
                              }}
                              className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="flex min-h-[760px] overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
              <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-[.16em] text-gray-500">Workflow builder</p>
                  <div className="mt-2 max-w-md">
                    {renderTextField("Campaign name", draft.name, updateCampaignName)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                    <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5">
                      {sendNodes.length} send
                    </span>
                    <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5">
                      {delayNodes.length} delay
                    </span>
                    <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5">
                      {ruleNodes.length} rule
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => addNode("send")}
                    className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                  >
                    + Send email
                  </button>
                  <button
                    type="button"
                    onClick={() => addNode("delay")}
                    className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                  >
                    + Delay
                  </button>
                  <button
                    type="button"
                    onClick={() => addNode("rule")}
                    className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                  >
                    + Rule
                  </button>
                  <button
                    type="button"
                    onClick={loadExample}
                    className="rounded-full border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm text-white"
                  >
                    Load example
                  </button>
                  <button
                    type="button"
                    onClick={closeBuilder}
                    className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm"
                  >
                    Campaign list
                  </button>
                </div>
              </header>

              <section className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Workflow graph</p>
                  <p className="text-xs text-gray-500">Select node to edit on right panel.</p>
                </div>

                {draft.nodes.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
                    <p className="text-sm text-gray-600">Create your first node.</p>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => addNode("send")}
                        className="rounded-full border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm text-white"
                      >
                        Add send
                      </button>
                      <button
                        type="button"
                        onClick={() => addNode("delay")}
                        className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm"
                      >
                        Add delay
                      </button>
                      <button
                        type="button"
                        onClick={() => addNode("rule")}
                        className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm"
                      >
                        Add rule
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-gray-50">
                    <div
                      className="relative"
                      style={{
                        width: `${layout.width}px`,
                        height: `${layout.height}px`,
                      }}
                    >
                      <svg
                        className="absolute left-0 top-0 h-full w-full"
                        viewBox={`0 0 ${layout.width} ${layout.height}`}
                      >
                        {draft.edges.map((edge) => {
                          const from = layout.positions.get(edge.fromNodeId);
                          const to = layout.positions.get(edge.toNodeId);
                          const fromNode = nodeById.get(edge.fromNodeId);
                          if (!from || !to || !fromNode) return null;

                          const sourceX = isRuleNode(fromNode)
                            ? edge.port === "true"
                              ? from.x + NODE_WIDTH * 0.35
                              : from.x + NODE_WIDTH * 0.65
                            : from.x + NODE_WIDTH / 2;
                          const sourceY = from.y + NODE_HEIGHT;
                          const targetX = to.x + NODE_WIDTH / 2;
                          const targetY = to.y;
                          const controlOffset = Math.max(72, Math.abs(targetY - sourceY) * 0.45);
                          const controlY1 = sourceY + controlOffset;
                          const controlY2 = targetY - controlOffset;
                          const path = `M ${sourceX} ${sourceY} C ${sourceX} ${controlY1}, ${targetX} ${controlY2}, ${targetX} ${targetY}`;

                          const midX = (sourceX + targetX) / 2;
                          const midY = (sourceY + targetY) / 2;

                          return (
                            <g key={edge.id}>
                              <path
                                d={path}
                                fill="none"
                                stroke={edgeColor(edge.port)}
                                strokeWidth="2.2"
                                markerEnd="url(#campaign-arrow)"
                              />
                              <rect
                                x={midX - 18}
                                y={midY - 10}
                                width="36"
                                height="16"
                                rx="8"
                                fill="white"
                                stroke={edgeColor(edge.port)}
                              />
                              <text
                                x={midX}
                                y={midY + 2}
                                fontSize="10"
                                textAnchor="middle"
                                fill={edgeColor(edge.port)}
                              >
                                {portLabel(edge.port)}
                              </text>
                            </g>
                          );
                        })}
                        <defs>
                          <marker
                            id="campaign-arrow"
                            markerWidth="10"
                            markerHeight="8"
                            refX="9"
                            refY="4"
                            orient="auto"
                            markerUnits="strokeWidth"
                          >
                            <path d="M0,0 L10,4 L0,8 z" fill="#64748b" />
                          </marker>
                        </defs>
                      </svg>

                      {draft.nodes.map((node, index) => {
                        const position = layout.positions.get(node.id);
                        if (!position) return null;
                        const selected = selectedNodeId === node.id;
                        const outgoing = outgoingEdgesByNode.get(node.id) ?? [];

                        return (
                          <div
                            key={node.id}
                            className="absolute"
                            style={{
                              left: `${position.x}px`,
                              top: `${position.y}px`,
                              width: `${NODE_WIDTH}px`,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(node.id)}
                              className={`relative w-full rounded-xl border bg-white p-3 text-left transition ${
                                selected
                                  ? "border-gray-900 shadow ring-2 ring-gray-900/15"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                              style={{ minHeight: `${NODE_HEIGHT}px` }}
                            >
                              <span className="absolute left-1/2 -top-2 h-3 w-3 -trangray-x-1/2 rounded-full border border-gray-300 bg-white" />
                              {isRuleNode(node) ? (
                                <>
                                  <span className="absolute bottom-[-6px] left-[35%] h-3 w-3 -trangray-x-1/2 rounded-full border border-emerald-300 bg-emerald-500" />
                                  <span className="absolute bottom-[-6px] left-[65%] h-3 w-3 -trangray-x-1/2 rounded-full border border-rose-300 bg-rose-500" />
                                </>
                              ) : (
                                <span className="absolute bottom-[-6px] left-1/2 h-3 w-3 -trangray-x-1/2 rounded-full border border-gray-300 bg-gray-600" />
                              )}

                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full border ${
                                      isSendNode(node)
                                        ? "border-blue-200 bg-blue-50 text-blue-700"
                                        : isDelayNode(node)
                                          ? "border-amber-200 bg-amber-50 text-amber-700"
                                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    }`}
                                  >
                                    {nodeIcon(node)}
                                  </span>
                                  <div>
                                    <p className="text-[11px] uppercase tracking-[.16em] text-gray-500">
                                      {nodeKindLabel(node)}
                                    </p>
                                    <p className="text-xs text-gray-500">Step {index + 1}</p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    deleteNode(node.id);
                                  }}
                                  className="text-[11px] text-red-600"
                                >
                                  delete
                                </button>
                              </div>

                              <h3 className="mt-2 text-sm font-semibold text-gray-900">
                                {node.label || "Untitled"}
                              </h3>
                              <p className="mt-1 text-xs text-gray-600">{nodeSummary(node)}</p>

                              <div className="mt-2 space-y-1">
                                {outgoing.length === 0 ? (
                                  <p className="text-[11px] text-gray-400">No transition</p>
                                ) : (
                                  outgoing.map((edge) => {
                                    const target = nodeById.get(edge.toNodeId);
                                    const targetLabel = target ? target.label || target.id : edge.toNodeId;
                                    return (
                                      <p key={edge.id} className="text-[11px] text-gray-500">
                                        <span className="font-medium text-gray-700">{portLabel(edge.port)}</span>
                                        {" → "}
                                        {targetLabel}
                                      </p>
                                    );
                                  })
                                )}
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            </div>

            <aside className="w-[420px] shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4">
              <div className="border-b border-gray-200 pb-3">
                <p className="text-xs uppercase tracking-[.16em] text-gray-500">Node editor</p>
                <p className="mt-1 text-sm font-semibold">
                  {selectedNode ? selectedNode.label || "Untitled node" : "Select a node"}
                </p>
              </div>

              {!selectedNode ? (
                <p className="mt-4 text-sm text-gray-500">Select a node from the graph.</p>
              ) : (
                <div className="mt-4 space-y-4">
                  {isSendNode(selectedNode) ? (
                    <>
                      {renderTextField("Label", selectedNode.label, (value) =>
                        updateSendNode(selectedNode.id, { label: value })
                      )}
                      {renderTextField("From", selectedNode.from, (value) =>
                        updateSendNode(selectedNode.id, { from: value })
                      )}
                      {renderTextField("Subject", selectedNode.subject, (value) =>
                        updateSendNode(selectedNode.id, { subject: value })
                      )}
                      {renderTextareaField("HTML", selectedNode.html, (value) =>
                        updateSendNode(selectedNode.id, { html: value }),
                        7
                      )}

                      <div className="rounded-xl border border-gray-200 p-3">
                        <p className="text-xs uppercase tracking-[.16em] text-gray-500">Audience</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Same logic as Compose: manual recipients or field/history rules.
                        </p>
                        <div className="mt-2 flex gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              updateSendAudience(selectedNode.id, (audience) => ({
                                ...audience,
                                mode: "manual",
                              }))
                            }
                            className={`rounded-full border px-2 py-1 text-xs ${
                              selectedNode.audience.mode === "manual"
                                ? "border-gray-900 bg-gray-900 text-white"
                                : "border-gray-300 bg-white text-gray-700"
                            }`}
                          >
                            Manual
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateSendAudience(selectedNode.id, (audience) => ({
                                ...audience,
                                mode: "rules",
                              }))
                            }
                            className={`rounded-full border px-2 py-1 text-xs ${
                              selectedNode.audience.mode === "rules"
                                ? "border-gray-900 bg-gray-900 text-white"
                                : "border-gray-300 bg-white text-gray-700"
                            }`}
                          >
                            Rules
                          </button>
                        </div>

                        {selectedNode.audience.mode === "manual" ? (
                          <div className="mt-2">
                            {renderTextareaField(
                              "Recipients (one email per line)",
                              selectedNode.audience.manualTo,
                              (value) =>
                                updateSendAudience(selectedNode.id, (audience) => ({
                                  ...audience,
                                  manualTo: value,
                                })),
                              4
                            )}
                          </div>
                        ) : (
                          <div className="mt-2">
                            <RulesEditor
                              idPrefix={`send-${selectedNode.id}`}
                              matchMode={selectedNode.audience.matchMode}
                              conditions={selectedNode.audience.conditions}
                              fieldKeys={fieldKeys}
                              subjectHints={subjectHints}
                              onChangeMatchMode={(mode) =>
                                updateSendAudience(selectedNode.id, (audience) => ({
                                  ...audience,
                                  matchMode: mode,
                                }))
                              }
                              onChangeConditions={(conditions) =>
                                updateSendAudience(selectedNode.id, (audience) => ({
                                  ...audience,
                                  conditions,
                                }))
                              }
                            />
                          </div>
                        )}
                      </div>

                      <label className="space-y-1 block">
                        <span className="text-xs font-medium text-gray-700">Next step</span>
                        <FancySelect
                          wrapperClassName="w-full"
                          className="h-9 border-gray-300 text-sm"
                          value={getTransitionTargetId(selectedNode.id, "next")}
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            setTransition(selectedNode.id, "next", event.target.value)
                          }
                        >
                          <option value="">None</option>
                          {draft.nodes
                            .filter((node) => node.id !== selectedNode.id)
                            .map((node) => (
                              <option key={node.id} value={node.id}>
                                {node.label || node.id}
                              </option>
                            ))}
                        </FancySelect>
                      </label>
                    </>
                  ) : null}

                  {isDelayNode(selectedNode) ? (
                    <>
                      {renderTextField("Label", selectedNode.label, (value) =>
                        updateDelayNode(selectedNode.id, { label: value })
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        {renderNumberField("Delay days", selectedNode.delayDays, (value) =>
                          updateDelayNode(selectedNode.id, { delayDays: value })
                        )}
                        {renderNumberField("Delay hours", selectedNode.delayHours, (value) =>
                          updateDelayNode(selectedNode.id, { delayHours: value })
                        )}
                      </div>
                      <label className="space-y-1 block">
                        <span className="text-xs font-medium text-gray-700">Next step</span>
                        <FancySelect
                          wrapperClassName="w-full"
                          className="h-9 border-gray-300 text-sm"
                          value={getTransitionTargetId(selectedNode.id, "next")}
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            setTransition(selectedNode.id, "next", event.target.value)
                          }
                        >
                          <option value="">None</option>
                          {draft.nodes
                            .filter((node) => node.id !== selectedNode.id)
                            .map((node) => (
                              <option key={node.id} value={node.id}>
                                {node.label || node.id}
                              </option>
                            ))}
                        </FancySelect>
                      </label>
                    </>
                  ) : null}

                  {isRuleNode(selectedNode) ? (
                    <>
                      {renderTextField("Label", selectedNode.label, (value) =>
                        updateRuleNode(selectedNode.id, { label: value })
                      )}
                      <RulesEditor
                        idPrefix={`rule-${selectedNode.id}`}
                        matchMode={selectedNode.matchMode}
                        conditions={selectedNode.conditions}
                        fieldKeys={fieldKeys}
                        subjectHints={subjectHints}
                        onChangeMatchMode={(mode) =>
                          updateRuleNode(selectedNode.id, { matchMode: mode })
                        }
                        onChangeConditions={(conditions) =>
                          updateRuleNode(selectedNode.id, { conditions })
                        }
                      />

                      <label className="space-y-1 block">
                        <span className="text-xs font-medium text-gray-700">If true</span>
                        <FancySelect
                          wrapperClassName="w-full"
                          className="h-9 border-gray-300 text-sm"
                          value={getTransitionTargetId(selectedNode.id, "true")}
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            setTransition(selectedNode.id, "true", event.target.value)
                          }
                        >
                          <option value="">None</option>
                          {draft.nodes
                            .filter((node) => node.id !== selectedNode.id)
                            .map((node) => (
                              <option key={node.id} value={node.id}>
                                {node.label || node.id}
                              </option>
                            ))}
                        </FancySelect>
                      </label>

                      <label className="space-y-1 block">
                        <span className="text-xs font-medium text-gray-700">If false</span>
                        <FancySelect
                          wrapperClassName="w-full"
                          className="h-9 border-gray-300 text-sm"
                          value={getTransitionTargetId(selectedNode.id, "false")}
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            setTransition(selectedNode.id, "false", event.target.value)
                          }
                        >
                          <option value="">None</option>
                          {draft.nodes
                            .filter((node) => node.id !== selectedNode.id)
                            .map((node) => (
                              <option key={node.id} value={node.id}>
                                {node.label || node.id}
                              </option>
                            ))}
                        </FancySelect>
                      </label>
                    </>
                  ) : null}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="app-shell bg-gray-100 text-gray-900">
      {sidebar}
      {content}
    </div>
  );
}

export default function CampaignsPage() {
  return <CampaignsShell />;
}
