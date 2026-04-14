export type ConditionMatchMode = "all" | "any";
export type FieldOperator = "equals" | "notEquals" | "contains" | "notContains" | "isEmpty" | "isNotEmpty";
export type HistoryEventType =
  | "send"
  | "delivery"
  | "open"
  | "click"
  | "bounce"
  | "complaint";
export type HistorySubjectMatch = "exact" | "contains";
export type WorkflowPort = "next" | "true" | "false";

export interface FieldCondition {
  id: string;
  kind: "field";
  field: string;
  operator: FieldOperator;
  value: string;
}

export interface HistoryCondition {
  id: string;
  kind: "history";
  subject: string;
  eventType: HistoryEventType;
  subjectMatch: HistorySubjectMatch;
}

export type RecipientCondition = FieldCondition | HistoryCondition;

export interface SendAudience {
  mode: "manual" | "rules";
  manualTo: string;
  matchMode: ConditionMatchMode;
  conditions: RecipientCondition[];
}

export interface SendNode {
  kind: "send";
  id: string;
  label: string;
  from: string;
  subject: string;
  html: string;
  audience: SendAudience;
}

export interface DelayNode {
  kind: "delay";
  id: string;
  label: string;
  delayDays: number;
  delayHours: number;
}

export interface RuleNode {
  kind: "rule";
  id: string;
  label: string;
  matchMode: ConditionMatchMode;
  conditions: RecipientCondition[];
}

export type WorkflowNode = SendNode | DelayNode | RuleNode;

export interface WorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  port: WorkflowPort;
}

export interface CampaignDraft {
  campaignId: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface SavedCampaign extends CampaignDraft {
  createdAt: string;
  updatedAt: string;
}

export const FIELD_OPERATORS: Array<{ value: FieldOperator; label: string }> = [
  { value: "equals", label: "is" },
  { value: "notEquals", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "notContains", label: "does not contain" },
  { value: "isEmpty", label: "is empty" },
  { value: "isNotEmpty", label: "is not empty" },
];

export const HISTORY_EVENTS: HistoryEventType[] = [
  "send",
  "delivery",
  "open",
  "click",
  "bounce",
  "complaint",
];

export const HISTORY_MATCH_OPTIONS: Array<{
  value: HistorySubjectMatch;
  label: string;
}> = [
  { value: "exact", label: "is" },
  { value: "contains", label: "contains" },
];

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createConditionId(): string {
  return uid("cond");
}

export function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function normalizeNumber(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

export function normalizeNumberFromUnknown(
  value: unknown,
  fallback: number
): number {
  return normalizeNumber(String(value ?? fallback), fallback);
}

export function normalizeMatchMode(value: unknown): ConditionMatchMode {
  return value === "any" ? "any" : "all";
}

export function normalizeFieldOperator(value: unknown): FieldOperator {
  if (
    value === "equals" ||
    value === "notEquals" ||
    value === "contains" ||
    value === "notContains" ||
    value === "isEmpty" ||
    value === "isNotEmpty"
  ) {
    return value;
  }
  return "equals";
}

export function normalizeHistoryEventType(value: unknown): HistoryEventType {
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

export function normalizeHistorySubjectMatch(
  value: unknown
): HistorySubjectMatch {
  return value === "contains" ? "contains" : "exact";
}

export function normalizePort(value: unknown): WorkflowPort {
  if (value === "true" || value === "false" || value === "next") {
    return value;
  }
  return "next";
}

export function makeFieldCondition(
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

export function makeHistoryCondition(
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

export function makeDefaultAudience(): SendAudience {
  return {
    mode: "rules",
    manualTo: "",
    matchMode: "all",
    conditions: [makeFieldCondition("verified", "true")],
  };
}

export function createSendNode(overrides: Partial<SendNode> = {}): SendNode {
  const defaultAudience = makeDefaultAudience();
  const { audience: overrideAudienceRaw, ...nodeOverrides } = overrides;
  const overrideAudience: Partial<SendAudience> = overrideAudienceRaw ?? {};
  return {
    kind: "send",
    id: uid("send"),
    label: "Send email",
    from: "",
    subject: "",
    html: "<p>Hello {{email}},</p>\n<p>Your message...</p>",
    ...nodeOverrides,
    audience: {
      ...defaultAudience,
      ...overrideAudience,
      conditions: Array.isArray(overrideAudience.conditions)
        ? overrideAudience.conditions
        : defaultAudience.conditions,
    },
  };
}

export function createDelayNode(overrides: Partial<DelayNode> = {}): DelayNode {
  return {
    kind: "delay",
    id: uid("delay"),
    label: "Delay",
    delayDays: 3,
    delayHours: 0,
    ...overrides,
  };
}

export function createRuleNode(overrides: Partial<RuleNode> = {}): RuleNode {
  return {
    kind: "rule",
    id: uid("rule"),
    label: "Rule",
    matchMode: "all",
    conditions: [makeFieldCondition("verified", "true")],
    ...overrides,
  };
}

export function createEdge(overrides: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return {
    id: uid("edge"),
    fromNodeId: "",
    toNodeId: "",
    port: "next",
    ...overrides,
  };
}

export function isSendNode(node: WorkflowNode): node is SendNode {
  return node.kind === "send";
}

export function isDelayNode(node: WorkflowNode): node is DelayNode {
  return node.kind === "delay";
}

export function isRuleNode(node: WorkflowNode): node is RuleNode {
  return node.kind === "rule";
}

export function nodeKindLabel(node: WorkflowNode): string {
  if (isSendNode(node)) return "Send";
  if (isDelayNode(node)) return "Delay";
  return "Rule";
}

export function nodeSummary(node: WorkflowNode): string {
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
  return `${node.matchMode === "all" ? "Match all" : "Match any"} · ${
    node.conditions.length
  } rule${node.conditions.length === 1 ? "" : "s"}`;
}

export function portLabel(port: WorkflowPort): string {
  if (port === "true") return "true";
  if (port === "false") return "false";
  return "next";
}

export function normalizeRecipientCondition(
  raw: unknown
): RecipientCondition | null {
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

export function normalizeConditions(raw: unknown): RecipientCondition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((condition) => normalizeRecipientCondition(condition))
    .filter((condition): condition is RecipientCondition => !!condition);
}

export function normalizeSendAudience(
  raw: unknown,
  legacyTo = ""
): SendAudience {
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

export function normalizeSendNode(raw: unknown): SendNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  if (normalizeString(node.kind) !== "send") return null;

  const legacyTo = normalizeString(node.to, "");
  return createSendNode({
    id: normalizeString(node.id, uid("send")),
    label: normalizeString(node.label, "Send email"),
    from: normalizeString(node.from, ""),
    subject: normalizeString(node.subject, ""),
    html: normalizeString(
      node.html,
      "<p>Hello {{email}},</p>\n<p>Your message...</p>"
    ),
    audience: normalizeSendAudience(node.audience, legacyTo),
  });
}

export function normalizeDelayNode(raw: unknown): DelayNode | null {
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

export function normalizeRuleNode(raw: unknown): RuleNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  if (normalizeString(node.kind) !== "rule") return null;

  const conditions = normalizeConditions(node.conditions);
  return createRuleNode({
    id: normalizeString(node.id, uid("rule")),
    label: normalizeString(node.label, "Rule"),
    matchMode: normalizeMatchMode(node.matchMode),
    conditions:
      conditions.length > 0
        ? conditions
        : [makeFieldCondition("verified", "true")],
  });
}

export function normalizeNode(raw: unknown): WorkflowNode | null {
  const send = normalizeSendNode(raw);
  if (send) return send;

  const delay = normalizeDelayNode(raw);
  if (delay) return delay;

  const rule = normalizeRuleNode(raw);
  if (rule) return rule;

  return null;
}

export function normalizeEdge(
  raw: unknown,
  nodeIds: Set<string>
): WorkflowEdge | null {
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

  for (const rawPredicate of rawPredicates) {
    if (!rawPredicate || typeof rawPredicate !== "object") continue;
    const predicate = rawPredicate as Record<string, unknown>;
    const kind = normalizeString(predicate.kind);

    if (
      kind === "field_equals" &&
      normalizeString(predicate.field) === "verified"
    ) {
      const value = normalizeString(predicate.value, "true");
      conditions.push(
        makeFieldCondition("verified", value === "false" ? "false" : "true")
      );
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

  return {
    matchMode: "all",
    conditions,
  };
}

export function normalizeCampaignV5(
  raw: Record<string, unknown>
): CampaignDraft | null {
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

export function migrateLegacyCampaign(
  raw: Record<string, unknown>
): CampaignDraft | null {
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
    const sourceNode = sourceNewId
      ? nodes.find((item) => item.id === sourceNewId)
      : null;
    if (!sourceNode || !isSendNode(sourceNode)) continue;

    const delayNode = createDelayNode({
      label: normalizeString(node.label, "Delay"),
      delayDays: normalizeNumberFromUnknown(node.delayDays, 0),
      delayHours: normalizeNumberFromUnknown(node.delayHours, 0),
    });

    const conditionalRules: RecipientCondition[] = [];
    if (Boolean(node.requireOpen) && sourceNode.subject.trim()) {
      conditionalRules.push(
        makeHistoryCondition(sourceNode.subject.trim(), "open", "exact")
      );
    }
    if (Boolean(node.requireVerified)) {
      conditionalRules.push(makeFieldCondition("verified", "true"));
    }

    const ruleNode = createRuleNode({
      label: "Rule",
      matchMode: "all",
      conditions:
        conditionalRules.length > 0
          ? conditionalRules
          : [makeFieldCondition("verified", "true")],
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

      const rawPredicates = Array.isArray(edge.predicates)
        ? edge.predicates
        : [];
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

      const converted = legacyPredicatesToConditions(
        rawPredicates,
        sendMetaByLegacyId
      );
      const ruleNode = createRuleNode({
        label: "Rule",
        matchMode: normalizeMatchMode(edge.matchMode ?? converted.matchMode),
        conditions:
          converted.conditions.length > 0
            ? converted.conditions
            : [makeFieldCondition()],
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

export function normalizeCampaign(raw: unknown): CampaignDraft | null {
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
      (edge) =>
        !!edge &&
        typeof edge === "object" &&
        typeof (edge as Record<string, unknown>).port === "string"
    );

  if (hasV5Node || hasV5Edge) {
    return normalizeCampaignV5(campaign);
  }

  return migrateLegacyCampaign(campaign);
}

export function sanitizeCampaignDraft(draft: CampaignDraft): CampaignDraft {
  const nodeById = new Map(draft.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const edges: WorkflowEdge[] = [];

  for (const edge of draft.edges) {
    const fromNode = nodeById.get(edge.fromNodeId);
    const toNode = nodeById.get(edge.toNodeId);
    if (!fromNode || !toNode || fromNode.id === toNode.id) {
      continue;
    }

    const allowedPorts: WorkflowPort[] = isRuleNode(fromNode)
      ? ["true", "false"]
      : ["next"];
    const normalizedPort = allowedPorts.includes(edge.port)
      ? edge.port
      : allowedPorts[0];
    const key = `${edge.fromNodeId}:${normalizedPort}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    edges.push({
      ...edge,
      port: normalizedPort,
    });
  }

  return {
    ...draft,
    edges,
  };
}

export function campaignListFromStorage(raw: string): SavedCampaign[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const list: SavedCampaign[] = [];
  for (const item of parsed) {
    const normalized = normalizeCampaign(item);
    if (!normalized) continue;
    list.push({
      ...sanitizeCampaignDraft(normalized),
      createdAt: normalizeString(
        (item as { createdAt?: unknown })?.createdAt,
        new Date().toISOString()
      ),
      updatedAt: normalizeString(
        (item as { updatedAt?: unknown })?.updatedAt,
        new Date().toISOString()
      ),
    });
  }
  return list;
}

export function defaultCampaign(): CampaignDraft {
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

export function getIncomingEdgesByNode(
  edges: WorkflowEdge[]
): Map<string, WorkflowEdge[]> {
  const byNode = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const list = byNode.get(edge.toNodeId) ?? [];
    list.push(edge);
    byNode.set(edge.toNodeId, list);
  }
  return byNode;
}

export function getOutgoingEdgesByNode(
  edges: WorkflowEdge[]
): Map<string, WorkflowEdge[]> {
  const byNode = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const list = byNode.get(edge.fromNodeId) ?? [];
    list.push(edge);
    byNode.set(edge.fromNodeId, list);
  }
  return byNode;
}

export function getRootNodeIds(draft: CampaignDraft): string[] {
  const incoming = getIncomingEdgesByNode(draft.edges);
  return draft.nodes
    .filter((node) => (incoming.get(node.id) ?? []).length === 0)
    .map((node) => node.id);
}

export function splitManualRecipients(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,;]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}
