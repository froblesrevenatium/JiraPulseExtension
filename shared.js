const DEFAULT_DONE_DAYS = 7;
const MAX_DONE_DAYS = 365;

function doneDaysOrDefault(value) {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= MAX_DONE_DAYS ? days : DEFAULT_DONE_DAYS;
}

const IN_PROGRESS_STATUSES = ["in progress", "en progreso", "en curso"];

function isInProgressStatus(name) {
  return IN_PROGRESS_STATUSES.includes((name ?? "").toLowerCase());
}

function hiddenStatusSet(hiddenStatuses) {
  return new Set((hiddenStatuses ?? []).map((name) => name.toLowerCase()));
}

function isVisibleTask(task, hiddenSet) {
  return !hiddenSet.has((task.status ?? "").toLowerCase());
}

function normalizePending(value) {
  if (Array.isArray(value)) return Object.fromEntries(value.map((key) => [key, null]));
  return value ?? {};
}
