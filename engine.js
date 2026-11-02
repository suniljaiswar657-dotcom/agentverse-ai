(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const input = $("missionInput");
  const select = $("agentSelect");
  const planButton = $("planMission");
  const output = $("planOutput");
  const status = $("planStatus");
  const actions = $("approvalActions");
  const approvalCount = $("approvalCount");
  const notice = $("engineNotice");
  if (!input || !select || !planButton || !output) return;

  const STORAGE_KEY = "agentverse-ai-engine-v1";
  const specialists = {
    ceo: { name: "AI CEO", focus: "strategy, prioritisation and decision framing" },
    developer: { name: "AI Developer", focus: "technical design, implementation and debugging" },
    researcher: { name: "AI Researcher", focus: "research, evidence gathering and synthesis" },
    marketer: { name: "AI Marketer", focus: "content, audience and campaign planning" },
    business: { name: "AI Business", focus: "operations, costs and business analysis" },
    automation: { name: "AI Automation", focus: "workflow mapping and process automation" },
    security: { name: "AI Security", focus: "risk review, privacy and security checks" }
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

  function makeSteps(agentKey, mission) {
    const base = [
      "Clarify the desired outcome and define what a successful result looks like.",
      "Break the mission into small, verifiable work items.",
      "Identify required information, tools, dependencies and constraints."
    ];
    const tailored = {
      ceo: ["Rank the work by impact, effort and risk.", "Prepare a recommendation with assumptions and measurable next actions."],
      developer: ["Map the required interface, data flow and technical components.", "Implement in small changes, then run functional and responsive checks."],
      researcher: ["Collect relevant sources and record their dates and reliability.", "Cross-check key claims and produce a concise evidence-based summary."],
      marketer: ["Define the audience, message and content objective.", "Draft channel-specific content and measurable engagement indicators."],
      business: ["Map the business process, customer value and cost drivers.", "Estimate outcomes transparently and identify operational risks."],
      automation: ["Map trigger, inputs, actions, conditions and failure paths.", "Design a human approval checkpoint before consequential actions."],
      security: ["Identify sensitive data, permissions and likely threat scenarios.", "Recommend least-privilege controls and validation checks before release."]
    };
    return [...base, ...tailored[agentKey], "Present the deliverable for human review; do not take external action without explicit approval."];
  }

  function updateApprovalCount() {
    approvalCount.textContent = saved.pending ? "01" : "00";
  }

  function showPlan(plan, isPending) {
    output.replaceChildren();
    const summary = document.createElement("div");
    summary.className = "plan-summary";
    const badge = document.createElement("span");
    badge.className = "plan-badge";
    badge.textContent = "ROUTED TO " + plan.agentName.toUpperCase();
    const title = document.createElement("strong");
    title.textContent = plan.mission;
    const meta = document.createElement("small");
    meta.textContent = "Specialist focus: " + plan.focus;
    summary.append(badge, title, meta);
    const list = document.createElement("ol");
    list.className = "plan-steps";
    plan.steps.forEach((step, index) => {
      const item = document.createElement("li");
      const number = document.createElement("span");
      number.textContent = String(index + 1).padStart(2, "0");
      const text = document.createElement("div");
      text.textContent = step;
      item.append(number, text);
      list.append(item);
    });
    const risk = document.createElement("p");
    risk.className = "risk-line";
    risk.textContent = "Execution mode: planning only · External tools: disconnected · Human control: required";
    output.append(summary, list, risk);
    status.textContent = isPending ? "AWAITING REVIEW" : "APPROVED LOCALLY";
    actions.hidden = !isPending;
    notice.textContent = isPending
      ? "Review the plan. Approval saves your decision locally; it does not execute tools or contact services."
      : "This plan is stored in this browser only. No external tools or AI provider have been called.";
  }

  planButton.addEventListener("click", () => {
    const mission = input.value.trim();
    if (!mission) {
      input.focus();
      input.setCustomValidity("Enter a mission first.");
      input.reportValidity();
      input.addEventListener("input", () => input.setCustomValidity(""), { once: true });
      return;
    }
    const agentKey = select.value === "auto" ? chooseAgent(mission) : select.value;
    const agent = specialists[agentKey];
    currentPlan = {
      id: Date.now().toString(36),
      mission,
      agentKey,
      agentName: agent.name,
      focus: agent.focus,
      steps: makeSteps(agentKey, mission),
      createdAt: new Date().toISOString()
    };
    saved = { pending: true, plan: currentPlan };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
    showPlan(currentPlan, true);
    updateApprovalCount();
  });

  $("approvePlan").addEventListener("click", () => {
    if (!currentPlan) return;
    saved = { pending: false, approvedAt: new Date().toISOString(), plan: currentPlan };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
    showPlan(currentPlan, false);
    updateApprovalCount();
    status.textContent = "APPROVED LOCALLY";
  });

  $("rejectPlan").addEventListener("click", () => {
    currentPlan = null;
    saved = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    output.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const symbol = document.createElement("span"); symbol.textContent = "✳";
    const title = document.createElement("strong"); title.textContent = "Plan discarded";
    const small = document.createElement("small"); small.textContent = "Enter a new mission whenever you are ready.";
    empty.append(symbol, title, small); output.append(empty);
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