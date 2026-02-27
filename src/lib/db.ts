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

function getMissingWorkspaceSettingsColumn(
  error: { message: string } | null
): string | null {
  if (!error) return null;
  const relationMatch = error.message.match(
    /column ["']?([a-z_]+)["']? of relation ["']workspace_settings["'] does not exist/i
  );
  if (relationMatch?.[1]) return relationMatch[1];

  const schemaCacheMatch = error.message.match(
    /could not find the ['"]([a-z_]+)['"] column of ['"](?:public\.)?workspace_settings['"] in the schema cache/i
  );
  return schemaCacheMatch?.[1] ?? null;
}

function getMissingRelation(error: { message: string } | null): string | null {
  if (!error) return null;

  const relationMatch = error.message.match(
    /relation ["']?(?:public\.)?([a-z_]+)["']? does not exist/i
  );
  if (relationMatch?.[1]) return relationMatch[1];

  const schemaCacheMatch = error.message.match(
    /table ['"]public\.([a-z_]+)['"] in the schema cache/i
  );
  return schemaCacheMatch?.[1] ?? null;
}

function isMissingTableError(
  error: { message: string } | null,
  table: string
): boolean {
  if (!error) return false;
  const message = error.message.toLowerCase();
  if (!message.includes(table.toLowerCase())) return false;
  return (
    message.includes("schema cache") || message.includes("does not exist")
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

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueNormalizedEmails(values: string[]): string[] {
  return Array.from(
    new Set(values.map((email) => normalizeEmail(email)).filter(Boolean))
  );
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

export type ContactSourceProvider = "manual" | "http_json";

function normalizeContactSourceProvider(value: unknown): ContactSourceProvider {
  if (value === "http_json") return "http_json";
  // Backward compatibility for early integration value.
  if (value === "airconcierge") return "http_json";
  return "manual";
}

// --- API Keys ---

export interface DbApiKey {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
}

interface ApiKeyRow {
  id: string;
  workspace_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  created_at: string;
}

async function hashApiKey(raw: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateRawApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sk_${hex}`;
}

export async function createApiKey(
  workspaceId: string,
  name: string
): Promise<{ key: string; apiKey: DbApiKey }> {
  const raw = generateRawApiKey();
  const keyHash = await hashApiKey(raw);
  const keyPrefix = raw.slice(0, 10);

  const db = getDb();
  const { data, error } = await db
    .from("api_keys")
    .insert({
      workspace_id: workspaceId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name: name || "",
    })
    .select("id, workspace_id, name, key_prefix, created_at")
    .single();
  assertNoError(error, "Failed to create API key");

  const row = data as ApiKeyRow;
  return {
    key: raw,
    apiKey: {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      keyPrefix: row.key_prefix,
      createdAt: row.created_at,
    },
  };
}

export async function getApiKeysForWorkspace(
  workspaceId: string
): Promise<DbApiKey[]> {
  const db = getDb();
  const { data, error } = await db
    .from("api_keys")
    .select("id, workspace_id, name, key_prefix, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  assertNoError(error, "Failed to fetch API keys");

  return ((data ?? []) as ApiKeyRow[]).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    createdAt: row.created_at,
  }));
}

export async function deleteApiKey(
  id: string,
  workspaceId: string
): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db
    .from("api_keys")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("id");
  assertNoError(error, "Failed to delete API key");
  return (data ?? []).length > 0;
}

export async function getWorkspaceIdByKeyHash(
  keyHash: string
): Promise<string | null> {
  const db = getDb();
  const { data, error } = await db
    .from("api_keys")
    .select("workspace_id")
    .eq("key_hash", keyHash)
    .limit(1);
  assertNoError(error, "Failed to look up API key");
  const row = (data ?? [])[0] as { workspace_id: string } | undefined;
  return row?.workspace_id ?? null;
}

export { hashApiKey };

// --- Workspace Memberships ---

interface WorkspaceMembershipRow {
  workspace_id: string;
}

interface WorkspaceOwnerMembershipRow {
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

export async function userIsWorkspaceOwner(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .limit(1);
  assertNoError(error, "Failed to check workspace ownership");
  const rows = (data ?? []) as WorkspaceOwnerMembershipRow[];
  return rows.length > 0;
}

export async function deleteWorkspaceData(workspaceId: string): Promise<void> {
  const db = getDb();
  const pageSize = 1000;
  const messageIds: string[] = [];
  let from = 0;

  // Collect send message IDs before deleting workspace sends, then remove linked events.
  while (true) {
    const { data, error } = await db
      .from("sends")
      .select("message_id")
      .eq("workspace_id", workspaceId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (isMissingTableError(error, "sends")) {
      break;
    }
    assertNoError(error, "Failed to list workspace sends for deletion");

    const rows = (data ?? []) as Array<{ message_id: string }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      const messageId = String(row.message_id ?? "").trim();
      if (messageId) {
        messageIds.push(messageId);
      }
    }

    from += rows.length;
    if (rows.length < pageSize) break;
  }

  const uniqueMessageIds = Array.from(new Set(messageIds));
  for (const chunk of chunkArray(uniqueMessageIds, 1000)) {
    if (chunk.length === 0) continue;
    const { error } = await db
      .from("email_events")
      .delete()
      .in("message_id", chunk);
    if (isMissingTableError(error, "email_events")) {
      break;
    }
    assertNoError(error, "Failed to delete workspace email events");
  }

  const { error: sendsError } = await db
    .from("sends")
    .delete()
    .eq("workspace_id", workspaceId);
  if (!isMissingTableError(sendsError, "sends")) {
    assertNoError(sendsError, "Failed to delete workspace sends");
  }

  const { error: sendJobsError } = await db
    .from("send_jobs")
    .delete()
    .eq("workspace_id", workspaceId);
  if (!isMissingTableError(sendJobsError, "send_jobs")) {
    assertNoError(sendJobsError, "Failed to delete workspace send jobs");
  }

  const { error: contactsError } = await db
    .from("contacts")
    .delete()
    .eq("workspace_id", workspaceId);
  if (!isMissingTableError(contactsError, "contacts")) {
    assertNoError(contactsError, "Failed to delete workspace contacts");
  }

  const { error: unsubscribesError } = await db
    .from("contact_unsubscribes")
    .delete()
    .eq("workspace_id", workspaceId);
  if (!isMissingTableError(unsubscribesError, "contact_unsubscribes")) {
    assertNoError(
      unsubscribesError,
      "Failed to delete workspace contact unsubscribes"
    );
  }

  const { error: apiKeysError } = await db
    .from("api_keys")
    .delete()
    .eq("workspace_id", workspaceId);
  if (!isMissingTableError(apiKeysError, "api_keys")) {
    assertNoError(apiKeysError, "Failed to delete workspace API keys");
  }

  const { error: settingsError } = await db
    .from("workspace_settings")
    .delete()
    .eq("id", workspaceId);
  if (!isMissingTableError(settingsError, "workspace_settings")) {
    assertNoError(settingsError, "Failed to delete workspace settings");
  }

  const { error: membershipsError } = await db
    .from("workspace_memberships")
    .delete()
    .eq("workspace_id", workspaceId);
  if (!isMissingTableError(membershipsError, "workspace_memberships")) {
    assertNoError(membershipsError, "Failed to delete workspace memberships");
  }
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

interface ContactUnsubscribeRow {
  email: string;
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

  const contactsByEmail = new Map<string, DbContact>();
  for (const row of allRows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    contactsByEmail.set(email, {
      email,
      fields: normalizeFields(row.fields),
    });
  }

  return Array.from(contactsByEmail.values());
}

export async function upsertContacts(
  workspaceId: string,
  contacts: DbContact[]
): Promise<void> {
  if (contacts.length === 0) return;

  const db = getDb();
  const byEmail = new Map<string, Record<string, string>>();
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email);
    if (!email) continue;
    byEmail.set(email, normalizeFields(contact.fields));
  }
  const rows = Array.from(byEmail.entries()).map(([email, fields]) => ({
    workspace_id: workspaceId,
    email,
    fields,
  }));
  if (rows.length === 0) return;

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
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  const db = getDb();
  const { error } = await db
    .from("contacts")
    .update({ fields: normalizeFields(fields) })
    .eq("workspace_id", workspaceId)
    .eq("email", normalizedEmail);
  assertNoError(error, "Failed to update contact");
}

export async function deleteContact(
  workspaceId: string,
  email: string
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  const db = getDb();
  const { error } = await db
    .from("contacts")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("email", normalizedEmail);
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

export async function getContactsByEmails(
  workspaceId: string,
  emails: string[]
): Promise<DbContact[]> {
  const normalized = uniqueNormalizedEmails(emails).slice(0, 2000);

  if (normalized.length === 0) {
    return [];
  }

  const db = getDb();
  const { data, error } = await db
    .from("contacts")
    .select("email, fields")
    .eq("workspace_id", workspaceId)
    .in("email", normalized);
  assertNoError(error, "Failed to fetch contacts by email");

  const rows = (data ?? []) as ContactRow[];
  return rows.map((row) => ({
    email: normalizeEmail(row.email),
    fields: normalizeFields(row.fields),
  }));
}

export async function markContactUnsubscribed(
  workspaceId: string,
  email: string
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  const db = getDb();
  const { error } = await db.from("contact_unsubscribes").upsert(
    {
      workspace_id: workspaceId,
      email: normalizedEmail,
      unsubscribed_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,email" }
  );
  assertNoError(error, "Failed to persist unsubscribe");
}

export async function getUnsubscribedEmailSet(
  workspaceId: string,
  emails: string[]
): Promise<Set<string>> {
  const normalized = uniqueNormalizedEmails(emails);
  if (normalized.length === 0) {
    return new Set();
  }

  const db = getDb();
  const unsubscribed = new Set<string>();
  const chunks = chunkArray(normalized, 500);

  for (const chunk of chunks) {
    const { data, error } = await db
      .from("contact_unsubscribes")
      .select("email")
      .eq("workspace_id", workspaceId)
      .in("email", chunk);
    if (error) {
      const missingRelation = getMissingRelation(error);
      if (
        missingRelation === "contact_unsubscribes" ||
        isMissingTableError(error, "contact_unsubscribes")
      ) {
        // Backward compatibility: older DBs can still send until the unsubscribe table is created.
        return new Set();
      }
    }
    assertNoError(error, "Failed to fetch unsubscribed contacts");

    const rows = (data ?? []) as ContactUnsubscribeRow[];
    for (const row of rows) {
      unsubscribed.add(normalizeEmail(row.email));
    }
  }

  return unsubscribed;
}

export async function filterContactsAgainstUnsubscribes(
  workspaceId: string,
  contacts: DbContact[]
): Promise<{ contacts: DbContact[]; skipped: number }> {
  if (contacts.length === 0) {
    return { contacts: [], skipped: 0 };
  }

  const normalizedContacts: DbContact[] = [];
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email);
    if (!email) continue;
    normalizedContacts.push({
      email,
      fields: normalizeFields(contact.fields),
    });
  }

  if (normalizedContacts.length === 0) {
    return { contacts: [], skipped: contacts.length };
  }

  const unsubscribed = await getUnsubscribedEmailSet(
    workspaceId,
    normalizedContacts.map((contact) => contact.email)
  );
  if (unsubscribed.size === 0) {
    return { contacts: normalizedContacts, skipped: 0 };
  }

  const allowed = normalizedContacts.filter(
    (contact) => !unsubscribed.has(contact.email)
  );
  return {
    contacts: allowed,
    skipped: normalizedContacts.length - allowed.length,
  };
}

// --- Workspace Settings ---

export interface DbWorkspaceSettings {
  id: string;
  from_address: string;
  from_name: string;
  config_set: string;
  rate_limit: number;
  footer_html: string;
  website_url: string;
  contact_source_provider: ContactSourceProvider;
  contact_source_config: Record<string, string>;
}

interface WorkspaceSettingsRow {
  id: unknown;
  from_address: unknown;
  from_name?: unknown;
  config_set: unknown;
  rate_limit: unknown;
  footer_html?: unknown;
  website_url?: unknown;
  contact_source_provider?: unknown;
  contact_source_config?: unknown;
}

function normalizeWorkspaceSettingsRow(
  row: WorkspaceSettingsRow
): DbWorkspaceSettings {
  return {
    id: String(row.id ?? ""),
    from_address: String(row.from_address ?? ""),
    from_name: String(row.from_name ?? ""),
    config_set: String(row.config_set ?? "email-tracking-config-set"),
    rate_limit:
      typeof row.rate_limit === "number"
        ? row.rate_limit
        : Number(row.rate_limit ?? 300),
    footer_html: String(row.footer_html ?? ""),
    website_url: String(row.website_url ?? ""),
    contact_source_provider: normalizeContactSourceProvider(
      row.contact_source_provider
    ),
    contact_source_config: normalizeFields(row.contact_source_config),
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
  fromName: string;
  configSet: string;
  rateLimit: number;
  footerHtml: string;
  websiteUrl: string;
  contactSourceProvider: ContactSourceProvider;
  contactSourceConfig: Record<string, string>;
}): Promise<void> {
  const db = getDb();
  const optionalColumns = new Set([
    "from_name",
    "footer_html",
    "website_url",
    "contact_source_provider",
    "contact_source_config",
  ]);
  const payload: Record<string, unknown> = {
    id: settings.id,
    from_address: settings.from,
    from_name: settings.fromName,
    config_set: settings.configSet,
    rate_limit: settings.rateLimit,
    footer_html: settings.footerHtml,
    website_url: settings.websiteUrl,
    contact_source_provider: settings.contactSourceProvider,
    contact_source_config: settings.contactSourceConfig,
  };

  while (true) {
    const { error } = await db
      .from("workspace_settings")
      .upsert(payload, { onConflict: "id" });

    if (!error) return;

    const missingColumn = getMissingWorkspaceSettingsColumn(error);
    if (missingColumn && optionalColumns.has(missingColumn)) {
      delete payload[missingColumn];
      continue;
    }

    assertNoError(error, "Failed to upsert workspace settings");
    return;
  }
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

export interface SendHistoryPage {
  rows: SendHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TopicDeliveryAnalytics {
  topic: string;
  totalSends: number;
  deliveredSends: number;
  undeliveredSends: number;
  deliveryRate: number;
}

export interface SubjectCampaignAnalytics {
  subject: string;
  totalSends: number;
  openedSends: number;
  clickedSends: number;
  openRate: number;
  ctr: number;
}

interface SendRow {
  message_id: string;
  recipient: string;
  subject: string | null;
  sent_at: string;
}

interface SendMessageIdRow {
  message_id: string;
}

interface EventRow {
  message_id: string;
  event_type: string;
  timestamp: string;
  detail: string | null;
}

const MESSAGE_ID_IN_QUERY_CHUNK_SIZE = 50;

function normalizeHistoryPage(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.floor(parsed));
}

function normalizeHistoryPageSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function normalizeHistorySearch(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .slice(0, 120)
    .replace(/[^a-zA-Z0-9@._+\-\s]/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeSubject(value: string | null): string {
  const normalized = (value ?? "").trim();
  return normalized || "(No subject)";
}

export async function getSendHistory(
  workspaceId: string,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}
): Promise<SendHistoryPage> {
  const db = getDb();
  const pageSize = normalizeHistoryPageSize(options.pageSize);
  const requestedPage = normalizeHistoryPage(options.page);
  const search = normalizeHistorySearch(options.search);
  const searchPattern = search ? `%${search.replace(/\s+/g, "%")}%` : "";
  const searchFilter = searchPattern
    ? `recipient.ilike.${searchPattern},subject.ilike.${searchPattern},message_id.ilike.${searchPattern}`
    : "";

  let countQuery = db
    .from("sends")
    .select("message_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (searchFilter) {
    countQuery = countQuery.or(searchFilter);
  }

  const { count, error: countError } = await countQuery;
  assertNoError(countError, "Failed to count send history");

  const total = Math.max(0, count ?? 0);
  if (total === 0) {
    return {
      rows: [],
      total: 0,
      page: 1,
      pageSize,
    };
  }

  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let sendsQuery = db
    .from("sends")
    .select("message_id, recipient, subject, sent_at")
    .eq("workspace_id", workspaceId);

  if (searchFilter) {
    sendsQuery = sendsQuery.or(searchFilter);
  }

  const { data: sendData, error: sendsError } = await sendsQuery
    .order("sent_at", { ascending: false })
    .range(from, to);
  assertNoError(sendsError, "Failed to fetch send history");

  const sends = (sendData ?? []) as SendRow[];
  if (sends.length === 0) {
    return {
      rows: [],
      total,
      page,
      pageSize,
    };
  }

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

  return {
    rows: sends.map((send) => ({
      message_id: send.message_id,
      recipient: send.recipient,
      subject: send.subject ?? "",
      sent_at: send.sent_at,
      events: JSON.stringify(eventsByMessageId.get(send.message_id) ?? []),
    })),
    total,
    page,
    pageSize,
  };
}

export async function getTopicDeliveryAnalytics(
  workspaceId: string,
  topic: string
): Promise<TopicDeliveryAnalytics> {
  const db = getDb();
  const normalizedTopic = normalizeHistorySearch(topic);
  if (!normalizedTopic) {
    return {
      topic: "",
      totalSends: 0,
      deliveredSends: 0,
      undeliveredSends: 0,
      deliveryRate: 0,
    };
  }

  const pageSize = 1000;
  const topicPattern = `%${normalizedTopic.replace(/\s+/g, "%")}%`;
  const messageIds: string[] = [];

  const { data: firstPageData, error, count } = await db
    .from("sends")
    .select("message_id", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .ilike("subject", topicPattern)
    .order("sent_at", { ascending: false })
    .range(0, pageSize - 1);
  assertNoError(error, "Failed to fetch sends for topic analytics");

  const firstPage = (firstPageData ?? []) as SendMessageIdRow[];
  messageIds.push(...firstPage.map((row) => row.message_id));

  const totalRows = Math.max(count ?? messageIds.length, messageIds.length);
  let from = messageIds.length;
  while (from < totalRows) {
    const { data: pageData, error: pageError } = await db
      .from("sends")
      .select("message_id")
      .eq("workspace_id", workspaceId)
      .ilike("subject", topicPattern)
      .order("sent_at", { ascending: false })
      .range(from, from + pageSize - 1);
    assertNoError(pageError, "Failed to fetch sends for topic analytics");

    const page = (pageData ?? []) as SendMessageIdRow[];
    if (page.length === 0) break;

    messageIds.push(...page.map((row) => row.message_id));
    from += page.length;
  }

  const uniqueMessageIds = Array.from(
    new Set(messageIds.map((value) => value.trim()).filter(Boolean))
  );

  if (uniqueMessageIds.length === 0) {
    return {
      topic: normalizedTopic,
      totalSends: 0,
      deliveredSends: 0,
      undeliveredSends: 0,
      deliveryRate: 0,
    };
  }

  const deliveredMessageIds = new Set<string>();
  const eventIdChunks = chunkArray(
    uniqueMessageIds,
    MESSAGE_ID_IN_QUERY_CHUNK_SIZE
  );
  for (const ids of eventIdChunks) {
    if (ids.length === 0) continue;
    const { data: eventsData, error: eventsError } = await db
      .from("email_events")
      .select("message_id")
      .in("message_id", ids)
      .ilike("event_type", "delivery");
    assertNoError(eventsError, "Failed to fetch delivery events for topic analytics");

    for (const row of (eventsData ?? []) as SendMessageIdRow[]) {
      if (!row.message_id) continue;
      deliveredMessageIds.add(row.message_id);
    }
  }

  const totalSends = uniqueMessageIds.length;
  const deliveredSends = deliveredMessageIds.size;
  const undeliveredSends = Math.max(0, totalSends - deliveredSends);

  return {
    topic: normalizedTopic,
    totalSends,
    deliveredSends,
    undeliveredSends,
    deliveryRate: totalSends > 0 ? deliveredSends / totalSends : 0,
  };
}

export async function getSubjectCampaignAnalytics(
  workspaceId: string,
  options: { limit?: number } = {}
): Promise<SubjectCampaignAnalytics[]> {
  const db = getDb();
  const pageSize = 1000;
  const normalizedLimit = Math.max(
    1,
    Math.min(200, Math.floor(options.limit ?? 50))
  );

  const aggregates = new Map<
    string,
    {
      subject: string;
      totalSends: number;
      openedSends: number;
      clickedSends: number;
      latestSentAt: number;
    }
  >();

  let from = 0;
  while (true) {
    const { data: sendsData, error: sendsError } = await db
      .from("sends")
      .select("message_id, subject, sent_at")
      .eq("workspace_id", workspaceId)
      .order("sent_at", { ascending: false })
      .range(from, from + pageSize - 1);
    assertNoError(sendsError, "Failed to fetch sends for subject analytics");

    const sends = (sendsData ?? []) as SendRow[];
    if (sends.length === 0) break;

    const messageIds = sends.map((row) => row.message_id).filter(Boolean);
    const byMessageId = new Map<string, { opened: boolean; clicked: boolean }>();

    for (
      const ids of chunkArray(messageIds, MESSAGE_ID_IN_QUERY_CHUNK_SIZE)
    ) {
      if (ids.length === 0) continue;
      const { data: eventsData, error: eventsError } = await db
        .from("email_events")
        .select("message_id, event_type")
        .in("message_id", ids);
      assertNoError(eventsError, "Failed to fetch events for subject analytics");

      for (const row of (eventsData ?? []) as Array<{
        message_id: string;
        event_type: string | null;
      }>) {
        const messageId = row.message_id?.trim();
        if (!messageId) continue;
        const eventType = (row.event_type ?? "").trim().toLowerCase();

        const entry = byMessageId.get(messageId) ?? {
          opened: false,
          clicked: false,
        };
        if (eventType === "open") {
          entry.opened = true;
        } else if (eventType === "click") {
          entry.clicked = true;
        }
        byMessageId.set(messageId, entry);
      }
    }

    for (const send of sends) {
      const subject = normalizeSubject(send.subject);
      const current = aggregates.get(subject) ?? {
        subject,
        totalSends: 0,
        openedSends: 0,
        clickedSends: 0,
        latestSentAt: 0,
      };
      current.totalSends += 1;

      const messageState = byMessageId.get(send.message_id);
      if (messageState?.opened) current.openedSends += 1;
      if (messageState?.clicked) current.clickedSends += 1;

      const sentAtTs = Date.parse(send.sent_at);
      if (Number.isFinite(sentAtTs) && sentAtTs > current.latestSentAt) {
        current.latestSentAt = sentAtTs;
      }

      aggregates.set(subject, current);
    }

    from += sends.length;
    if (sends.length < pageSize) break;
  }

  return Array.from(aggregates.values())
    .sort(
      (a, b) =>
        b.latestSentAt - a.latestSentAt ||
        b.totalSends - a.totalSends ||
        a.subject.localeCompare(b.subject)
    )
    .slice(0, normalizedLimit)
    .map(({ subject, totalSends, openedSends, clickedSends }) => ({
      subject,
      totalSends,
      openedSends,
      clickedSends,
      openRate: totalSends > 0 ? openedSends / totalSends : 0,
      ctr: totalSends > 0 ? clickedSends / totalSends : 0,
    }));
}

export type SendJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type SendJobRecipientStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed";

export interface SendJobPayload {
  workspaceId: string;
  from: string;
  fromName: string;
  subject: string;
  html: string;
  configSet: string;
  rateLimit: number;
  footerHtml: string;
  websiteUrl: string;
  baseUrl: string;
}

export interface SendJobProgress {
  id: string;
  workspaceId: string;
  status: SendJobStatus;
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
}

export interface SendJobSummary {
  id: string;
  workspaceId: string;
  status: SendJobStatus;
  total: number;
  sent: number;
  failed: number;
  dryRun: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt: string | null;
  updatedAt: string;
  subject: string;
  errorMessage: string | null;
}

interface SendJobRowRaw {
  id: string;
  workspace_id: string;
  user_id: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  dry_run: boolean;
  payload: unknown;
  rate_limit: number;
  batch_size: number;
  send_concurrency: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  heartbeat_at: string | null;
  updated_at: string;
}

interface SendJobWorkerContext {
  id: string;
  workspaceId: string;
  userId: string;
  status: SendJobStatus;
  total: number;
  sent: number;
  failed: number;
  dryRun: boolean;
  payload: SendJobPayload;
  rateLimit: number;
  batchSize: number;
  sendConcurrency: number;
}

function normalizeNonNegativeInteger(
  value: unknown,
  fallback: number,
  min = 0
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function normalizeSendJobPayload(value: unknown): SendJobPayload {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const workspaceId = String(payload.workspaceId ?? "").trim().toLowerCase();
  const from = String(payload.from ?? "").trim();
  const fromName = String(payload.fromName ?? "").trim();
  const subject = String(payload.subject ?? "").trim();
  const html = String(payload.html ?? "").trim();
  const configSet = String(payload.configSet ?? "email-tracking-config-set").trim();
  const footerHtml = String(payload.footerHtml ?? "").trim();
  const websiteUrl = String(payload.websiteUrl ?? "").trim();
  const baseUrl = String(payload.baseUrl ?? "").trim();
  const rateLimit = normalizeNonNegativeInteger(payload.rateLimit, 300);

  if (!workspaceId || !from || !subject || !html || !baseUrl) {
    throw new Error("Invalid send job payload");
  }

  return {
    workspaceId,
    from,
    fromName,
    subject,
    html,
    configSet,
    rateLimit,
    footerHtml,
    websiteUrl,
    baseUrl,
  };
}

function normalizeSendJobStatus(value: string): SendJobStatus {
  if (value === "queued") return "queued";
  if (value === "running") return "running";
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  return "queued";
}

function normalizeSendJobRow(row: SendJobRowRaw): SendJobPayload & {
  id: string;
  userId: string;
  status: SendJobStatus;
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
  errorMessage: string | null;
} {
  const payload = normalizeSendJobPayload(row.payload);
  return {
    id: row.id,
    workspaceId: payload.workspaceId,
    from: payload.from,
    fromName: payload.fromName,
    subject: payload.subject,
    html: payload.html,
    configSet: payload.configSet,
    rateLimit: normalizeNonNegativeInteger(row.rate_limit, payload.rateLimit),
    footerHtml: payload.footerHtml,
    websiteUrl: payload.websiteUrl,
    baseUrl: payload.baseUrl,
    userId: row.user_id,
    status: normalizeSendJobStatus(row.status),
    total: normalizeNonNegativeInteger(row.total, 0),
    sent: normalizeNonNegativeInteger(row.sent, 0),
    failed: normalizeNonNegativeInteger(row.failed, 0),
    dryRun: !!row.dry_run,
    batchSize: normalizeNonNegativeInteger(row.batch_size, 50, 1),
    sendConcurrency: normalizeNonNegativeInteger(row.send_concurrency, 1, 1),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    heartbeatAt: row.heartbeat_at,
    updatedAt: row.updated_at,
    errorMessage: row.error_message ?? null,
  };
}

export async function createSendJob(params: {
  userId: string;
  payload: SendJobPayload;
  totalRecipients: number;
  rateLimit?: number;
  batchSize: number;
  sendConcurrency: number;
  dryRun: boolean;
}): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();

  const payload = {
    workspaceId: params.payload.workspaceId,
    from: params.payload.from,
    fromName: params.payload.fromName,
    subject: params.payload.subject,
    html: params.payload.html,
    configSet: params.payload.configSet,
    rateLimit: params.payload.rateLimit,
    footerHtml: params.payload.footerHtml,
    websiteUrl: params.payload.websiteUrl,
    baseUrl: params.payload.baseUrl,
  };

  const { error } = await db.from("send_jobs").insert({
    id,
    workspace_id: params.payload.workspaceId,
    user_id: params.userId,
    status: "queued",
    total: normalizeNonNegativeInteger(params.totalRecipients, 0),
    sent: 0,
    failed: 0,
    dry_run: params.dryRun,
    payload,
    rate_limit: normalizeNonNegativeInteger(
      params.rateLimit ?? params.payload.rateLimit,
      params.payload.rateLimit
    ),
    batch_size: normalizeNonNegativeInteger(params.batchSize, 50, 1),
    send_concurrency: normalizeNonNegativeInteger(params.sendConcurrency, 4, 1),
  });
  if (error) {
    const missingRelation = getMissingRelation(error);
    if (missingRelation === "send_jobs") {
      throw new Error(
        "Database schema missing `send_jobs` table. Run the latest supabase/schema.sql."
      );
    }
  }
  assertNoError(error, "Failed to create send job");

  return id;
}

export async function insertSendJobRecipients(
  jobId: string,
  recipients: string[]
): Promise<void> {
  const deduped = Array.from(
    new Set(recipients.map((recipient) => recipient.trim().toLowerCase()))
  ).filter(Boolean);

  if (deduped.length === 0) {
    return;
  }

  const chunkSize = 500;
  const db = getDb();

  for (let i = 0; i < deduped.length; i += chunkSize) {
    const chunk = deduped
      .slice(i, i + chunkSize)
      .map((recipient) => ({
        job_id: jobId,
        recipient,
        status: "pending",
      }));

    const { error } = await db
      .from("send_job_recipients")
      .upsert(chunk, { onConflict: "job_id,recipient" })
      .select("id");
    if (error) {
      const missingRelation = getMissingRelation(error);
      if (missingRelation === "send_job_recipients") {
        throw new Error(
          "Database schema missing `send_job_recipients` table. Run the latest supabase/schema.sql."
        );
      }
      if (
        /no unique or exclusion constraint matching the ON CONFLICT specification/i.test(
          error.message
        )
      ) {
        throw new Error(
          "Database schema for `send_job_recipients` is outdated (missing unique(job_id,recipient)). Run the latest supabase/schema.sql."
        );
      }
    }
    assertNoError(error, "Failed to store send job recipients");
  }
}

export async function getSendJobForUser(
  jobId: string,
  userId: string
): Promise<SendJobProgress | null> {
  const db = getDb();
  const { data, error } = await db
    .from("send_jobs")
    .select(
      "id, user_id, workspace_id, status, total, sent, failed, dry_run, payload, rate_limit, batch_size, send_concurrency, error_message, created_at, started_at, completed_at, heartbeat_at, updated_at"
    )
    .eq("id", jobId)
    .eq("user_id", userId)
    .limit(1);
  assertNoError(error, "Failed to read send job");

  const row = (data ?? [])[0];
  if (!row) return null;

  const normalized = normalizeSendJobRow(row as SendJobRowRaw);

  const { data: errorRows, error: errorRowsError } = await db
    .from("send_job_recipients")
    .select("recipient,error")
    .eq("job_id", jobId)
    .eq("status", "failed")
    .order("id", { ascending: false })
    .limit(5);
  assertNoError(errorRowsError, "Failed to load send job errors");

  const recentErrors =
    (errorRows ?? []).map((item) => {
      const recipientError = String((item as { recipient: string; error: string | null }).error ?? "");
      return recipientError
        ? `${item.recipient}: ${recipientError}`
        : `${item.recipient}: send failed`;
    }) ?? [];

  return {
    id: normalized.id,
    workspaceId: normalized.workspaceId,
    status: normalized.status,
    total: normalized.total,
    sent: normalized.sent,
    failed: normalized.failed,
    dryRun: normalized.dryRun,
    rateLimit: normalized.rateLimit,
    batchSize: normalized.batchSize,
    sendConcurrency: normalized.sendConcurrency,
    createdAt: normalized.createdAt,
    startedAt: normalized.startedAt,
    completedAt: normalized.completedAt,
    heartbeatAt: normalized.heartbeatAt,
    updatedAt: normalized.updatedAt,
    subject: normalized.subject,
    errorMessage: normalized.errorMessage,
    remaining: Math.max(0, normalized.total - normalized.sent - normalized.failed),
    recentErrors,
  };
}

interface SendJobsQuery {
  workspaceId?: string;
  statuses?: SendJobStatus[];
  limit?: number;
}

export async function getSendJobsForUser(
  userId: string,
  options: SendJobsQuery = {}
): Promise<SendJobSummary[]> {
  const db = getDb();
  const query = db
    .from("send_jobs")
    .select(
      "id, workspace_id, user_id, status, total, sent, failed, dry_run, payload, rate_limit, batch_size, send_concurrency, error_message, created_at, started_at, completed_at, heartbeat_at, updated_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (options.workspaceId) {
    query.eq("workspace_id", options.workspaceId);
  }

  if (options.statuses && options.statuses.length > 0) {
    query.in("status", options.statuses);
  }

  const limited = Math.max(1, Math.floor(options.limit ?? 50));
  query.limit(limited);

  const { data, error } = await query;
  assertNoError(error, "Failed to read send jobs");

  return ((data ?? []) as SendJobRowRaw[]).map((row) => {
    const normalized = normalizeSendJobRow(row);
    return {
      id: normalized.id,
      workspaceId: normalized.workspaceId,
      status: normalized.status,
      total: normalized.total,
      sent: normalized.sent,
      failed: normalized.failed,
      dryRun: normalized.dryRun,
      createdAt: normalized.createdAt,
      startedAt: normalized.startedAt,
      completedAt: normalized.completedAt,
      heartbeatAt: normalized.heartbeatAt,
      updatedAt: normalized.updatedAt,
      subject: normalized.subject,
      errorMessage: normalized.errorMessage,
    };
  });
}

export async function getQueuedOrRunningSendJobs(
  limit = 1
): Promise<SendJobRowRaw[]> {
  const db = getDb();
  const { data, error } = await db
    .from("send_jobs")
    .select(
      "id, workspace_id, user_id, status, total, sent, failed, dry_run, payload, rate_limit, batch_size, send_concurrency, error_message, created_at, started_at, completed_at, heartbeat_at, updated_at"
    )
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(limit);
  assertNoError(error, "Failed to load send jobs");
  return (data ?? []) as SendJobRowRaw[];
}

export async function getSendJobWorkerContext(
  jobId: string
): Promise<SendJobWorkerContext | null> {
  const db = getDb();
  const { data, error } = await db
    .from("send_jobs")
    .select(
      "id, workspace_id, user_id, status, total, sent, failed, dry_run, payload, rate_limit, batch_size, send_concurrency"
    )
    .eq("id", jobId)
    .limit(1);
  assertNoError(error, "Failed to load send job");

  const row = (data ?? [])[0];
  if (!row) return null;

  const normalized = normalizeSendJobRow(row as SendJobRowRaw);
  return {
    id: normalized.id,
    workspaceId: normalized.workspaceId,
    userId: normalized.userId,
    status: normalized.status,
    total: normalized.total,
    sent: normalized.sent,
    failed: normalized.failed,
    dryRun: normalized.dryRun,
    payload: {
      workspaceId: normalized.workspaceId,
      from: normalized.from,
      fromName: normalized.fromName,
      subject: normalized.subject,
      html: normalized.html,
      configSet: normalized.configSet,
      rateLimit: normalized.rateLimit,
      footerHtml: normalized.footerHtml,
      websiteUrl: normalized.websiteUrl,
      baseUrl: normalized.baseUrl,
    },
    rateLimit: normalized.rateLimit,
    batchSize: normalized.batchSize,
    sendConcurrency: normalized.sendConcurrency,
  };
}

export async function claimQueuedSendJob(jobId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const db = getDb();
  const { data, error } = await db
    .from("send_jobs")
    .update({ status: "running", started_at: now, heartbeat_at: now, updated_at: now })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("id");
  assertNoError(error, "Failed to claim send job");
  return (data ?? []).length > 0;
}

export async function claimStaleRunningSendJob(
  jobId: string,
  heartbeatAt: string | null
): Promise<boolean> {
  const now = new Date().toISOString();
  const db = getDb();
  let query = db
    .from("send_jobs")
    .update({ started_at: now, heartbeat_at: now, updated_at: now })
    .eq("id", jobId)
    .eq("status", "running")
    .select("id");

  if (heartbeatAt === null) {
    query = query.is("heartbeat_at", null);
  } else {
    query = query.eq("heartbeat_at", heartbeatAt);
  }

  const { data, error } = await query;
  assertNoError(error, "Failed to re-claim send job");
  return (data ?? []).length > 0;
}

export async function claimRunningSendJob(
  jobId: string,
  heartbeatAt: string | null
): Promise<boolean> {
  const now = new Date().toISOString();
  const db = getDb();
  let query = db
    .from("send_jobs")
    .update({ heartbeat_at: now, updated_at: now })
    .eq("id", jobId)
    .eq("status", "running")
    .select("id");

  if (heartbeatAt === null) {
    query = query.is("heartbeat_at", null);
  } else {
    query = query.eq("heartbeat_at", heartbeatAt);
  }

  const { data, error } = await query;
  assertNoError(error, "Failed to claim running send job");
  return (data ?? []).length > 0;
}

export async function markSendJobHeartbeat(jobId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db
    .from("send_jobs")
    .update({ heartbeat_at: now, updated_at: now })
    .eq("id", jobId);
  assertNoError(error, "Failed to heartbeat send job");
}

export async function requeueStaleSendingRecipients(
  jobId: string,
  startedBefore: string
): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("send_job_recipients")
    .update({ status: "pending" })
    .eq("job_id", jobId)
    .eq("status", "sending")
    .lt("started_at", startedBefore);
  assertNoError(error, "Failed to reset stale recipients");
}

export async function getPendingSendJobRecipients(
  jobId: string,
  limit: number
): Promise<Array<{ id: number; recipient: string }>> {
  const db = getDb();
  const boundedLimit = Math.max(1, Math.floor(limit));
  const { data, error } = await db
    .from("send_job_recipients")
    .select("id, recipient")
    .eq("job_id", jobId)
    .eq("status", "pending")
    .order("id", { ascending: true })
    .limit(boundedLimit);
  assertNoError(error, "Failed to load send job recipients");
  return ((data ?? []) as { id: number; recipient: string }[]).map((row) => ({
    id: row.id,
    recipient: row.recipient,
  }));
}

export async function claimSendJobRecipients(
  jobId: string,
  recipientIds: number[]
): Promise<Array<{ id: number; recipient: string }>> {
  if (recipientIds.length === 0) return [];

  const now = new Date().toISOString();
  const db = getDb();
  const { data, error } = await db
    .from("send_job_recipients")
    .update({ status: "sending", started_at: now })
    .in("id", recipientIds)
    .eq("job_id", jobId)
    .eq("status", "pending")
    .select("id, recipient");
  assertNoError(error, "Failed to claim send job recipients");
  return ((data ?? []) as Array<{ id: number; recipient: string }>).map((row) => ({
    id: row.id,
    recipient: row.recipient,
  }));
}

export async function markSendJobRecipientSent(
  id: number,
  messageId: string | null
): Promise<void> {
  const now = new Date().toISOString();
  const db = getDb();
  const { error } = await db
    .from("send_job_recipients")
    .update({
      status: "sent",
      message_id: messageId,
      processed_at: now,
      error: null,
      last_error_at: null,
    })
    .eq("id", id);
  assertNoError(error, "Failed to mark send job recipient as sent");
}

export async function markSendJobRecipientFailed(
  id: number,
  message: string
): Promise<void> {
  const now = new Date().toISOString();
  const db = getDb();
  const { error } = await db
    .from("send_job_recipients")
    .update({
      status: "failed",
      error: message.slice(0, 1000),
      processed_at: now,
      last_error_at: now,
    })
    .eq("id", id);
  assertNoError(error, "Failed to mark send job recipient as failed");
}

export async function incrementSendJobProgress(
  jobId: string,
  sentDelta: number,
  failedDelta: number
): Promise<void> {
  const normalizedSentDelta = Math.max(0, Math.floor(sentDelta));
  const normalizedFailedDelta = Math.max(0, Math.floor(failedDelta));
  if (normalizedSentDelta === 0 && normalizedFailedDelta === 0) {
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();

  const { data: current, error: readError } = await db
    .from("send_jobs")
    .select("sent, failed")
    .eq("id", jobId)
    .limit(1);
  assertNoError(readError, "Failed to read send job progress");

  const currentSent = normalizeNonNegativeInteger(current?.[0]?.sent, 0);
  const currentFailed = normalizeNonNegativeInteger(current?.[0]?.failed, 0);

  const { error } = await db
    .from("send_jobs")
    .update({
      sent: currentSent + normalizedSentDelta,
      failed: currentFailed + normalizedFailedDelta,
      updated_at: now,
      heartbeat_at: now,
    })
    .eq("id", jobId);
  assertNoError(error, "Failed to update send job progress");
}

export async function setSendJobCompleted(
  jobId: string,
  status: SendJobStatus
): Promise<void> {
  const now = new Date().toISOString();
  const db = getDb();
  const { error } = await db
    .from("send_jobs")
    .update({
      status,
      completed_at: status === "completed" || status === "failed" || status === "cancelled" ? now : null,
      updated_at: now,
      heartbeat_at: now,
    })
    .eq("id", jobId);
  assertNoError(error, "Failed to finalize send job");
}

export async function failSendJobWithMessage(
  jobId: string,
  message: string
): Promise<void> {
  const now = new Date().toISOString();
  const db = getDb();
  const { error } = await db
    .from("send_jobs")
    .update({
      status: "failed",
      error_message: message.slice(0, 2000),
      completed_at: now,
      updated_at: now,
      heartbeat_at: now,
    })
    .eq("id", jobId);
  assertNoError(error, "Failed to fail send job");
}

export async function countSendJobRecipientsByStatus(
  jobId: string,
  status: SendJobRecipientStatus
): Promise<number> {
  const db = getDb();
  const { count, error } = await db
    .from("send_job_recipients")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", status);
  assertNoError(error, "Failed to count send job recipients");
  return count ?? 0;
}
