const form = document.getElementById("options-form");
const status = document.getElementById("status");

chrome.storage.local.get(["jiraDomain", "jiraEmail", "jiraToken", "doneDays"], (data) => {
  document.getElementById("done-days").value = doneDaysOrDefault(data.doneDays);
  if (data.jiraDomain) document.getElementById("domain").value = data.jiraDomain;
  if (data.jiraEmail)  document.getElementById("email").value  = data.jiraEmail;
  if (data.jiraToken)  document.getElementById("token").value  = data.jiraToken;
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const domain = document.getElementById("domain").value.trim();
  const email  = document.getElementById("email").value.trim();
  const token  = document.getElementById("token").value.trim();
  const doneDaysInput = document.getElementById("done-days").value.trim();

  if (!domain || !email || !token) {
    status.style.color = "#de350b";
    status.textContent = "Completa todos los campos.";
    return;
  }

  const doneDays = Number(doneDaysInput);
  if (doneDaysOrDefault(doneDays) !== doneDays) {
    status.style.color = "#de350b";
    status.textContent = `Los días de finalizadas deben ser un número entero entre 1 y ${MAX_DONE_DAYS}.`;
    return;
  }

  chrome.storage.local.set({ jiraDomain: domain, jiraEmail: email, jiraToken: token, doneDays }, () => {
    status.style.color = "#36b37e";
    status.textContent = "Guardado correctamente.";
    setTimeout(() => { status.textContent = ""; }, 2500);

    // Forzar actualización inmediata tras guardar
    chrome.runtime.sendMessage({ action: "refresh" });
  });
});

function statusOptions(tasks, hiddenStatuses) {
  const counts = new Map();
  tasks.forEach((task) => {
    const name = task.status || "Sin estado";
    const key = name.toLowerCase();
    const entry = counts.get(key) ?? { name, count: 0 };
    entry.count++;
    counts.set(key, entry);
  });
  hiddenStatuses.forEach((name) => {
    if (!counts.has(name.toLowerCase())) counts.set(name.toLowerCase(), { name, count: 0 });
  });
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function renderStatusList(tasks = [], hiddenStatuses = []) {
  const list = document.getElementById("status-list");
  const options = statusOptions(tasks, hiddenStatuses);
  const hiddenSet = hiddenStatusSet(hiddenStatuses);

  list.innerHTML = "";
  document.getElementById("status-empty").hidden = options.length > 0;

  options.forEach(({ name, count }) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = name;
    checkbox.checked = !hiddenSet.has(name.toLowerCase());
    checkbox.addEventListener("change", saveHiddenStatuses);

    const text = document.createElement("span");
    text.textContent = name;

    const countSpan = document.createElement("span");
    countSpan.className = "status-count";
    countSpan.textContent = count === 0 ? "sin tareas actualmente" : count === 1 ? "1 tarea" : `${count} tareas`;

    label.append(checkbox, text, countSpan);
    list.appendChild(label);
  });
}

function saveHiddenStatuses() {
  const hiddenStatuses = [...document.querySelectorAll("#status-list input:not(:checked)")].map((input) => input.value);
  chrome.storage.local.set({ hiddenStatuses });
}

chrome.storage.local.get(["jiraTasks", "hiddenStatuses"], (data) => {
  renderStatusList(data.jiraTasks, data.hiddenStatuses);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(changes.jiraTasks || changes.hiddenStatuses)) return;
  chrome.storage.local.get(["jiraTasks", "hiddenStatuses"], (data) => {
    renderStatusList(data.jiraTasks, data.hiddenStatuses);
  });
});
