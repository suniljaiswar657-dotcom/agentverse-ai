(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const list = $("historyList");
  const status = $("historyStatus");
  const exportButton = $("exportHistoryBackup");
  const importButton = $("importHistoryBackup");
  const fileInput = $("historyBackupFile");
  if (!list || !status || !exportButton || !importButton || !fileInput) return;

  const KEY = "agentverse-ai-history-v1";
  const PLAN_KEY = "agentverse-ai-engine-v2";
  const LIMIT = 100;
  let records = [];

  function readRecords() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter(validRecord).slice(0, LIMIT) : [];
    } catch { return []; }
  }

  function validRecord(item) {
    return Boolean(item && typeof item.id === "string" &&
      typeof item.at === "string" && !Number.isNaN(Date.parse(item.at)) &&
      typeof item.event === "string" && typeof item.title === "string");
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(records.slice(0, LIMIT)));
      status.textContent = "SAVED LOCALLY";
      return true;
    } catch {
      status.textContent = "STORAGE FULL — EXPORT BACKUP";
      return false;
    }
  }

  function render() {
    list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "No history yet. Generate or approve a plan to create the first record.";
      list.append(empty);
      return;
    }
    records.slice(0, 10).forEach(item => {
      const row = document.createElement("div");
      row.className = "history-row";
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.title;
      const meta = document.createElement("small");
      meta.textContent = item.event.replace(/_/g, " ").toUpperCase() + " · " + new Date(item.at).toLocaleString();
      details.append(title, meta);
      const tag = document.createElement("span");
      tag.className = "history-event";
      tag.textContent = item.event.replace(/_/g, " ");
      row.append(details, tag);
      list.append(row);
    });
  }

  function add(event, title, planId) {
    const duplicate = records.some(item => item.event === event && item.planId === planId);
    if (duplicate) return;
    records.unshift({
      id: "hist-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      at: new Date().toISOString(),
      event,
      title: String(title || "AGENTVERSE AI activity").slice(0, 180),
      planId: String(planId || "")
    });
    records = records.slice(0, LIMIT);
    persist();
    render();
  }

  function readPlan() {
    try { return JSON.parse(localStorage.getItem(PLAN_KEY) || "null"); }
    catch { return null; }
  }

  let trackedPlanId = "";
  let trackedState = "";
  const initial = readPlan();
  if (initial && initial.plan && initial.plan.id) {
    trackedPlanId = String(initial.plan.id);
    trackedState = initial.pending ? "pending" : initial.approvedAt ? "approved" : "unknown";
  }

  function inspectPlanStatus() {
    const saved = readPlan();
    if (saved && saved.plan && saved.plan.id) {
      const id = String(saved.plan.id);
      const nextState = saved.pending ? "pending" : saved.approvedAt ? "approved" : "unknown";
      const title = String(saved.plan.summary || saved.plan.mission || "AI plan");
      if (id !== trackedPlanId) {
        trackedPlanId = id;
        trackedState = nextState;
        add("plan_generated", title, id);
      } else if (nextState === "approved" && trackedState !== "approved") {
        trackedState = "approved";
        add("plan_approved", title, id);
      } else if (nextState === "pending") {
        trackedState = "pending";
      }
      return;
    }
    if (trackedPlanId) {
      add("plan_discarded", "Plan discarded or cleared", trackedPlanId);
      trackedPlanId = "";
      trackedState = "";
    }
  }

  const planStatus = $("planStatus");
  if (planStatus && "MutationObserver" in window) {
    new MutationObserver(inspectPlanStatus).observe(planStatus, { childList: true, characterData: true, subtree: true });
  }
  const executionStatus = $("executionStatus");
  if (executionStatus && "MutationObserver" in window) {
    new MutationObserver(() => {
      const value = executionStatus.textContent.trim();
      if (value === "COMPLETED") add("playbook_exported", "Approved playbook exported locally", trackedPlanId);
      if (value === "FAILED") add("export_failed", "Local playbook export failed", trackedPlanId);
    }).observe(executionStatus, { childList: true, characterData: true, subtree: true });
  }

  exportButton.addEventListener("click", () => {
    const backup = {
      app: "AGENTVERSE AI",
      type: "execution-history-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      records
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agentverse-history-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    status.textContent = "BACKUP EXPORTED";
  });

  importButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("Backup file is too large. Maximum size is 1 MB.");
      const backup = JSON.parse(await file.text());
      if (!backup || backup.app !== "AGENTVERSE AI" || backup.type !== "execution-history-backup" ||
          backup.version !== 1 || !Array.isArray(backup.records)) {
        throw new Error("This is not a supported AGENTVERSE AI history backup.");
      }
      const imported = backup.records.filter(validRecord).slice(0, LIMIT);
      const byId = new Map(records.map(item => [item.id, item]));
      imported.forEach(item => byId.set(item.id, {
        id: item.id,
        at: item.at,
        event: item.event.slice(0, 50),
        title: item.title.slice(0, 180),
        planId: String(item.planId || "").slice(0, 80)
      }));
      records = Array.from(byId.values()).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, LIMIT);
      if (!persist()) throw new Error("Browser storage could not save the restored history. Export your current backup and free device storage.");
      render();
      status.textContent = "HISTORY RESTORED";
    } catch (error) {
      status.textContent = error && error.message ? error.message : "RESTORE FAILED";
    } finally {
      fileInput.value = "";
    }
  });

  records = readRecords();
  render();
  status.textContent = "SAVED LOCALLY";
})();