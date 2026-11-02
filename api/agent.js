const crypto = require("crypto");

const ALLOWED_AGENTS = {
  ceo: "AI CEO — strategy, prioritisation and decision framing",
  developer: "AI Developer — software design, implementation and debugging",
  researcher: "AI Researcher — live web research, evidence and synthesis",
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
  if (parts.length !== 2 || !/^\\d+$/.test(parts[0])) return false;
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
function extractGroundedSources(metadata) {
  const chunks = Array.isArray(metadata && metadata.groundingChunks) ? metadata.groundingChunks : [];
  const sources = [];
  const chunkSourceNumbers = [];
  const seen = new Map();
  for (const chunk of chunks) {
    const web = chunk && chunk.web;
    const uri = web && typeof web.uri === "string" ? web.uri.trim() : "";
    if (!/^https?:\\/\\//i.test(uri)) {
      chunkSourceNumbers.push(null);
      continue;
    }
    if (seen.has(uri)) {
      chunkSourceNumbers.push(seen.get(uri));
      continue;
    }
    if (sources.length >= 12) {
      chunkSourceNumbers.push(null);
      continue;
    }
    const number = sources.length + 1;
    sources.push({
      number,
      title: String(web.title || new URL(uri).hostname).slice(0, 180),
      url: uri
    });
    seen.set(uri, number);
    chunkSourceNumbers.push(number);
  }
  return { sources, chunkSourceNumbers };
}
function addGroundingCitations(text, metadata, chunkSourceNumbers) {
  const supports = Array.isArray(metadata && metadata.groundingSupports) ? metadata.groundingSupports : [];
  const insertions = new Map();
  for (const support of supports) {
    const end = Number(support && support.segment && support.segment.endIndex);
    if (!Number.isInteger(end) || end < 0 || end > text.length) continue;
    const numbers = (Array.isArray(support.groundingChunkIndices) ? support.groundingChunkIndices : [])
      .map(index => chunkSourceNumbers[index])
      .filter(number => Number.isInteger(number));
    if (!numbers.length) continue;
    if (!insertions.has(end)) insertions.set(end, new Set());
    numbers.forEach(number => insertions.get(end).add(number));
  }
  let result = text;
  Array.from(insertions.entries()).sort((a, b) => b[0] - a[0]).forEach(([end, numbers]) => {
    const marker = " " + Array.from(numbers).sort((a, b) => a - b).map(number => "[" + number + "]").join("");
    result = result.slice(0, end) + marker + result.slice(end);
  });
  return result;
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

  const isResearcher = agentKey === "researcher";
  const systemInstruction = isResearcher
    ? [
        "You are the live-web research specialist inside AGENTVERSE AI.",
        "Your role is: " + agentRole + ".",
        "Google Search grounding is enabled. Use it to retrieve current public web evidence before writing the report.",
        "Return an actual research report in clear Markdown, not a research plan or methodology.",
        "Answer the mission directly. Include specific findings, dates or prices only when supported by retrieved sources.",
        "Separate verified findings from estimates, assumptions and unknowns.",
        "Never invent businesses, people, statistics, interviews, prices, customer demand, source titles or URLs.",
        "If evidence is insufficient, say so explicitly and explain what could not be verified.",
        "Use concise headings, comparisons and practical conclusions where relevant.",
        "The server will attach a numbered source list from the actual Google Search grounding metadata. Do not fabricate a source list.",
        "Do not claim that you contacted anyone, accessed private analytics, or performed external actions."
      ].join(" ")
    : [
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
    let response;
    let data = {};
    let activeModel = "";
    const modelFallbacks = [
      { name: "gemini-3.8-flash", attempts: 2 },
      { name: "gemini-3.6-flash", attempts: 1 },
      { name: "gemini-3.5-flash-lite", attempts: 1 }
    ];
    const retryableStatuses = new Set([500, 502, 503, 504]);
    let lastRequestError = null;

    modelLoop:
    for (const modelConfig of modelFallbacks) {
      for (let attempt = 1; attempt <= modelConfig.attempts; attempt++) {
        response = null;
        data = {};
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const requestBody = {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: mission }] }],
          generationConfig: isResearcher
            ? { maxOutputTokens: 3000, temperature: 0.2 }
            : { responseMimeType: "application/json", maxOutputTokens: 1200 }
        };
        if (isResearcher) requestBody.tools = [{ google_search: {} }];
        try {
          response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + modelConfig.name + ":generateContent", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            signal: controller.signal,
            body: JSON.stringify(requestBody)
          });
          data = await response.json().catch(() => ({}));
          lastRequestError = null;
        } catch (requestError) {
          lastRequestError = requestError;
          if (!requestError || requestError.name !== "AbortError") {
            if (attempt >= modelConfig.attempts && modelConfig === modelFallbacks[modelFallbacks.length - 1]) throw requestError;
          }
        } finally {
          clearTimeout(timeoutId);
        }

        if (response && response.ok) {
          activeModel = modelConfig.name;
          break modelLoop;
        }

        if (response && response.status === 429) {
          const providerMessage = data.error && data.error.message ? data.error.message : "Gemini rate limit reached.";
          console.error("Gemini API rate limit:", response.status, providerMessage.slice(0, 300));
          return res.status(429).json({ error: "Gemini rate limit reached. Please wait and try again." });
        }

        const shouldRetry = lastRequestError
          ? lastRequestError.name === "AbortError"
          : response && retryableStatuses.has(response.status);
        if (!shouldRetry) break modelLoop;

        if (attempt < modelConfig.attempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    if (!activeModel) {
      if (lastRequestError && lastRequestError.name === "AbortError") {
        return res.status(504).json({ error: "Gemini models did not respond within the time limit. Please try again later." });
      }
      const providerMessage = data && data.error && data.error.message ? data.error.message : "Gemini API request failed.";
      const safeMessage = response && response.status === 400
        ? "Gemini rejected this request. Check model availability and API key access."
        : "Gemini service is temporarily unavailable across the configured fallback models.";
      console.error("Gemini API error:", response ? response.status : "network error", providerMessage.slice(0, 300));
      return res.status(response && response.status === 503 ? 503 : 502).json({ error: safeMessage });
    }
    const candidate = data.candidates && data.candidates[0];
    const text = candidate && candidate.content && candidate.content.parts &&
      candidate.content.parts.map(part => part.text || "").join("");
    if (!text) return res.status(502).json({ error: "Gemini returned an empty response. Please try again." });

    if (isResearcher) {
      const metadata = candidate.groundingMetadata || {};
      const { sources, chunkSourceNumbers } = extractGroundedSources(metadata);
      if (!sources.length) {
        return res.status(502).json({
          error: "Researcher could not retrieve verifiable web sources for this mission. No research report was saved. Try a more specific research question."
        });
      }
      const groundedText = addGroundingCitations(text, metadata, chunkSourceNumbers);
      const searchQueries = Array.isArray(metadata.webSearchQueries)
        ? metadata.webSearchQueries.filter(query => typeof query === "string").slice(0, 8)
        : [];
      return res.status(200).json({
        provider: "Google Gemini · Google Search",
        model: activeModel,
        agent: agentKey,
        plan: {
          summary: "Live web research completed with " + sources.length + " source(s). Review the evidence and limitations below.",
          steps: [],
          risks: ["Search results and AI summaries can be incomplete or outdated. Open the cited sources before relying on important claims."],
          needsHumanApproval: ["Verify important claims and source dates before making business or financial decisions."],
          deliverable: "Grounded research report with source links.",
          researchText: groundedText.slice(0, 18000),
          sources,
          searchQueries
        }
      });
    }

    let plan;
    try { plan = JSON.parse(text); } catch {
      return res.status(502).json({ error: "AI response format was invalid. Please generate the plan again." });
    }
    if (!plan || typeof plan.summary !== "string" || !Array.isArray(plan.steps)) {
      return res.status(502).json({ error: "AI response did not match the expected plan format." });
    }

    return res.status(200).json({
      provider: "Google Gemini",
      model: activeModel,
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
