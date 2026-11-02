const ALLOWED_AGENTS = {
  ceo: "AI CEO — strategy, prioritisation and decision framing",
  developer: "AI Developer — software design, implementation and debugging",
  researcher: "AI Researcher — research, evidence and synthesis",
  marketer: "AI Marketer — content, audience and campaigns",
  business: "AI Business — operations, costs and business analysis",
  automation: "AI Automation — workflow design and process automation",
  security: "AI Security — privacy, risk and defensive security review"
};

// Best-effort per-instance protection. Serverless instances do not share memory.
const recentRequests = new Map();
function rateLimited(key) {
  const now = Date.now();
  const recent = (recentRequests.get(key) || []).filter(time => now - time < 60000);
  if (recent.length >= 8) return true;
  recent.push(now);
  recentRequests.set(key, recent);
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "AI provider is not configured yet. Add GEMINI_API_KEY in Vercel Project Settings → Environment Variables, then redeploy."
    });
  }

  const ip = (req.headers["x-forwarded-for"] || "unknown").toString().split(",")[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Request limit reached for this instance. Please wait one minute and try again." });
  }

  const body = req.body || {};
  const mission = typeof body.mission === "string" ? body.mission.trim() : "";
  const agentKey = typeof body.agent === "string" ? body.agent : "ceo";
  const agentRole = ALLOWED_AGENTS[agentKey];

  if (!mission || mission.length > 1500) {
    return res.status(400).json({ error: "Mission is required and must be 1–1500 characters." });
  }
  if (!agentRole) {
    return res.status(400).json({ error: "Unknown specialist assignment." });
  }

  const systemInstruction = [
    "You are a specialist worker inside AGENTVERSE AI, a human-supervised multi-agent workspace.",
    "Your assigned role is: " + agentRole + ".",
    "Create a useful, realistic execution plan for the user's mission.",
    "Do not claim you executed actions, accessed accounts, browsed websites, changed files, or contacted anyone.",
    "Do not request passwords, API keys, or other secrets in the plan.",
    "Keep recommendations practical for a zero-budget project where possible.",
    "Return only valid JSON with this exact shape:",
    '{"summary":"short mission interpretation","steps":["step 1","step 2"],"risks":["risk"],"needsHumanApproval":["actions requiring approval"],"deliverable":"expected output"}',
    "Use 4–7 concrete steps. If the mission is unsafe or unclear, explain the issue and request clarification in the summary."
  ].join(" ");

  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: mission }] }],
        generationConfig: {
          response_mime_type: "application/json",
          maxOutputTokens: 1200
        }
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = data.error && data.error.message ? data.error.message : "AI provider request failed.";
      const safeMessage = response.status === 429
        ? "Gemini rate limit reached. Please wait and try again."
        : response.status === 400
          ? "Gemini rejected this request. Check the selected model and API key access."
          : "Gemini service is temporarily unavailable.";
      console.error("Gemini API error:", response.status, providerMessage.slice(0, 300));
      return res.status(response.status === 429 ? 429 : 502).json({ error: safeMessage });
    }

    const text = data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts.map(part => part.text || "").join("");
    if (!text) {
      return res.status(502).json({ error: "Gemini returned an empty response. Please try again." });
    }

    let plan;
    try {
      plan = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: "AI response format was invalid. Please generate the plan again." });
    }

    if (!plan || typeof plan.summary !== "string" || !Array.isArray(plan.steps)) {
      return res.status(502).json({ error: "AI response did not match the expected plan format." });
    }

    return res.status(200).json({
      provider: "Google Gemini",
      model: "gemini-3.8-flash",
      agent: agentKey,
      plan: {
        summary: plan.summary.slice(0, 1200),
        steps: plan.steps.filter(step => typeof step === "string").slice(0, 8).map(step => step.slice(0, 500)),
        risks: Array.isArray(plan.risks) ? plan.risks.filter(item => typeof item === "string").slice(0, 6) : [],
        needsHumanApproval: Array.isArray(plan.needsHumanApproval) ? plan.needsHumanApproval.filter(item => typeof item === "string").slice(0, 6) : [],
        deliverable: typeof plan.deliverable === "string" ? plan.deliverable.slice(0, 800) : ""
      }
    });
  } catch (error) {
    console.error("Agent API error:", error && error.message ? error.message : "Unknown error");
    return res.status(500).json({ error: "Server could not reach Gemini. Check deployment logs and try again." });
  }
};
