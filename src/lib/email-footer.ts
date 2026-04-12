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
    "<p style=\"margin:14px 0 0 0;font-size:11px;line-height:1.5;color:#9ca3af;text-align:right;\">",
    `sent with <a href="${escapedSendAgainUrl}" style="color:inherit;font-weight:600;text-decoration:underline;">${sendAgainLabel}</a>`,
    "</p>",
  ].join("");
}

export function appendWorkspaceFooter({
  html,
  footerHtml,
  websiteUrl,
  workspaceId,
  unsubscribeUrl,
  includeSendAgainFooter = true,
}: {
  html: string;
  footerHtml: string;
  websiteUrl: string;
  workspaceId: string;
  unsubscribeUrl: string;
  includeSendAgainFooter?: boolean;
}): string {
  const normalizedWebsiteUrl = normalizeWebsiteUrl(websiteUrl, workspaceId);
  const customFooter = (footerHtml ?? "").trim();
  const renderedCustomFooter = customFooter
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, unsubscribeUrl)
    .replace(/\{\{\s*workspace_url\s*\}\}/gi, normalizedWebsiteUrl);

  const sendAgainPart = includeSendAgainFooter ? buildSendAgainFooter() : "";
  return appendFooterToHtml(html, `${renderedCustomFooter}${sendAgainPart}`);
}
