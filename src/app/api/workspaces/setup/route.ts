import { NextRequest, NextResponse } from "next/server";
import { promises as dns } from "dns";
import {
  verifyDomain,
  getDomainSetupStatus,
  setupDkim,
  createConfigurationSet,
  configurationSetExists,
} from "@/lib/ses";
import { userCanAccessWorkspace } from "@/lib/db";
import {
  buildNamecheapCredentials,
  configureSesDnsInNamecheap,
  type NamecheapCredentialsInput,
} from "@/lib/namecheap";
import {
  buildCloudflareCredentials,
  configureSesDnsInCloudflare,
  type CloudflareCredentialsInput,
} from "@/lib/cloudflare";
import {
  buildRoute53Config,
  configureSesDnsInRoute53,
  type Route53ConfigInput,
} from "@/lib/route53";
import { requireAuthenticatedUser, apiErrorResponse } from "@/lib/auth";

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\.+$/, "");
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return null;
}

function parseNamecheapInput(value: unknown): NamecheapCredentialsInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const useSandbox = parseBooleanLike(input.useSandbox);

  return {
    apiUser: typeof input.apiUser === "string" ? input.apiUser : undefined,
    username: typeof input.username === "string" ? input.username : undefined,
    apiKey: typeof input.apiKey === "string" ? input.apiKey : undefined,
    clientIp: typeof input.clientIp === "string" ? input.clientIp : undefined,
    useSandbox: useSandbox === null ? undefined : useSandbox,
  };
}

function parseCloudflareInput(value: unknown): CloudflareCredentialsInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  return {
    apiToken: typeof input.apiToken === "string" ? input.apiToken : undefined,
    zoneId: typeof input.zoneId === "string" ? input.zoneId : undefined,
  };
}

function parseRoute53Input(value: unknown): Route53ConfigInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  return {
    hostedZoneId:
      typeof input.hostedZoneId === "string" ? input.hostedZoneId : undefined,
  };
}

function buildResolvedNamecheapCredentials(
  input: NamecheapCredentialsInput
) {
  const envUseSandbox = parseBooleanLike(process.env.NAMECHEAP_SANDBOX);

  return buildNamecheapCredentials({
    apiUser: input.apiUser ?? process.env.NAMECHEAP_API_USER,
    username: input.username ?? process.env.NAMECHEAP_USERNAME,
    apiKey: input.apiKey ?? process.env.NAMECHEAP_API_KEY,
    clientIp: input.clientIp ?? process.env.NAMECHEAP_CLIENT_IP,
    useSandbox: input.useSandbox ?? envUseSandbox ?? false,
  });
}

function buildResolvedCloudflareCredentials(input: CloudflareCredentialsInput) {
  return buildCloudflareCredentials({
    apiToken: input.apiToken ?? process.env.CLOUDFLARE_API_TOKEN,
    zoneId: input.zoneId ?? process.env.CLOUDFLARE_ZONE_ID,
  });
}

function buildResolvedRoute53Config(input: Route53ConfigInput) {
  return buildRoute53Config({
    hostedZoneId: input.hostedZoneId ?? process.env.ROUTE53_HOSTED_ZONE_ID,
  });
}

async function ensureSesDnsInputs(domain: string): Promise<{
  verificationToken: string;
  dkimTokens: string[];
}> {
  const status = await getDomainSetupStatus(domain);
  const verificationToken = status.verificationToken ?? (await verifyDomain(domain));
  if (!verificationToken) {
    throw new Error("SES verification token is missing");
  }

  const dkimTokens =
    status.dkimTokens.length > 0 ? status.dkimTokens : await setupDkim(domain);
  if (dkimTokens.length === 0) {
    throw new Error("SES DKIM tokens are missing");
  }

  return { verificationToken, dkimTokens };
}

async function checkSpf(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(domain);
    return records.some((chunks) => {
      const txt = chunks.join("");
      return txt.startsWith("v=spf1") && txt.includes("amazonses.com");
    });
  } catch {
    return false;
  }
}

async function checkDmarc(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    return records.some((chunks) => chunks.join("").startsWith("v=DMARC1"));
  } catch {
    return false;
  }
}

async function checkUnsubscribePage(websiteUrl: string): Promise<boolean> {
  try {
    const url = new URL("/unsubscribe", websiteUrl).toString();
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);

    const domain = normalizeDomain(req.nextUrl.searchParams.get("domain"));
    if (!domain) {
      return NextResponse.json(
        { error: "domain query parameter is required" },
        { status: 400 }
      );
    }

    const hasAccess = await userCanAccessWorkspace(user.id, domain);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const configSetName = req.nextUrl.searchParams.get("configSet") ?? "";
    const websiteUrl = req.nextUrl.searchParams.get("websiteUrl") ?? "";

    const [status, configSetExists_, spfFound, dmarcFound, unsubscribePageFound] = await Promise.all([
      getDomainSetupStatus(domain),
      configSetName ? configurationSetExists(configSetName) : Promise.resolve(false),
      checkSpf(domain),
      checkDmarc(domain),
      websiteUrl ? checkUnsubscribePage(websiteUrl) : checkUnsubscribePage(`https://${domain}`),
    ]);

    return NextResponse.json({
      verificationToken: status.verificationToken,
      verificationStatus: status.verificationStatus,
      dkimTokens: status.dkimTokens,
      dkimStatus: status.dkimStatus,
      configSetExists: configSetExists_,
      spfFound,
      dmarcFound,
      unsubscribePageFound,
    });
  } catch (err) {
    return apiErrorResponse(err, "Failed to get setup status");
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);

    const body = await req.json();
    const { domain: rawDomain, action, configSet } = body as {
      domain?: string;
      action?: string;
      configSet?: string;
    };
    const domain = normalizeDomain(rawDomain);

    if (!domain) {
      return NextResponse.json(
        { error: "domain is required" },
        { status: 400 }
      );
    }

    const hasAccess = await userCanAccessWorkspace(user.id, domain);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    switch (action) {
      case "verify-domain": {
        const token = await verifyDomain(domain);
        return NextResponse.json({ token });
      }
      case "setup-dkim": {
        const tokens = await setupDkim(domain);
        return NextResponse.json({ dkimTokens: tokens });
      }
      case "create-config-set": {
        if (!configSet) {
          return NextResponse.json(
            { error: "configSet is required for this action" },
            { status: 400 }
          );
        }
        await createConfigurationSet(configSet);
        return NextResponse.json({ ok: true });
      }
      case "configure-namecheap-dns": {
        const namecheapInput = parseNamecheapInput((body as Record<string, unknown>).namecheap);
        const credentials = buildResolvedNamecheapCredentials(namecheapInput);
        const { verificationToken, dkimTokens } = await ensureSesDnsInputs(
          domain
        );

        const result = await configureSesDnsInNamecheap({
          domain,
          verificationToken,
          dkimTokens,
          credentials,
        });

        return NextResponse.json(result);
      }
      case "configure-cloudflare-dns": {
        const cloudflareInput = parseCloudflareInput(
          (body as Record<string, unknown>).cloudflare
        );
        const credentials = buildResolvedCloudflareCredentials(cloudflareInput);
        const { verificationToken, dkimTokens } = await ensureSesDnsInputs(
          domain
        );

        const result = await configureSesDnsInCloudflare({
          domain,
          verificationToken,
          dkimTokens,
          credentials,
        });
        return NextResponse.json(result);
      }
      case "configure-route53-dns": {
        const route53Input = parseRoute53Input(
          (body as Record<string, unknown>).route53
        );
        const config = buildResolvedRoute53Config(route53Input);
        const { verificationToken, dkimTokens } = await ensureSesDnsInputs(
          domain
        );

        const result = await configureSesDnsInRoute53({
          domain,
          verificationToken,
          dkimTokens,
          config,
        });
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return apiErrorResponse(err, "Setup action failed");
  }
}
