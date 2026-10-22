const STATUS_PRIORITY = {
  ...Object.fromEntries(IN_PROGRESS_STATUSES.map((status) => [status, 0])),
  "in review": 1,
  "en revisión": 1,
  "to do": 2,
  "por hacer": 2,
  "pendiente": 2,
  "open": 2,
  "abierto": 2,
  "backlog": 3,
};

function statusPriority(name) {
  return STATUS_PRIORITY[name.toLowerCase()] ?? 4;
}

function statusColorClass(name) {
  return statusPriority(name) === 0 ? "status-in-progress" : "status-pending";
}

function groupByStatus(tasks) {
  const groups = {};
  tasks.forEach((task) => {
    const s = task.status || "Sin estado";
    if (!groups[s]) groups[s] = [];
    groups[s].push(task);
  });
  return groups;
}

let currentTasks = [];
let pendingImplementation = {};
let doneDays = DEFAULT_DONE_DAYS;
let hiddenStatuses = [];

function isInProgress(task) {
  return !task.done && isInProgressStatus(task.status);
}

function setPendingImplementation(key, pending) {
  const next = { ...pendingImplementation };
  if (pending) next[key] = new Date().toISOString();
  else delete next[key];
  chrome.storage.local.set({ pendingImplementation: next });
}

function formatDay(value) {
  return new Date(value).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDayTime(value) {
  return new Date(value).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function renderError(error) {
  const banner = document.getElementById("error");
  banner.hidden = !error;
  banner.textContent = error ? `${error.message} (${formatDayTime(error.at)})` : "";
}

function createActionButton(label, title, action) {
  const button = document.createElement("button");
  button.className = "md-button";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "…";
    try {
      button.title = await action();
      button.textContent = "✓";
    } catch (e) {
      console.error(`${label} error:`, e);
      button.textContent = "✗";
      button.title = e.message;
    }
    setTimeout(() => {
      button.disabled = false;
      button.textContent = label;
      button.title = title;
    }, 2500);
  });
  return button;
}

function createMarkdownButton(key) {
  return createActionButton("MD", "Copiar ticket y comentarios como Markdown", async () => {
    await navigator.clipboard.writeText(await issueToMarkdown(key));
    return "Copiado al portapapeles";
  });
}

function createExportButton(key) {
  return createActionButton("⬇", "Descargar ticket con adjuntos en Descargas/jira", async () => {
    const result = await chrome.runtime.sendMessage({ action: "exportIssue", key });
    if (!result?.ok) throw new Error(result?.error ?? "Error al exportar");
    const skipped = result.skipped ? `, ${result.skipped} sin descargar` : "";
    return `Guardado en ${result.folder} (${result.downloaded} adjuntos${skipped})`;
  });
}

function renderHiddenNote(count) {
  const note = document.getElementById("hidden-note");
  note.hidden = count === 0;
  document.getElementById("hidden-count").textContent =
    count === 1 ? "1 tarea oculta por estatus" : `${count} tareas ocultas por estatus`;
}

function renderTasks(allTasks) {
  currentTasks = allTasks || [];
  const hiddenSet = hiddenStatusSet(hiddenStatuses);
  const tasks = currentTasks.filter((t) => isVisibleTask(t, hiddenSet));
  const list = document.getElementById("task-list");
  const empty = document.getElementById("empty");

  list.innerHTML = "";
  renderHiddenNote(currentTasks.length - tasks.length);

  if (tasks.length === 0) {
    empty.textContent = currentTasks.length > 0 ? "Todas las tareas están ocultas por estatus." : "Sin tareas abiertas.";
    empty.hidden = false;
    return;
  }

  empty.hidden = true;

  const pendingKeys = new Set(Object.keys(pendingImplementation));
  const isPending = (t) => isInProgress(t) && pendingKeys.has(t.key);
  const openTasks = tasks.filter((t) => !t.done && !isPending(t));
  const pendingTasks = tasks.filter(isPending);
  const doneTasks = tasks.filter((t) => t.done);

  const appendTaskItem = (task, colorClass, date) => {
    const { key, summary, url } = task;
    const li = document.createElement("li");

    if (isInProgress(task)) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "pending-toggle";
      checkbox.checked = pendingKeys.has(key);
      checkbox.title = checkbox.checked ? "Regresar a En curso" : "Mover a Por implementar";
      checkbox.addEventListener("change", () => setPendingImplementation(key, checkbox.checked));
      li.appendChild(checkbox);
    }

    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    const keySpan = document.createElement("span");
    keySpan.className = `key ${colorClass}`;
    keySpan.textContent = key;

    const summarySpan = document.createElement("span");
    summarySpan.className = "summary";
    summarySpan.textContent = summary;

    a.appendChild(keySpan);
    a.appendChild(summarySpan);

    if (date) {
      const dateSpan = document.createElement("span");
      dateSpan.className = "resolution-date";
      dateSpan.textContent = date.text;
      dateSpan.title = date.title;
      a.appendChild(dateSpan);
    }

    li.appendChild(a);
    li.appendChild(createMarkdownButton(key));
    li.appendChild(createExportButton(key));
    list.appendChild(li);
  };

  const groups = groupByStatus(openTasks);
  const sortedStatuses = Object.keys(groups).sort(
    (a, b) => statusPriority(a) - statusPriority(b)
  );

  sortedStatuses.forEach((status) => {
    const header = document.createElement("li");
    header.className = "status-header";
    header.textContent = status;
    list.appendChild(header);

    const colorClass = statusColorClass(status);
    groups[status].forEach((task) => appendTaskItem(task, colorClass));
  });

  if (pendingTasks.length > 0) {
    const header = document.createElement("li");
    header.className = "status-header";
    header.textContent = "Por implementar";
    list.appendChild(header);

    pendingTasks
      .slice()
      .sort((a, b) => new Date(pendingImplementation[b.key] ?? 0) - new Date(pendingImplementation[a.key] ?? 0))
      .forEach((task) => {
        const since = pendingImplementation[task.key];
        const date = since && { text: formatDayTime(since), title: `Enviada a Por implementar el ${formatDayTime(since)}` };
        appendTaskItem(task, "status-pending-implementation", date);
      });
  }

  if (doneTasks.length > 0) {
    const header = document.createElement("li");
    header.className = "status-header";
    header.textContent = `Finalizadas (${doneDays === 1 ? "último día" : `últimos ${doneDays} días`})`;
    list.appendChild(header);

    doneTasks
      .slice()
      .sort((a, b) => new Date(b.resolutionDate) - new Date(a.resolutionDate))
      .forEach((task) => {
        const date = task.resolutionDate && { text: formatDay(task.resolutionDate), title: `Finalizada el ${formatDayTime(task.resolutionDate)}` };
        appendTaskItem(task, "status-done", date);
      });
  }
}

// Mostrar datos en caché inmediatamente
chrome.storage.local.get(["jiraTasks", "pendingImplementation", "jiraError", "doneDays", "hiddenStatuses"], (data) => {
  doneDays = doneDaysOrDefault(data.doneDays);
  hiddenStatuses = data.hiddenStatuses ?? [];
  pendingImplementation = normalizePending(data.pendingImplementation);
  renderError(data.jiraError);
  renderTasks(data.jiraTasks);
});

// Solicitar refresco al background
chrome.runtime.sendMessage({ action: "refresh" });

// Actualizar lista cuando el background guarde nuevos datos
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.jiraError) renderError(changes.jiraError.newValue);
  if (changes.pendingImplementation) {
    pendingImplementation = normalizePending(changes.pendingImplementation.newValue);
  }
  if (changes.doneDays) doneDays = doneDaysOrDefault(changes.doneDays.newValue);
  if (changes.hiddenStatuses) hiddenStatuses = changes.hiddenStatuses.newValue ?? [];
  if (changes.jiraTasks || changes.pendingImplementation || changes.doneDays || changes.hiddenStatuses) {
    renderTasks(changes.jiraTasks ? changes.jiraTasks.newValue : currentTasks);
  }
});

document.getElementById("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
