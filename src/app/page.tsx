import Link from "next/link";

const features = [
  {
    title: "High Deliverability",
    description:
      "Powered by Amazon SES with automatic bounce and complaint handling. SPF, DKIM, and domain verification built in.",
    icon: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z",
  },
  {
    title: "REST API",
    description:
      "Send emails, manage contacts, and track delivery programmatically. Built for developers and AI agents.",
    icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
  },
  {
    title: "Transparent Pricing",
    description:
      "Generous free tier to get started. Simple, predictable pricing when you scale — no hidden fees.",
    icon: "M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z",
  },
  {
    title: "Open Source",
    description:
      "Fully open source. Self-host it, audit the code, or contribute. No vendor lock-in.",
    icon: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5",
  },
];

async function getGitHubStars(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/guillaumegay13/send-again",
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null;
  } catch {
    return null;
  }
}

export default async function LandingPage() {
  const stars = await getGitHubStars();
  return (
    <div
      style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}
    >
      {/* Header */}
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <div
          style={{
            maxWidth: "64rem",
            margin: "0 auto",
            padding: "0.75rem 1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "0.875rem", letterSpacing: "-0.01em" }}>
            Send Again
          </span>
          <nav style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            <Link
              href="/docs"
              style={{
                fontSize: "0.875rem",
                color: "var(--text-muted)",
                textDecoration: "none",
              }}
            >
              API Docs
            </Link>
            <a
              href="https://github.com/guillaumegay13/send-again"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                fontSize: "0.875rem",
                color: "var(--text-muted)",
                textDecoration: "none",
              }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                style={{ width: "1rem", height: "1rem" }}
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              {stars !== null && (
                <span
                  style={{
                    background: "var(--background)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-tight)",
                    padding: "0.125rem 0.375rem",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                  }}
                >
                  {stars}
                </span>
              )}
            </a>
            <Link
              href="/app"
              style={{
                fontSize: "0.875rem",
                color: "var(--text-muted)",
                textDecoration: "none",
              }}
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section
        style={{
          padding: "5rem 1.5rem 4rem",
          textAlign: "center",
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ maxWidth: "40rem", margin: "0 auto" }}>
          <h1
            style={{
              fontSize: "2.5rem",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              lineHeight: 1.1,
              margin: "0 0 1rem",
            }}
          >
            The open source
            <br />
            email platform
          </h1>
          <p
            style={{
              fontSize: "1.125rem",
              color: "var(--text-muted)",
              margin: "0 0 2rem",
              lineHeight: 1.5,
            }}
          >
            Send campaigns, manage contacts, and track delivery.
            High deliverability via Amazon SES, a REST API for automation,
            and transparent pricing. Fully open source.
          </p>
          <Link
            href="/app"
            style={{
              display: "inline-block",
              background: "var(--foreground)",
              color: "var(--surface)",
              padding: "0.625rem 1.5rem",
              borderRadius: "var(--radius-tight)",
              fontSize: "0.875rem",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Get started
          </Link>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: "4rem 1.5rem" }}>
        <div style={{ maxWidth: "64rem", margin: "0 auto" }}>
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              textAlign: "center",
              margin: "0 0 2.5rem",
              letterSpacing: "-0.01em",
            }}
          >
            Everything you need to send emails
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
              gap: "1.5rem",
            }}
          >
            {features.map((f) => (
              <div
                key={f.title}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-tight)",
                  padding: "1.5rem",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  style={{
                    width: "1.5rem",
                    height: "1.5rem",
                    color: "var(--text-muted)",
                    marginBottom: "0.75rem",
                  }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={f.icon}
                  />
                </svg>
                <h3
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    margin: "0 0 0.5rem",
                  }}
                >
                  {f.title}
                </h3>
                <p
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--text-muted)",
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section
        style={{
          padding: "4rem 1.5rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div style={{ maxWidth: "40rem", margin: "0 auto" }}>
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              textAlign: "center",
              margin: "0 0 2.5rem",
              letterSpacing: "-0.01em",
            }}
          >
            Simple pricing
          </h2>
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-tight)",
              padding: "1.5rem 2rem",
              maxWidth: "24rem",
              margin: "0 auto",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: "2rem", fontWeight: 700, margin: "0", letterSpacing: "-0.025em" }}>
              1,000
              <span style={{ fontSize: "0.875rem", fontWeight: 400, color: "var(--text-muted)" }}>
                {" "}free credits
              </span>
            </p>
            <p
              style={{
                fontSize: "0.8125rem",
                color: "var(--text-muted)",
                margin: "0.75rem 0 0",
                lineHeight: 1.6,
              }}
            >
              Then buy credit packs as you go. No subscriptions, no monthly fees.
            </p>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section
        style={{
          padding: "4rem 1.5rem",
          textAlign: "center",
          borderTop: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <h2
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            margin: "0 0 0.75rem",
            letterSpacing: "-0.025em",
          }}
        >
          Ready to send?
        </h2>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: "0.9375rem",
            margin: "0 0 1.5rem",
          }}
        >
          Start for free — no credit card required.
        </p>
        <Link
          href="/app"
          style={{
            display: "inline-block",
            background: "var(--foreground)",
            color: "var(--surface)",
            padding: "0.625rem 1.5rem",
            borderRadius: "var(--radius-tight)",
            fontSize: "0.875rem",
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Get started
        </Link>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "1.5rem",
          textAlign: "center",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
        }}
      >
        <p style={{ margin: 0 }}>
          &copy; {new Date().getFullYear()} Send Again. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
