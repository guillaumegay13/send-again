"use client";

import {
  Fragment,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  ChangeEvent,
  FormEvent,
} from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";
import { appendWorkspaceFooter } from "@/lib/email-footer";
import { FancySelect } from "@/components/ui/fancy-select";
import { AppSidebar } from "@/components/ui/app-sidebar";
import { CampaignsShell } from "./campaigns/page";

type Tab = "compose" | "contacts" | "history" | "settings" | "campaigns";
type HistoryView = "activity" | "performance";

interface Workspace {
  id: string;
  name: string;
  from: string;
  fromName: string;
  configSet: string;
  rateLimit: number;
  footerHtml: string;
  websiteUrl: string;
  contactSourceProvider: "manual" | "http_json";
  contactSourceConfig: Record<string, string>;
  verified: boolean;
}

interface Contact {
  email: string;
  fields: Record<string, string>;
}

interface ContactsBatchImportResponse {
  ok: boolean;
  imported: number;
  skippedUnsubscribed: number;
}

interface CsvImportHeader {
  index: number;
  label: string;
  normalizedKey: string;
  selected: boolean;
  targetField: string;
}

interface CsvImportConfig {
  workspaceId: string;
  fileName: string;
  rowCount: number;
  emailColumnIndex: number;
  headers: CsvImportHeader[];
}

interface ParseCSVOptions {
  emailColumnIndex?: number;
  fieldMapByIndex?: Record<number, string>;
  existingByEmail?: Map<string, Contact>;
}

interface EmailEvent {
  type: string;
  timestamp: string;
  detail: string;
}

interface HistoryItem {
  messageId: string;
  recipient: string;
  subject: string;
  sentAt: string;
  events: EmailEvent[];
}

interface HistoryListResponse {
  items: HistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

interface SubjectCampaignMetric {
  subject: string;
  totalSends: number;
  openedSends: number;
  clickedSends: number;
  openRate: number;
  ctr: number;
}

interface SubjectCampaignMetricsResponse {
  items: SubjectCampaignMetric[];
}

interface CampaignLinkRecipient {
  recipient: string;
  totalClicks: number;
  lastClickedAt: string;
}

interface CampaignLinkMetric {
  url: string;
  totalClicks: number;
  uniqueClickers: number;
  clickRate: number;
  lastClickedAt: string;
  recipients: CampaignLinkRecipient[];
}

interface CampaignPerformanceAnalytics {
  subject: string;
  totalSends: number;
  deliveredSends: number;
  undeliveredSends: number;
  openedSends: number;
  clickedSends: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  clickedLinks: CampaignLinkMetric[];
}

const HISTORY_RULES_PAGE_SIZE = 100;
const HISTORY_TABLE_PAGE_SIZE = 25;
const CONTACTS_TABLE_PAGE_SIZE = 200;
const CONTACT_IMPORT_BATCH_SIZE = 1000;
const NAMECHEAP_DNS_STORAGE_KEY = "send-again.namecheap-dns";

interface SendJobStatusResponse {
  id: string;
  workspaceId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  sent: number;
  failed: number;
  dryRun: boolean;
  rateLimit: number;
  batchSize: number;
  sendConcurrency: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt: string | null;
  updatedAt: string;
  subject: string;
  errorMessage: string | null;
  remaining: number;
  recentErrors: string[];
  percent: number;
  isDone: boolean;
}

interface SendJobSummary {
  id: string;
  workspaceId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  sent: number;
  failed: number;
}

interface ApiKeyMeta {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
}

interface SetupStatus {
  verificationToken: string | null;
  verificationStatus: "NotStarted" | "Pending" | "Success" | "Failed";
  dkimTokens: string[];
  dkimStatus: "NotStarted" | "Pending" | "Success" | "Failed";
  configSetExists: boolean;
  spfFound: boolean;
  dmarcFound: boolean;
  unsubscribePageFound: boolean;
}

interface NamecheapDnsConfig {
  apiUser: string;
  username: string;
  apiKey: string;
  clientIp: string;
  useSandbox: boolean;
}

interface NamecheapDnsSetupResult {
  zoneDomain: string;
  existingRecords: number;
  replacedRecords: number;
  totalRecords: number;
  appliedRecords: number;
}

interface CloudflareDnsConfig {
  apiToken: string;
  zoneId: string;
}

interface CloudflareDnsSetupResult {
  zoneId: string;
  zoneName: string;
  appliedRecords: number;
  changedRecords: number;
}

interface Route53DnsConfig {
  hostedZoneId: string;
}

interface Route53DnsSetupResult {
  hostedZoneId: string;
  zoneName: string;
  appliedRecords: number;
  changedRecords: number;
}

type DnsProvider = "manual" | "namecheap" | "cloudflare" | "route53";

type FieldOperator = "equals" | "notEquals" | "contains" | "notContains";
type ConditionMatchMode = "all" | "any";
type HistoryEventType = "send" | "delivery" | "open" | "click" | "bounce" | "complaint";

type FieldCondition = {
  id: string;
  kind: "field";
  field: string;
  operator: FieldOperator;
  value: string;
};

type HistoryCondition = {
  id: string;
  kind: "history";
  subject: string;
  eventType: HistoryEventType;
  subjectMatch: "exact" | "contains";
};

type RecipientCondition = FieldCondition | HistoryCondition;

type HistoryEventIndex = Map<HistoryEventType, Map<string, Set<string>>>;
type SettingsSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

function createConditionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseBooleanLike(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "verified"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "unverified"].includes(normalized)) return false;
  return null;
}

function isDnsProvider(value: unknown): value is DnsProvider {
  return (
    value === "manual" ||
    value === "namecheap" ||
    value === "cloudflare" ||
    value === "route53"
  );
}

function loadPersistedDnsSetupState(): Partial<NamecheapDnsConfig> & {
  provider?: DnsProvider;
  cloudflareZoneId?: string;
  route53HostedZoneId?: string;
} {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(NAMECHEAP_DNS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      provider: isDnsProvider(parsed.provider) ? parsed.provider : undefined,
      apiUser: typeof parsed.apiUser === "string" ? parsed.apiUser : "",
      username: typeof parsed.username === "string" ? parsed.username : "",
      clientIp: typeof parsed.clientIp === "string" ? parsed.clientIp : "",
      useSandbox: typeof parsed.useSandbox === "boolean" ? parsed.useSandbox : false,
      cloudflareZoneId:
        typeof parsed.cloudflareZoneId === "string" ? parsed.cloudflareZoneId : "",
      route53HostedZoneId:
        typeof parsed.route53HostedZoneId === "string"
          ? parsed.route53HostedZoneId
          : "",
    };
  } catch {
    return {};
  }
}

function normalizeHistoryEventType(eventType: string): HistoryEventType | null {
  switch (eventType.trim().toLowerCase()) {
    case "send":
      return "send";
    case "delivery":
      return "delivery";
    case "open":
      return "open";
    case "click":
      return "click";
    case "bounce":
      return "bounce";
    case "complaint":
      return "complaint";
    default:
      return null;
  }
}

function buildHistoryEventIndex(history: HistoryItem[]): HistoryEventIndex {
  const index: HistoryEventIndex = new Map();

  for (const item of history) {
    const subject = item.subject.trim().toLowerCase();
    if (!subject || !item.recipient) continue;
    const emailKey = item.recipient.toLowerCase();

    for (const event of item.events) {
      const type = normalizeHistoryEventType(event.type);
      if (!type) continue;
      const eventIndex = index.get(type) ?? new Map<string, Set<string>>();
      const recipients = eventIndex.get(subject) ?? new Set<string>();
      recipients.add(emailKey);
      eventIndex.set(subject, recipients);
      index.set(type, eventIndex);
    }
  }

  return index;
}

function evaluateFieldCondition(
  contact: Contact,
  condition: FieldCondition
): boolean {
  const target = condition.field.trim().toLowerCase();
  if (!target) return false;

  const rawValue = contact.fields[target] ?? "";
  const expected = condition.value.trim();
  const actual = rawValue.trim();

  if (
    !expected &&
    (condition.operator === "equals" || condition.operator === "notEquals")
  ) {
    const matches = actual === "";
    return condition.operator === "equals" ? matches : !matches;
  }

  if (condition.operator === "contains" || condition.operator === "notContains") {
    if (!expected) return false;
    const contains = actual.toLowerCase().includes(expected.toLowerCase());
    return condition.operator === "contains" ? contains : !contains;
  }

  const actualBool = parseBooleanLike(actual);
  const expectedBool = parseBooleanLike(expected);

  if (actualBool !== null && expectedBool !== null) {
    const equals = actualBool === expectedBool;
    return condition.operator === "equals" ? equals : !equals;
  }

  const equals = actual.toLowerCase() === expected.toLowerCase();
  return condition.operator === "equals" ? equals : !equals;
}

function evaluateHistoryCondition(
  contact: Contact,
  condition: HistoryCondition,
  index: HistoryEventIndex
): boolean {
  const email = contact.email.toLowerCase();
  const needle = condition.subject.trim().toLowerCase();
  if (!needle) return false;

  const subjectMap = index.get(condition.eventType);
  if (!subjectMap) return false;

  if (condition.subjectMatch === "contains") {
    for (const [subject, recipients] of subjectMap) {
      if (!subject.includes(needle)) continue;
      if (recipients.has(email)) return true;
    }
    return false;
  }

  return subjectMap.get(needle)?.has(email) ?? false;
}

function evaluateCondition(
  contact: Contact,
  mode: ConditionMatchMode,
  conditions: RecipientCondition[],
  historyIndex: HistoryEventIndex
): boolean {
  if (!conditions.length) return false;

  const tests = conditions.map((condition) => {
    if (condition.kind === "field") {
      return evaluateFieldCondition(contact, condition);
    }
    return evaluateHistoryCondition(contact, condition, historyIndex);
  });

  if (mode === "any") {
    return tests.some(Boolean);
  }

  return tests.every(Boolean);
}

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

const HISTORY_MATCH_OPTIONS: Array<{ value: "exact" | "contains"; label: string }> = [
  { value: "exact", label: "is" },
  { value: "contains", label: "contains" },
];

const CONDITION_MATCH_OPTIONS: Array<{ value: ConditionMatchMode; label: string }> = [
  { value: "all", label: "Match all rules" },
  { value: "any", label: "Match any rule" },
];

function segmentedButtonClass(active: boolean) {
  return `text-[11px] rounded-full px-2.5 py-1 border transition ${
    active
      ? "bg-black text-white border-black shadow-sm"
      : "bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:bg-white"
  }`;
}

function segmentedSetClass() {
  return "inline-flex items-center rounded-full p-0.5 border border-gray-200 bg-gray-50 gap-1";
}

function makeFieldCondition(
  field = "verified",
  id: string = createConditionId()
): FieldCondition {
  return {
    id,
    kind: "field",
    field,
    operator: "equals",
    value: "true",
  };
}

function makeHistoryCondition(
  id: string = createConditionId()
): HistoryCondition {
  return {
    id,
    kind: "history",
    subject: "",
    eventType: "click",
    subjectMatch: "exact",
  };
}

function uniqueEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const raw of values) {
    const email = raw.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(email);
  }

  return unique;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  return date.toLocaleString();
}

function formatTimestampOrDash(value: string): string {
  const formatted = formatTimestamp(value);
  return formatted === "Invalid Date" ? "-" : formatted;
}

function getSafeExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function formatRatio(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

type CampaignSankeyNode = {
  id: string;
  label: string;
  value: number;
  column: number;
  color: string;
};

type CampaignSankeyLink = {
  source: string;
  target: string;
  value: number;
  color: string;
};

type PositionedCampaignSankeyNode = CampaignSankeyNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PositionedCampaignSankeyLink = CampaignSankeyLink & {
  path: string;
  thickness: number;
};

function CampaignSankeyDiagram({
  analytics,
}: {
  analytics: CampaignPerformanceAnalytics;
}) {
  const total = Math.max(0, Math.floor(analytics.totalSends));
  if (total <= 0) {
    return <p className="text-xs text-gray-500">No send volume yet.</p>;
  }

  const delivered = Math.max(
    0,
    Math.min(total, Math.floor(analytics.deliveredSends))
  );
  const undelivered = Math.max(0, total - delivered);
  const opened = Math.max(0, Math.min(delivered, Math.floor(analytics.openedSends)));
  const notOpened = Math.max(0, delivered - opened);
  const clicked = Math.max(0, Math.min(opened, Math.floor(analytics.clickedSends)));
  const openedNoClick = Math.max(0, opened - clicked);

  const rawNodes: CampaignSankeyNode[] = [
    { id: "sent", label: "Sent", value: total, column: 0, color: "#4F46E5" },
    {
      id: "delivered",
      label: "Delivered",
      value: delivered,
      column: 1,
      color: "#0EA5E9",
    },
    {
      id: "undelivered",
      label: "Undelivered",
      value: undelivered,
      column: 1,
      color: "#F97316",
    },
    { id: "opened", label: "Opened", value: opened, column: 2, color: "#14B8A6" },
    {
      id: "not-opened",
      label: "Not opened",
      value: notOpened,
      column: 2,
      color: "#94A3B8",
    },
    { id: "clicked", label: "Clicked", value: clicked, column: 3, color: "#8B5CF6" },
    {
      id: "opened-no-click",
      label: "Opened, no click",
      value: openedNoClick,
      column: 3,
      color: "#C4B5FD",
    },
  ];

  const rawLinks: CampaignSankeyLink[] = [
    { source: "sent", target: "delivered", value: delivered, color: "#A5B4FC" },
    { source: "sent", target: "undelivered", value: undelivered, color: "#FDBA74" },
    { source: "delivered", target: "opened", value: opened, color: "#99F6E4" },
    {
      source: "delivered",
      target: "not-opened",
      value: notOpened,
      color: "#CBD5E1",
    },
    { source: "opened", target: "clicked", value: clicked, color: "#C4B5FD" },
    {
      source: "opened",
      target: "opened-no-click",
      value: openedNoClick,
      color: "#DDD6FE",
    },
  ];

  const nodes = rawNodes.filter((node) => node.id === "sent" || node.value > 0);
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const links = rawLinks.filter(
    (link) =>
      link.value > 0 &&
      visibleNodeIds.has(link.source) &&
      visibleNodeIds.has(link.target)
  );

  const viewWidth = 900;
  const viewHeight = 280;
  const marginTop = 18;
  const marginRight = 22;
  const marginBottom = 18;
  const marginLeft = 22;
  const nodeWidth = 10;
  const nodeGap = 10;
  const contentHeight = viewHeight - marginTop - marginBottom;
  const maxColumn = nodes.reduce((max, node) => Math.max(max, node.column), 0);
  const columnStep =
    maxColumn > 0
      ? (viewWidth - marginLeft - marginRight - nodeWidth) / maxColumn
      : 0;
  const pxPerUnit = contentHeight / total;

  const nodesByColumn = new Map<number, CampaignSankeyNode[]>();
  for (const node of nodes) {
    const group = nodesByColumn.get(node.column) ?? [];
    group.push(node);
    nodesByColumn.set(node.column, group);
  }

  const positionedNodes = new Map<string, PositionedCampaignSankeyNode>();
  for (let column = 0; column <= maxColumn; column += 1) {
    const columnNodes = nodesByColumn.get(column) ?? [];
    if (columnNodes.length === 0) continue;

    const stackedHeight =
      columnNodes.reduce((sum, node) => sum + node.value * pxPerUnit, 0) +
      nodeGap * Math.max(0, columnNodes.length - 1);
    let currentY = marginTop + Math.max(0, (contentHeight - stackedHeight) / 2);

    for (const node of columnNodes) {
      const height = node.value * pxPerUnit;
      positionedNodes.set(node.id, {
        ...node,
        x: marginLeft + column * columnStep,
        y: currentY,
        width: nodeWidth,
        height,
      });
      currentY += height + nodeGap;
    }
  }

  const sourceOffsets = new Map<string, number>();
  const targetOffsets = new Map<string, number>();
  const positionedLinks: PositionedCampaignSankeyLink[] = [];
  for (const link of links) {
    const source = positionedNodes.get(link.source);
    const target = positionedNodes.get(link.target);
    if (!source || !target) continue;

    const thickness = link.value * pxPerUnit;
    if (thickness <= 0) continue;

    const sourceOffset = sourceOffsets.get(link.source) ?? 0;
    const targetOffset = targetOffsets.get(link.target) ?? 0;

    const sx = source.x + source.width;
    const sy = source.y + sourceOffset + thickness / 2;
    const tx = target.x;
    const ty = target.y + targetOffset + thickness / 2;
    const curve = (tx - sx) * 0.45;
    const path = `M ${sx} ${sy} C ${sx + curve} ${sy}, ${tx - curve} ${ty}, ${tx} ${ty}`;

    sourceOffsets.set(link.source, sourceOffset + thickness);
    targetOffsets.set(link.target, targetOffset + thickness);
    positionedLinks.push({
      ...link,
      thickness,
      path,
    });
  }

  const orderedNodes = Array.from(positionedNodes.values()).sort(
    (a, b) => a.column - b.column || a.y - b.y
  );

  return (
    <div>
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        role="img"
        aria-label="Campaign flow from sent to delivered, opened, and clicked."
        className="h-auto w-full"
      >
        <rect x={0} y={0} width={viewWidth} height={viewHeight} fill="#F8FAFC" />
        {positionedLinks.map((link, index) => (
          <path
            key={`${link.source}-${link.target}-${index}`}
            d={link.path}
            fill="none"
            stroke={link.color}
            strokeOpacity={0.62}
            strokeWidth={Math.max(1, link.thickness)}
            strokeLinecap="round"
          />
        ))}
        {orderedNodes.map((node) => (
          <rect
            key={node.id}
            x={node.x}
            y={node.y}
            width={node.width}
            height={Math.max(1, node.height)}
            fill={node.color}
            rx={3}
          />
        ))}
        {orderedNodes.map((node) => {
          const isLastColumn = node.column === maxColumn;
          const textX = isLastColumn ? node.x - 8 : node.x + node.width + 8;
          const textAnchor = isLastColumn ? "end" : "start";
          const label = `${node.label}: ${node.value.toLocaleString()} (${formatRatio(
            node.value / total
          )})`;
          return (
            <text
              key={`${node.id}-label`}
              x={textX}
              y={node.y + node.height / 2}
              dominantBaseline="middle"
              textAnchor={textAnchor}
              fill="#334155"
              fontSize="12"
            >
              {label}
            </text>
          );
        })}
      </svg>
      <p className="mt-2 text-[11px] text-gray-500">
        Sankey view: flow width represents number of recipients.
      </p>
    </div>
  );
}

type HistoryEventMeta = {
  label: string;
  className: string;
  priority: number;
};

const HISTORY_EVENT_META: Record<string, HistoryEventMeta> = {
  Reject: {
    label: "Rejected",
    className: "bg-red-100 text-red-700",
    priority: 0,
  },
  Bounce: {
    label: "Bounced",
    className: "bg-red-100 text-red-700",
    priority: 1,
  },
  Complaint: {
    label: "Spam complaint",
    className: "bg-orange-100 text-orange-700",
    priority: 2,
  },
  DeliveryDelay: {
    label: "Delayed",
    className: "bg-amber-100 text-amber-700",
    priority: 3,
  },
  RenderingFailure: {
    label: "Rendering failed",
    className: "bg-yellow-100 text-yellow-800",
    priority: 4,
  },
  Delivery: {
    label: "Delivered",
    className: "bg-green-100 text-green-700",
    priority: 5,
  },
  Open: {
    label: "Opened",
    className: "bg-blue-100 text-blue-700",
    priority: 6,
  },
  Click: {
    label: "Clicked",
    className: "bg-purple-100 text-purple-700",
    priority: 7,
  },
  Subscription: {
    label: "Subscription",
    className: "bg-cyan-100 text-cyan-700",
    priority: 8,
  },
  Send: {
    label: "Sent",
    className: "bg-gray-100 text-gray-600",
    priority: 9,
  },
};

function normalizeEventTypeKey(eventType: string): string {
  return eventType.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeEventType(eventType: string): string {
  switch (normalizeEventTypeKey(eventType)) {
    case "send":
      return "Send";
    case "delivery":
      return "Delivery";
    case "open":
      return "Open";
    case "click":
      return "Click";
    case "bounce":
      return "Bounce";
    case "complaint":
      return "Complaint";
    case "reject":
      return "Reject";
    case "deliverydelay":
      return "DeliveryDelay";
    case "renderingfailure":
      return "RenderingFailure";
    case "subscription":
      return "Subscription";
    default:
      return eventType.trim();
  }
}

function getHistoryEventsForDisplay(events: EmailEvent[]): EmailEvent[] {
  const latestByType = new Map<string, EmailEvent>();

  for (const event of events) {
    const type = normalizeEventType(event.type);
    if (!type) continue;
    latestByType.set(type, { ...event, type });
  }

  let deduped = Array.from(latestByType.values());
  if (deduped.length > 1) {
    deduped = deduped.filter((event) => event.type !== "Send");
  }

  deduped.sort((a, b) => {
    const priorityA = HISTORY_EVENT_META[a.type]?.priority ?? 99;
    const priorityB = HISTORY_EVENT_META[b.type]?.priority ?? 99;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.type.localeCompare(b.type);
  });

  return deduped;
}

function formatHistoryEventTooltip(event: EmailEvent): string {
  const label = HISTORY_EVENT_META[event.type]?.label ?? event.type;
  const parts = [label];
  const detail = event.detail.trim();
  const timestamp = formatTimestamp(event.timestamp);

  if (timestamp !== "Invalid Date") parts.push(timestamp);
  if (detail) parts.push(detail);

  return parts.join(" · ");
}

function hasClosingQuoteForField(
  row: string,
  startIndex: number,
  separator: string
): boolean {
  for (let i = startIndex + 1; i < row.length; i++) {
    if (row[i] !== "\"") continue;
    if (row[i + 1] === "\"") {
      i++;
      continue;
    }
    let tail = i + 1;
    while (tail < row.length && row[tail] === " ") {
      tail++;
    }
    return tail === row.length || row[tail] === separator;
  }
  return false;
}

function parseDelimitedRow(row: string, separator: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];

    if (char === "\"") {
      if (inQuotes) {
        if (row[i + 1] === "\"") {
          current += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else if (
        current.trim().length === 0 &&
        hasClosingQuoteForField(row, i, separator)
      ) {
        inQuotes = true;
        current = "";
      } else {
        current += char;
      }
      continue;
    }

    if (char === separator && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());

  return values;
}

function normalizeCSVValue(value: string): string {
  return value
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "");
}

function getCSVLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim());
}

function getCSVSeparator(headerLine: string): string {
  if (headerLine.includes("\t")) return "\t";
  if (headerLine.includes(";")) return ";";
  return ",";
}

function normalizeCSVHeader(value: string, fallbackIndex: number): string {
  const normalized = normalizeCSVValue(value).toLowerCase();
  if (normalized) return normalized;
  return `field_${fallbackIndex + 1}`;
}

function findCSVEmailColumnIndex(headers: string[]): number {
  const emailIdx = headers.findIndex(
    (header) => header === "email" || header === "e-mail" || header === "mail"
  );
  return emailIdx >= 0 ? emailIdx : 0;
}

function createCSVImportConfig(
  text: string,
  workspaceId: string,
  fileName: string
): CsvImportConfig | null {
  const lines = getCSVLines(text);
  if (lines.length === 0) return null;

  const separator = getCSVSeparator(lines[0]);
  const headerLabels = parseDelimitedRow(lines[0], separator).map(normalizeCSVValue);
  if (headerLabels.length === 0) return null;

  const headers = headerLabels.map((label, index) => ({
    index,
    label: label || `Column ${index + 1}`,
    normalizedKey: normalizeCSVHeader(label, index),
    selected: true,
    targetField: normalizeCSVHeader(label, index),
  }));
  const emailColumnIndex = findCSVEmailColumnIndex(
    headers.map((header) => header.normalizedKey)
  );
  headers[emailColumnIndex].selected = false;

  return {
    workspaceId,
    fileName,
    rowCount: Math.max(0, lines.length - 1),
    emailColumnIndex,
    headers,
  };
}

function parseCSV(text: string, options: ParseCSVOptions = {}): Contact[] {
  // Strip BOM and handle all line ending styles (\r\n, \n, \r)
  const lines = getCSVLines(text);
  if (lines.length === 0) return [];

  const sep = getCSVSeparator(lines[0]);

  const headers = parseDelimitedRow(lines[0], sep).map((header, index) =>
    normalizeCSVHeader(header, index)
  );

  const defaultEmailIndex = findCSVEmailColumnIndex(headers);
  const requestedEmailIndex = options.emailColumnIndex;
  const eIdx =
    requestedEmailIndex != null &&
    requestedEmailIndex >= 0 &&
    requestedEmailIndex < headers.length
      ? requestedEmailIndex
      : defaultEmailIndex;

  const byEmail = new Map<string, Contact>();
  const hasFieldMap = options.fieldMapByIndex != null;
  for (let i = 1; i < lines.length; i++) {
    const values = parseDelimitedRow(lines[i], sep).map(normalizeCSVValue);
    const email = (values[eIdx] ?? "").trim().toLowerCase();
    if (!email) continue;

    let target = byEmail.get(email);
    if (!target) {
      const existing = options.existingByEmail?.get(email);
      target = {
        email,
        fields: existing ? { ...existing.fields } : {},
      };
    }

    for (let index = 0; index < headers.length; index++) {
      if (index === eIdx) continue;

      let fieldKey = headers[index];
      if (hasFieldMap) {
        const mapped = options.fieldMapByIndex?.[index];
        if (typeof mapped !== "string") continue;
        fieldKey = normalizeCSVValue(mapped).toLowerCase();
        if (!fieldKey) continue;
      }

      target.fields[fieldKey] = values[index] ?? "";
    }

    byEmail.set(email, target);
  }

  return Array.from(byEmail.values());
}

function buildPreviewUnsubscribeUrl(workspaceId: string, email: string): string {
  const params = new URLSearchParams({
    workspace: workspaceId,
    email,
    token: "preview",
  });
  return `https://example.com/api/unsubscribe?${params.toString()}`;
}

function buildPreviewDocument(html: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
  </head>
  <body style="margin:0;padding:16px;background:#fff;color:#111827;">${html}</body>
</html>`;
}

export default function ComposePage() {
  const [authLoading, setAuthLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [loginEmail, setLoginEmail] = useState("guillaume.gay@protonmail.com");
  const [loginPassword, setLoginPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [newWorkspaceId, setNewWorkspaceId] = useState("");
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [workspaceDeleteConfirmOpen, setWorkspaceDeleteConfirmOpen] = useState(false);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [workspaceDeleteConfirmValue, setWorkspaceDeleteConfirmValue] =
    useState("");

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("compose");

  const workspace = workspaces.find((w) => w.id === activeId) ?? null;

  // Contacts per workspace
  const [contactsMap, setContactsMap] = useState<Record<string, Contact[]>>(
    {}
  );
  const [newContact, setNewContact] = useState("");
  const [contactsImporting, setContactsImporting] = useState(false);
  const [contactsImportMessage, setContactsImportMessage] = useState<string | null>(
    null
  );
  const [contactsPage, setContactsPage] = useState(1);
  const [csvImportConfig, setCsvImportConfig] = useState<CsvImportConfig | null>(
    null
  );

  const contacts = useMemo(
    () => (activeId ? contactsMap[activeId] ?? [] : []),
    [contactsMap, activeId]
  );

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(HISTORY_TABLE_PAGE_SIZE);
  const [historySearch, setHistorySearch] = useState("");
  const [historySearchInput, setHistorySearchInput] = useState("");
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const [historyView, setHistoryView] = useState<HistoryView>("activity");
  const [subjectMetrics, setSubjectMetrics] = useState<SubjectCampaignMetric[]>(
    []
  );
  const [subjectMetricsLoading, setSubjectMetricsLoading] = useState(false);
  const [subjectMetricsError, setSubjectMetricsError] = useState<string | null>(
    null
  );
  const [selectedCampaignSubject, setSelectedCampaignSubject] = useState("");
  const [campaignPerformanceLoading, setCampaignPerformanceLoading] =
    useState(false);
  const [campaignPerformanceError, setCampaignPerformanceError] =
    useState<string | null>(null);
  const [campaignPerformance, setCampaignPerformance] =
    useState<CampaignPerformanceAnalytics | null>(null);
  const [expandedClickedUrl, setExpandedClickedUrl] = useState<string | null>(
    null
  );
  const [recipientConditions, setRecipientConditions] = useState<
    RecipientCondition[]
  >([]);
  const [conditionMatchMode, setConditionMatchMode] =
    useState<ConditionMatchMode>("all");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvImportTextRef = useRef<string | null>(null);

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeSendJobId, setActiveSendJobId] = useState<string | null>(null);
  const [activeSendJob, setActiveSendJob] = useState<SendJobStatusResponse | null>(
    null
  );
  const [result, setResult] = useState<string | null>(null);
  const [bodyVibePrompt, setBodyVibePrompt] = useState("");
  const [footerVibePrompt, setFooterVibePrompt] = useState("");
  const [bodyVibeBusy, setBodyVibeBusy] = useState(false);
  const [footerVibeBusy, setFooterVibeBusy] = useState(false);
  const [bodyVibeStatus, setBodyVibeStatus] = useState<string | null>(null);
  const [footerVibeStatus, setFooterVibeStatus] = useState<string | null>(null);
  const [settingsSaveState, setSettingsSaveState] =
    useState<SettingsSaveState>("idle");
  const [settingsSaveMessage, setSettingsSaveMessage] = useState<string | null>(
    null
  );
  const [settingsSavedAtLabel, setSettingsSavedAtLabel] = useState<string | null>(
    null
  );

  const [apiKeys, setApiKeys] = useState<ApiKeyMeta[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupActionLoading, setSetupActionLoading] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [dnsProvider, setDnsProvider] = useState<DnsProvider>("manual");
  const [namecheapConfig, setNamecheapConfig] = useState<NamecheapDnsConfig>({
    apiUser: "",
    username: "",
    apiKey: "",
    clientIp: "",
    useSandbox: false,
  });
  const [cloudflareConfig, setCloudflareConfig] = useState<CloudflareDnsConfig>({
    apiToken: "",
    zoneId: "",
  });
  const [route53Config, setRoute53Config] = useState<Route53DnsConfig>({
    hostedZoneId: "",
  });
  const [namecheapStatus, setNamecheapStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [cloudflareStatus, setCloudflareStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [route53Status, setRoute53Status] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsSavedResetRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const settingsSaveRequestSeqRef = useRef(0);
  const activeWorkspaceIdRef = useRef<string | null>(null);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendJobPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendJobInFlightRef = useRef(false);

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!sessionToken) {
        throw new Error("Not authenticated");
      }
      const headers = new Headers(init?.headers ?? {});
      headers.set("Authorization", `Bearer ${sessionToken}`);
      return fetch(input, { ...init, headers });
    },
    [sessionToken]
  );

  const fetchJson = useCallback(
    async <T,>(input: RequestInfo | URL, init?: RequestInit): Promise<T> => {
      const res = await authFetch(input, init);
      const payload = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(
          payload?.error ?? `Request failed with status ${res.status}`
        );
      }
      return payload as T;
    },
    [authFetch]
  );

  useEffect(() => {
    const persisted = loadPersistedDnsSetupState();
    if (persisted.provider) {
      setDnsProvider(persisted.provider);
    }
    setNamecheapConfig((current) => ({
      ...current,
      apiUser: persisted.apiUser ?? current.apiUser,
      username: persisted.username ?? current.username,
      clientIp: persisted.clientIp ?? current.clientIp,
      useSandbox: persisted.useSandbox ?? current.useSandbox,
    }));
    setCloudflareConfig((current) => ({
      ...current,
      zoneId: persisted.cloudflareZoneId ?? current.zoneId,
    }));
    setRoute53Config((current) => ({
      ...current,
      hostedZoneId: persisted.route53HostedZoneId ?? current.hostedZoneId,
    }));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const payload = {
      provider: dnsProvider,
      apiUser: namecheapConfig.apiUser,
      username: namecheapConfig.username,
      clientIp: namecheapConfig.clientIp,
      useSandbox: namecheapConfig.useSandbox,
      cloudflareZoneId: cloudflareConfig.zoneId,
      route53HostedZoneId: route53Config.hostedZoneId,
    };
    window.localStorage.setItem(NAMECHEAP_DNS_STORAGE_KEY, JSON.stringify(payload));
  }, [
    dnsProvider,
    namecheapConfig.apiUser,
    namecheapConfig.username,
    namecheapConfig.clientIp,
    namecheapConfig.useSandbox,
    cloudflareConfig.zoneId,
    route53Config.hostedZoneId,
  ]);

  useEffect(() => {
    setNamecheapStatus(null);
    setCloudflareStatus(null);
    setRoute53Status(null);
  }, [dnsProvider]);

  const clearSettingsSavedResetTimer = useCallback(() => {
    if (!settingsSavedResetRef.current) return;
    clearTimeout(settingsSavedResetRef.current);
    settingsSavedResetRef.current = null;
  }, []);

  const buildWorkspaceSettingsPayload = useCallback((value: Workspace) => {
    return {
      id: value.id,
      from: value.from,
      fromName: value.fromName,
      configSet: value.configSet,
      rateLimit: value.rateLimit,
      footerHtml: value.footerHtml,
      websiteUrl: value.websiteUrl,
      contactSourceProvider: value.contactSourceProvider,
      contactSourceConfig: value.contactSourceConfig,
    };
  }, []);

  const persistWorkspaceSettings = useCallback(
    async (value: Workspace) => {
      const isActiveWorkspace = activeWorkspaceIdRef.current === value.id;
      const requestSeq = ++settingsSaveRequestSeqRef.current;

      if (isActiveWorkspace) {
        clearSettingsSavedResetTimer();
        setSettingsSaveState("saving");
        setSettingsSaveMessage(null);
      }

      try {
        await fetchJson<{ ok: boolean }>("/api/workspaces/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildWorkspaceSettingsPayload(value)),
        });

        if (requestSeq !== settingsSaveRequestSeqRef.current) return;
        if (activeWorkspaceIdRef.current !== value.id) return;

        setSettingsSaveState("saved");
        setSettingsSaveMessage(null);
        setSettingsSavedAtLabel(
          new Intl.DateTimeFormat(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(new Date())
        );

        clearSettingsSavedResetTimer();
        settingsSavedResetRef.current = setTimeout(() => {
          setSettingsSaveState((current) =>
            current === "saved" ? "idle" : current
          );
          setSettingsSavedAtLabel(null);
          settingsSavedResetRef.current = null;
        }, 2500);
      } catch (error) {
        if (requestSeq !== settingsSaveRequestSeqRef.current) return;
        if (activeWorkspaceIdRef.current !== value.id) return;

        setSettingsSaveState("error");
        setSettingsSavedAtLabel(null);
        setSettingsSaveMessage(
          error instanceof Error ? error.message : String(error)
        );
      }
    },
    [buildWorkspaceSettingsPayload, clearSettingsSavedResetTimer, fetchJson]
  );

  const stopSendPolling = useCallback(() => {
    if (sendJobPollRef.current) {
      clearInterval(sendJobPollRef.current);
      sendJobPollRef.current = null;
    }
    sendJobInFlightRef.current = false;
  }, []);

  const pollSendJob = useCallback(async () => {
    if (!activeSendJobId) return;
    if (sendJobInFlightRef.current) return;
    sendJobInFlightRef.current = true;

    try {
      const status = await fetchJson<SendJobStatusResponse>(
        `/api/send/status?jobId=${encodeURIComponent(activeSendJobId)}`
      );
      setActiveSendJob(status);

      if (status.isDone) {
        stopSendPolling();
        setSending(false);
        setActiveSendJobId(null);
        const totalFailed = status.failed;
        const summary = `Done: ${status.sent} sent${totalFailed > 0 ? ` · ${totalFailed} failed` : ""}`;
        setResult(
          status.status === "failed"
            ? `${summary}. Job failed.`
            : status.errorMessage
            ? `${summary}. ${status.errorMessage}`
            : summary
        );
      }
    } catch (error) {
      console.error("Failed to poll send job:", error);
    } finally {
      sendJobInFlightRef.current = false;
    }
  }, [activeSendJobId, fetchJson, stopSendPolling]);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setAuthError(error.message);
          setSessionToken(null);
          setUserEmail(null);
        } else {
          setAuthError(null);
          setSessionToken(data.session?.access_token ?? null);
          setUserEmail(data.session?.user.email?.toLowerCase() ?? null);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAuthError(error instanceof Error ? error.message : String(error));
        setSessionToken(null);
        setUserEmail(null);
      })
      .finally(() => {
        if (active) {
          setAuthLoading(false);
        }
      });

    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        setSessionToken(session?.access_token ?? null);
        setUserEmail(session?.user.email?.toLowerCase() ?? null);
      }
    );

    return () => {
      active = false;
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionToken) {
      setLoading(false);
      setWorkspaces([]);
      setActiveId(null);
      setWorkspaceDeleteConfirmOpen(false);
      setDeletingWorkspace(false);
      setWorkspaceDeleteConfirmValue("");
      setContactsMap({});
      setContactsPage(1);
      setContactsImporting(false);
      setContactsImportMessage(null);
      setCsvImportConfig(null);
      csvImportTextRef.current = null;
      setHistory([]);
      setHistoryRows([]);
      setHistoryTotal(0);
      setHistoryPage(1);
      setHistoryPageSize(HISTORY_TABLE_PAGE_SIZE);
      setHistorySearch("");
      setHistorySearchInput("");
      setHistoryView("activity");
      setSubjectMetrics([]);
      setSubjectMetricsLoading(false);
      setSubjectMetricsError(null);
      setSelectedCampaignSubject("");
      setCampaignPerformanceLoading(false);
      setCampaignPerformanceError(null);
      setCampaignPerformance(null);
      setExpandedClickedUrl(null);
      setHistoryLoading(false);
      setNamecheapStatus(null);
      setCloudflareStatus(null);
      setRoute53Status(null);
      return;
    }

    setLoading(true);
    setAuthError(null);
    fetchJson<Workspace[]>("/api/workspaces")
      .then((data) => {
        const normalized = data.map((workspace) => ({
          ...workspace,
          fromName: workspace.fromName ?? "",
          contactSourceProvider: workspace.contactSourceProvider ?? "manual",
          contactSourceConfig: workspace.contactSourceConfig ?? {},
        }));
        setWorkspaces(normalized);
        setActiveId((current) => {
          if (
            current &&
            normalized.some((workspace) => workspace.id === current)
          ) {
            return current;
          }
          return normalized[0]?.id ?? null;
        });
      })
      .catch((error: unknown) => {
        console.error(error);
        setAuthError(error instanceof Error ? error.message : String(error));
        setWorkspaces([]);
        setActiveId(null);
      })
      .finally(() => setLoading(false));
  }, [sessionToken, fetchJson]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeId;
    settingsSaveRequestSeqRef.current += 1;
    clearSettingsSavedResetTimer();
    setSettingsSaveState("idle");
    setSettingsSaveMessage(null);
    setSettingsSavedAtLabel(null);
  }, [activeId, clearSettingsSavedResetTimer]);

  useEffect(() => {
    setWorkspaceDeleteConfirmOpen(false);
    setDeletingWorkspace(false);
    setWorkspaceDeleteConfirmValue("");
    setContactsPage(1);
    setContactsImporting(false);
    setContactsImportMessage(null);
    setCsvImportConfig(null);
    csvImportTextRef.current = null;
    setHistoryRows([]);
    setHistoryTotal(0);
    setHistoryPage(1);
    setHistoryPageSize(HISTORY_TABLE_PAGE_SIZE);
    setHistorySearch("");
    setHistorySearchInput("");
    setHistoryView("activity");
    setSubjectMetrics([]);
    setSubjectMetricsLoading(false);
    setSubjectMetricsError(null);
    setSelectedCampaignSubject("");
    setCampaignPerformanceLoading(false);
    setCampaignPerformanceError(null);
    setCampaignPerformance(null);
    setExpandedClickedUrl(null);
    setNamecheapStatus(null);
    setCloudflareStatus(null);
    setRoute53Status(null);
  }, [activeId]);

  useEffect(() => {
    if (!sessionToken || !activeId) return;
    // Skip if we already have contacts loaded for this workspace
    if (contactsMap[activeId] !== undefined) return;
    fetchJson<Contact[]>(`/api/contacts?workspace=${encodeURIComponent(activeId)}`)
      .then((data) => {
        setContactsMap((prev) => ({ ...prev, [activeId]: data }));
      })
      .catch(console.error);
  }, [sessionToken, activeId, contactsMap, fetchJson]);

  useEffect(() => {
    setBodyVibeStatus(null);
    setFooterVibeStatus(null);
  }, [activeId, stopSendPolling]);

  useEffect(() => {
    if (!sessionToken || !activeId) return;
    const params = new URLSearchParams({
      workspace: activeId,
      page: "1",
      pageSize: String(HISTORY_RULES_PAGE_SIZE),
    });
    fetchJson<HistoryListResponse>(`/api/history?${params.toString()}`)
      .then((data) => setHistory(data.items))
      .catch(console.error);
  }, [sessionToken, activeId, fetchJson]);

  useEffect(() => {
    if (!sessionToken || !activeId || tab !== "history") return;
    let cancelled = false;

    const params = new URLSearchParams({
      workspace: activeId,
      page: String(historyPage),
      pageSize: String(HISTORY_TABLE_PAGE_SIZE),
    });
    const searchTerm = historySearch.trim();
    if (searchTerm) {
      params.set("search", searchTerm);
    }

    setHistoryLoading(true);
    fetchJson<HistoryListResponse>(`/api/history?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setHistoryRows(data.items);
        setHistoryTotal(data.total);
        setHistoryPageSize(data.pageSize);
        if (data.page !== historyPage) {
          setHistoryPage(data.page);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    sessionToken,
    activeId,
    tab,
    historyPage,
    historySearch,
    historyReloadKey,
    fetchJson,
  ]);

  useEffect(() => {
    if (!sessionToken || !activeId || tab !== "history") return;
    let cancelled = false;

    const params = new URLSearchParams({
      workspace: activeId,
      mode: "subject",
      limit: "50",
    });

    setSubjectMetricsLoading(true);
    setSubjectMetricsError(null);
    fetchJson<SubjectCampaignMetricsResponse>(
      `/api/history/analytics?${params.toString()}`
    )
      .then((data) => {
        if (cancelled) return;
        setSubjectMetrics(Array.isArray(data.items) ? data.items : []);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setSubjectMetrics([]);
        setSubjectMetricsError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setSubjectMetricsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionToken, activeId, tab, historyReloadKey, fetchJson]);

  useEffect(() => {
    if (subjectMetrics.length === 0) {
      if (selectedCampaignSubject) {
        setSelectedCampaignSubject("");
      }
      return;
    }

    const selectedExists = subjectMetrics.some(
      (metric) => metric.subject === selectedCampaignSubject
    );
    if (!selectedExists) {
      setSelectedCampaignSubject(subjectMetrics[0].subject);
    }
  }, [selectedCampaignSubject, subjectMetrics]);

  useEffect(() => {
    if (!sessionToken || !activeId || tab !== "history") return;

    const subject = selectedCampaignSubject.trim();
    if (!subject) {
      setCampaignPerformanceLoading(false);
      setCampaignPerformanceError(null);
      setCampaignPerformance(null);
      setExpandedClickedUrl(null);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({
      workspace: activeId,
      mode: "campaign",
      subject,
    });

    setCampaignPerformanceLoading(true);
    setCampaignPerformanceError(null);
    setExpandedClickedUrl(null);
    fetchJson<CampaignPerformanceAnalytics>(
      `/api/history/analytics?${params.toString()}`
    )
      .then((data) => {
        if (cancelled) return;
        setCampaignPerformance(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setCampaignPerformance(null);
        setCampaignPerformanceError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setCampaignPerformanceLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    sessionToken,
    activeId,
    tab,
    selectedCampaignSubject,
    historyReloadKey,
    fetchJson,
  ]);

  useEffect(() => {
    if (!sessionToken || !activeId) return;
    setApiKeysLoading(true);
    fetchJson<ApiKeyMeta[]>(`/api/keys?workspace=${encodeURIComponent(activeId)}`)
      .then((data) => setApiKeys(data))
      .catch(console.error)
      .finally(() => setApiKeysLoading(false));
  }, [sessionToken, activeId, fetchJson]);

  useEffect(() => {
    if (!sessionToken || !activeId) return;
    if (activeSendJobId || sending) return;

    let cancelled = false;
    fetchJson<{ jobs: SendJobSummary[] }>(
      `/api/send/jobs?workspace=${encodeURIComponent(
        activeId
      )}&status=queued,running&limit=1`
    )
      .then((data) => {
        if (cancelled) return;
        const job = data.jobs?.[0];
        if (!job) return;

        setActiveSendJobId(job.id);
        setSending(true);
        setResult(
          `Resumed job ${job.status.toUpperCase()} ${job.sent + job.failed}/${job.total}`
        );
      })
      .catch((error) => {
        console.error("Failed to restore active send job:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionToken, activeId, activeSendJobId, fetchJson, sending]);

  useEffect(() => {
    stopSendPolling();
    setSending(false);
    setActiveSendJobId(null);
    setActiveSendJob(null);
    setResult(null);
    setRecipientConditions([]);
    setConditionMatchMode("all");
  }, [activeId, stopSendPolling]);

  useEffect(() => {
    if (!activeSendJobId) {
      return;
    }

    pollSendJob();
    sendJobPollRef.current = setInterval(pollSendJob, 1400);

    return () => {
      stopSendPolling();
    };
  }, [activeSendJobId, pollSendJob, stopSendPolling]);

  useEffect(() => {
    return () => {
      stopSendPolling();
      clearSettingsSavedResetTimer();
    };
  }, [clearSettingsSavedResetTimer, stopSendPolling]);

  const fetchSetupStatus = useCallback(async () => {
    if (!workspace) return;
    setSetupLoading(true);
    try {
      const data = await fetchJson<SetupStatus>(
        `/api/workspaces/setup?domain=${encodeURIComponent(workspace.id)}&configSet=${encodeURIComponent(workspace.configSet)}&websiteUrl=${encodeURIComponent(workspace.websiteUrl || "")}`
      );
      setSetupStatus(data);
    } catch (e) {
      console.error("Failed to fetch setup status:", e);
    } finally {
      setSetupLoading(false);
    }
  }, [workspace, fetchJson]);

  useEffect(() => {
    if (tab === "settings" && sessionToken && workspace) {
      fetchSetupStatus();
    }
  }, [tab, sessionToken, workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runSetupAction(action: string) {
    if (!workspace) return;
    setSetupActionLoading(action);
    try {
      await fetchJson("/api/workspaces/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: workspace.id,
          action,
          configSet: workspace.configSet,
        }),
      });
      await fetchSetupStatus();
    } catch (e) {
      console.error(`Setup action ${action} failed:`, e);
    } finally {
      setSetupActionLoading(null);
    }
  }

  function updateNamecheapConfig(patch: Partial<NamecheapDnsConfig>) {
    setNamecheapConfig((current) => ({ ...current, ...patch }));
  }

  function updateCloudflareConfig(patch: Partial<CloudflareDnsConfig>) {
    setCloudflareConfig((current) => ({ ...current, ...patch }));
  }

  function updateRoute53Config(patch: Partial<Route53DnsConfig>) {
    setRoute53Config((current) => ({ ...current, ...patch }));
  }

  async function configureNamecheapDns() {
    if (!workspace) return;

    const payload = {
      apiUser: namecheapConfig.apiUser.trim(),
      username: namecheapConfig.username.trim(),
      apiKey: namecheapConfig.apiKey.trim(),
      clientIp: namecheapConfig.clientIp.trim(),
      useSandbox: namecheapConfig.useSandbox,
    };

    if (!payload.apiUser || !payload.username || !payload.apiKey || !payload.clientIp) {
      setNamecheapStatus({
        type: "error",
        message: "Fill API User, Username, API Key and Client IP before applying DNS.",
      });
      return;
    }

    setNamecheapStatus(null);
    setSetupActionLoading("configure-namecheap-dns");
    try {
      const result = await fetchJson<NamecheapDnsSetupResult>("/api/workspaces/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: workspace.id,
          action: "configure-namecheap-dns",
          configSet: workspace.configSet,
          namecheap: payload,
        }),
      });

      setNamecheapStatus({
        type: "success",
        message: `Updated ${result.appliedRecords} SES records in ${result.zoneDomain} (${result.totalRecords} total DNS records now configured).`,
      });
      await fetchSetupStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNamecheapStatus({
        type: "error",
        message,
      });
    } finally {
      setSetupActionLoading(null);
    }
  }

  async function configureCloudflareDns() {
    if (!workspace) return;

    const payload = {
      apiToken: cloudflareConfig.apiToken.trim(),
      zoneId: cloudflareConfig.zoneId.trim(),
    };

    if (!payload.apiToken) {
      setCloudflareStatus({
        type: "error",
        message: "Enter a Cloudflare API token before applying DNS.",
      });
      return;
    }

    setCloudflareStatus(null);
    setSetupActionLoading("configure-cloudflare-dns");
    try {
      const result = await fetchJson<CloudflareDnsSetupResult>(
        "/api/workspaces/setup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: workspace.id,
            action: "configure-cloudflare-dns",
            configSet: workspace.configSet,
            cloudflare: payload,
          }),
        }
      );

      setCloudflareStatus({
        type: "success",
        message: `Synced ${result.appliedRecords} SES records in ${result.zoneName}. ${result.changedRecords} record(s) changed.`,
      });
      await fetchSetupStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCloudflareStatus({
        type: "error",
        message,
      });
    } finally {
      setSetupActionLoading(null);
    }
  }

  async function configureRoute53Dns() {
    if (!workspace) return;

    const payload = {
      hostedZoneId: route53Config.hostedZoneId.trim(),
    };

    setRoute53Status(null);
    setSetupActionLoading("configure-route53-dns");
    try {
      const result = await fetchJson<Route53DnsSetupResult>(
        "/api/workspaces/setup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: workspace.id,
            action: "configure-route53-dns",
            configSet: workspace.configSet,
            route53: payload,
          }),
        }
      );

      setRoute53Status({
        type: "success",
        message: `Synced ${result.appliedRecords} SES records in hosted zone ${result.zoneName}. ${result.changedRecords} record(s) changed.`,
      });
      await fetchSetupStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRoute53Status({
        type: "error",
        message,
      });
    } finally {
      setSetupActionLoading(null);
    }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField((c) => (c === field ? null : c)), 2000);
  }

  async function handleSignIn() {
    setLoggingIn(true);
    setAuthError(null);
    setAuthMessage(null);
    try {
      const supabase = getBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      if (error) {
        setAuthError(error.message);
        return;
      }
      setLoginPassword("");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleSignUp() {
    setLoggingIn(true);
    setAuthError(null);
    setAuthMessage(null);
    try {
      const supabase = getBrowserSupabaseClient();
      const { data, error } = await supabase.auth.signUp({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      if (error) {
        setAuthError(error.message);
        return;
      }

      setLoginPassword("");
      if (data.session) {
        setAuthMessage("Account created and signed in.");
        return;
      }

      setAuthMode("sign-in");
      setAuthMessage("Account created. Confirm your email, then sign in.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authMode === "sign-in") {
      await handleSignIn();
      return;
    }
    await handleSignUp();
  }

  async function handleSignOut() {
    const supabase = getBrowserSupabaseClient();
    await supabase.auth.signOut();
    setSessionToken(null);
    setUserEmail(null);
    setAuthError(null);
    setWorkspaces([]);
    setActiveId(null);
    setWorkspaceDeleteConfirmOpen(false);
    setDeletingWorkspace(false);
    setWorkspaceDeleteConfirmValue("");
    setContactsMap({});
    setHistory([]);
    setHistoryRows([]);
    setHistoryTotal(0);
    setHistoryPage(1);
    setHistoryPageSize(HISTORY_TABLE_PAGE_SIZE);
    setHistorySearch("");
    setHistorySearchInput("");
    setHistoryView("activity");
    setSubjectMetrics([]);
    setSubjectMetricsLoading(false);
    setSubjectMetricsError(null);
    setSelectedCampaignSubject("");
    setCampaignPerformanceLoading(false);
    setCampaignPerformanceError(null);
    setCampaignPerformance(null);
    setExpandedClickedUrl(null);
    setHistoryLoading(false);
    setWorkspaceMessage(null);
    setNewWorkspaceId("");
    setBodyVibeStatus(null);
    setFooterVibeStatus(null);
    setNamecheapStatus(null);
    setCloudflareStatus(null);
    setRoute53Status(null);
  }

  async function addWorkspaceById(rawId: string) {
    if (!sessionToken) return;
    const id = rawId.trim().toLowerCase();
    if (!id) {
      setWorkspaceMessage("Enter a domain, e.g. example.com");
      return;
    }

    setAddingWorkspace(true);
    setWorkspaceMessage(null);
    try {
      const created = await fetchJson<Workspace>("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const normalized = {
        ...created,
        fromName: created.fromName ?? "",
        contactSourceProvider: created.contactSourceProvider ?? "manual",
        contactSourceConfig: created.contactSourceConfig ?? {},
      };
      setWorkspaces((prev) => {
        const next = [
          ...prev.filter((workspace) => workspace.id !== normalized.id),
          normalized,
        ];
        next.sort((a, b) => a.id.localeCompare(b.id));
        return next;
      });
      setActiveId(normalized.id);
      setNewWorkspaceId("");
      setWorkspaceMessage(`Domain added: ${normalized.id}`);
      setTab("settings");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAddingWorkspace(false);
    }
  }

  async function addWorkspace() {
    await addWorkspaceById(newWorkspaceId);
  }

  function openWorkspaceDeleteConfirm() {
    if (!activeId || deletingWorkspace) return;
    setWorkspaceDeleteConfirmValue("");
    setWorkspaceDeleteConfirmOpen(true);
  }

  function cancelWorkspaceDelete() {
    if (deletingWorkspace) return;
    setWorkspaceDeleteConfirmValue("");
    setWorkspaceDeleteConfirmOpen(false);
  }

  async function confirmWorkspaceDelete() {
    const workspaceId = activeId;
    if (!workspaceId || deletingWorkspace) return;
    if (workspaceDeleteConfirmValue.trim().toLowerCase() !== workspaceId) {
      setWorkspaceMessage(
        `Type "${workspaceId}" exactly to confirm deletion.`
      );
      return;
    }

    setDeletingWorkspace(true);
    setWorkspaceMessage(null);
    try {
      await fetchJson<{ ok: boolean }>(
        `/api/workspaces?id=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" }
      );

      const remainingWorkspaces = workspaces
        .filter((item) => item.id !== workspaceId)
        .sort((a, b) => a.id.localeCompare(b.id));

      setWorkspaces(remainingWorkspaces);
      setActiveId(remainingWorkspaces[0]?.id ?? null);
      setContactsMap((prev) => {
        const next = { ...prev };
        delete next[workspaceId];
        return next;
      });
      setWorkspaceMessage(`Workspace deleted: ${workspaceId}`);
      setWorkspaceDeleteConfirmValue("");
      setWorkspaceDeleteConfirmOpen(false);
    } catch (error) {
      setWorkspaceMessage(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setDeletingWorkspace(false);
    }
  }

  async function refreshApiKeys() {
    if (!activeId) return;
    const data = await fetchJson<ApiKeyMeta[]>(
      `/api/keys?workspace=${encodeURIComponent(activeId)}`
    );
    setApiKeys(data);
  }

  async function createApiKeyHandler() {
    if (!activeId || creatingKey) return;
    setCreatingKey(true);
    try {
      const res = await fetchJson<{ key: string }>(
        "/api/keys",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: activeId, name: newKeyName.trim() }),
        }
      );
      setNewlyCreatedKey(res.key);
      setNewKeyName("");
      await refreshApiKeys();
    } catch (e) {
      console.error(e);
    } finally {
      setCreatingKey(false);
    }
  }

  async function deleteApiKeyHandler(id: string) {
    if (!activeId) return;
    try {
      await fetchJson(
        `/api/keys/${encodeURIComponent(id)}?workspace=${encodeURIComponent(activeId)}`,
        { method: "DELETE" }
      );
      await refreshApiKeys();
    } catch (e) {
      console.error(e);
    }
  }

  async function generateVibeHtml(target: "email" | "footer") {
    if (!sessionToken || !workspace?.id) return;

    const prompt =
      target === "email" ? bodyVibePrompt.trim() : footerVibePrompt.trim();
    if (!prompt) {
      if (target === "email") {
        setBodyVibeStatus("Write a prompt first.");
      } else {
        setFooterVibeStatus("Write a prompt first.");
      }
      return;
    }

    if (target === "email") {
      setBodyVibeBusy(true);
      setBodyVibeStatus(null);
    } else {
      setFooterVibeBusy(true);
      setFooterVibeStatus(null);
    }

    try {
      const data = await fetchJson<{ html: string; model: string }>("/api/vibe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          target,
          instruction: prompt,
          currentHtml: target === "email" ? html : workspace.footerHtml,
          from: workspace.from,
          websiteUrl: workspace.websiteUrl,
        }),
      });

      if (target === "email") {
        setHtml(data.html);
        setBodyVibeStatus(`Updated by ${data.model}.`);
      } else {
        updateWorkspace({ footerHtml: data.html });
        setFooterVibeStatus(`Updated by ${data.model}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (target === "email") {
        setBodyVibeStatus(message);
      } else {
        setFooterVibeStatus(message);
      }
    } finally {
      if (target === "email") {
        setBodyVibeBusy(false);
      } else {
        setFooterVibeBusy(false);
      }
    }
  }

  function updateWorkspace(patch: Partial<Workspace>) {
    if (!activeId || !workspace || !sessionToken) return;
    const changed = Object.entries(patch).some(
      ([key, value]) => workspace[key as keyof Workspace] !== value
    );
    if (!changed) return;

    const updated = { ...workspace, ...patch };
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === activeId ? updated : w))
    );

    clearSettingsSavedResetTimer();
    setSettingsSaveState("dirty");
    setSettingsSaveMessage(null);
    setSettingsSavedAtLabel(null);
  }

  async function saveWorkspaceSettingsNow() {
    if (!sessionToken || !workspace) return;
    await persistWorkspaceSettings(workspace);
  }

  function setLocalContacts(list: Contact[]) {
    if (!activeId) return;
    const unique = Array.from(
      new Map(list.map((c) => [c.email, c])).values()
    );
    setContactsMap((prev) => ({ ...prev, [activeId]: unique }));
  }

  async function addContact() {
    const email = newContact.trim();
    if (!sessionToken || !email || !activeId) return;
    if (contacts.some((c) => c.email === email)) {
      setNewContact("");
      return;
    }
    const newList = [...contacts, { email, fields: {} }];
    setLocalContacts(newList);
    setNewContact("");
    try {
      await fetchJson<Contact[]>("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: activeId,
          contacts: [{ email, fields: {} }],
        }),
      });
    } catch (e) {
      console.error("Failed to add contact:", e);
    }
  }

  async function removeContact(email: string) {
    if (!sessionToken || !activeId) return;
    setLocalContacts(contacts.filter((c) => c.email !== email));
    try {
      await fetchJson<{ ok: boolean }>(
        `/api/contacts/${encodeURIComponent(email)}?workspace=${encodeURIComponent(activeId)}`,
        { method: "DELETE" }
      );
    } catch (e) {
      console.error("Failed to remove contact:", e);
    }
  }

  function updateContactField(email: string, key: string, value: string) {
    if (!sessionToken || !activeId) return;
    const contact = contacts.find((c) => c.email === email);
    if (!contact) return;
    const updatedFields = { ...contact.fields, [key]: value };
    setLocalContacts(
      contacts.map((c) =>
        c.email === email ? { ...c, fields: updatedFields } : c
      )
    );
    // Debounce API call for field edits
    if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    contactDebounceRef.current = setTimeout(() => {
      fetchJson<{ ok: boolean }>(`/api/contacts/${encodeURIComponent(email)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: activeId, fields: updatedFields }),
      }).catch(console.error);
    }, 500);
  }

  async function clearContacts() {
    if (!sessionToken || !activeId) return;
    setLocalContacts([]);
    try {
      await fetchJson<{ ok: boolean }>(
        `/api/contacts?workspace=${encodeURIComponent(activeId)}`,
        { method: "DELETE" }
      );
    } catch (e) {
      console.error("Failed to clear contacts:", e);
    }
  }

  function updateCsvEmailColumn(columnIndex: number) {
    setCsvImportConfig((current) => {
      if (!current) return current;
      if (columnIndex < 0 || columnIndex >= current.headers.length) return current;

      return {
        ...current,
        emailColumnIndex: columnIndex,
        headers: current.headers.map((header) =>
          header.index === columnIndex
            ? { ...header, selected: false }
            : header.index === current.emailColumnIndex
              ? { ...header, selected: true }
              : header
        ),
      };
    });
  }

  function updateCsvColumnSelection(columnIndex: number, selected: boolean) {
    setCsvImportConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        headers: current.headers.map((header) =>
          header.index === columnIndex
            ? { ...header, selected }
            : header
        ),
      };
    });
  }

  function updateCsvColumnTarget(columnIndex: number, targetField: string) {
    setCsvImportConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        headers: current.headers.map((header) =>
          header.index === columnIndex
            ? { ...header, targetField }
            : header
        ),
      };
    });
  }

  function cancelCsvImportConfig() {
    if (contactsImporting) return;
    setCsvImportConfig(null);
    csvImportTextRef.current = null;
    setContactsImportMessage("CSV import cancelled.");
  }

  async function confirmCsvImport() {
    const config = csvImportConfig;
    const text = csvImportTextRef.current;
    if (!sessionToken || !config || !text || contactsImporting) return;

    setCsvImportConfig(null);
    setContactsImporting(true);
    setContactsImportMessage("Preparing contacts...");

    try {
      const existingByEmail = new Map(
        contacts.map((contact) => [contact.email.trim().toLowerCase(), contact])
      );
      const fieldMapByIndex: Record<number, string> = {};
      for (const header of config.headers) {
        if (header.index === config.emailColumnIndex) continue;
        if (!header.selected) continue;
        const targetField = normalizeCSVValue(header.targetField).toLowerCase();
        if (
          !targetField ||
          targetField === "email" ||
          targetField === "e-mail" ||
          targetField === "mail"
        ) {
          continue;
        }
        fieldMapByIndex[header.index] = targetField;
      }

      const parsed = parseCSV(text, {
        emailColumnIndex: config.emailColumnIndex,
        fieldMapByIndex,
        existingByEmail,
      });
      if (parsed.length === 0) {
        setContactsImportMessage("No valid contacts found in this CSV.");
        return;
      }

      let imported = 0;
      let skippedUnsubscribed = 0;
      const totalChunks = Math.ceil(parsed.length / CONTACT_IMPORT_BATCH_SIZE);

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CONTACT_IMPORT_BATCH_SIZE;
        const chunk = parsed.slice(start, start + CONTACT_IMPORT_BATCH_SIZE);
        setContactsImportMessage(
          `Importing contacts (${chunkIndex + 1}/${totalChunks})...`
        );

        const response = await fetchJson<ContactsBatchImportResponse>(
          "/api/contacts",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspace: config.workspaceId,
              contacts: chunk,
              returnContacts: false,
            }),
          }
        );
        imported += response.imported;
        skippedUnsubscribed += response.skippedUnsubscribed;
      }

      const updated = await fetchJson<Contact[]>(
        `/api/contacts?workspace=${encodeURIComponent(config.workspaceId)}`
      );
      setContactsMap((prev) => ({ ...prev, [config.workspaceId]: updated }));
      setContactsPage(1);
      setContactsImportMessage(
        `Imported ${imported} contacts.${skippedUnsubscribed > 0 ? ` ${skippedUnsubscribed} unsubscribed skipped.` : ""}`
      );
    } catch (err) {
      console.error("Failed to upload contacts:", err);
      setContactsImportMessage(
        err instanceof Error ? `Import failed: ${err.message}` : "Import failed."
      );
    } finally {
      csvImportTextRef.current = null;
      setContactsImporting(false);
    }
  }

  async function handleCSVUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const workspaceId = activeId;
    if (!sessionToken || !file || !workspaceId || contactsImporting) return;

    setCsvImportConfig(null);
    csvImportTextRef.current = null;
    setContactsImporting(true);
    setContactsImportMessage("Reading CSV...");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const config = createCSVImportConfig(text, workspaceId, file.name);
        if (!config) {
          csvImportTextRef.current = null;
          setContactsImportMessage("Invalid CSV header.");
          return;
        }
        if (config.rowCount === 0) {
          csvImportTextRef.current = null;
          setContactsImportMessage("No valid contacts found in this CSV.");
          return;
        }
        csvImportTextRef.current = text;
        setCsvImportConfig(config);
        setContactsImportMessage(
          `Loaded ${config.rowCount.toLocaleString()} rows from ${config.fileName}. Choose columns to import.`
        );
      } catch (err) {
        console.error("Failed to upload contacts:", err);
        csvImportTextRef.current = null;
        setContactsImportMessage(
          err instanceof Error ? `Import failed: ${err.message}` : "Import failed."
        );
      } finally {
        setContactsImporting(false);
      }
    };
    reader.onerror = () => {
      setContactsImporting(false);
      setContactsImportMessage("Failed to read the selected file.");
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function insertAllContacts() {
    setTo(contacts.map((c) => c.email).join("\n"));
    setTab("compose");
  }

  function replaceVars(template: string, vars: Record<string, string>): string {
    return template.replace(
      /\{\{(\w+)\}\}/g,
      (_, key) => vars[key.toLowerCase()] ?? `{{${key}}}`
    );
  }

  const contactsTotalPages = Math.max(
    1,
    Math.ceil(contacts.length / CONTACTS_TABLE_PAGE_SIZE)
  );
  const contactsVisibleRows = useMemo(() => {
    const start = (contactsPage - 1) * CONTACTS_TABLE_PAGE_SIZE;
    return contacts.slice(start, start + CONTACTS_TABLE_PAGE_SIZE);
  }, [contacts, contactsPage]);
  const contactsRangeStart =
    contacts.length > 0
      ? (contactsPage - 1) * CONTACTS_TABLE_PAGE_SIZE + 1
      : 0;
  const contactsRangeEnd =
    contacts.length > 0
      ? contactsRangeStart + contactsVisibleRows.length - 1
      : 0;

  useEffect(() => {
    if (contactsPage <= contactsTotalPages) return;
    setContactsPage(contactsTotalPages);
  }, [contactsPage, contactsTotalPages]);

  const allFieldKeys = useMemo(
    () =>
      Array.from(new Set(contacts.flatMap((c) => Object.keys(c.fields)))).sort(),
    [contacts]
  );
  const csvImportTargetFieldOptions = useMemo(() => {
    if (!csvImportConfig) return allFieldKeys;
    const keys = new Set(allFieldKeys);
    for (const header of csvImportConfig.headers) {
      if (header.targetField.trim()) {
        keys.add(header.targetField.trim().toLowerCase());
      }
      keys.add(header.normalizedKey);
    }
    return Array.from(keys).sort();
  }, [allFieldKeys, csvImportConfig]);
  const csvSelectedColumnCount = useMemo(() => {
    if (!csvImportConfig) return 0;
    return csvImportConfig.headers.filter(
      (header) =>
        header.index !== csvImportConfig.emailColumnIndex && header.selected
    ).length;
  }, [csvImportConfig]);
  const availableFieldKeys = useMemo(
    () => {
      const keys = new Set(["verified", ...allFieldKeys]);
      return Array.from(keys).sort();
    },
    [allFieldKeys]
  );
  const availableSubjects = useMemo(
    () =>
      Array.from(
        new Set(
          history
            .map((item) => item.subject.trim())
            .filter(Boolean)
        )
      ).sort(),
    [history]
  );
  const historyEventIndex = useMemo(
    () => buildHistoryEventIndex(history),
    [history]
  );

  const conditionMatchedRecipients = useMemo(() => {
    if (!recipientConditions.length || contacts.length === 0) return [];
    const matched = contacts.filter((contact) =>
      evaluateCondition(contact, conditionMatchMode, recipientConditions, historyEventIndex)
    );
    return uniqueEmails(matched.map((c) => c.email));
  }, [
    contacts,
    recipientConditions,
    conditionMatchMode,
    historyEventIndex,
  ]);

  const historyTotalPages = Math.max(
    1,
    Math.ceil(historyTotal / Math.max(1, historyPageSize))
  );
  const historyRangeStart =
    historyTotal > 0 ? (historyPage - 1) * historyPageSize + 1 : 0;
  const historyRangeEnd =
    historyTotal > 0 && historyRows.length > 0
      ? historyRangeStart + historyRows.length - 1
      : 0;
  const selectedCampaignMetric = useMemo(
    () =>
      subjectMetrics.find((metric) => metric.subject === selectedCampaignSubject) ??
      null,
    [selectedCampaignSubject, subjectMetrics]
  );

  function refreshHistoryPage() {
    setHistoryReloadKey((prev) => prev + 1);
  }

  function submitHistorySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHistoryPage(1);
    setHistorySearch(historySearchInput.trim());
    refreshHistoryPage();
  }

  function clearHistorySearch() {
    setHistorySearchInput("");
    setHistorySearch("");
    setHistoryPage(1);
    refreshHistoryPage();
  }

  function formatPercent(value: number): string {
    return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
  }

  function addFieldCondition() {
    setRecipientConditions((prev) => [...prev, makeFieldCondition(availableFieldKeys[0] ?? "verified")]);
  }

  function addHistoryCondition() {
    setRecipientConditions((prev) => [...prev, makeHistoryCondition()]);
  }

  function setCondition(id: string, patch: Partial<RecipientCondition>) {
    setRecipientConditions((prev) =>
      prev.map((condition) =>
        condition.id !== id
          ? condition
          : ({ ...condition, ...patch } as RecipientCondition)
      )
    );
  }

  function setConditionType(id: string, kind: RecipientCondition["kind"]) {
    if (kind === "field") {
      setCondition(id, makeFieldCondition(availableFieldKeys[0] ?? "verified", id));
      return;
    }
    setCondition(id, makeHistoryCondition(id));
  }

  function removeCondition(id: string) {
    setRecipientConditions((prev) => prev.filter((condition) => condition.id !== id));
  }

  function importMatchedRecipients() {
    if (!conditionMatchedRecipients.length) return;
    setTo((prev) =>
      uniqueEmails([
        ...prev.split("\n").map((value) => value.trim()).filter(Boolean),
        ...conditionMatchedRecipients,
      ]).join("\n")
    );
  }

  const updatePreview = useCallback((htmlContent: string, sampleVars: Record<string, string>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const resolved = replaceVars(htmlContent, sampleVars);
        const previewWorkspaceId = workspace?.id ?? "example.com";
        const previewWebsiteUrl =
          workspace?.websiteUrl?.trim() || `https://${previewWorkspaceId}`;
        const previewEmail = sampleVars.email?.trim() || "contact@example.com";
        const previewUnsubscribeUrl = buildPreviewUnsubscribeUrl(
          previewWorkspaceId,
          previewEmail
        );
        const resolvedWithFooter = appendWorkspaceFooter({
          html: resolved,
          footerHtml: workspace?.footerHtml ?? "",
          websiteUrl: previewWebsiteUrl,
          workspaceId: previewWorkspaceId,
          unsubscribeUrl: previewUnsubscribeUrl,
        });
        const previewDoc = buildPreviewDocument(resolvedWithFooter);
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html: previewDoc }),
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (iframeRef.current) {
          iframeRef.current.src = url;
        }
      } catch {
        // preview failed silently
      }
    }, 300);
  }, [workspace?.id, workspace?.websiteUrl, workspace?.footerHtml]);

  const manualRecipients = uniqueEmails(
    to
      .split("\n")
      .map((e) => e.trim())
      .filter(Boolean)
  );
  const recipients = uniqueEmails([
    ...manualRecipients,
    ...conditionMatchedRecipients,
  ]);

  // Build sample variables from first recipient's contact data
  const firstRecipient = recipients[0] ?? "";
  const sampleContact =
    contacts.find((c) => c.email === firstRecipient) ?? contacts[0];
  const sampleVars: Record<string, string> = {
    email: sampleContact?.email ?? firstRecipient,
    ...(sampleContact?.fields ?? {}),
  };

  const footerPreviewWorkspaceId = workspace?.id ?? "example.com";
  const footerPreviewWebsiteUrl =
    workspace?.websiteUrl?.trim() || `https://${footerPreviewWorkspaceId}`;
  const footerPreviewEmail = sampleVars.email?.trim() || "contact@example.com";
  const footerPreviewUnsubscribeUrl = buildPreviewUnsubscribeUrl(
    footerPreviewWorkspaceId,
    footerPreviewEmail
  );
  const footerPreviewHtml = appendWorkspaceFooter({
    html: [
      "<div style=\"font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\">",
      "<h2 style=\"margin:0 0 8px 0;font-size:22px;line-height:1.2;\">Email Content Preview</h2>",
      "<p style=\"margin:0;color:#374151;line-height:1.6;\">",
      "This sample block simulates the body of your email. Your configured footer appears below.",
      "</p>",
      "</div>",
    ].join(""),
    footerHtml: workspace?.footerHtml ?? "",
    websiteUrl: footerPreviewWebsiteUrl,
    workspaceId: footerPreviewWorkspaceId,
    unsubscribeUrl: footerPreviewUnsubscribeUrl,
  });
  const footerPreviewDoc = buildPreviewDocument(footerPreviewHtml);

  const sampleFieldsJson = JSON.stringify(sampleContact?.fields ?? {});
  useEffect(() => {
    updatePreview(html, sampleVars);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, updatePreview, sampleContact?.email, sampleFieldsJson]);

  async function handleSend() {
    if (!sessionToken || !workspace?.from || !workspace.id || !subject || !html) {
      setResult("Fill in all fields.");
      return;
    }
    if (!recipients.length) {
      setResult("Add at least one recipient.");
      return;
    }
    setSending(true);
    setActiveSendJobId(null);
    setActiveSendJob(null);
    setResult(null);
    try {
      const data = await fetchJson<{
        sent: number;
        dryRun?: boolean;
        jobId?: string;
        status?: "queued" | "running";
        total?: number;
        skippedUnsubscribed?: number;
      }>("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          from: workspace.from,
          fromName: workspace.fromName,
          to: recipients,
          subject,
          html,
          dryRun,
          configSet: workspace.configSet,
          rateLimit: workspace.rateLimit,
          footerHtml: workspace.footerHtml,
          websiteUrl: workspace.websiteUrl,
        }),
      });
      if (data.dryRun) {
        const skipped =
          typeof data.skippedUnsubscribed === "number"
            ? data.skippedUnsubscribed
            : 0;
        setResult(
          `Dry run: ${data.sent} email(s) would be sent.${skipped > 0 ? ` ${skipped} unsubscribed skipped.` : ""}`
        );
        setSending(false);
      } else {
        if (!data.jobId) {
          setResult("Failed to start send job.");
          setSending(false);
          return;
        }
        setActiveSendJobId(data.jobId);
        const skipped =
          typeof data.skippedUnsubscribed === "number"
            ? data.skippedUnsubscribed
            : 0;
        setResult(
          `Queued ${data.total ?? recipients.length} recipients${skipped > 0 ? ` (${skipped} unsubscribed skipped)` : ""}`
        );
        pollSendJob();
      }
    } catch (err) {
      setResult(`Error: ${err}`);
      setSending(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400 text-sm">
        Loading authentication...
      </div>
    );
  }

  if (!sessionToken) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 px-4">
        <form
          onSubmit={handleAuthSubmit}
          className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h1 className="text-lg font-semibold">
            {authMode === "sign-in" ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Email/password access is currently restricted.
          </p>

          <div className="mt-4 grid grid-cols-2 rounded border border-gray-200 p-1">
            <button
              type="button"
              onClick={() => {
                setAuthMode("sign-in");
                setAuthError(null);
                setAuthMessage(null);
              }}
              className={`rounded px-3 py-1.5 text-sm ${
                authMode === "sign-in"
                  ? "bg-black text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("sign-up");
                setAuthError(null);
                setAuthMessage(null);
              }}
              className={`rounded px-3 py-1.5 text-sm ${
                authMode === "sign-up"
                  ? "bg-black text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Sign up
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-600">Email</span>
              <input
                type="email"
                autoComplete="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                required
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-600">Password</span>
              <input
                type="password"
                autoComplete={
                  authMode === "sign-in"
                    ? "current-password"
                    : "new-password"
                }
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                required
              />
            </label>

            {authMessage && (
              <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                {authMessage}
              </p>
            )}

            {authError && (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {authError}
              </p>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingIn
                ? authMode === "sign-in"
                  ? "Signing in..."
                  : "Creating account..."
                : authMode === "sign-in"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400 text-sm">
        Loading SES domains...
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">No workspace yet</h1>
            <button
              onClick={handleSignOut}
              className="text-xs text-black hover:underline"
            >
              Sign out
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Add a domain/workspace to start testing. SES verification is only required for real sends.
          </p>

          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={newWorkspaceId}
              onChange={(event) => setNewWorkspaceId(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && addWorkspace()}
              placeholder="example.com"
              className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
            />
            <button
              onClick={addWorkspace}
              disabled={addingWorkspace}
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {addingWorkspace ? "Adding..." : "Add domain"}
            </button>
          </div>

          {workspaceMessage && (
            <p className="mt-3 text-xs text-gray-600">{workspaceMessage}</p>
          )}
        </div>
      </div>
    );
  }

  const isSettingsSaving = settingsSaveState === "saving";
  const canSaveSettings =
    !isSettingsSaving &&
    (settingsSaveState === "dirty" || settingsSaveState === "error");
  const settingsStatusText =
    settingsSaveState === "dirty"
      ? "Unsaved changes"
      : settingsSaveState === "saving"
      ? "Saving settings..."
      : settingsSaveState === "saved"
      ? `Saved at ${settingsSavedAtLabel ?? "just now"}`
      : settingsSaveState === "error"
      ? `Save failed: ${settingsSaveMessage ?? "Unknown error"}`
      : null;
  const settingsStatusClass =
    settingsSaveState === "saved"
      ? "text-green-700"
      : settingsSaveState === "error"
      ? "text-red-700"
      : "text-gray-500";
  const isNamecheapProvider = dnsProvider === "namecheap";
  const isCloudflareProvider = dnsProvider === "cloudflare";
  const isRoute53Provider = dnsProvider === "route53";
  const namecheapApplyBusy = setupActionLoading === "configure-namecheap-dns";
  const cloudflareApplyBusy = setupActionLoading === "configure-cloudflare-dns";
  const route53ApplyBusy = setupActionLoading === "configure-route53-dns";
  const isNamecheapConfigComplete =
    namecheapConfig.apiUser.trim().length > 0 &&
    namecheapConfig.username.trim().length > 0 &&
    namecheapConfig.apiKey.trim().length > 0 &&
    namecheapConfig.clientIp.trim().length > 0;
  const isCloudflareConfigComplete =
    cloudflareConfig.apiToken.trim().length > 0;
  const canConfirmWorkspaceDelete =
    workspaceDeleteConfirmValue.trim().toLowerCase() ===
    (workspace?.id ?? "").toLowerCase();

  return (
    <div className="app-shell">
      <AppSidebar
        brand="Email Campaign"
        userEmail={userEmail}
        onSignOut={handleSignOut}
        authError={authError}
        controls={
          <div className="px-3 mt-4 mb-4">
            <div className="flex gap-2">
              <FancySelect
                wrapperClassName="w-full"
                value={activeId ?? ""}
                onChange={(e) => setActiveId(e.target.value)}
                className="h-8 border-gray-300 text-sm focus:border-black focus:ring-black/10"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </FancySelect>
              <button
                type="button"
                onClick={() => {
                  if (addingWorkspace) return;
                  const value = prompt("Domain to add (e.g. example.com):");
                  if (!value) return;
                  void addWorkspaceById(value);
                }}
                disabled={addingWorkspace}
                className="shrink-0 rounded border border-gray-300 px-2 py-1.5 text-xs hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {addingWorkspace ? "..." : "Add"}
              </button>
            </div>
            {workspaceMessage && (
              <p className="mt-1 text-[11px] text-gray-500">{workspaceMessage}</p>
            )}
          </div>
        }
        items={(["compose", "contacts", "history", "campaigns", "settings"] as Tab[]).map((t) => ({
          id: t,
          label: t,
          active: tab === t,
          onClick: () => setTab(t),
        }))}
        footer={
          contacts.length > 0 ? (
            <span className="text-xs text-gray-400">
              {contacts.length} contact{contacts.length !== 1 && "s"}
            </span>
          ) : null
        }
      />

      {/* Main content */}
      <div className="flex flex-1 min-w-0">
        {tab === "compose" && (
          <>
            <div className="w-1/2 border-r border-gray-200 p-6 flex flex-col gap-4 overflow-y-auto">
              <div>
                <h1 className="text-xl font-semibold">Compose Email</h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  Sending as {workspace.fromName || workspace.name}
                </p>
                {!workspace.verified && (
                  <p className="mt-1 text-xs text-amber-700">
                    This domain is not verified in SES yet. Dry run works, live send will fail until verified.
                  </p>
                )}
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">From</span>
                <input
                  type="text"
                  value={workspace.from}
                  onChange={(e) => updateWorkspace({ from: e.target.value })}
                  className="border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
                />
              </label>

              <label className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">
                    To{" "}
                    <span className="text-gray-400 font-normal">
                      ({recipients.length} selected)
                    </span>
                    <span className="text-gray-400 font-normal">{" "} · one per line</span>
                  </span>
                  {contacts.length > 0 && (
                    <button
                      type="button"
                      onClick={insertAllContacts}
                      className="text-xs text-black hover:underline"
                    >
                      Use all contacts ({contacts.length})
                    </button>
                  )}
                </div>
                <textarea
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  rows={3}
                  placeholder="recipient@example.com"
                  className="border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black resize-none"
                />
              </label>

              <label className="rounded border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Recipient Conditions</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Combine conditions with manual input to build the final recipient
                      list.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={segmentedSetClass()}>
                      {CONDITION_MATCH_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setConditionMatchMode(option.value)}
                          className={segmentedButtonClass(
                            conditionMatchMode === option.value
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={addFieldCondition}
                      className="text-xs text-black border border-gray-300 rounded px-2 py-1 hover:bg-white"
                    >
                      + Field Rule
                    </button>
                    <button
                      type="button"
                      onClick={addHistoryCondition}
                      className="text-xs text-black border border-gray-300 rounded px-2 py-1 hover:bg-white"
                    >
                      + History Rule
                    </button>
                    <button
                      type="button"
                      onClick={importMatchedRecipients}
                      disabled={!conditionMatchedRecipients.length}
                      className="text-xs text-black border border-gray-300 rounded px-2 py-1 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Import Matched ({conditionMatchedRecipients.length})
                    </button>
                  </div>
                </div>
                {recipientConditions.length === 0 ? (
                  <p className="mt-2 text-xs text-gray-500">
                    No dynamic rules yet. Add one to target contacts by field or history
                    behavior.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {recipientConditions.map((condition) => (
                      <div
                        key={condition.id}
                        className="border border-gray-200 rounded-md bg-white p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className={segmentedSetClass()}>
                            <button
                              type="button"
                              onClick={() => setConditionType(condition.id, "field")}
                              className={segmentedButtonClass(condition.kind === "field")}
                            >
                              Field
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConditionType(condition.id, "history")
                              }
                              className={segmentedButtonClass(condition.kind === "history")}
                            >
                              History
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeCondition(condition.id)}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                        {condition.kind === "field" ? (
                          <div className="mt-2 grid sm:grid-cols-3 gap-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] text-gray-500">Field</span>
                              <input
                                list="recipient-field-keys"
                                value={condition.field}
                                onChange={(e) =>
                                  setCondition(condition.id, { field: e.target.value })
                                }
                                className="border border-gray-300 rounded px-2 py-1 text-sm"
                                placeholder="verified, company..."
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] text-gray-500">Operator</span>
                              <div className="flex flex-wrap gap-1.5">
                                {FIELD_OPERATORS.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                      setCondition(condition.id, {
                                        operator: option.value,
                                      })
                                    }
                                    className={segmentedButtonClass(
                                      condition.operator === option.value
                                    )}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] text-gray-500">Value</span>
                              <input
                                value={condition.value}
                                onChange={(e) =>
                                  setCondition(condition.id, {
                                    value: e.target.value,
                                  })
                                }
                                className="border border-gray-300 rounded px-2 py-1 text-sm"
                                placeholder="true"
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="mt-2 grid sm:grid-cols-3 gap-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] text-gray-500">
                                Subject Match
                              </span>
                              <input
                                list="recipient-subjects"
                                value={condition.subject}
                                onChange={(e) =>
                                  setCondition(condition.id, {
                                    subject: e.target.value,
                                  })
                                }
                                className="border border-gray-300 rounded px-2 py-1 text-sm"
                                placeholder="subject text..."
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] text-gray-500">
                                Match mode
                              </span>
                              <div className={segmentedSetClass()}>
                                {HISTORY_MATCH_OPTIONS.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                      setCondition(condition.id, {
                                        subjectMatch: option.value,
                                      })
                                    }
                                    className={segmentedButtonClass(
                                      condition.subjectMatch === option.value
                                    )}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] text-gray-500">Event</span>
                              <div className={`${segmentedSetClass()} flex-wrap`}>
                                {HISTORY_EVENTS.map((event) => (
                                  <button
                                    key={event}
                                    type="button"
                                    onClick={() =>
                                      setCondition(condition.id, { eventType: event })
                                    }
                                    className={segmentedButtonClass(
                                      condition.eventType === event
                                    )}
                                  >
                                    {event}
                                  </button>
                                ))}
                              </div>
                            </label>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <datalist id="recipient-field-keys">
                  {availableFieldKeys.map((key) => (
                    <option key={key} value={key} />
                  ))}
                </datalist>
                <datalist id="recipient-subjects">
                  {availableSubjects.map((subject) => (
                    <option key={subject} value={subject} />
                  ))}
                </datalist>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">
                  Subject
                </span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </label>

              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <p className="text-sm font-medium text-gray-700">Vibe Body</p>
                <p className="mt-1 text-xs text-gray-500">
                  Describe what to write or how to revise. Click again to iterate from current HTML.
                </p>
                <textarea
                  value={bodyVibePrompt}
                  onChange={(e) => setBodyVibePrompt(e.target.value)}
                  rows={3}
                  placeholder="Write a concise launch email for indie founders, warm tone, with one CTA button."
                  className="mt-2 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black resize-y"
                />
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => generateVibeHtml("email")}
                    disabled={bodyVibeBusy}
                    className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {bodyVibeBusy ? "Generating..." : "Generate Body HTML"}
                  </button>
                  {bodyVibeStatus && (
                    <span className="text-xs text-gray-500">{bodyVibeStatus}</span>
                  )}
                </div>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-600">
                  Body{" "}
                  <span className="text-gray-400 font-normal">(raw HTML)</span>
                </span>
                <textarea
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  rows={16}
                  placeholder="<h1>Hello!</h1>"
                  className="border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black resize-y"
                />
                <span className="text-xs text-gray-400">
                  Variables:{" "}
                  <code className="bg-gray-100 px-1 rounded">{"{{email}}"}</code>
                  {allFieldKeys.map((k) => (
                    <span key={k}>
                      {" "}
                      <code className="bg-gray-100 px-1 rounded">{`{{${k}}}`}</code>
                    </span>
                  ))}
                </span>
                <span className="text-xs text-gray-400">
                  Workspace footer + unsubscribe link are appended automatically.
                </span>
              </label>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={dryRun}
                  onClick={() => setDryRun(!dryRun)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    dryRun ? "bg-black" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                      dryRun ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
                <span className="text-sm text-gray-600">
                  Dry run {dryRun ? "(ON)" : "(OFF)"}
                </span>
              </div>

              <div className="text-xs text-gray-500">
                Manual recipients: {manualRecipients.length}. Dynamic recipients:
                {" "}
                {conditionMatchedRecipients.length}. Total: {recipients.length}.
              </div>

              <button
                onClick={handleSend}
                disabled={sending}
                className="mt-2 bg-black text-white rounded px-4 py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed w-fit"
              >
                {sending && activeSendJob
                  ? `Processing... ${activeSendJob.sent + activeSendJob.failed}/${activeSendJob.total}`
                  : sending
                    ? "Sending..."
                    : `Send${recipients.length > 1 ? ` (${recipients.length})` : ""}`}
              </button>

              {activeSendJob && (
                <div className="mt-2 rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">
                      Job {activeSendJob.status.toUpperCase()}
                    </span>
                    <span>
                      {activeSendJob.sent + activeSendJob.failed}/{activeSendJob.total}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded bg-gray-100 overflow-hidden">
                    <div
                      className="h-full bg-black transition-all"
                      style={{ width: `${Math.min(100, Math.round(activeSendJob.percent))}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[11px]">
                    {Math.round(activeSendJob.percent)}% complete
                    {activeSendJob.errorMessage ? ` · ${activeSendJob.errorMessage}` : ""}
                  </div>
                  {activeSendJob.recentErrors.length > 0 && (
                    <ul className="mt-2 text-[11px] text-red-600 space-y-0.5">
                      {activeSendJob.recentErrors.slice(0, 3).map((error) => (
                        <li key={error}>• {error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {result && (
                <div className="text-sm px-3 py-2 rounded bg-gray-100 border border-gray-200 font-mono">
                  {result}
                </div>
              )}
            </div>

            <div className="w-1/2 flex flex-col">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-sm font-medium text-gray-600">
                  Live Preview
                </h2>
              </div>
              <iframe
                ref={iframeRef}
                title="Email preview"
                className="flex-1 w-full bg-white"
                sandbox="allow-same-origin"
              />
            </div>
          </>
        )}

        {tab === "contacts" && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h1 className="text-xl font-semibold">Contacts</h1>
              <div className="flex items-center gap-2">
                {contacts.length > 0 && (
                  <>
                    <button
                      onClick={insertAllContacts}
                      className="text-xs text-black hover:underline"
                    >
                      Use all in Compose
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={clearContacts}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Clear all
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-4">{workspace.name}</p>

            {/* Upload + manual add */}
            <div className="flex gap-2 mb-6">
              <input
                type="email"
                value={newContact}
                onChange={(e) => setNewContact(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addContact()}
                placeholder="email@example.com"
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
              />
              <button
                onClick={addContact}
                className="bg-black text-white rounded px-4 py-2 text-sm font-medium hover:bg-gray-800"
              >
                Add
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleCSVUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={contactsImporting}
                className={`border border-gray-300 rounded px-4 py-2 text-sm font-medium ${
                  contactsImporting
                    ? "cursor-not-allowed opacity-60"
                    : "hover:bg-gray-100"
                }`}
              >
                {contactsImporting ? "Uploading..." : "Upload CSV"}
              </button>
              {contacts.length > 0 && (
                <button
                  onClick={() => {
                    const name = prompt("Field name (e.g. company, city):");
                    if (!name?.trim()) return;
                    const key = name.trim().toLowerCase();
                    if (key === "email" || allFieldKeys.includes(key)) return;
                    // Add the key to all contacts with empty value
                    setLocalContacts(
                      contacts.map((c) => ({
                        ...c,
                        fields: { ...c.fields, [key]: c.fields[key] ?? "" },
                      }))
                    );
                  }}
                  className="border border-gray-300 rounded px-4 py-2 text-sm font-medium hover:bg-gray-100"
                >
                  + Field
                </button>
              )}
            </div>
            {contactsImportMessage && (
              <p className="mb-4 text-xs text-gray-500">{contactsImportMessage}</p>
            )}

            {/* Contact table */}
            {contacts.length === 0 ? (
              <div className="text-sm text-gray-400">
                <p>No contacts yet. Add manually or upload a CSV.</p>
                <p className="mt-2 text-xs">
                  CSV format: <code className="bg-gray-100 px-1 rounded">email,name,company,...</code>
                </p>
              </div>
            ) : (
              <>
                <div className="border border-gray-200 rounded overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Email
                        </th>
                        {allFieldKeys.map((key) => (
                          <th
                            key={key}
                            className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider w-36"
                          >
                            {key}
                          </th>
                        ))}
                        <th className="w-16" />
                      </tr>
                    </thead>
                    <tbody>
                      {contactsVisibleRows.map((c) => (
                        <tr
                          key={c.email}
                          className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                        >
                          <td className="px-3 py-2 font-mono text-sm">
                            {c.email}
                          </td>
                          {allFieldKeys.map((key) => (
                            <td key={key} className="px-1 py-1">
                              <input
                                type="text"
                                value={c.fields[key] ?? ""}
                                onChange={(e) =>
                                  updateContactField(c.email, key, e.target.value)
                                }
                                placeholder="--"
                                className="w-full px-2 py-1 text-sm border border-transparent rounded hover:border-gray-300 focus:border-gray-300 focus:outline-none"
                              />
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => removeContact(c.email)}
                              className="text-gray-400 hover:text-red-500 text-xs"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                  <p>
                    Showing {contactsRangeStart}-{contactsRangeEnd} of {contacts.length}{" "}
                    contact
                    {contacts.length !== 1 && "s"}
                  </p>
                  {contactsTotalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setContactsPage((page) => Math.max(1, page - 1))}
                        disabled={contactsPage <= 1}
                        className={`rounded border px-2 py-1 ${
                          contactsPage <= 1
                            ? "cursor-not-allowed border-gray-200 text-gray-300"
                            : "border-gray-300 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        Prev
                      </button>
                      <span>
                        Page {contactsPage}/{contactsTotalPages}
                      </span>
                      <button
                        onClick={() =>
                          setContactsPage((page) =>
                            Math.min(contactsTotalPages, page + 1)
                          )
                        }
                        disabled={contactsPage >= contactsTotalPages}
                        className={`rounded border px-2 py-1 ${
                          contactsPage >= contactsTotalPages
                            ? "cursor-not-allowed border-gray-200 text-gray-300"
                            : "border-gray-300 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h1 className="text-xl font-semibold">Send History</h1>
              <button
                onClick={refreshHistoryPage}
                disabled={
                  historyLoading ||
                  subjectMetricsLoading ||
                  campaignPerformanceLoading ||
                  !activeId
                }
                className="text-xs text-black hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
              >
                {historyLoading || subjectMetricsLoading || campaignPerformanceLoading
                  ? "Refreshing..."
                  : "Refresh"}
              </button>
            </div>
            <p className="mb-4 text-xs text-gray-400">{workspace.name}</p>

            <div className="mb-4">
              <div className={segmentedSetClass()}>
                <button
                  type="button"
                  onClick={() => setHistoryView("activity")}
                  className={segmentedButtonClass(historyView === "activity")}
                >
                  Activity
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryView("performance")}
                  className={segmentedButtonClass(historyView === "performance")}
                >
                  Campaign Performance
                </button>
              </div>
            </div>

            {historyView === "performance" ? (
              <div className="space-y-4">
                <div className="rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Campaign selector
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Pick a campaign to inspect delivery, opens, clicks, and clicked links.
                      </p>
                    </div>
                    <label className="w-full max-w-lg space-y-1">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                        Campaign (subject)
                      </span>
                      <FancySelect
                        wrapperClassName="w-full"
                        value={selectedCampaignSubject}
                        onChange={(event) => setSelectedCampaignSubject(event.target.value)}
                        disabled={subjectMetricsLoading || subjectMetrics.length === 0}
                        className="h-8 border-gray-300 text-xs"
                      >
                        {subjectMetrics.length === 0 ? (
                          <option value="">No campaigns yet</option>
                        ) : (
                          subjectMetrics.map((metric) => (
                            <option key={metric.subject} value={metric.subject}>
                              {metric.subject}
                            </option>
                          ))
                        )}
                      </FancySelect>
                    </label>
                  </div>

                  {subjectMetricsLoading ? (
                    <p className="mt-3 text-xs text-gray-500">Loading campaigns...</p>
                  ) : subjectMetricsError ? (
                    <p className="mt-3 text-xs text-red-600">{subjectMetricsError}</p>
                  ) : subjectMetrics.length === 0 ? (
                    <p className="mt-3 text-xs text-gray-500">
                      No campaign metrics yet for this workspace.
                    </p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200 text-gray-500">
                            <th className="px-2 py-1.5 text-left font-semibold">Campaign</th>
                            <th className="px-2 py-1.5 text-right font-semibold">Sends</th>
                            <th className="px-2 py-1.5 text-right font-semibold">
                              Open rate (sent)
                            </th>
                            <th className="px-2 py-1.5 text-right font-semibold">
                              Click rate (sent)
                            </th>
                            <th className="px-2 py-1.5 text-right font-semibold">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {subjectMetrics.map((metric) => {
                            const active = metric.subject === selectedCampaignSubject;
                            return (
                              <tr
                                key={metric.subject}
                                className={`border-b border-gray-100 last:border-0 ${
                                  active ? "bg-white" : ""
                                }`}
                              >
                                <td className="max-w-[28rem] truncate px-2 py-1.5 text-gray-700">
                                  {metric.subject}
                                </td>
                                <td className="px-2 py-1.5 text-right text-gray-700">
                                  {metric.totalSends}
                                </td>
                                <td className="px-2 py-1.5 text-right text-gray-700">
                                  {formatPercent(metric.openRate)} ({metric.openedSends})
                                </td>
                                <td className="px-2 py-1.5 text-right text-gray-700">
                                  {formatPercent(metric.ctr)} ({metric.clickedSends})
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedCampaignSubject(metric.subject)}
                                    className={`rounded border px-2 py-1 text-[11px] font-medium ${
                                      active
                                        ? "border-black bg-black text-white"
                                        : "border-gray-300 text-gray-700 hover:bg-gray-100"
                                    }`}
                                  >
                                    {active ? "Selected" : "View"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {campaignPerformanceLoading ? (
                  <p className="text-sm text-gray-500">Loading campaign performance...</p>
                ) : campaignPerformanceError ? (
                  <p className="text-sm text-red-600">{campaignPerformanceError}</p>
                ) : campaignPerformance ? (
                  <>
                    <div className="rounded border border-gray-200 bg-white p-4">
                      <p className="mb-1 text-sm font-semibold text-gray-900">
                        {campaignPerformance.subject}
                      </p>
                      <p className="mb-3 text-xs text-gray-500">
                        Open and click rates are calculated from delivered sends.
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded border border-gray-200 bg-gray-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-gray-500">Sent</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {campaignPerformance.totalSends}
                          </p>
                        </div>
                        <div className="rounded border border-gray-200 bg-gray-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-gray-500">
                            Delivered
                          </p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {formatPercent(campaignPerformance.deliveryRate)}
                          </p>
                          <p className="text-xs text-gray-500">
                            {campaignPerformance.deliveredSends} / {campaignPerformance.totalSends}
                          </p>
                        </div>
                        <div className="rounded border border-gray-200 bg-gray-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-gray-500">Opened</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {formatPercent(campaignPerformance.openRate)}
                          </p>
                          <p className="text-xs text-gray-500">{campaignPerformance.openedSends}</p>
                        </div>
                        <div className="rounded border border-gray-200 bg-gray-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-gray-500">Clicked</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {formatPercent(campaignPerformance.clickRate)}
                          </p>
                          <p className="text-xs text-gray-500">{campaignPerformance.clickedSends}</p>
                        </div>
                      </div>

                      <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
                        <CampaignSankeyDiagram analytics={campaignPerformance} />
                      </div>
                    </div>

                    <div className="rounded border border-gray-200 bg-white p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            Clicked links
                          </p>
                          <p className="text-xs text-gray-500">
                            Unique clickers are deduplicated by recipient email.
                          </p>
                        </div>
                      </div>
                      {campaignPerformance.clickedLinks.length === 0 ? (
                        <p className="text-sm text-gray-500">
                          No link clicks recorded for this campaign yet.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-200 text-gray-500">
                                <th className="px-2 py-1.5 text-left font-semibold">URL</th>
                                <th className="px-2 py-1.5 text-right font-semibold">
                                  Unique clickers
                                </th>
                                <th className="px-2 py-1.5 text-right font-semibold">
                                  Total clicks
                                </th>
                                <th className="px-2 py-1.5 text-right font-semibold">
                                  Click rate
                                </th>
                                <th className="px-2 py-1.5 text-right font-semibold">
                                  Last clicked
                                </th>
                                <th className="px-2 py-1.5 text-right font-semibold">Drill down</th>
                              </tr>
                            </thead>
                            <tbody>
                              {campaignPerformance.clickedLinks.map((link) => {
                                const isExpanded = expandedClickedUrl === link.url;
                                const safeUrl = getSafeExternalUrl(link.url);
                                return (
                                  <Fragment key={link.url}>
                                    <tr className="border-b border-gray-100">
                                      <td className="max-w-[30rem] px-2 py-1.5">
                                        {safeUrl ? (
                                          <a
                                            href={safeUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block truncate text-blue-700 hover:underline"
                                            title={link.url}
                                          >
                                            {link.url}
                                          </a>
                                        ) : (
                                          <span className="block truncate text-gray-700" title={link.url}>
                                            {link.url}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-2 py-1.5 text-right text-gray-700">
                                        {link.uniqueClickers}
                                      </td>
                                      <td className="px-2 py-1.5 text-right text-gray-700">
                                        {link.totalClicks}
                                      </td>
                                      <td className="px-2 py-1.5 text-right text-gray-700">
                                        {formatPercent(link.clickRate)}
                                      </td>
                                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-gray-700">
                                        {formatTimestampOrDash(link.lastClickedAt)}
                                      </td>
                                      <td className="px-2 py-1.5 text-right">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setExpandedClickedUrl((current) =>
                                              current === link.url ? null : link.url
                                            )
                                          }
                                          className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                                        >
                                          {isExpanded ? "Hide recipients" : "View recipients"}
                                        </button>
                                      </td>
                                    </tr>
                                    {isExpanded && (
                                      <tr className="border-b border-gray-100 bg-gray-50">
                                        <td colSpan={6} className="px-3 py-2">
                                          {link.recipients.length === 0 ? (
                                            <p className="text-xs text-gray-500">
                                              No recipient details found.
                                            </p>
                                          ) : (
                                            <div className="overflow-x-auto">
                                              <table className="w-full text-xs">
                                                <thead>
                                                  <tr className="border-b border-gray-200 text-gray-500">
                                                    <th className="px-2 py-1 text-left font-semibold">
                                                      Recipient
                                                    </th>
                                                    <th className="px-2 py-1 text-right font-semibold">
                                                      Clicks
                                                    </th>
                                                    <th className="px-2 py-1 text-right font-semibold">
                                                      Last clicked
                                                    </th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {link.recipients.slice(0, 25).map((recipient) => (
                                                    <tr
                                                      key={`${link.url}-${recipient.recipient}`}
                                                      className="border-b border-gray-100 last:border-0"
                                                    >
                                                      <td className="px-2 py-1 font-mono text-gray-700">
                                                        {recipient.recipient}
                                                      </td>
                                                      <td className="px-2 py-1 text-right text-gray-700">
                                                        {recipient.totalClicks}
                                                      </td>
                                                      <td className="px-2 py-1 text-right text-gray-700">
                                                        {formatTimestampOrDash(recipient.lastClickedAt)}
                                                      </td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                              {link.recipients.length > 25 && (
                                                <p className="mt-2 text-[11px] text-gray-500">
                                                  Showing 25 of {link.recipients.length} recipients.
                                                </p>
                                              )}
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                ) : selectedCampaignMetric ? (
                  <p className="text-sm text-gray-500">
                    Select a campaign to load delivery and clicked-link analytics.
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <form
                  onSubmit={submitHistorySearch}
                  className="mb-4 flex flex-wrap items-center gap-2"
                >
                  <input
                    type="search"
                    value={historySearchInput}
                    onChange={(event) => setHistorySearchInput(event.target.value)}
                    placeholder="Search recipient, subject, or message ID"
                    className="w-full max-w-md rounded border border-gray-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                  <button
                    type="submit"
                    className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    Search
                  </button>
                  {(historySearch || historySearchInput) && (
                    <button
                      type="button"
                      onClick={clearHistorySearch}
                      className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100"
                    >
                      Clear
                    </button>
                  )}
                </form>

                {historyLoading ? (
                  <p className="text-sm text-gray-400">Loading...</p>
                ) : historyRows.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    {historySearch
                      ? "No history results match your search."
                      : "No emails sent yet from this workspace."}
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded border border-gray-200">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                              Recipient
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                              Subject
                            </th>
                            <th className="w-40 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                              Sent
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {historyRows.map((item) => {
                            const visibleEvents = getHistoryEventsForDisplay(item.events);
                            return (
                              <tr
                                key={item.messageId}
                                className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                              >
                                <td className="px-3 py-2 font-mono text-sm">{item.recipient}</td>
                                <td className="max-w-xs truncate px-3 py-2 text-sm">
                                  {item.subject}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-500">
                                  {formatTimestamp(item.sentAt)}
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    {visibleEvents.map((event) => {
                                      const meta = HISTORY_EVENT_META[event.type];
                                      return (
                                        <span
                                          key={`${item.messageId}-${event.type}`}
                                          title={formatHistoryEventTooltip(event)}
                                          className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                                            meta?.className ?? "bg-gray-100 text-gray-600"
                                          }`}
                                        >
                                          {meta?.label ?? event.type}
                                        </span>
                                      );
                                    })}
                                    {visibleEvents.length === 0 && (
                                      <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400">
                                        Pending
                                      </span>
                                    )}
                                  </div>
                                  {visibleEvents.some(
                                    (event) => event.detail.trim().length > 0
                                  ) && (
                                    <p className="mt-1 text-[11px] leading-snug text-gray-500">
                                      {visibleEvents
                                        .filter((event) => event.detail.trim().length > 0)
                                        .map((event) => {
                                          const label =
                                            HISTORY_EVENT_META[event.type]?.label ?? event.type;
                                          return `${label}: ${event.detail.trim()}`;
                                        })
                                        .join(" · ")}
                                    </p>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
                      <p>
                        Showing {historyRangeStart}-{historyRangeEnd} of {historyTotal}
                        {historySearch ? ` results for "${historySearch}"` : ""}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                          disabled={historyLoading || historyPage <= 1}
                          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Previous
                        </button>
                        <span>
                          Page {historyPage} of {historyTotalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryPage((prev) => Math.min(historyTotalPages, prev + 1))
                          }
                          disabled={historyLoading || historyPage >= historyTotalPages}
                          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {tab === "settings" && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h1 className="text-xl font-semibold">Settings</h1>
              <div className="flex items-center gap-3">
                {settingsStatusText && (
                  <p
                    aria-live="polite"
                    className={`text-xs ${settingsStatusClass}`}
                  >
                    {settingsStatusText}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void saveWorkspaceSettingsNow()}
                  disabled={!canSaveSettings}
                  className="rounded bg-black px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSettingsSaving ? "Saving..." : "Save settings"}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-6">{workspace.name}</p>

            <details open className="rounded border border-gray-200 bg-gray-50 p-4 mb-6 [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer text-sm font-semibold text-gray-800">
                Email Deliverability Setup
              </summary>
              <div className="flex items-center justify-between mt-3 mb-3">
                <p className="text-xs text-gray-500">
                  Complete these steps to ensure your emails reach the inbox instead of spam.
                </p>
                <button
                  type="button"
                  onClick={() => fetchSetupStatus()}
                  disabled={setupLoading}
                  className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                >
                  {setupLoading ? "Checking..." : "Refresh status"}
                </button>
              </div>
              <div className="flex flex-col gap-3">

                <div className="rounded border border-gray-200 bg-white p-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-sm text-gray-700 font-medium">DNS provider</span>
                    <FancySelect
                      wrapperClassName="max-w-xs"
                      value={dnsProvider}
                      onChange={(event) => setDnsProvider(event.target.value as DnsProvider)}
                      className="h-8 border-gray-300 text-xs font-medium focus:border-black focus:ring-black/10"
                    >
                      <option value="manual">Manual DNS</option>
                      <option value="namecheap">Namecheap</option>
                      <option value="cloudflare">Cloudflare</option>
                      <option value="route53">Amazon Route 53</option>
                    </FancySelect>
                    <span className="text-[11px] text-gray-500">
                      Choose where DNS should be managed for this domain.
                    </span>
                  </label>
                </div>

                {isNamecheapProvider && (
                  <div className="rounded border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-gray-700 font-medium">Auto-configure DNS in Namecheap</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Applies SES verification, DKIM, SPF, and DMARC records automatically.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void configureNamecheapDns()}
                        disabled={namecheapApplyBusy || !isNamecheapConfigComplete}
                        className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-100 disabled:opacity-50"
                      >
                        {namecheapApplyBusy ? "Applying..." : "Apply in Namecheap"}
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-gray-500">API User</span>
                        <input
                          type="text"
                          value={namecheapConfig.apiUser}
                          onChange={(event) =>
                            updateNamecheapConfig({ apiUser: event.target.value })
                          }
                          placeholder="your-namecheap-api-user"
                          className="border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-gray-500">Username</span>
                        <input
                          type="text"
                          value={namecheapConfig.username}
                          onChange={(event) =>
                            updateNamecheapConfig({ username: event.target.value })
                          }
                          placeholder="your-namecheap-username"
                          className="border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-gray-500">Client IP (whitelisted)</span>
                        <input
                          type="text"
                          value={namecheapConfig.clientIp}
                          onChange={(event) =>
                            updateNamecheapConfig({ clientIp: event.target.value })
                          }
                          placeholder="203.0.113.10"
                          className="border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-gray-500">API Key</span>
                        <input
                          type="password"
                          value={namecheapConfig.apiKey}
                          onChange={(event) =>
                            updateNamecheapConfig({ apiKey: event.target.value })
                          }
                          autoComplete="off"
                          className="border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
                        />
                      </label>
                    </div>
                    <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-gray-600">
                      <input
                        type="checkbox"
                        checked={namecheapConfig.useSandbox}
                        onChange={(event) =>
                          updateNamecheapConfig({ useSandbox: event.target.checked })
                        }
                        className="h-3.5 w-3.5 rounded border-gray-300 text-black focus:ring-black"
                      />
                      Use Namecheap sandbox API
                    </label>
                    <p className="mt-1 text-[11px] text-gray-400">
                      API key is used only for the apply action and is not saved to local storage.
                    </p>
                    {namecheapStatus && (
                      <p
                        className={`mt-2 rounded border px-2 py-1 text-[11px] ${
                          namecheapStatus.type === "success"
                            ? "border-green-200 bg-green-50 text-green-700"
                            : "border-red-200 bg-red-50 text-red-700"
                        }`}
                      >
                        {namecheapStatus.message}
                      </p>
                    )}
                  </div>
                )}

                {isCloudflareProvider && (
                  <div className="rounded border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-gray-700 font-medium">Auto-configure DNS in Cloudflare</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Uses Cloudflare API to apply SES verification, DKIM, SPF, and DMARC.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void configureCloudflareDns()}
                        disabled={cloudflareApplyBusy || !isCloudflareConfigComplete}
                        className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-100 disabled:opacity-50"
                      >
                        {cloudflareApplyBusy ? "Applying..." : "Apply in Cloudflare"}
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className="text-[11px] text-gray-500">API Token</span>
                        <input
                          type="password"
                          value={cloudflareConfig.apiToken}
                          onChange={(event) =>
                            updateCloudflareConfig({ apiToken: event.target.value })
                          }
                          autoComplete="off"
                          placeholder="Cloudflare token with Zone:Read and DNS:Edit"
                          className="border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
                        />
                      </label>
                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className="text-[11px] text-gray-500">Zone ID (optional)</span>
                        <input
                          type="text"
                          value={cloudflareConfig.zoneId}
                          onChange={(event) =>
                            updateCloudflareConfig({ zoneId: event.target.value })
                          }
                          placeholder="If empty, zone is auto-detected from the domain"
                          className="border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
                        />
                      </label>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">
                      API token is used only for the apply action and is not saved to local storage.
                    </p>
                    {cloudflareStatus && (
                      <p
                        className={`mt-2 rounded border px-2 py-1 text-[11px] ${
                          cloudflareStatus.type === "success"
                            ? "border-green-200 bg-green-50 text-green-700"
                            : "border-red-200 bg-red-50 text-red-700"
                        }`}
                      >
                        {cloudflareStatus.message}
                      </p>
                    )}
                  </div>
                )}

                {isRoute53Provider && (
                  <div className="rounded border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-gray-700 font-medium">Auto-configure DNS in Route 53</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Uses current AWS credentials to apply SES records in Route 53.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void configureRoute53Dns()}
                        disabled={route53ApplyBusy}
                        className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-100 disabled:opacity-50"
                      >
                        {route53ApplyBusy ? "Applying..." : "Apply in Route 53"}
                      </button>
                    </div>
                    <label className="mt-3 flex flex-col gap-1">
                      <span className="text-[11px] text-gray-500">Hosted Zone ID (optional)</span>
                      <input
                        type="text"
                        value={route53Config.hostedZoneId}
                        onChange={(event) =>
                          updateRoute53Config({ hostedZoneId: event.target.value })
                        }
                        placeholder="If empty, the best matching hosted zone is auto-detected"
                        className="border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
                      />
                    </label>
                    {route53Status && (
                      <p
                        className={`mt-2 rounded border px-2 py-1 text-[11px] ${
                          route53Status.type === "success"
                            ? "border-green-200 bg-green-50 text-green-700"
                            : "border-red-200 bg-red-50 text-red-700"
                        }`}
                      >
                        {route53Status.message}
                      </p>
                    )}
                  </div>
                )}

                {/* 1. Verify domain */}
                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {setupStatus?.verificationStatus === "Success" ? (
                        <span className="h-4 w-4 shrink-0 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                      ) : setupStatus?.verificationStatus === "Pending" ? (
                        <span className="h-4 w-4 shrink-0 rounded-full bg-yellow-400" />
                      ) : (
                        <span className="h-4 w-4 shrink-0 rounded border border-gray-300 bg-white" />
                      )}
                      <p className="text-sm text-gray-700 font-medium">Verify domain in AWS SES</p>
                      {setupStatus && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          setupStatus.verificationStatus === "Success" ? "bg-green-100 text-green-700" :
                          setupStatus.verificationStatus === "Pending" ? "bg-yellow-100 text-yellow-700" :
                          setupStatus.verificationStatus === "Failed" ? "bg-red-100 text-red-700" :
                          "bg-gray-100 text-gray-500"
                        }`}>
                          {setupStatus.verificationStatus === "NotStarted" ? "Not started" : setupStatus.verificationStatus}
                        </span>
                      )}
                    </div>
                    {(!setupStatus || setupStatus.verificationStatus === "NotStarted") && (
                      <button
                        type="button"
                        onClick={() => runSetupAction("verify-domain")}
                        disabled={setupActionLoading === "verify-domain"}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-100 disabled:opacity-50"
                      >
                        {setupActionLoading === "verify-domain" ? "Starting..." : "Start verification"}
                      </button>
                    )}
                  </div>
                  {setupStatus?.verificationToken && (
                    <div className="mt-2 rounded bg-gray-50 p-2">
                      <p className="text-[11px] text-gray-500 mb-1">Add this TXT record to your DNS:</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 break-all bg-gray-100 px-2 py-1 rounded text-[11px] font-mono">
                          _amazonses.{workspace.id} → {setupStatus.verificationToken}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(setupStatus.verificationToken!, "verif-token")}
                          className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-medium hover:bg-gray-100"
                        >
                          {copiedField === "verif-token" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. SPF */}
                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2">
                    {setupStatus?.spfFound ? (
                      <span className="h-4 w-4 shrink-0 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded border border-gray-300 bg-white" />
                    )}
                    <p className="text-sm text-gray-700 font-medium">Add SPF record</p>
                    {setupStatus && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        setupStatus.spfFound ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {setupStatus.spfFound ? "Found" : "Not found"}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 rounded bg-gray-50 p-2">
                    <p className="text-[11px] text-gray-500 mb-1">Add this TXT record on <code className="bg-gray-200 px-1 rounded text-[11px]">{workspace.id}</code>:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all bg-gray-100 px-2 py-1 rounded text-[11px] font-mono">
                        v=spf1 include:amazonses.com ~all
                      </code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard("v=spf1 include:amazonses.com ~all", "spf")}
                        className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-medium hover:bg-gray-100"
                      >
                        {copiedField === "spf" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 3. DKIM */}
                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {setupStatus?.dkimStatus === "Success" ? (
                        <span className="h-4 w-4 shrink-0 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                      ) : setupStatus?.dkimStatus === "Pending" ? (
                        <span className="h-4 w-4 shrink-0 rounded-full bg-yellow-400" />
                      ) : (
                        <span className="h-4 w-4 shrink-0 rounded border border-gray-300 bg-white" />
                      )}
                      <p className="text-sm text-gray-700 font-medium">Set up DKIM</p>
                      {setupStatus && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          setupStatus.dkimStatus === "Success" ? "bg-green-100 text-green-700" :
                          setupStatus.dkimStatus === "Pending" ? "bg-yellow-100 text-yellow-700" :
                          setupStatus.dkimStatus === "Failed" ? "bg-red-100 text-red-700" :
                          "bg-gray-100 text-gray-500"
                        }`}>
                          {setupStatus.dkimStatus === "NotStarted" ? "Not started" : setupStatus.dkimStatus}
                        </span>
                      )}
                    </div>
                    {(!setupStatus || (setupStatus.dkimStatus === "NotStarted" && setupStatus.dkimTokens.length === 0)) && (
                      <button
                        type="button"
                        onClick={() => runSetupAction("setup-dkim")}
                        disabled={setupActionLoading === "setup-dkim"}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-100 disabled:opacity-50"
                      >
                        {setupActionLoading === "setup-dkim" ? "Generating..." : "Generate DKIM"}
                      </button>
                    )}
                  </div>
                  {setupStatus && setupStatus.dkimTokens.length > 0 && (
                    <div className="mt-2 rounded bg-gray-50 p-2">
                      <p className="text-[11px] text-gray-500 mb-1">Add these 3 CNAME records to your DNS:</p>
                      <div className="flex flex-col gap-1.5">
                        {setupStatus.dkimTokens.map((token, i) => (
                          <div key={token} className="flex items-center gap-2">
                            <code className="flex-1 break-all bg-gray-100 px-2 py-1 rounded text-[11px] font-mono">
                              {token}._domainkey.{workspace.id} → {token}.dkim.amazonses.com
                            </code>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(`${token}._domainkey.${workspace.id} CNAME ${token}.dkim.amazonses.com`, `dkim-${i}`)}
                              className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-medium hover:bg-gray-100"
                            >
                              {copiedField === `dkim-${i}` ? "Copied!" : "Copy"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. DMARC */}
                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2">
                    {setupStatus?.dmarcFound ? (
                      <span className="h-4 w-4 shrink-0 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded border border-gray-300 bg-white" />
                    )}
                    <p className="text-sm text-gray-700 font-medium">Add DMARC record</p>
                    {setupStatus && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        setupStatus.dmarcFound ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {setupStatus.dmarcFound ? "Found" : "Not found"}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 rounded bg-gray-50 p-2">
                    <p className="text-[11px] text-gray-500 mb-1">Add this TXT record at <code className="bg-gray-200 px-1 rounded text-[11px]">_dmarc.{workspace.id}</code>:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all bg-gray-100 px-2 py-1 rounded text-[11px] font-mono">
                        v=DMARC1; p=quarantine; rua=mailto:dmarc@{workspace.id}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`v=DMARC1; p=quarantine; rua=mailto:dmarc@${workspace.id}`, "dmarc")}
                        className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-medium hover:bg-gray-100"
                      >
                        {copiedField === "dmarc" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 5. Configuration set */}
                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {setupStatus?.configSetExists ? (
                        <span className="h-4 w-4 shrink-0 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                      ) : (
                        <span className="h-4 w-4 shrink-0 rounded border border-gray-300 bg-white" />
                      )}
                      <p className="text-sm text-gray-700 font-medium">SES Configuration Set</p>
                      {setupStatus && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          setupStatus.configSetExists ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}>
                          {setupStatus.configSetExists ? "Done" : "Not created"}
                        </span>
                      )}
                    </div>
                    {setupStatus && !setupStatus.configSetExists && (
                      <button
                        type="button"
                        onClick={() => runSetupAction("create-config-set")}
                        disabled={setupActionLoading === "create-config-set"}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-100 disabled:opacity-50"
                      >
                        {setupActionLoading === "create-config-set" ? "Creating..." : "Create"}
                      </button>
                    )}
                  </div>
                  <p className="mt-1 ml-6 text-xs text-gray-500">
                    Configuration set <code className="bg-gray-200 px-1 rounded text-[11px]">{workspace.configSet}</code> for tracking bounces and complaints.
                  </p>
                </div>

                {/* 6. Unsubscribe page */}
                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2">
                    {setupStatus?.unsubscribePageFound ? (
                      <span className="h-4 w-4 shrink-0 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">✓</span>
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded border border-gray-300 bg-white" />
                    )}
                    <p className="text-sm text-gray-700 font-medium">Unsubscribe page</p>
                    {setupStatus && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        setupStatus.unsubscribePageFound ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {setupStatus.unsubscribePageFound ? "Reachable" : "Not found"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 ml-6 text-xs text-gray-500">
                    A page at <code className="bg-gray-200 px-1 rounded text-[11px]">{workspace.websiteUrl || `https://${workspace.id}`}/unsubscribe</code> where users land after unsubscribing.
                  </p>
                </div>

              </div>
            </details>

            {/* Sender */}
            <div className="border-t border-gray-200 pt-6 mt-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Sender</h2>
              <div className="flex flex-col gap-5 max-w-xl">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-600">
                    Default From
                  </span>
                  <input
                    type="text"
                    value={workspace.from}
                    onChange={(e) => updateWorkspace({ from: e.target.value })}
                    className="border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-600">
                    Send As Name
                  </span>
                  <input
                    type="text"
                    value={workspace.fromName}
                    onChange={(e) => updateWorkspace({ fromName: e.target.value })}
                    placeholder="Your brand or team name"
                    className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </label>
              </div>
            </div>

            {/* Email Footer */}
            <div className="border-t border-gray-200 pt-6 mt-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Email Footer</h2>
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_26rem] gap-6 items-start">
                <div className="flex flex-col gap-5 max-w-xl">
                  <div className="rounded border border-gray-200 bg-gray-50 p-3">
                    <p className="text-sm font-medium text-gray-700">Vibe Footer</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Describe the footer style or ask for edits. Each run updates the current footer.
                    </p>
                    <textarea
                      value={footerVibePrompt}
                      onChange={(e) => setFooterVibePrompt(e.target.value)}
                      rows={3}
                      placeholder="Create a clean minimal footer with brand tone, website link and unsubscribe."
                      className="mt-2 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black resize-y"
                    />
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => generateVibeHtml("footer")}
                        disabled={footerVibeBusy}
                        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {footerVibeBusy ? "Generating..." : "Generate Footer HTML"}
                      </button>
                      {footerVibeStatus && (
                        <span className="text-xs text-gray-500">{footerVibeStatus}</span>
                      )}
                    </div>
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-gray-600">
                      Footer HTML (appended to every email)
                    </span>
                    <textarea
                      rows={8}
                      value={workspace.footerHtml}
                      onChange={(e) =>
                        updateWorkspace({ footerHtml: e.target.value })
                      }
                      placeholder="<p>Thanks for reading.</p><p><a href='{{unsubscribe_url}}'>Unsubscribe</a></p>"
                      className="border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black resize-y"
                    />
                    <span className="text-xs text-gray-400">
                      Supported variables:{" "}
                      <code className="bg-gray-100 px-1 rounded">
                        {"{{unsubscribe_url}}"}
                      </code>{" "}
                      and{" "}
                      <code className="bg-gray-100 px-1 rounded">
                        {"{{workspace_url}}"}
                      </code>
                    </span>
                  </label>
                </div>

                <div className="flex flex-col gap-2 xl:sticky xl:top-6">
                  <span className="text-sm font-medium text-gray-600">
                    Footer Preview
                  </span>
                  <p className="text-xs text-gray-400">
                    Preview uses sample values for unsubscribe and workspace links.
                  </p>
                  <iframe
                    title="Footer preview"
                    srcDoc={footerPreviewDoc}
                    className="h-[28rem] w-full rounded border border-gray-200 bg-white"
                    sandbox="allow-same-origin"
                  />
                </div>
              </div>
            </div>

            {/* Sending */}
            <div className="border-t border-gray-200 pt-6 mt-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Sending</h2>
              <div className="flex flex-col gap-5 max-w-xl">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-600">
                    SES Configuration Set
                  </span>
                  <input
                    type="text"
                    value={workspace.configSet}
                    onChange={(e) =>
                      updateWorkspace({ configSet: e.target.value })
                    }
                    className="border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-600">
                    Website URL (domain page link)
                  </span>
                  <input
                    type="url"
                    value={workspace.websiteUrl}
                    onChange={(e) =>
                      updateWorkspace({ websiteUrl: e.target.value })
                    }
                    placeholder={`https://${workspace.id}`}
                    className="border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-600">
                    Rate limit between sends (ms)
                  </span>
                  <input
                    type="number"
                    value={workspace.rateLimit}
                    onChange={(e) =>
                      updateWorkspace({ rateLimit: Number(e.target.value) })
                    }
                    min={0}
                    step={50}
                    className="border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black w-32"
                  />
                </label>
              </div>
            </div>

            {/* API Keys */}
            <div className="border-t border-gray-200 pt-6 mt-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">API Keys</h2>
              <p className="text-xs text-gray-500 mb-3">
                Create keys to access the API programmatically.
              </p>

              <div className="max-w-xl">
                {newlyCreatedKey && (
                  <div className="mb-3 rounded border border-green-300 bg-green-50 p-3">
                    <p className="text-xs font-medium text-green-800">
                      Key created — copy it now, it won&apos;t be shown again:
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="flex-1 break-all rounded bg-white px-2 py-1 text-xs font-mono text-green-900 border border-green-200">
                        {newlyCreatedKey}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(newlyCreatedKey);
                        }}
                        className="rounded border border-green-300 bg-white px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100"
                      >
                        Copy
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewlyCreatedKey(null)}
                      className="mt-2 text-xs text-green-600 underline"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <label className="flex flex-col gap-1 flex-1">
                    <span className="text-xs text-gray-500">Key name</span>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g. CI pipeline"
                      className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={createApiKeyHandler}
                    disabled={creatingKey}
                    className="rounded bg-black text-white px-3 py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creatingKey ? "Creating..." : "Create"}
                  </button>
                </div>

                {apiKeysLoading ? (
                  <p className="mt-3 text-xs text-gray-400">Loading keys...</p>
                ) : apiKeys.length === 0 ? (
                  <p className="mt-3 text-xs text-gray-400">No API keys yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-gray-100">
                    {apiKeys.map((k) => (
                      <li
                        key={k.id}
                        className="flex items-center justify-between py-2 gap-3"
                      >
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-gray-800 block truncate">
                            {k.name || "(unnamed)"}
                          </span>
                          <span className="text-xs text-gray-400 font-mono">
                            {k.keyPrefix}...
                          </span>
                          <span className="text-xs text-gray-400 ml-2">
                            {new Date(k.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteApiKeyHandler(k.id)}
                          className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-6 rounded border border-red-200 bg-red-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-red-700">Danger Zone</h2>
                  <p className="mt-1 text-xs text-red-700">
                    Delete this workspace and all associated data permanently.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openWorkspaceDeleteConfirm}
                  disabled={!activeId || deletingWorkspace}
                  className="shrink-0 rounded border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingWorkspace ? "Deleting..." : "Delete workspace"}
                </button>
              </div>
            </div>

          </div>
        )}

        {tab === "campaigns" && (
          <div className="flex-1 min-w-0 overflow-y-auto bg-gray-100 text-gray-900">
            <CampaignsShell embedded />
          </div>
        )}
      </div>

      {csvImportConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="csv-import-title"
            className="w-full max-w-3xl rounded-lg bg-white shadow-xl"
          >
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 id="csv-import-title" className="text-base font-semibold text-gray-900">
                Configure CSV Import
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                {csvImportConfig.fileName} · {csvImportConfig.rowCount.toLocaleString()} rows
              </p>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              <label className="mb-4 flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Email Column
                </span>
                <FancySelect
                  wrapperClassName="w-full"
                  value={String(csvImportConfig.emailColumnIndex)}
                  onChange={(event) => updateCsvEmailColumn(Number(event.target.value))}
                  className="h-10 border-gray-300 text-sm focus:border-black focus:ring-black/10"
                >
                  {csvImportConfig.headers.map((header) => (
                    <option key={header.index} value={String(header.index)}>
                      {header.label}
                    </option>
                  ))}
                </FancySelect>
              </label>

              <p className="mb-2 text-xs text-gray-500">
                Select columns to import and map them to existing fields.
              </p>
              <div className="overflow-x-auto rounded border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-2 text-left">CSV column</th>
                      <th className="px-3 py-2 text-left">Import</th>
                      <th className="px-3 py-2 text-left">Map to field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvImportConfig.headers.map((header) => {
                      const isEmailColumn = header.index === csvImportConfig.emailColumnIndex;
                      const selectValue = header.targetField.trim().toLowerCase();

                      return (
                        <tr key={header.index} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-mono text-xs text-gray-700">
                            {header.label}
                          </td>
                          <td className="px-3 py-2">
                            <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                              <input
                                type="checkbox"
                                checked={isEmailColumn ? false : header.selected}
                                onChange={(event) =>
                                  updateCsvColumnSelection(header.index, event.target.checked)
                                }
                                disabled={isEmailColumn}
                                className="h-4 w-4 rounded border-gray-300 text-black focus:ring-black disabled:opacity-50"
                              />
                              {isEmailColumn ? "Email column" : "Import"}
                            </label>
                          </td>
                          <td className="px-3 py-2">
                            <FancySelect
                              wrapperClassName="w-full"
                              value={selectValue}
                              onChange={(event) =>
                                updateCsvColumnTarget(header.index, event.target.value)
                              }
                              disabled={isEmailColumn || !header.selected}
                              className="h-8 border-gray-300 text-xs focus:border-black focus:ring-black/10"
                            >
                              <option value={header.normalizedKey}>
                                {header.normalizedKey}
                              </option>
                              {csvImportTargetFieldOptions
                                .filter((field) => field !== header.normalizedKey)
                                .map((field) => (
                                  <option key={field} value={field}>
                                    {field}
                                  </option>
                                ))}
                            </FancySelect>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                {csvSelectedColumnCount} column{csvSelectedColumnCount !== 1 && "s"} selected. Existing
                contacts keep unmapped fields and merge on email match.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={cancelCsvImportConfig}
                disabled={contactsImporting}
                className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmCsvImport()}
                disabled={contactsImporting}
                className="rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {contactsImporting ? "Importing..." : "Import contacts"}
              </button>
            </div>
          </div>
        </div>
      )}

      {workspaceDeleteConfirmOpen && workspace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-delete-title"
            className="w-full max-w-md rounded-lg bg-white shadow-xl"
          >
            <div className="border-b border-gray-200 px-5 py-4">
              <h2
                id="workspace-delete-title"
                className="text-base font-semibold text-gray-900"
              >
                Delete Workspace
              </h2>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700">
              <p>
                Delete workspace <strong>{workspace.id}</strong>?
              </p>
              <p className="mt-2 text-xs text-gray-500">
                This permanently deletes contacts, history, API keys, settings,
                and workspace memberships for this domain.
              </p>
              <label className="mt-3 block">
                <span className="text-[11px] text-gray-600">
                  Type <code className="rounded bg-gray-100 px-1">{workspace.id}</code> to
                  confirm.
                </span>
                <input
                  type="text"
                  value={workspaceDeleteConfirmValue}
                  onChange={(event) =>
                    setWorkspaceDeleteConfirmValue(event.target.value)
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder={workspace.id}
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={cancelWorkspaceDelete}
                disabled={deletingWorkspace}
                className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmWorkspaceDelete()}
                disabled={deletingWorkspace || !canConfirmWorkspaceDelete}
                className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingWorkspace ? "Deleting..." : "Delete workspace"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
