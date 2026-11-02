(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const input = $("missionInput");
  const select = $("agentSelect");
  const button = $("planMission");
  const output = $("planOutput");
  const status = $("planStatus");
  const actions = $("approvalActions");
  const approvalCount = $("approvalCount");
  const notice = $("engineNotice");
  if (!input || !select || !button || !output) return;

  const STORAGE_KEY = "agentverse-ai-engine-v2";
  const specialists = {
    ceo: "AI CEO", developer: "AI Developer", researcher: "AI Researcher",
    marketer: "AI Marketer", business: "AI Business",
    automation: "AI Automation", security: "AI Security"
  };
  let currentPlan = null;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}; } catch { saved = {}; }

  function chooseAgent(text) {
    const t = text.toLowerCase();
    const rules = [
      ["security", /security|secure|privacy|permission|risk|threat|protect|vulnerability|safety/],
      ["developer", /code|website|web app|app|bug|debug|api|build|program|software|html|css|javascript|python/],
      ["automation", /automate|automation|workflow|repeat|integration|schedule|process/],
      ["marketer", /marketing|instagram|reel|content|caption|hashtag|campaign|brand|social media|audience/],
      ["business", /business|profit|revenue|cost|invoice|sales|customer|operation|pricing/],
      ["researcher", /research|compare|find|investigate|analyse|analyze|study|report|information/],
      ["ceo", /strategy|plan|roadmap|priority|decision|launch|goal|mission/]
    ];
    for (const [key, pattern] of rules) if (pattern.test(t)) return key;
    return "ceo";
  }

  function updateApprovalCount() {
    approvalCount.textContent = saved.pending ? "01" : "00";
  }

  function appendText(parent, tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    parent.append(node);
    return node;
  }

  function showPlan(plan, pending) {
    output.replaceChildren();
    const summary = document.createElement("div");
    summary.className = "plan-summary";
    appendText(summary, "span", "plan-badge", "LIVE AI · " + (specialists[plan.agentKey] || "SPECIALIST").toUpperCase());
    appendText(summary, "strong", "", plan.summary || plan.mission);
    appendText(summary, "small", "", "Provider: " + (plan.provider || "Google Gemini") + " · Model: " + (plan.model || "gemini-3.8-flash"));
    output.append(summary);

    const heading = document.createElement("div");
    heading.className = "field-label";
    heading.textContent = "RECOMMENDED WORKFLOW";
    output.append(heading);
    const list = document.createElement("ol");
    list.className = "plan-steps";
    (plan.steps || []).forEach((step, index) => {
      const item = document.createElement("li");
      const number = document.createElement("span");
      number.textContent = String(index + 1).padStart(2, "0");
      const text = document.createElement("div");
      text.textContent = step;
      item.append(number, text);
      list.append(item);
    });
    output.append(list);

    if (plan.deliverable) {
      const deliverable = document.createElement("div");
      deliverable.className = "plan-summary plan-extra";
      appendText(deliverable, "span", "plan-badge", "EXPECTED DELIVERABLE");
      appendText(deliverable, "strong", "", plan.deliverable);
      output.append(deliverable);
    }
    if (plan.risks && plan.risks.length) {
      const risks = document.createElement("div");
      risks.className = "plan-extra";
      appendText(risks, "div", "field-label", "RISKS TO REVIEW");
      const riskList = document.createElement("ul");
      riskList.className = "plan-bullets";
      plan.risks.forEach(risk => appendText(riskList, "li", "", risk));
      risks.append(riskList);
      output.append(risks);
    }
    if (plan.needsHumanApproval && plan.needsHumanApproval.length) {
      const approvals = document.createElement("div");
      approvals.className = "plan-extra";
      appendText(approvals, "div", "field-label", "HUMAN APPROVAL REQUIRED");
      const approvalList = document.createElement("ul");
      approvalList.className = "plan-bullets";
      plan.needsHumanApproval.forEach(item => appendText(approvalList, "li", "", item));
      approvals.append(approvalList);
      output.append(approvals);
    }

    status.textContent = pending ? "AWAITING REVIEW" : "APPROVED LOCALLY";
    actions.hidden = !pending;
    notice.textContent = pending
      ? "AI-generated plan ready. Review it carefully. Approval saves your decision locally; it does not execute external tools."
      : "Your approval decision is stored in this browser. No external action has been performed.";
  }

  function showError(message) {
    output.replaceChildren();
    const box = document.createElement("div");
    box.className = "safety-note";
    appendText(box, "span", "", "ⓘ");
    const p = document.createElement("p");
    p.textContent = message;
    box.append(p);
    output.append(box);
    status.textContent = "AI UNAVAILABLE";
    actions.hidden = true;
  }

  button.addEventListener("click", async () => {
    const mission = input.value.trim();
    if (!mission) {
      input.focus();
      input.setCustomValidity("Enter a mission first.");
      input.reportValidity();
      input.addEventListener("input", () => input.setCustomValidity(""), { once: true });
      return;
    }
    if (mission.length > 1500) {
      showError("Mission must be 1,500 characters or less.");
      return;
    }

    const agentKey = select.value === "auto" ? chooseAgent(mission) : select.value;
    button.disabled = true;
    button.textContent = "Connecting to Gemini…";
    status.textContent = "AI THINKING";
    actions.hidden = true;
    output.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "empty-state";
    appendText(loading, "span", "", "✳");
    appendText(loading, "strong", "", "Real AI is preparing your plan");
    appendText(loading, "small", "", "Sending mission securely to the server-side AI endpoint…");
    output.append(loading);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission, agent: agentKey })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI request failed. Please try again.");
      if (!data.plan || !Array.isArray(data.plan.steps)) throw new Error("AI response was incomplete. Please try again.");

      currentPlan = {
        id: Date.now().toString(36),
        mission,
        agentKey,
        summary: data.plan.summary || mission,
        steps: data.plan.steps,
        risks: data.plan.risks || [],
        needsHumanApproval: data.plan.needsHumanApproval || [],
        deliverable: data.plan.deliverable || "",
        provider: data.provider,
        model: data.model,
        createdAt: new Date().toISOString()
      };
      saved = { pending: true, plan: currentPlan };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
      showPlan(currentPlan, true);
      updateApprovalCount();
    } catch (error) {
      showError(error && error.message ? error.message : "Could not connect to the AI service.");
    } finally {
      button.disabled = false;
      button.textContent = "✳ Generate execution plan";
    }
  });

  $("approvePlan").addEventListener("click", () => {
    if (!currentPlan) return;
    saved = { pending: false, approvedAt: new Date().toISOString(), plan: currentPlan };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
    showPlan(currentPlan, false);
    updateApprovalCount();
  });

  $("rejectPlan").addEventListener("click", () => {
    currentPlan = null;
    saved = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    output.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-state";
    appendText(empty, "span", "", "✳");
    appendText(empty, "strong", "", "Plan discarded");
    appendText(empty, "small", "", "Enter a new mission whenever you are ready.");
    output.append(empty);
    status.textContent = "NO PLAN";
    actions.hidden = true;
    notice.textContent = "No plan is pending. Nothing has been executed.";
    updateApprovalCount();
  });

  if (saved.plan && specialists[saved.plan.agentKey]) {
    currentPlan = saved.plan;
    showPlan(currentPlan, Boolean(saved.pending));
  }
  updateApprovalCount();
})();