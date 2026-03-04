import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Docs | Send Again",
  description: "Developer-oriented API reference for Send Again.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
