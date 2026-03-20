function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeWebsiteUrl(value: string | undefined, workspaceId: string): string {
  const raw = (value ?? "").trim() || `https://${workspaceId}`;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `https://${workspaceId}`;
    }
    return parsed.toString();
  } catch {
    return `https://${workspaceId}`;
  }
}

function appendFooterToHtml(html: string, footer: string): string {
  if (!footer.trim()) return html;
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${footer}</body>`);
  }
  return `${html}${footer}`;
}

function buildSendAgainFooter(): string {
  const sendAgainUrl = "https://send-again.com";
  const escapedSendAgainUrl = escapeHtml(sendAgainUrl);
  const sendAgainLabel = "send-again.com";

  return [
    "<p style=\"margin:12px 0 0 0;font-size:12px;line-height:1.5;color:#6b7280;\">",
    `sent with <a href="${escapedSendAgainUrl}" style="color:#2563eb;">${sendAgainLabel}</a>`,
    "</p>",
  ].join("");
}

export function appendWorkspaceFooter({
  html,
  footerHtml,
  websiteUrl,
  workspaceId,
  unsubscribeUrl,
}: {
  html: string;
  footerHtml: string;
  websiteUrl: string;
  workspaceId: string;
  unsubscribeUrl: string;
}): string {
  const normalizedWebsiteUrl = normalizeWebsiteUrl(websiteUrl, workspaceId);
  const customFooter = (footerHtml ?? "").trim();
  const renderedCustomFooter = customFooter
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, unsubscribeUrl)
    .replace(/\{\{\s*workspace_url\s*\}\}/gi, normalizedWebsiteUrl);

  return appendFooterToHtml(html, `${renderedCustomFooter}${buildSendAgainFooter()}`);
}
