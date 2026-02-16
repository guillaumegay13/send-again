"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  ChangeEvent,
  FormEvent,
} from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";

type Tab = "compose" | "contacts" | "history" | "settings";

interface Workspace {
  id: string;
  name: string;
  from: string;
  configSet: string;
  rateLimit: number;
}

interface Contact {
  email: string;
  fields: Record<string, string>;
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

function parseCSV(text: string): Contact[] {
  // Strip BOM and handle all line ending styles (\r\n, \n, \r)
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const sep = lines[0].includes("\t")
    ? "\t"
    : lines[0].includes(";")
      ? ";"
      : ",";

  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());

  // Find the email column
  const emailIdx = headers.findIndex(
    (h) => h === "email" || h === "e-mail" || h === "mail"
  );
  const eIdx = emailIdx >= 0 ? emailIdx : 0;

  // All non-email columns become field keys
  const fieldHeaders = headers
    .map((h, i) => ({ header: h, index: i }))
    .filter((_, i) => i !== eIdx);

  const byEmail = new Map<string, Contact>();
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(sep).map((v) => v.trim());
    const email = values[eIdx] ?? "";
    if (!email) continue;
    const fields: Record<string, string> = {};
    for (const { header, index } of fieldHeaders) {
      fields[header] = values[index] ?? "";
    }
    byEmail.set(email, { email, fields });
  }

  return Array.from(byEmail.values());
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

  const contacts = activeId ? contactsMap[activeId] ?? [] : [];

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setContactsMap({});
      setHistory([]);
      return;
    }

    setLoading(true);
    setAuthError(null);
    fetchJson<Workspace[]>("/api/workspaces")
      .then((data) => {
        setWorkspaces(data);
        setActiveId((current) => {
          if (current && data.some((workspace) => workspace.id === current)) {
            return current;
          }
          return data[0]?.id ?? null;
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
    if (!sessionToken) return;
    if (tab !== "history" || !activeId) return;
    setHistoryLoading(true);
    fetchJson<HistoryItem[]>(`/api/history?workspace=${encodeURIComponent(activeId)}`)
      .then((data) => setHistory(data))
      .catch(console.error)
      .finally(() => setHistoryLoading(false));
  }, [sessionToken, tab, activeId, fetchJson]);

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
    setContactsMap({});
    setHistory([]);
  }

  function updateWorkspace(patch: Partial<Workspace>) {
    if (!activeId || !workspace || !sessionToken) return;
    const updated = { ...workspace, ...patch };
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === activeId ? updated : w))
    );
    // Debounce persist to DB
    if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current);
    settingsDebounceRef.current = setTimeout(() => {
      fetchJson<{ ok: boolean }>("/api/workspaces/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: updated.id,
          from: updated.from,
          configSet: updated.configSet,
          rateLimit: updated.rateLimit,
        }),
      }).catch(console.error);
    }, 500);
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

  async function handleCSVUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!sessionToken || !file || !activeId) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const parsed = parseCSV(reader.result as string);
      // Merge: CSV rows overwrite existing by email
      const newEmails = new Set(parsed.map((c) => c.email));
      const kept = contacts.filter((c) => !newEmails.has(c.email));
      setLocalContacts([...kept, ...parsed]);
      try {
        const updated = await fetchJson<Contact[]>("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: activeId, contacts: parsed }),
        });
        setContactsMap((prev) => ({ ...prev, [activeId]: updated }));
      } catch (err) {
        console.error("Failed to upload contacts:", err);
      }
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

  const updatePreview = useCallback((htmlContent: string, sampleVars: Record<string, string>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const resolved = replaceVars(htmlContent, sampleVars);
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html: resolved }),
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
  }, []);

  // Build sample variables from first recipient's contact data
  const firstRecipient = to.split("\n").map((e) => e.trim()).find(Boolean) ?? "";
  const sampleContact = contacts.find((c) => c.email === firstRecipient) ?? contacts[0];
  const sampleVars: Record<string, string> = {
    email: sampleContact?.email ?? firstRecipient,
    ...(sampleContact?.fields ?? {}),
  };

  // Compute all field keys across contacts for column headers and variable hints
  const allFieldKeys = Array.from(
    new Set(contacts.flatMap((c) => Object.keys(c.fields)))
  );

  const sampleFieldsJson = JSON.stringify(sampleContact?.fields ?? {});
  useEffect(() => {
    updatePreview(html, sampleVars);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, updatePreview, sampleContact?.email, sampleFieldsJson]);

  const recipients = to
    .split("\n")
    .map((e) => e.trim())
    .filter(Boolean);

  async function handleSend() {
    if (
      !sessionToken ||
      !workspace?.from ||
      !workspace.id ||
      !recipients.length ||
      !subject ||
      !html
    ) {
      setResult("Fill in all fields.");
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const data = await fetchJson<{
        sent: number;
        dryRun?: boolean;
        errors?: number;
        errorEmails?: string[];
      }>("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          from: workspace.from,
          to: recipients,
          subject,
          html,
          dryRun,
          configSet: workspace.configSet,
          rateLimit: workspace.rateLimit,
        }),
      });
      if (data.dryRun) {
        setResult(`Dry run: ${data.sent} email(s) would be sent.`);
      } else {
        let msg = `Sent: ${data.sent}`;
        if ((data.errors ?? 0) > 0) {
          msg += ` | Errors: ${data.errors} (${(data.errorEmails ?? []).join(", ")})`;
        }
        setResult(msg);
      }
    } catch (err) {
      setResult(`Error: ${err}`);
    } finally {
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
      <div className="flex h-screen items-center justify-center text-gray-400 text-sm">
        No verified SES domains found. Add a domain in AWS SES first.
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-48 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="px-4 py-5">
          <span className="text-sm font-semibold tracking-tight">
            Email Campaign
          </span>
        </div>

        <div className="px-4 pb-4 border-b border-gray-200">
          <p className="text-xs text-gray-500 truncate">{userEmail}</p>
          <button
            onClick={handleSignOut}
            className="mt-1 text-xs text-black hover:underline"
          >
            Sign out
          </button>
          {authError && (
            <p className="mt-2 text-[11px] text-red-600">{authError}</p>
          )}
        </div>

        <div className="px-3 mt-4 mb-4">
          <select
            value={activeId ?? ""}
            onChange={(e) => setActiveId(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black"
          >
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))}
          </select>
        </div>

        <nav className="flex flex-col gap-1 px-2">
          {(["compose", "contacts", "history", "settings"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-left px-3 py-1.5 rounded text-sm capitalize ${
                tab === t
                  ? "bg-black text-white font-medium"
                  : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        {contacts.length > 0 && (
          <div className="mt-auto px-4 py-3 border-t border-gray-200">
            <span className="text-xs text-gray-400">
              {contacts.length} contact{contacts.length !== 1 && "s"}
            </span>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-w-0">
        {tab === "compose" && (
          <>
            <div className="w-1/2 border-r border-gray-200 p-6 flex flex-col gap-4 overflow-y-auto">
              <div>
                <h1 className="text-xl font-semibold">Compose Email</h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  Sending as {workspace.name}
                </p>
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
                      (one per line)
                    </span>
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

              <button
                onClick={handleSend}
                disabled={sending}
                className="mt-2 bg-black text-white rounded px-4 py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed w-fit"
              >
                {sending
                  ? "Sending..."
                  : `Send${recipients.length > 1 ? ` (${recipients.length})` : ""}`}
              </button>

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
                className="border border-gray-300 rounded px-4 py-2 text-sm font-medium hover:bg-gray-100"
              >
                Upload CSV
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
                      {contacts.map((c) => (
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
                <p className="text-xs text-gray-400 mt-3">
                  {contacts.length} contact
                  {contacts.length !== 1 && "s"}
                </p>
              </>
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h1 className="text-xl font-semibold">Send History</h1>
              <button
                onClick={() => {
                  if (!activeId) return;
                  setHistoryLoading(true);
                  fetchJson<HistoryItem[]>(
                    `/api/history?workspace=${encodeURIComponent(activeId)}`
                  )
                    .then((data) => setHistory(data))
                    .catch(console.error)
                    .finally(() => setHistoryLoading(false));
                }}
                className="text-xs text-black hover:underline"
              >
                Refresh
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">{workspace.name}</p>

            {historyLoading ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-400">
                No emails sent yet from this workspace.
              </p>
            ) : (
              <div className="border border-gray-200 rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Recipient
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Subject
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider w-40">
                        Sent
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => {
                      const eventTypes = new Set(
                        item.events.map((e) => e.type)
                      );
                      return (
                        <tr
                          key={item.messageId}
                          className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                        >
                          <td className="px-3 py-2 font-mono text-sm">
                            {item.recipient}
                          </td>
                          <td className="px-3 py-2 text-sm truncate max-w-xs">
                            {item.subject}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-500 whitespace-nowrap">
                            {new Date(item.sentAt + "Z").toLocaleString()}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {eventTypes.has("Delivery") && (
                                <span className="inline-block px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-700">
                                  Delivered
                                </span>
                              )}
                              {eventTypes.has("Open") && (
                                <span className="inline-block px-1.5 py-0.5 text-xs rounded bg-blue-100 text-blue-700">
                                  Opened
                                </span>
                              )}
                              {eventTypes.has("Click") && (
                                <span className="inline-block px-1.5 py-0.5 text-xs rounded bg-purple-100 text-purple-700">
                                  Clicked
                                </span>
                              )}
                              {eventTypes.has("Bounce") && (
                                <span className="inline-block px-1.5 py-0.5 text-xs rounded bg-red-100 text-red-700">
                                  Bounced
                                </span>
                              )}
                              {eventTypes.has("Complaint") && (
                                <span className="inline-block px-1.5 py-0.5 text-xs rounded bg-orange-100 text-orange-700">
                                  Complaint
                                </span>
                              )}
                              {eventTypes.has("Send") &&
                                !eventTypes.has("Delivery") &&
                                !eventTypes.has("Bounce") && (
                                  <span className="inline-block px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
                                    Sent
                                  </span>
                                )}
                              {item.events.length === 0 && (
                                <span className="inline-block px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-400">
                                  Pending
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "settings" && (
          <div className="flex-1 p-6 max-w-xl">
            <h1 className="text-xl font-semibold mb-1">Settings</h1>
            <p className="text-xs text-gray-400 mb-6">{workspace.name}</p>

            <div className="flex flex-col gap-5">
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
        )}
      </div>
    </div>
  );
}
