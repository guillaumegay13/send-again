import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export class ApiAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

const globalAuthClient = globalThis as unknown as {
  __supabaseAuthClient?: SupabaseClient;
};

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function getSupabaseAuthClient(): SupabaseClient {
  if (!globalAuthClient.__supabaseAuthClient) {
    const supabaseUrl = requireEnv(
      "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL",
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
    );
    const supabasePublishableKey = requireEnv(
      "SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    );
    globalAuthClient.__supabaseAuthClient = createClient(
      supabaseUrl,
      supabasePublishableKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );
  }

  return globalAuthClient.__supabaseAuthClient;
}

function normalizeEmail(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function getAllowedEmails(): string[] {
  const explicit =
    process.env.ALLOWED_AUTH_EMAILS ?? process.env.AUTHORIZED_EMAILS;
  const raw =
    explicit && explicit.trim().length > 0
      ? explicit
      : process.env.INITIAL_OWNER_EMAIL ?? "guillaume.gay@protonmail.com";

  return raw
    .split(",")
    .map((part) => normalizeEmail(part))
    .filter(Boolean);
}

export function getInitialOwnerEmail(): string {
  return normalizeEmail(
    process.env.INITIAL_OWNER_EMAIL ?? "guillaume.gay@protonmail.com"
  );
}

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export async function requireAuthenticatedUser(
  req: NextRequest
): Promise<AuthenticatedUser> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new ApiAuthError("Missing bearer token", 401);
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new ApiAuthError("Invalid bearer token", 401);
  }

  const supabase = getSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new ApiAuthError("Invalid session", 401);
  }

  const email = normalizeEmail(data.user.email);
  if (!email) {
    throw new ApiAuthError("Account email is required", 403);
  }

  const allowedEmails = getAllowedEmails();
  if (!allowedEmails.includes(email)) {
    throw new ApiAuthError("This account is not authorized", 403);
  }

  return { id: data.user.id, email };
}

export function apiErrorResponse(
  error: unknown,
  fallback = "Internal server error"
): NextResponse {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error(error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
