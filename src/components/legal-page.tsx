import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL_LAST_UPDATED = "March 6, 2026";

export interface LegalSection {
  title: string;
  paragraphs?: ReactNode[];
  bullets?: ReactNode[];
}

interface LegalPageProps {
  title: string;
  summary: ReactNode;
  sections: LegalSection[];
  lastUpdated?: string;
}

export function LegalPage({
  title,
  summary,
  sections,
  lastUpdated = LEGAL_LAST_UPDATED,
}: LegalPageProps) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-gray-900 no-underline"
          >
            Send Again
          </Link>
          <nav className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
            <Link href="/terms-of-use" className="transition hover:text-gray-900">
              Terms of Use
            </Link>
            <Link
              href="/privacy-policy"
              className="transition hover:text-gray-900"
            >
              Privacy Policy
            </Link>
            <Link href="/app" className="transition hover:text-gray-900">
              Open app
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-[linear-gradient(135deg,#ffffff_0%,#f9fafb_60%,#eef2ff_100%)] px-6 py-8 sm:px-10 sm:py-10">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
              Legal
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-950 sm:text-4xl">
              {title}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-600 sm:text-base">
              {summary}
            </p>
            <p className="mt-5 inline-flex rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-500">
              Last updated {lastUpdated}
            </p>
          </div>

          <article className="px-6 py-8 sm:px-10 sm:py-10">
            <div className="grid gap-8">
              {sections.map((section) => (
                <section key={section.title} className="grid gap-4">
                  <h2 className="text-lg font-semibold tracking-tight text-gray-950">
                    {section.title}
                  </h2>
                  {section.paragraphs?.map((paragraph, index) => (
                    <p
                      key={`${section.title}-paragraph-${index + 1}`}
                      className="text-sm leading-7 text-gray-600 sm:text-[15px]"
                    >
                      {paragraph}
                    </p>
                  ))}
                  {section.bullets && section.bullets.length > 0 && (
                    <ul className="grid gap-3 pl-5 text-sm leading-7 text-gray-600 sm:text-[15px]">
                      {section.bullets.map((bullet, index) => (
                        <li key={`${section.title}-bullet-${index + 1}`}>
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>

            <div className="mt-10 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-600">
              Need the companion policy? Review the{" "}
              <Link
                href="/terms-of-use"
                className="font-medium text-gray-900 underline underline-offset-4"
              >
                Terms of Use
              </Link>{" "}
              and{" "}
              <Link
                href="/privacy-policy"
                className="font-medium text-gray-900 underline underline-offset-4"
              >
                Privacy Policy
              </Link>
              .
            </div>
          </article>
        </div>
      </main>
    </div>
  );
}
