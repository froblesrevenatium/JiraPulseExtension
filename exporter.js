const EXPORT_ROOT = "jira";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function planAttachments(attachments) {
  const usedNames = new Set();
  return attachments.map((attachment) => {
    const base = attachment.filename.replace(/[^\w.\-]/g, "_");
    const name = usedNames.has(base) ? `${attachment.id}-${base}` : base;
    usedNames.add(name);
    return {
      attachment,
      path: `attachments/${name}`,
      isImage: attachment.mimeType?.startsWith("image/") ?? false,
      downloadable: attachment.size <= MAX_ATTACHMENT_BYTES
    };
  });
}

function attachmentLink(entry, domain) {
  const { attachment, path, isImage, downloadable } = entry;
  if (!downloadable) {
    return `[${attachment.filename} (no descargado, ${formatSize(attachment.size)})](https://${domain}/rest/api/3/attachment/content/${attachment.id})`;
  }
  return isImage ? `![${attachment.filename}](${path})` : `[${attachment.filename}](${path})`;
}

function download(url, filename) {
  return chrome.downloads.download({ url, filename, conflictAction: "overwrite", saveAs: false });
}

async function downloadAttachment(entry, folder) {
  const { response } = await jiraFetch(
    `/rest/api/3/attachment/content/${entry.attachment.id}?redirect=false`,
    entry.attachment.mimeType || "*/*"
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mime = entry.attachment.mimeType || "application/octet-stream";
  await download(`data:${mime};base64,${toBase64(bytes)}`, `${folder}/${entry.path}`);
}

async function exportIssue(key) {
  const data = await fetchIssue(key);
  const folder = `${EXPORT_ROOT}/${data.issue.key}`;
  const entries = planAttachments(data.issue.fields.attachment ?? []);
  const byFilename = new Map();
  entries.forEach((e) => byFilename.set(e.attachment.filename, [...(byFilename.get(e.attachment.filename) ?? []), e]));

  const failed = new Set();
  let downloaded = 0;
  for (const entry of entries.filter((e) => e.downloadable)) {
    try {
      await downloadAttachment(entry, folder);
      downloaded++;
    } catch (e) {
      console.error(`Attachment ${entry.attachment.filename} error:`, e);
      failed.add(entry);
      entry.downloadable = false;
    }
  }

  const mediaRenderer = (attrs) => {
    const matches = byFilename.get(attrs.alt) ?? [];
    if (matches.length === 0) return defaultMediaRenderer(attrs);
    if (matches.length === 1) return attachmentLink(matches[0], data.domain);
    const candidates = matches.map((e) => `[${e.path}](${e.downloadable ? e.path : `https://${data.domain}/rest/api/3/attachment/content/${e.attachment.id}`})`);
    return `_[Adjunto: ${attrs.alt} — hay ${matches.length} archivos con este nombre: ${candidates.join(", ")}]_`;
  };

  const attachmentsSection = entries.length === 0 ? [] : [
    `## Adjuntos (${entries.length})`,
    entries.map((e) => `- ${attachmentLink(e, data.domain)}${failed.has(e) ? " — error al descargar" : ""}`).join("\n")
  ];

  const markdown = buildIssueMarkdown(data, mediaRenderer, attachmentsSection);
  await download(
    `data:text/markdown;charset=utf-8;base64,${toBase64(new TextEncoder().encode(markdown))}`,
    `${folder}/${data.issue.key}.md`
  );

  return { folder, downloaded, skipped: entries.length - downloaded };
}
