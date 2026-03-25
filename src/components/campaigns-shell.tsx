"use client";

import * as dagre from "dagre";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppSidebar } from "@/components/ui/app-sidebar";
import { FancySelect } from "@/components/ui/fancy-select";
import {
  FIELD_OPERATORS,
  HISTORY_EVENTS,
  HISTORY_MATCH_OPTIONS,
  createDelayNode,
  createEdge,
  createRuleNode,
  createSendNode,
  defaultCampaign,
  isDelayNode,
  isRuleNode,
  isSendNode,
  makeFieldCondition,
  makeHistoryCondition,
  nodeKindLabel,
  nodeSummary,
  normalizeFieldOperator,
  normalizeHistoryEventType,
  normalizeHistorySubjectMatch,
  normalizeMatchMode,
  normalizeNumber,
  portLabel,
  sanitizeCampaignDraft,
  type CampaignDraft,
  type ConditionMatchMode,
  type DelayNode,
  type FieldOperator,
  type HistoryEventType,
  type HistorySubjectMatch,
  type RecipientCondition,
  type RuleNode,
  type SavedCampaign,
  type SendAudience,
  type SendNode,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowPort,
} from "@/lib/campaign-workflows";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";

const NODE_WIDTH = 248;
const NODE_HEIGHT = 116;

interface CampaignsShellProps {
  embedded?: boolean;
  workspaceId?: string | null;
}

interface WorkspaceSummary {
  id: string;
  name: string;
}

interface CampaignRunSendJobSummary {
  id: string;
  status: string;
  subject: string;
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

interface CampaignRunStatusResponse {
  id: string;
  campaignName: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  stepCounts: {
    pending: number;
    waiting: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  };
  sendJobs: CampaignRunSendJobSummary[];
  isDone: boolean;
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

type CampaignSaveState = "idle" | "saving" | "saved" | "error";

function freshDraftState(): { draft: CampaignDraft; snapshot: string } {
  const draft = sanitizeCampaignDraft(defaultCampaign());
  return {
    draft,
    snapshot: JSON.stringify(draft),
  };
}

function mergeCampaign(list: SavedCampaign[], nextCampaign: SavedCampaign): SavedCampaign[] {
  const existingIndex = list.findIndex(
    (campaign) => campaign.campaignId === nextCampaign.campaignId
  );
  if (existingIndex === -1) {
    return [nextCampaign, ...list];
  }

  const nextList = [...list];
  nextList[existingIndex] = nextCampaign;
  return nextList;
}

function edgeColor(port: WorkflowPort): string {
  if (port === "true") return "#16a34a";
  if (port === "false") return "#e11d48";
  return "#64748b";
}

function formatSavedLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function nodeIcon(node: WorkflowNode) {
  if (isSendNode(node)) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="m4 8 8 6 8-6" />
      </svg>
    );
  }
  if (isDelayNode(node)) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 8.5V12l2.8 2.8" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
    >
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
    onChangeConditions(
      conditions.map((condition) => (condition.id === id ? next : condition))
    );
  }

  function patchCondition(id: string, patch: Partial<RecipientCondition>) {
    onChangeConditions(
      conditions.map((condition) =>
        condition.id === id
          ? ({ ...condition, ...patch } as RecipientCondition)
          : condition
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
            onClick={() =>
              onChangeConditions([
                ...conditions,
                makeFieldCondition(fieldKeys[0] ?? "verified"),
              ])
            }
            className="rounded-full border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700"
          >
            + Field
          </button>
          <button
            type="button"
            onClick={() =>
              onChangeConditions([
                ...conditions,
                makeHistoryCondition("", "open", "exact"),
              ])
            }
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
            <div
              key={condition.id}
              className="rounded-lg border border-gray-200 bg-white p-2.5"
            >
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
                      replaceCondition(
                        condition.id,
                        makeHistoryCondition("", "open", "exact", condition.id)
                      )
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
                  onClick={() =>
                    onChangeConditions(
                      conditions.filter((item) => item.id !== condition.id)
                    )
                  }
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
                        patchCondition(condition.id, {
                          field: event.target.value,
                        })
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
                          operator: normalizeFieldOperator(
                            event.target.value as FieldOperator
                          ),
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
                        patchCondition(condition.id, {
                          value: event.target.value,
                        })
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
                        patchCondition(condition.id, {
                          subject: event.target.value,
                        })
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
                          subjectMatch: normalizeHistorySubjectMatch(
                            event.target.value as HistorySubjectMatch
                          ),
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
                          eventType: normalizeHistoryEventType(
                            event.target.value as HistoryEventType
                          ),
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

export function CampaignsShell({
  embedded = false,
  workspaceId,
}: CampaignsShellProps) {
  const initialDraft = useMemo(() => freshDraftState(), []);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceListLoaded, setWorkspaceListLoaded] = useState(embedded);
  const [workspaceListError, setWorkspaceListError] = useState<string | null>(
    null
  );
  const [standaloneWorkspaceId, setStandaloneWorkspaceId] = useState("");

  const effectiveWorkspaceId = embedded
    ? (workspaceId ?? "").trim().toLowerCase()
    : standaloneWorkspaceId;

  const [campaigns, setCampaigns] = useState<SavedCampaign[]>([]);
  const [campaignsWorkspaceId, setCampaignsWorkspaceId] = useState<string | null>(
    null
  );
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(initialDraft.draft);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialDraft.draft.nodes[0]?.id ?? null
  );
  const [savedSnapshot, setSavedSnapshot] = useState(initialDraft.snapshot);
  const [saveState, setSaveState] = useState<CampaignSaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<CampaignRunStatusResponse | null>(
    null
  );

  const saveRequestRef = useRef(0);
  const latestDraftSnapshotRef = useRef(initialDraft.snapshot);
  latestDraftSnapshotRef.current = JSON.stringify(draft);

  const fieldKeys = useMemo(() => ["verified"], []);

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
      const response = await authFetch(input, init);
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.error ?? `Request failed with status ${response.status}`
        );
      }
      return payload as T;
    },
    [authFetch]
  );

  const resetBuilderState = useCallback(() => {
    const next = freshDraftState();
    setActiveCampaignId(null);
    setDraft(next.draft);
    setSelectedNodeId(next.draft.nodes[0]?.id ?? null);
    setSavedSnapshot(next.snapshot);
    setSaveState("idle");
    setSaveMessage(null);
    setLastSavedAt(null);
    setRunBusy(false);
    setRunError(null);
    setActiveRunId(null);
    setActiveRun(null);
  }, []);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSessionToken(data.session?.access_token ?? null);
    });

    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSessionToken(session?.access_token ?? null);
      }
    );

    return () => {
      cancelled = true;
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (embedded || !sessionToken || workspaceListLoaded) {
      return;
    }

    let cancelled = false;
    void fetchJson<WorkspaceSummary[]>("/api/workspaces")
      .then((items) => {
        if (cancelled) return;
        setAvailableWorkspaces(items);
        setWorkspaceListLoaded(true);
        setWorkspaceListError(null);
        if (!standaloneWorkspaceId && items[0]?.id) {
          setStandaloneWorkspaceId(items[0].id);
          resetBuilderState();
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWorkspaceListLoaded(true);
        setWorkspaceListError(
          error instanceof Error ? error.message : String(error)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    embedded,
    fetchJson,
    resetBuilderState,
    sessionToken,
    standaloneWorkspaceId,
    workspaceListLoaded,
  ]);

  useEffect(() => {
    if (
      !sessionToken ||
      !effectiveWorkspaceId ||
      campaignsWorkspaceId === effectiveWorkspaceId
    ) {
      return;
    }

    let cancelled = false;
    void fetchJson<{ items: SavedCampaign[] }>(
      `/api/campaigns?workspace=${encodeURIComponent(effectiveWorkspaceId)}`
    )
      .then((data) => {
        if (cancelled) return;
        setCampaigns(data.items);
        setCampaignsWorkspaceId(effectiveWorkspaceId);
        setCampaignsError(null);
        resetBuilderState();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCampaigns([]);
        setCampaignsWorkspaceId(effectiveWorkspaceId);
        setCampaignsError(error instanceof Error ? error.message : String(error));
        resetBuilderState();
      });

    return () => {
      cancelled = true;
    };
  }, [
    campaignsWorkspaceId,
    effectiveWorkspaceId,
    fetchJson,
    resetBuilderState,
    sessionToken,
  ]);

  const orderedCampaigns = useMemo(() => {
    const list = [...campaigns];
    list.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return list;
  }, [campaigns]);

  const updateDraft = useCallback(
    (updater: CampaignDraft | ((current: CampaignDraft) => CampaignDraft)) => {
      setDraft((current) => {
        const nextDraft = sanitizeCampaignDraft(
          typeof updater === "function"
            ? (updater as (current: CampaignDraft) => CampaignDraft)(current)
            : updater
        );
        if (activeCampaignId) {
          setCampaigns((currentCampaigns) =>
            currentCampaigns.map((campaign) =>
              campaign.campaignId === activeCampaignId
                ? {
                    ...campaign,
                    ...nextDraft,
                  }
                : campaign
            )
          );
        }
        return nextDraft;
      });
      if (saveState !== "saving") {
        setSaveState("idle");
      }
      setSaveMessage(null);
    },
    [activeCampaignId, saveState]
  );

  const draftSnapshot = useMemo(() => JSON.stringify(draft), [draft]);
  const hasUnsavedChanges =
    !!activeCampaignId && draftSnapshot !== savedSnapshot;

  const saveCampaign = useCallback(
    async (
      source: "auto" | "manual",
      draftOverride?: CampaignDraft,
      successMessage?: string
    ) => {
      if (!effectiveWorkspaceId) {
        setSaveState("error");
        setSaveMessage("Choose a workspace before saving.");
        return null;
      }
      if (!sessionToken) {
        setSaveState("error");
        setSaveMessage("Sign in before saving campaigns.");
        return null;
      }

      const campaignToSave = sanitizeCampaignDraft(draftOverride ?? draft);
      const snapshotAtSaveStart = JSON.stringify(campaignToSave);
      const requestId = ++saveRequestRef.current;

      setSaveState("saving");
      setSaveMessage(
        source === "auto" ? "Saving changes..." : "Saving campaign..."
      );

      try {
        const saved = await fetchJson<SavedCampaign>("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: effectiveWorkspaceId,
            draft: campaignToSave,
          }),
        });

        if (requestId !== saveRequestRef.current) {
          return saved;
        }

        setCampaigns((current) => mergeCampaign(current, saved));
        if (
          latestDraftSnapshotRef.current === snapshotAtSaveStart &&
          saved.campaignId === campaignToSave.campaignId
        ) {
          setDraft(saved);
        }
        setSavedSnapshot(snapshotAtSaveStart);
        setSaveState("saved");
        setSaveMessage(
          successMessage ??
            (source === "auto" ? "Saved automatically" : "Campaign saved")
        );
        setLastSavedAt(saved.updatedAt);
        return saved;
      } catch (error) {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [draft, effectiveWorkspaceId, fetchJson, sessionToken]
  );

  useEffect(() => {
    if (
      !sessionToken ||
      !effectiveWorkspaceId ||
      !activeCampaignId ||
      !hasUnsavedChanges
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveCampaign("auto");
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeCampaignId,
    draftSnapshot,
    effectiveWorkspaceId,
    hasUnsavedChanges,
    saveCampaign,
    sessionToken,
  ]);

  useEffect(() => {
    if (!sessionToken || !activeRunId) {
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    const poll = async () => {
      try {
        const data = await fetchJson<CampaignRunStatusResponse>(
          `/api/campaigns/runs/${encodeURIComponent(activeRunId)}`
        );
        if (cancelled) return;
        setActiveRun(data);
        setRunError(null);
        if (data.isDone && intervalId) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      } catch (error) {
        if (cancelled) return;
        setRunError(error instanceof Error ? error.message : String(error));
      }
    };

    void poll();
    intervalId = window.setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [activeRunId, fetchJson, sessionToken]);

  const nodeById = useMemo(
    () => new Map(draft.nodes.map((node) => [node.id, node])),
    [draft.nodes]
  );
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
        new Set(sendNodes.map((node) => node.subject.trim()).filter(Boolean))
      ),
    [sendNodes]
  );

  const resolvedSelectedNodeId =
    selectedNodeId && draft.nodes.some((node) => node.id === selectedNodeId)
      ? selectedNodeId
      : draft.nodes[0]?.id ?? null;

  const selectedNode = useMemo(
    () => draft.nodes.find((node) => node.id === resolvedSelectedNodeId) ?? null,
    [draft.nodes, resolvedSelectedNodeId]
  );

  const getTransitionTargetId = useCallback(
    (fromNodeId: string, port: WorkflowPort): string => {
      const target = (outgoingEdgesByNode.get(fromNodeId) ?? []).find(
        (edge) => edge.port === port
      );
      return target?.toNodeId ?? "";
    },
    [outgoingEdgesByNode]
  );

  const setTransition = useCallback(
    (fromNodeId: string, port: WorkflowPort, toNodeId: string) => {
      updateDraft((current) => {
        const validFrom = current.nodes.some((node) => node.id === fromNodeId);
        const validTo =
          toNodeId === "" || current.nodes.some((node) => node.id === toNodeId);
        if (!validFrom || !validTo || fromNodeId === toNodeId) {
          return current;
        }

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
    },
    [updateDraft]
  );

  const openCampaign = useCallback(
    (campaignId: string) => {
      const campaignToEdit = campaigns.find(
        (campaign) => campaign.campaignId === campaignId
      );
      if (!campaignToEdit) return;
      const sanitized = sanitizeCampaignDraft(campaignToEdit);
      const snapshot = JSON.stringify(sanitized);
      setActiveCampaignId(campaignId);
      setDraft(sanitized);
      setSelectedNodeId(sanitized.nodes[0]?.id ?? null);
      setSavedSnapshot(snapshot);
      setSaveState("idle");
      setSaveMessage(null);
      setLastSavedAt(campaignToEdit.updatedAt);
      setRunBusy(false);
      setRunError(null);
      setActiveRunId(null);
      setActiveRun(null);
    },
    [campaigns]
  );

  const createCampaign = useCallback(() => {
    const now = new Date().toISOString();
    const fresh = sanitizeCampaignDraft(defaultCampaign());
    const created: SavedCampaign = {
      ...fresh,
      name: `Campaign ${campaigns.length + 1}`,
      createdAt: now,
      updatedAt: now,
    };
    const snapshot = JSON.stringify(created);

    setCampaigns((current) => [created, ...current]);
    setActiveCampaignId(created.campaignId);
    setDraft(created);
    setSelectedNodeId(created.nodes[0]?.id ?? null);
    setSavedSnapshot(snapshot);
    setSaveState("idle");
    setSaveMessage("New campaign draft created.");
    setLastSavedAt(null);
    setRunBusy(false);
    setRunError(null);
    setActiveRunId(null);
    setActiveRun(null);
    void saveCampaign("manual", created, "Campaign created");
  }, [campaigns.length, saveCampaign]);

  const closeBuilder = useCallback(() => {
    setActiveCampaignId(null);
    setSelectedNodeId(null);
    setRunBusy(false);
    setRunError(null);
    setActiveRunId(null);
    setActiveRun(null);
  }, []);

  const deleteCampaign = useCallback(
    async (campaignId: string) => {
      if (!effectiveWorkspaceId) return;
      try {
        await fetchJson<{ ok: boolean }>(
          `/api/campaigns/${encodeURIComponent(
            campaignId
          )}?workspace=${encodeURIComponent(effectiveWorkspaceId)}`,
          {
            method: "DELETE",
          }
        );
        setCampaigns((current) =>
          current.filter((campaign) => campaign.campaignId !== campaignId)
        );
        if (activeCampaignId === campaignId) {
          resetBuilderState();
        }
      } catch (error) {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [activeCampaignId, effectiveWorkspaceId, fetchJson, resetBuilderState]
  );

  const updateCampaignName = useCallback(
    (name: string) => {
      updateDraft((current) => ({ ...current, name }));
    },
    [updateDraft]
  );

  const updateSendNode = useCallback(
    (id: string, patch: Partial<SendNode>) => {
      updateDraft((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          isSendNode(node) && node.id === id ? { ...node, ...patch } : node
        ),
      }));
    },
    [updateDraft]
  );

  const updateSendAudience = useCallback(
    (id: string, updater: (audience: SendAudience) => SendAudience) => {
      updateDraft((current) => ({
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
    },
    [updateDraft]
  );

  const updateDelayNode = useCallback(
    (id: string, patch: Partial<DelayNode>) => {
      updateDraft((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          isDelayNode(node) && node.id === id ? { ...node, ...patch } : node
        ),
      }));
    },
    [updateDraft]
  );

  const updateRuleNode = useCallback(
    (id: string, patch: Partial<RuleNode>) => {
      updateDraft((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          isRuleNode(node) && node.id === id ? { ...node, ...patch } : node
        ),
      }));
    },
    [updateDraft]
  );

  const addNode = useCallback(
    (kind: WorkflowNode["kind"]) => {
      const node =
        kind === "send"
          ? createSendNode()
          : kind === "delay"
          ? createDelayNode()
          : createRuleNode();

      updateDraft((current) => {
        const nextNodes = [...current.nodes, node];
        const sourceId =
          resolvedSelectedNodeId &&
          current.nodes.some((item) => item.id === resolvedSelectedNodeId)
            ? resolvedSelectedNodeId
            : current.nodes.at(-1)?.id ?? "";
        if (!sourceId) {
          return { ...current, nodes: nextNodes };
        }

        const sourceNode = current.nodes.find((item) => item.id === sourceId);
        if (!sourceNode) {
          return { ...current, nodes: nextNodes };
        }

        const defaultPort: WorkflowPort = isRuleNode(sourceNode) ? "true" : "next";
        const nextEdges = current.edges.filter(
          (edge) => !(edge.fromNodeId === sourceId && edge.port === defaultPort)
        );
        nextEdges.push(
          createEdge({
            fromNodeId: sourceId,
            toNodeId: node.id,
            port: defaultPort,
          })
        );

        return {
          ...current,
          nodes: nextNodes,
          edges: nextEdges,
        };
      });
      setSelectedNodeId(node.id);
    },
    [resolvedSelectedNodeId, updateDraft]
  );

  const deleteNode = useCallback(
    (id: string) => {
      updateDraft((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== id),
        edges: current.edges.filter(
          (edge) => edge.fromNodeId !== id && edge.toNodeId !== id
        ),
      }));
      setSelectedNodeId((current) => (current === id ? null : current));
    },
    [updateDraft]
  );

  const loadExample = useCallback(() => {
    updateDraft((current) => {
      const sample = sanitizeCampaignDraft(defaultCampaign());
      return {
        ...sample,
        campaignId: current.campaignId,
        name: current.name,
      };
    });
    setSelectedNodeId(null);
  }, [updateDraft]);

  const handleManualSave = useCallback(async () => {
    await saveCampaign("manual", undefined, "Campaign saved");
  }, [saveCampaign]);

  const handleRunCampaign = useCallback(async () => {
    if (!activeCampaignId || !effectiveWorkspaceId) {
      return;
    }
    if (hasUnsavedChanges) {
      const saved = await saveCampaign("manual", undefined, "Campaign saved");
      if (!saved) {
        return;
      }
    }

    setRunBusy(true);
    setRunError(null);
    try {
      const result = await fetchJson<{ runId: string }>(
        `/api/campaigns/${encodeURIComponent(activeCampaignId)}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: effectiveWorkspaceId }),
        }
      );
      setActiveRunId(result.runId);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunBusy(false);
    }
  }, [
    activeCampaignId,
    effectiveWorkspaceId,
    fetchJson,
    hasUnsavedChanges,
    saveCampaign,
  ]);

  const layout = useMemo(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({
      rankdir: "TB",
      ranksep: 88,
      nodesep: 32,
      marginx: 48,
      marginy: 48,
    });
    graph.setDefaultEdgeLabel(() => ({}));

    for (const node of draft.nodes) {
      graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    for (const edge of draft.edges) {
      graph.setEdge(edge.fromNodeId, edge.toNodeId);
    }

    dagre.layout(graph);

    const positions = new Map<string, { x: number; y: number }>();
    let maxX = 0;
    let maxY = 0;

    for (const node of draft.nodes) {
      const point = graph.node(node.id);
      if (!point) continue;
      const x = point.x - NODE_WIDTH / 2;
      const y = point.y - NODE_HEIGHT / 2;
      positions.set(node.id, { x, y });
      maxX = Math.max(maxX, x + NODE_WIDTH);
      maxY = Math.max(maxY, y + NODE_HEIGHT);
    }

    return {
      positions,
      width: Math.max(maxX + 48, 360),
      height: Math.max(maxY + 48, 240),
    };
  }, [draft.edges, draft.nodes]);

  function renderTextField(
    label: string,
    value: string,
    onChange: (value: string) => void
  ) {
    return (
      <label className="block space-y-1">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </label>
    );
  }

  function renderTextareaField(
    label: string,
    value: string,
    onChange: (value: string) => void,
    rows = 5
  ) {
    return (
      <label className="block space-y-1">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <textarea
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
        />
      </label>
    );
  }

  function renderNumberField(
    label: string,
    value: number,
    onChange: (value: number) => void
  ) {
    return (
      <label className="block space-y-1">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <input
          type="number"
          min={0}
          value={value}
          onChange={(event) => onChange(normalizeNumber(event.target.value, value))}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </label>
    );
  }

  const saveStatusLabel =
    saveState === "saving"
      ? "Saving..."
      : saveState === "saved"
      ? `Saved${formatSavedLabel(lastSavedAt) ? ` ${formatSavedLabel(lastSavedAt)}` : ""}`
      : saveState === "error"
      ? "Save failed"
      : hasUnsavedChanges
      ? "Unsaved changes"
      : null;

  const sidebar = (
    <AppSidebar
      brand="Email Campaign"
      userEmail={effectiveWorkspaceId || "Campaign workspace"}
      controls={
        <div className="mb-4 mt-4 space-y-3 px-3">
          {!embedded ? (
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Workspace
              </span>
              <FancySelect
                wrapperClassName="w-full"
                className="h-8 border-gray-300 text-xs"
                value={standaloneWorkspaceId}
                onChange={(event) => {
                  setStandaloneWorkspaceId(event.target.value);
                  setCampaigns([]);
                  setCampaignsWorkspaceId(null);
                  setCampaignsError(null);
                  resetBuilderState();
                }}
                disabled={!workspaceListLoaded || availableWorkspaces.length === 0}
              >
                {availableWorkspaces.length === 0 ? (
                  <option value="">No workspaces</option>
                ) : (
                  availableWorkspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))
                )}
              </FancySelect>
            </label>
          ) : null}
          <button
            type="button"
            onClick={createCampaign}
            disabled={!effectiveWorkspaceId}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
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
      footer={
        <span className="text-xs text-gray-500">{orderedCampaigns.length} campaigns</span>
      }
    />
  );

  const content = (
    <div className="flex min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1600px] p-4">
        {!sessionToken ? (
          <div className="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-6">
            <p className="text-xs uppercase tracking-[.16em] text-gray-500">Campaigns</p>
            <h1 className="mt-2 text-xl font-semibold">Sign in required</h1>
            <p className="mt-2 text-sm text-gray-600">
              Open the dashboard and sign in before editing campaigns.
            </p>
          </div>
        ) : !effectiveWorkspaceId ? (
          <div className="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-6">
            <p className="text-xs uppercase tracking-[.16em] text-gray-500">Campaigns</p>
            <h1 className="mt-2 text-xl font-semibold">Select a workspace</h1>
            <p className="mt-2 text-sm text-gray-600">
              Campaigns are saved and executed per workspace.
            </p>
            {workspaceListError ? (
              <p className="mt-3 text-sm text-red-600">{workspaceListError}</p>
            ) : null}
          </div>
        ) : activeCampaignId === null ? (
          <div className="mx-auto w-full max-w-3xl">
            <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[.16em] text-gray-500">Campaigns</p>
                <h1 className="text-xl font-semibold">Email Campaigns</h1>
                <p className="mt-1 text-xs text-gray-500">
                  Workspace: {effectiveWorkspaceId}
                </p>
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
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">Campaign list</p>
                {campaignsError ? (
                  <p className="text-xs text-red-600">{campaignsError}</p>
                ) : campaignsWorkspaceId !== effectiveWorkspaceId ? (
                  <p className="text-xs text-gray-500">Loading campaigns...</p>
                ) : null}
              </div>

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
                              Updated {campaign.updatedAt.slice(0, 10)} · {sendCount} send ·{" "}
                              {delayCount} delay · {ruleCount} rule
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
                                void deleteCampaign(campaign.campaignId);
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
                  <p className="text-xs uppercase tracking-[.16em] text-gray-500">
                    Workflow builder
                  </p>
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
                    {saveStatusLabel ? (
                      <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5">
                        {saveStatusLabel}
                      </span>
                    ) : null}
                  </div>
                  {saveMessage ? (
                    <p
                      className={`mt-2 text-xs ${
                        saveState === "error" ? "text-red-600" : "text-gray-500"
                      }`}
                    >
                      {saveMessage}
                    </p>
                  ) : null}
                  {runError ? (
                    <p className="mt-2 text-xs text-red-600">{runError}</p>
                  ) : null}
                  {activeRun ? (
                    <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Latest run
                          </p>
                          <p className="text-sm font-semibold text-gray-900">
                            {activeRun.campaignName}
                          </p>
                        </div>
                        <span className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-700">
                          {activeRun.status}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-4">
                        <p>
                          Pending:{" "}
                          <span className="font-medium text-gray-900">
                            {activeRun.stepCounts.pending}
                          </span>
                        </p>
                        <p>
                          Waiting:{" "}
                          <span className="font-medium text-gray-900">
                            {activeRun.stepCounts.waiting}
                          </span>
                        </p>
                        <p>
                          Processing:{" "}
                          <span className="font-medium text-gray-900">
                            {activeRun.stepCounts.processing}
                          </span>
                        </p>
                        <p>
                          Completed:{" "}
                          <span className="font-medium text-gray-900">
                            {activeRun.stepCounts.completed}
                          </span>
                        </p>
                      </div>
                      {activeRun.sendJobs.length > 0 ? (
                        <div className="mt-3 space-y-1">
                          {activeRun.sendJobs.slice(0, 3).map((job) => (
                            <p key={job.id} className="text-xs text-gray-500">
                              {job.subject || "(No subject)"} · {job.status} · {job.sent}/{job.total} sent
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
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
                    onClick={() => {
                      void handleManualSave();
                    }}
                    className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                  >
                    Save workflow
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleRunCampaign();
                    }}
                    disabled={runBusy}
                    className="rounded-full border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {runBusy ? "Starting..." : "Run campaign"}
                  </button>
                  <button
                    type="button"
                    onClick={loadExample}
                    className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
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
                  <p className="text-xs text-gray-500">
                    Select node to edit on right panel.
                  </p>
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
                          const controlOffset = Math.max(
                            72,
                            Math.abs(targetY - sourceY) * 0.45
                          );
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
                        const selected = resolvedSelectedNodeId === node.id;
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
                              <span className="absolute left-1/2 -top-2 h-3 w-3 -translate-x-1/2 rounded-full border border-gray-300 bg-white" />
                              {isRuleNode(node) ? (
                                <>
                                  <span className="absolute bottom-[-6px] left-[35%] h-3 w-3 -translate-x-1/2 rounded-full border border-emerald-300 bg-emerald-500" />
                                  <span className="absolute bottom-[-6px] left-[65%] h-3 w-3 -translate-x-1/2 rounded-full border border-rose-300 bg-rose-500" />
                                </>
                              ) : (
                                <span className="absolute bottom-[-6px] left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border border-gray-300 bg-gray-600" />
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
                                    const targetLabel = target
                                      ? target.label || target.id
                                      : edge.toNodeId;
                                    return (
                                      <p key={edge.id} className="text-[11px] text-gray-500">
                                        <span className="font-medium text-gray-700">
                                          {portLabel(edge.port)}
                                        </span>
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

                      <label className="block space-y-1">
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
                      <label className="block space-y-1">
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
                          updateRuleNode(selectedNode.id, {
                            matchMode: normalizeMatchMode(mode),
                          })
                        }
                        onChangeConditions={(conditions) =>
                          updateRuleNode(selectedNode.id, { conditions })
                        }
                      />

                      <label className="block space-y-1">
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

                      <label className="block space-y-1">
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

                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">
                      Node edits save automatically. Use the button below if you want to force a save right now.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void handleManualSave();
                      }}
                      className="mt-3 w-full rounded-full border border-gray-900 bg-gray-900 px-3 py-2 text-sm text-white"
                    >
                      Save node changes
                    </button>
                  </div>
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

export default CampaignsShell;
