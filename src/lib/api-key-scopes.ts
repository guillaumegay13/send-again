export const API_KEY_SCOPES = [
  "contacts.read",
  "contacts.write",
  "send.read",
  "send.write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const API_KEY_SCOPE_SET = new Set<string>(API_KEY_SCOPES);

export function allApiKeyScopes(): ApiKeyScope[] {
  return [...API_KEY_SCOPES];
}

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return API_KEY_SCOPE_SET.has(value);
}

export function normalizeApiKeyScopes(
  value: unknown
): { scopes: ApiKeyScope[]; invalid: string[] } {
  if (!Array.isArray(value)) {
    return { scopes: [], invalid: [] };
  }

  const invalid: string[] = [];
  const seen = new Set<ApiKeyScope>();

  for (const item of value) {
    if (typeof item !== "string") {
      invalid.push(String(item));
      continue;
    }
    if (!isApiKeyScope(item)) {
      invalid.push(item);
      continue;
    }
    seen.add(item);
  }

  return {
    scopes: API_KEY_SCOPES.filter((scope) => seen.has(scope)),
    invalid: Array.from(new Set(invalid)),
  };
}

export function isFullApiKeyScopeSet(scopes: ApiKeyScope[]): boolean {
  if (scopes.length !== API_KEY_SCOPES.length) return false;
  const set = new Set<ApiKeyScope>(scopes);
  return API_KEY_SCOPES.every((scope) => set.has(scope));
}

export function resolveStoredApiKeyScopes(value: unknown): ApiKeyScope[] {
  if (value === null || value === undefined) {
    return allApiKeyScopes();
  }
  const { scopes } = normalizeApiKeyScopes(value);
  return scopes;
}
