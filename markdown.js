const COMMENTS_PAGE_SIZE = 100;

async function jiraFetch(path, accept = "application/json") {
  const { jiraDomain, jiraEmail, jiraToken } = await chrome.storage.local.get(["jiraDomain", "jiraEmail", "jiraToken"]);
  if (!jiraDomain || !jiraEmail || !jiraToken) throw new Error("Faltan credenciales de Jira");

  const response = await fetch(`https://${jiraDomain}${path}`, {
    headers: {
      "Authorization": `Basic ${btoa(`${jiraEmail}:${jiraToken}`)}`,
      "Accept": accept
    }
  });
  if (!response.ok) throw new Error(`Jira API ${response.status}`);
  return { response, domain: jiraDomain };
}

async function jiraRequest(path) {
  const { response, domain } = await jiraFetch(path);
  return { data: await response.json(), domain };
}

async function fetchAllComments(key) {
  const comments = [];
  let startAt = 0;
  while (true) {
    const { data } = await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(key)}/comment?startAt=${startAt}&maxResults=${COMMENTS_PAGE_SIZE}&orderBy=created`
    );
    const page = data.comments ?? [];
    comments.push(...page);
    startAt += page.length;
    if (page.length === 0 || startAt >= (data.total ?? 0)) return comments;
  }
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "";
}

const defaultMediaRenderer = (attrs) => `_[Adjunto${attrs.alt ? `: ${attrs.alt}` : ""}]_`;
let renderMedia = defaultMediaRenderer;

function applyMarks(text, marks) {
  if (!text) return "";
  let out = marks.some((m) => m.type === "code") ? `\`${text}\`` : text;
  marks.forEach((mark) => {
    if (mark.type === "strong") out = `**${out}**`;
    else if (mark.type === "em") out = `_${out}_`;
    else if (mark.type === "strike") out = `~~${out}~~`;
  });
  const link = marks.find((m) => m.type === "link");
  return link ? `[${out}](${link.attrs?.href ?? ""})` : out;
}

function renderInline(nodes = []) {
  return nodes.map(renderInlineNode).join("");
}

function renderInlineNode(node) {
  switch (node.type) {
    case "text": return applyMarks(node.text, node.marks ?? []);
    case "hardBreak": return "  \n";
    case "mention": return node.attrs?.text ?? "@usuario";
    case "emoji": return node.attrs?.text ?? node.attrs?.shortName ?? "";
    case "inlineCard": return `<${node.attrs?.url ?? ""}>`;
    case "status": return `\`${node.attrs?.text ?? ""}\``;
    case "date": {
      const date = new Date(Number(node.attrs?.timestamp));
      return !node.attrs?.timestamp || Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
    }
    default: return node.content ? renderInline(node.content) : (node.text ?? "");
  }
}

function renderBlocks(nodes = [], separator = "\n\n") {
  return nodes.map(renderBlock).filter((s) => s !== "").join(separator);
}

function renderListItem(item, marker) {
  const body = item.type === "taskItem" ? renderInline(item.content) : renderBlocks(item.content, "\n");
  const pad = " ".repeat(marker.length);
  return marker + body.split("\n").map((line, i) => (i === 0 || line === "" ? line : pad + line)).join("\n");
}

function quote(text) {
  return text.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
}

function renderTableCell(cell) {
  return renderBlocks(cell.content, " ").replace(/\n/g, "<br>").replace(/\|/g, "\\|");
}

function renderTable(node) {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map(renderTableCell));
  if (rows.length === 0) return "";
  const columns = Math.max(...rows.map((r) => r.length));
  const line = (cells) => `| ${Array.from({ length: columns }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [line(rows[0]), line(Array(columns).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

function renderBlock(node) {
  switch (node.type) {
    case "paragraph": return renderInline(node.content);
    case "heading": return `${"#".repeat(node.attrs?.level ?? 1)} ${renderInline(node.content)}`;
    case "bulletList": return (node.content ?? []).map((item) => renderListItem(item, "- ")).join("\n");
    case "orderedList": {
      const start = node.attrs?.order ?? 1;
      return (node.content ?? []).map((item, i) => renderListItem(item, `${start + i}. `)).join("\n");
    }
    case "taskList":
      return (node.content ?? [])
        .map((item) => renderListItem(item, item.attrs?.state === "DONE" ? "- [x] " : "- [ ] "))
        .join("\n");
    case "codeBlock": {
      const code = (node.content ?? []).map((t) => t.text ?? "").join("");
      return `\`\`\`${node.attrs?.language ?? ""}\n${code}\n\`\`\``;
    }
    case "blockquote": return quote(renderBlocks(node.content));
    case "panel": return quote(renderBlocks(node.content));
    case "rule": return "---";
    case "expand":
    case "nestedExpand": return `**${node.attrs?.title ?? ""}**\n\n${renderBlocks(node.content)}`;
    case "mediaSingle":
    case "mediaGroup": return (node.content ?? []).map(renderBlock).join("\n");
    case "media": return renderMedia(node.attrs ?? {});
    case "blockCard":
    case "embedCard": return `<${node.attrs?.url ?? ""}>`;
    case "table": return renderTable(node);
    default: return node.content ? renderBlocks(node.content) : renderInlineNode(node);
  }
}

function adfToMarkdown(doc) {
  if (!doc) return "";
  if (typeof doc === "string") return doc;
  return renderBlocks(doc.content).trim();
}

async function fetchIssue(key) {
  const fields = "summary,status,issuetype,priority,assignee,reporter,created,updated,description,attachment";
  const [{ data: issue, domain }, comments] = await Promise.all([
    jiraRequest(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`),
    fetchAllComments(key)
  ]);
  return { issue, domain, comments };
}

async function issueToMarkdown(key) {
  return buildIssueMarkdown(await fetchIssue(key));
}

function buildIssueMarkdown({ issue, domain, comments }, mediaRenderer = defaultMediaRenderer, extraSections = []) {
  const f = issue.fields;

  const meta = [
    ["Estado", f.status?.name],
    ["Tipo", f.issuetype?.name],
    ["Prioridad", f.priority?.name],
    ["Asignado", f.assignee?.displayName ?? "Sin asignar"],
    ["Reportado por", f.reporter?.displayName],
    ["Creado", formatDate(f.created)],
    ["Actualizado", formatDate(f.updated)],
    ["Enlace", `https://${domain}/browse/${issue.key}`]
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `- **${label}:** ${value}`)
    .join("\n");

  const sections = [`# ${issue.key}: ${f.summary}`, meta];

  renderMedia = mediaRenderer;
  try {
    sections.push("## Descripción", adfToMarkdown(f.description) || "_Sin descripción._");
    sections.push(`## Comentarios (${comments.length})`);
    if (comments.length === 0) sections.push("_Sin comentarios._");
    comments.forEach((c) => {
      sections.push(`### ${c.author?.displayName ?? "Desconocido"} — ${formatDate(c.created)}`);
      sections.push(adfToMarkdown(c.body) || "_Vacío._");
    });
  } finally {
    renderMedia = defaultMediaRenderer;
  }

  return [...sections, ...extraSections].join("\n\n") + "\n";
}
