"use client";

import { useState, useRef, useEffect, useCallback, ChangeEvent } from "react";

type Tab = "compose" | "contacts" | "settings";

interface Workspace {
  id: string;
  name: string;
  from: string;
  configSet: string;
  rateLimit: number;
}

interface Contact {
  email: string;
  firstname: string;
  language: string;
}

function parseCSV(text: string): Contact[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const sep = lines[0].includes("\t")
    ? "\t"
    : lines[0].includes(";")
      ? ";"
      : ",";

  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());

  // Map header names to our fields
  const emailIdx = headers.findIndex(
    (h) => h === "email" || h === "e-mail" || h === "mail"
  );
  const firstnameIdx = headers.findIndex(
    (h) =>
      h === "firstname" ||
      h === "first_name" ||
      h === "first name" ||
      h === "prenom" ||
      h === "prénom" ||
      h === "name"
  );
  const languageIdx = headers.findIndex(
    (h) =>
      h === "language" ||
      h === "lang" ||
      h === "langue" ||
      h === "locale"
  );

  // If no email header found, assume first column
  const eIdx = emailIdx >= 0 ? emailIdx : 0;

  const contacts: Contact[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(sep).map((v) => v.trim());
    const email = values[eIdx] ?? "";
    if (!email) continue;
    contacts.push({
      email,
      firstname: firstnameIdx >= 0 ? values[firstnameIdx] ?? "" : "",
      language: languageIdx >= 0 ? values[languageIdx] ?? "" : "",
    });
  }

  return contacts;
}

export default function ComposePage() {
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/workspaces")
      .then((res) => res.json())
      .then((data: Workspace[]) => {
        if (data.length > 0) {
          setWorkspaces(data);
          setActiveId(data[0].id);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function updateWorkspace(patch: Partial<Workspace>) {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === activeId ? { ...w, ...patch } : w))
    );
  }

  function setContacts(list: Contact[]) {
    if (!activeId) return;
    setContactsMap((prev) => ({ ...prev, [activeId]: list }));
  }

  function addContact() {
    const email = newContact.trim();
    if (!email || !activeId) return;
    if (contacts.some((c) => c.email === email)) {
      setNewContact("");
      return;
    }
    setContacts([...contacts, { email, firstname: "", language: "" }]);
    setNewContact("");
  }

  function removeContact(email: string) {
    setContacts(contacts.filter((c) => c.email !== email));
  }

  function updateContact(email: string, patch: Partial<Contact>) {
    setContacts(
      contacts.map((c) => (c.email === email ? { ...c, ...patch } : c))
    );
  }

  function clearContacts() {
    setContacts([]);
  }

  function handleCSVUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCSV(reader.result as string);
      // Merge: CSV rows overwrite existing by email
      const newEmails = new Set(parsed.map((c) => c.email));
      const kept = contacts.filter((c) => !newEmails.has(c.email));
      setContacts([...kept, ...parsed]);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function insertAllContacts() {
    setTo(contacts.map((c) => c.email).join("\n"));
    setTab("compose");
  }

  const updatePreview = useCallback((htmlContent: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html: htmlContent }),
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

  useEffect(() => {
    updatePreview(html);
  }, [html, updatePreview]);

  const recipients = to
    .split("\n")
    .map((e) => e.trim())
    .filter(Boolean);

  async function handleSend() {
    if (!workspace?.from || !recipients.length || !subject || !html) {
      setResult("Fill in all fields.");
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: workspace.from,
          to: recipients,
          subject,
          html,
          dryRun,
          configSet: workspace.configSet,
          rateLimit: workspace.rateLimit,
        }),
      });
      const data = await res.json();
      if (data.dryRun) {
        setResult(`Dry run: ${data.sent} email(s) would be sent.`);
      } else {
        let msg = `Sent: ${data.sent}`;
        if (data.errors > 0) {
          msg += ` | Errors: ${data.errors} (${data.errorEmails.join(", ")})`;
        }
        setResult(msg);
      }
    } catch (err) {
      setResult(`Error: ${err}`);
    } finally {
      setSending(false);
    }
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

        <div className="px-3 mb-4">
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
          {(["compose", "contacts", "settings"] as Tab[]).map((t) => (
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
            </div>

            {/* Contact table */}
            {contacts.length === 0 ? (
              <div className="text-sm text-gray-400">
                <p>No contacts yet. Add manually or upload a CSV.</p>
                <p className="mt-2 text-xs">
                  CSV format: <code className="bg-gray-100 px-1 rounded">email,firstname,language</code>
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
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider w-40">
                          Firstname
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                          Language
                        </th>
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
                          <td className="px-1 py-1">
                            <input
                              type="text"
                              value={c.firstname}
                              onChange={(e) =>
                                updateContact(c.email, {
                                  firstname: e.target.value,
                                })
                              }
                              placeholder="--"
                              className="w-full px-2 py-1 text-sm border border-transparent rounded hover:border-gray-300 focus:border-gray-300 focus:outline-none"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="text"
                              value={c.language}
                              onChange={(e) =>
                                updateContact(c.email, {
                                  language: e.target.value,
                                })
                              }
                              placeholder="--"
                              className="w-full px-2 py-1 text-sm border border-transparent rounded hover:border-gray-300 focus:border-gray-300 focus:outline-none"
                            />
                          </td>
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
