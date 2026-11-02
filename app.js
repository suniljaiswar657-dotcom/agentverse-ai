(() => {
  const storageKey = "agentverse-ai-task-queue-v1";
  const form = document.getElementById("taskForm");
  const input = document.getElementById("taskInput");
  const list = document.getElementById("taskList");
  const count = document.getElementById("openCount");
  const menu = document.getElementById("sidebar");
  const menuToggle = document.getElementById("menuToggle");

  let tasks = [];
  try { tasks = JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { tasks = []; }
  if (!Array.isArray(tasks)) tasks = [];

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(tasks)); } catch {}
  }

  function render() {
    const open = tasks.filter(task => !task.done).length;
    count.textContent = String(open).padStart(2, "0");
    list.replaceChildren();
    if (!tasks.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const symbol = document.createElement("span"); symbol.textContent = "▤";
      const title = document.createElement("strong"); title.textContent = "Your queue is clear";
      const note = document.createElement("small"); note.textContent = "Add a task to organise your next piece of work.";
      empty.append(symbol, title, note); list.append(empty); return;
    }
    tasks.forEach(task => {
      const row = document.createElement("div"); row.className = "task-item" + (task.done ? " done" : "");
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = Boolean(task.done); checkbox.setAttribute("aria-label", "Mark task complete");
      checkbox.addEventListener("change", () => { task.done = checkbox.checked; save(); render(); });
      const label = document.createElement("span"); label.textContent = task.text;
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", "Remove task");
      remove.addEventListener("click", () => { tasks = tasks.filter(item => item.id !== task.id); save(); render(); });
      row.append(checkbox, label, remove); list.append(row);
    });
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    tasks.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text, done: false });
    save(); render(); input.value = ""; input.focus();
  });

  menuToggle.addEventListener("click", () => menu.classList.toggle("open"));
  document.querySelectorAll(".nav-link").forEach(link => link.addEventListener("click", () => menu.classList.remove("open")));
  document.getElementById("viewAgents").addEventListener("click", () => document.getElementById("agents").scrollIntoView({ behavior: "smooth" }));
  render();
})();