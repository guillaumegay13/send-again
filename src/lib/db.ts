import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const globalDb = globalThis as unknown as { __supabaseDb?: SupabaseClient };

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function getDb(): SupabaseClient {
  if (!globalDb.__supabaseDb) {
    const supabaseUrl = requireEnv(
      "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL",
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
    );
    const supabaseSecret = requireEnv(
      "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    globalDb.__supabaseDb = createClient(supabaseUrl, supabaseSecret, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return globalDb.__supabaseDb;
}

function assertNoError(
  error: { message: string } | null,
  context: string
): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function isMissingWorkspaceOptionalColumnError(
  error: { message: string } | null
): boolean {
  if (!error) return false;
  const message = error.message.toLowerCase();
  if (!message.includes("workspace_settings")) return false;
  return (
    message.includes("footer_html") ||
    message.includes("website_url") ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function normalizeFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    normalized[key] = raw == null ? "" : String(raw);
  }
  return normalized;
}

// --- Workspace Memberships ---

interface WorkspaceMembershipRow {
  workspace_id: string;
}

export async function ensureWorkspaceMemberships(
  userId: string,
  workspaceIds: string[],
  role: "owner" | "member" = "owner"
): Promise<void> {
  const normalizedWorkspaceIds = Array.from(
    new Set(
      workspaceIds
        .map((workspaceId) => workspaceId.trim())
        .filter((workspaceId) => workspaceId.length > 0)
    )
  );
  if (normalizedWorkspaceIds.length === 0) return;

  const db = getDb();
  const payload = normalizedWorkspaceIds.map((workspaceId) => ({
    workspace_id: workspaceId,
    user_id: userId,
    role,
  }));
  const { error } = await db
    .from("workspace_memberships")
    .upsert(payload, { onConflict: "workspace_id,user_id" });
  assertNoError(error, "Failed to upsert workspace memberships");
}

export async function getWorkspaceIdsForUser(userId: string): Promise<string[]> {
  const db = getDb();
  const { data, error } = await db
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", userId);
  assertNoError(error, "Failed to fetch workspace memberships");
  const rows = (data ?? []) as WorkspaceMembershipRow[];
  return rows.map((row) => row.workspace_id);
}

export async function userCanAccessWorkspace(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .limit(1);
  assertNoError(error, "Failed to check workspace access");
  return (data ?? []).length > 0;
}

// --- Contacts ---

export interface DbContact {
  email: string;
  fields: Record<string, string>;
}

interface ContactRow {
  email: string;
  fields: unknown;
}

export async function getContacts(workspaceId: string): Promise<DbContact[]> {
  const db = getDb();
  const pageSize = 1000;
  const allRows: ContactRow[] = [];

  // Supabase/PostgREST can enforce a max rows per response (often 1000),
  // so fetch contacts in pages to avoid truncating large lists.
  const { data: firstPageData, error, count } = await db
    .from("contacts")
    .select("email, fields", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("id", { ascending: true })
    .range(0, pageSize - 1);
  assertNoError(error, "Failed to fetch contacts");

  const firstPage = (firstPageData ?? []) as ContactRow[];
  allRows.push(...firstPage);

  const totalRows = Math.max(count ?? allRows.length, allRows.length);
  let from = allRows.length;
  while (from < totalRows) {
    const { data: pageData, error: pageError } = await db
      .from("contacts")
      .select("email, fields")
      .eq("workspace_id", workspaceId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    assertNoError(pageError, "Failed to fetch contacts");

    const page = (pageData ?? []) as ContactRow[];
    if (page.length === 0) break;

    allRows.push(...page);
    from += page.length;
  }

  return allRows.map((row) => ({
    email: row.email,
    fields: normalizeFields(row.fields),
  }));
}

export async function upsertContacts(
  workspaceId: string,
  contacts: DbContact[]
): Promise<void> {
  if (contacts.length === 0) return;

  const db = getDb();
  const rows = contacts.map((contact) => ({
    workspace_id: workspaceId,
    email: contact.email,
    fields: contact.fields,
  }));
  const { error } = await db
    .from("contacts")
    .upsert(rows, { onConflict: "workspace_id,email" });
  assertNoError(error, "Failed to upsert contacts");
}

export async function updateContact(
  workspaceId: string,
  email: string,
  fields: Record<string, string>
): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("contacts")
    .update({ fields })
    .eq("workspace_id", workspaceId)
    .eq("email", email);
  assertNoError(error, "Failed to update contact");
}

export async function deleteContact(
  workspaceId: string,
  email: string
): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("contacts")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("email", email);
  assertNoError(error, "Failed to delete contact");
}

export async function deleteAllContacts(workspaceId: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("contacts")
    .delete()
    .eq("workspace_id", workspaceId);
  assertNoError(error, "Failed to delete all contacts");
}

// --- Workspace Settings ---

export interface DbWorkspaceSettings {
  id: string;
  from_address: string;
  config_set: string;
  rate_limit: number;
  footer_html: string;
  website_url: string;
}

interface WorkspaceSettingsRow {
  id: unknown;
  from_address: unknown;
  config_set: unknown;
  rate_limit: unknown;
  footer_html?: unknown;
  website_url?: unknown;
}

function normalizeWorkspaceSettingsRow(
  row: WorkspaceSettingsRow
): DbWorkspaceSettings {
  return {
    id: String(row.id ?? ""),
    from_address: String(row.from_address ?? ""),
    config_set: String(row.config_set ?? "email-tracking-config-set"),
    rate_limit:
      typeof row.rate_limit === "number"
        ? row.rate_limit
        : Number(row.rate_limit ?? 300),
    footer_html: String(row.footer_html ?? ""),
    website_url: String(row.website_url ?? ""),
  };
}

export async function getAllWorkspaceSettings(): Promise<DbWorkspaceSettings[]> {
  const db = getDb();
  const { data, error } = await db
    .from("workspace_settings")
    .select("*")
    .order("id", { ascending: true });
  assertNoError(error, "Failed to fetch workspace settings");
  const rows = (data ?? []) as WorkspaceSettingsRow[];
  return rows.map(normalizeWorkspaceSettingsRow);
}

export async function getWorkspaceSettings(
  workspaceId: string
): Promise<DbWorkspaceSettings | null> {
  const db = getDb();
  const { data, error } = await db
    .from("workspace_settings")
    .select("*")
    .eq("id", workspaceId)
    .limit(1);
  assertNoError(error, "Failed to fetch workspace settings");
  const rows = (data ?? []) as WorkspaceSettingsRow[];
  const row = rows[0];
  return row ? normalizeWorkspaceSettingsRow(row) : null;
}

export async function upsertWorkspaceSettings(settings: {
  id: string;
  from: string;
  configSet: string;
  rateLimit: number;
  footerHtml: string;
  websiteUrl: string;
}): Promise<void> {
  const db = getDb();
  const fullPayload = {
    id: settings.id,
    from_address: settings.from,
    config_set: settings.configSet,
    rate_limit: settings.rateLimit,
    footer_html: settings.footerHtml,
    website_url: settings.websiteUrl,
  };

  const { error } = await db
    .from("workspace_settings")
    .upsert(fullPayload, { onConflict: "id" });

  if (isMissingWorkspaceOptionalColumnError(error)) {
    const legacyPayload = {
      id: settings.id,
      from_address: settings.from,
      config_set: settings.configSet,
      rate_limit: settings.rateLimit,
    };
    const { error: legacyError } = await db
      .from("workspace_settings")
      .upsert(legacyPayload, { onConflict: "id" });
    assertNoError(legacyError, "Failed to upsert workspace settings");
    return;
  }

  assertNoError(error, "Failed to upsert workspace settings");
}

// --- Sends & Events ---

export async function insertSend(
  workspaceId: string,
  messageId: string,
  recipient: string,
  subject: string
): Promise<void> {
  const db = getDb();
  const { error } = await db.from("sends").insert({
    workspace_id: workspaceId,
    message_id: messageId,
    recipient,
    subject,
  });
  assertNoError(error, "Failed to insert send");
}

export async function insertEvent(
  messageId: string,
  eventType: string,
  timestamp: string,
  detail: string
): Promise<void> {
  const db = getDb();
  const { error } = await db.from("email_events").insert({
    message_id: messageId,
    event_type: eventType,
    timestamp,
    detail,
  });
  assertNoError(error, "Failed to insert event");
}

export interface SendHistoryRow {
  message_id: string;
  recipient: string;
  subject: string;
  sent_at: string;
  events: string;
}

interface SendRow {
  message_id: string;
  recipient: string;
  subject: string | null;
  sent_at: string;
}

interface EventRow {
  message_id: string;
  event_type: string;
  timestamp: string;
  detail: string | null;
}

export async function getSendHistory(
  workspaceId: string,
  limit = 100
): Promise<SendHistoryRow[]> {
  const db = getDb();
  const rowLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;
  const { data: sendData, error: sendsError } = await db
    .from("sends")
    .select("message_id, recipient, subject, sent_at")
    .eq("workspace_id", workspaceId)
    .order("sent_at", { ascending: false })
    .limit(rowLimit);
  assertNoError(sendsError, "Failed to fetch send history");

  const sends = (sendData ?? []) as SendRow[];
  if (sends.length === 0) return [];

  const messageIds = sends.map((send) => send.message_id);
  const { data: eventData, error: eventsError } = await db
    .from("email_events")
    .select("message_id, event_type, timestamp, detail")
    .in("message_id", messageIds)
    .order("timestamp", { ascending: true });
  assertNoError(eventsError, "Failed to fetch send events");

  const eventRows = (eventData ?? []) as EventRow[];
  const eventsByMessageId = new Map<
    string,
    Array<{ type: string; timestamp: string; detail: string }>
  >();

  for (const row of eventRows) {
    const list = eventsByMessageId.get(row.message_id) ?? [];
    list.push({
      type: row.event_type,
      timestamp: row.timestamp,
      detail: row.detail ?? "",
    });
    eventsByMessageId.set(row.message_id, list);
  }

  return sends.map((send) => ({
    message_id: send.message_id,
    recipient: send.recipient,
    subject: send.subject ?? "",
    sent_at: send.sent_at,
    events: JSON.stringify(eventsByMessageId.get(send.message_id) ?? []),
  }));
}
