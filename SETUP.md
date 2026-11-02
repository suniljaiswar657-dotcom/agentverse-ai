# AGENTVERSE AI — Engine 0.3 setup

## What this release adds

- A server-side Vercel Function at `/api/agent`.
- Google Gemini `gemini-3.8-flash` generates specialist execution plans.
- The Gemini API key is read only on the server from `GEMINI_API_KEY`.
- A password-protected workspace using a signed, HttpOnly session cookie.
- AI plans remain subject to human review. Approving a plan does not run tools or perform external actions.

## Configure Vercel environment variables

Open the **agentverse-ai** project in Vercel:

1. Open **Settings → Environment Variables**.
2. Add these variables for the **Production** environment (and Preview only if needed):
   - `GEMINI_API_KEY` — your API key from Google AI Studio.
   - `AGENTVERSE_ACCESS_PASSWORD` — a strong, unique workspace password. Do not reuse your Google or GitHub password.
   - `AGENTVERSE_SESSION_SECRET` — a random secret with at least 32 characters. Use a password manager's secure generator; do not put this value in GitHub or share it in chat.
3. Save the variables.
4. Redeploy the latest deployment so the Function receives the new values.
5. Open the live site and enter your workspace password in the AI Brain panel.

Google AI Studio: https://aistudio.google.com/app/apikey

## Important security and privacy notes

- Never paste the Gemini API key, workspace password, or session secret into website code, GitHub files, or this chat.
- The API key stays on the Vercel server. The browser receives only the generated plan.
- The workspace login protects the AI endpoint with a signed HttpOnly cookie. The in-memory request limiter is best-effort and is not a distributed quota system.
- Gemini's free tier is limited and model availability/rate limits can change. Check the current Google AI Studio usage limits.
- Google's Gemini API pricing page says content submitted on the free tier may be used to improve Google products. Do not submit passwords, API keys, financial details, private customer data, or other sensitive information through the free-tier integration.
- AI output can be wrong. Verify the plan before approving it.
- This release does not browse the web, call tools, edit files, send messages, or execute external actions. Human approval currently records the plan decision locally only.

## Troubleshooting

- **Workspace security is not configured:** confirm all three environment variables exist in the Vercel project and redeploy.
- **Incorrect workspace password:** confirm `AGENTVERSE_ACCESS_PASSWORD` exactly matches the value saved in Vercel.
- **Gemini is not configured:** confirm `GEMINI_API_KEY` is saved in the correct Vercel environment and redeploy.
- **Gemini rate limit reached:** wait for the quota window to reset; check AI Studio limits for the selected model.
