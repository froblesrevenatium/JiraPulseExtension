importScripts("shared.js", "markdown.js", "exporter.js");

const SUPPORT_STATUS = "con soporte";

function buildJql(doneDays) {
  return (
    `(assignee = currentUser() AND (resolution = Unresolved OR resolutiondate >= -${doneDays}d)) ` +
    `OR (status = "Con Soporte" AND assignee was currentUser() AND updated >= -${doneDays}d)`
  );
}
const PAGE_SIZE = 50;
const FIELDS = "summary,key,status,resolution,resolutiondate,updated";
const ERROR_COLOR = "#de350b";

class JiraError extends Error {}

function describeHttpError(status) {
  if (status === 401) return "Jira rechazó las credenciales (HTTP 401). Revisa el email y el API token en Opciones.";
  if (status === 403) return "Jira negó el acceso (HTTP 403). Revisa los permisos del token.";
  if (status === 404) return "No se encontró la API de Jira (HTTP 404). Revisa el dominio en Opciones.";
  if (status === 429) return "Jira limitó las solicitudes (HTTP 429). Se reintentará en el próximo ciclo.";
  return `Jira respondió con error (HTTP ${status}).`;
}

async function fetchAllIssues(jiraDomain, credentials, jql) {
  const issues = [];
  let nextPageToken;
  do {
    const tokenParam = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
    const url = `https://${jiraDomain}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${PAGE_SIZE}&fields=${FIELDS}${tokenParam}`;

    let response;
    try {
      response = await fetch(url, {
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Accept": "application/json"
        }
      });
    } catch (e) {
      console.error("Jira fetch error:", e);
      throw new JiraError(`No se pudo conectar con ${jiraDomain}. Revisa tu conexión o el dominio.`);
    }

    if (!response.ok) {
      console.error("Jira API error:", response.status, await response.text());
      throw new JiraError(describeHttpError(response.status));
    }

    const data = await response.json();
    issues.push(...(data.issues ?? []));
    nextPageToken = data.isLast ? undefined : data.nextPageToken;
  } while (nextPageToken);
  return issues;
}

function showError(message) {
  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: ERROR_COLOR });
  chrome.storage.local.set({ jiraError: { message, at: new Date().toISOString() } });
}

async function fetchJiraTasks() {
  const { jiraDomain, jiraEmail, jiraToken, doneDays } = await chrome.storage.local.get(["jiraDomain", "jiraEmail", "jiraToken", "doneDays"]);

  if (!jiraDomain || !jiraEmail || !jiraToken) {
    showError("Configura el dominio, email y API token en Opciones.");
    return;
  }

  let issues;
  try {
    issues = await fetchAllIssues(jiraDomain, btoa(`${jiraEmail}:${jiraToken}`), buildJql(doneDaysOrDefault(doneDays)));
  } catch (e) {
    showError(e instanceof JiraError ? e.message : `Error inesperado: ${e.message}`);
    return;
  }

  const tasks = issues.map((issue) => {
    const statusName = issue.fields.status?.name ?? "Sin estado";
    const isSupportHandoff = statusName.toLowerCase() === SUPPORT_STATUS;

    return {
      key: issue.key,
      summary: issue.fields.summary,
      url: `https://${jiraDomain}/browse/${issue.key}`,
      status: statusName,
      done: issue.fields.resolution != null || isSupportHandoff,
      resolutionDate: issue.fields.resolutiondate ?? (isSupportHandoff ? issue.fields.updated : null) ?? null
    };
  });

  const stored = await chrome.storage.local.get("pendingImplementation");
  const pendingImplementation = normalizePending(stored.pendingImplementation);
  const inProgressKeys = new Set(
    tasks.filter((t) => !t.done && isInProgressStatus(t.status)).map((t) => t.key)
  );
  const validPending = Object.fromEntries(
    Object.entries(pendingImplementation).filter(([key]) => inProgressKeys.has(key))
  );

  await chrome.storage.local.remove("jiraError");
  await chrome.storage.local.set({ jiraTasks: tasks, pendingImplementation: validPending });
  await updateBadge();
}

async function updateBadge() {
  const { jiraTasks = [], pendingImplementation, hiddenStatuses, jiraError } = await chrome.storage.local.get(
    ["jiraTasks", "pendingImplementation", "hiddenStatuses", "jiraError"]
  );
  if (jiraError) return;
  const pending = normalizePending(pendingImplementation);
  const hiddenSet = hiddenStatusSet(hiddenStatuses);
  const openCount = jiraTasks.filter((t) => !t.done && !(t.key in pending) && isVisibleTask(t, hiddenSet)).length;
  chrome.action.setBadgeText({ text: openCount > 0 ? String(openCount) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#0052CC" });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(changes.pendingImplementation || changes.hiddenStatuses)) return;
  updateBadge();
});

chrome.alarms.get("jiraRefresh").then((alarm) => {
  if (!alarm) chrome.alarms.create("jiraRefresh", { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "jiraRefresh") fetchJiraTasks();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "refresh") fetchJiraTasks();
  if (msg.action === "exportIssue") {
    exportIssue(msg.key).then(
      (result) => sendResponse({ ok: true, ...result }),
      (e) => sendResponse({ ok: false, error: e.message })
    );
    return true;
  }
});

fetchJiraTasks();
