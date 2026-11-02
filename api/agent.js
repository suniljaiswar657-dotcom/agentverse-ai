const crypto = require("crypto");

const ALLOWED_AGENTS = {
  ceo: "AI CEO — strategy, prioritisation and decision framing",
  developer: "AI Developer — software design, implementation and debugging",
  researcher: "AI Researcher — research, evidence and synthesis",
  marketer: "AI Marketer — content, audience and campaigns",
  business: "AI Business — operations, costs and business analysis",
  automation: "AI Automation — workflow design and process automation",
  security: "AI Security — privacy, risk and defensive security review"
};
const SESSION_COOKIE = "agentverse_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const recentRequests = new Map();

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}
function readCookie(req, name) {
  const header = req.headers.cookie || "";
  const entry = header.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}
function validSession(req, secret) {
  const token = readCookie(req, SESSION_COOKIE);
  const parts = token.split(".");
  if (parts.length !== 2 || !/^\d+$/.test(parts[0])) return false;
  const issued = Number(parts[0]);
  if (!Number.isFinite(issued) || Date.now() - issued > SESSION_TTL_MS || issued > Date.now() + 60000) return false;
  return safeEqual(parts[1], sign(parts[0], secret));
}
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
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const body = req.body || {};
  const action = typeof body.action === "string" ? body.action : "";
  const accessPassword = process.env.AGENTVERSE_ACCESS_PASSWORD;
  const sessionSecret = process.env.AGENTVERSE_SESSION_SECRET;

  if (!accessPassword || !sessionSecret || sessionSecret.length < 32) {
    return res.status(503).json({
      error: "Workspace security is not configured. Add AGENTVERSE_ACCESS_PASSWORD and a 32+ character AGENTVERSE_SESSION_SECRET in Vercel, then redeploy."
    });
  }

  if (action === "status") {
    return res.status(200).json({ authenticated: validSession(req, sessionSecret) });
  }

  if (action === "login") {
    const supplied = typeof body.password === "string" ? body.password : "";
    if (!safeEqual(supplied, accessPassword)) {
      return res.status(401).json({ error: "Incorrect workspace password." });
    }
    const issued = String(Date.now());
    const token = issued + "." + sign(issued, sessionSecret);
    res.setHeader("Set-Cookie", SESSION_COOKIE + "=" + encodeURIComponent(token) + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200");
    return res.status(200).json({ authenticated: true });
  }

  if (action === "logout") {
    res.setHeader("Set-Cookie", SESSION_COOKIE + "=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
    return res.status(200).json({ authenticated: false });
  }

  if (!validSession(req, sessionSecret)) {
    return res.status(401).json({ error: "Workspace locked. Sign in to use the AI Brain." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Gemini is not configured. Add GEMINI_API_KEY in Vercel Project Settings → Environment Variables, then redeploy." });
  }

  const ip = (req.headers["x-forwarded-for"] || "unknown").toString().split(",")[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Request limit reached for this server instance. Please wait one minute and try again." });
  }

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    let response;
    let data;
    try {
      response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: mission }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1200 }
        })
      });
      data = await response.json().catch(() => ({}));
    } catch (requestError) {
      if (requestError && requestError.name === "AbortError") {
        return res.status(504).json({ error: "Gemini request timed out after 45 seconds. Please try again in a moment." });
      }
      throw requestError;
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const providerMessage = data.error && data.error.message ? data.error.message : "Gemini API request failed.";
      const safeMessage = response.status === 429
        ? "Gemini rate limit reached. Please wait and try again."
        : response.status === 400
          ? "Gemini rejected this request. Check model availability and API key access."
          : "Gemini service is temporarily unavailable.";
      console.error("Gemini API error:", response.status, providerMessage.slice(0, 300));
      return res.status(response.status === 429 ? 429 : 502).json({ error: safeMessage });
    }
    const text = data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts.map(part => part.text || "").join("");
    if (!text) return res.status(502).json({ error: "Gemini returned an empty response. Please try again." });

    let plan;
    try { plan = JSON.parse(text); } catch {
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
