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

function buildDefaultFooter({
  unsubscribeUrl,
  websiteUrl,
}: {
  unsubscribeUrl: string;
  websiteUrl: string;
}): string {
  const escapedUnsubscribeUrl = escapeHtml(unsubscribeUrl);
  const escapedWebsiteUrl = escapeHtml(websiteUrl);

  return [
    "<hr style=\"margin-top:24px;margin-bottom:16px;border:none;border-top:1px solid #e5e7eb;\" />",
    "<p style=\"margin:0;font-size:12px;line-height:1.5;color:#6b7280;\">",
    `Need help? Visit <a href="${escapedWebsiteUrl}" style="color:#2563eb;">our website</a>.`,
    "</p>",
    "<p style=\"margin:8px 0 0 0;font-size:12px;line-height:1.5;color:#6b7280;\">",
    `No longer interested? <a href="${escapedUnsubscribeUrl}" style="color:#2563eb;">Unsubscribe</a>.`,
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

  const hasUnsubscribePlaceholder =
    /\{\{\s*unsubscribe_url\s*\}\}/i.test(customFooter);
  const unsubscribeFallback = `<p style="margin:8px 0 0 0;font-size:12px;line-height:1.5;color:#6b7280;">No longer interested? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#2563eb;">Unsubscribe</a>.</p>`;

  const footer =
    renderedCustomFooter.length > 0
      ? `${renderedCustomFooter}${hasUnsubscribePlaceholder ? "" : unsubscribeFallback}`
      : buildDefaultFooter({
          unsubscribeUrl,
          websiteUrl: normalizedWebsiteUrl,
        });

  return appendFooterToHtml(html, footer);
}
