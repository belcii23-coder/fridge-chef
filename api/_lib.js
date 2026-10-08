// Shared helpers for the serverless functions in this folder.
// Files starting with "_" are not exposed as web endpoints on Vercel.
//
// Which AI is used (checked in this order):
//   1. AI_PROVIDER=gemini or AI_PROVIDER=claude (explicit choice)
//   2. GEMINI_API_KEY is set  -> Google Gemini (has a free tier)
//   3. ANTHROPIC_API_KEY set  -> Claude

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const GEMINI_FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash-lite").split(",").map((m) => m.trim()).filter(Boolean);
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export class AiError extends Error {
  constructor(friendly, status = 502) {
    super(friendly);
    this.friendly = friendly;
    this.status = status;
  }
}

export function pickProvider() {
  const forced = (process.env.AI_PROVIDER || "").toLowerCase();
  if (forced === "gemini") return process.env.GEMINI_API_KEY ? "gemini" : null;
  if (forced === "claude") return process.env.ANTHROPIC_API_KEY ? "claude" : null;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

export const NO_KEY_MESSAGE =
  "No AI key found. Add GEMINI_API_KEY (free) or ANTHROPIC_API_KEY in your environment settings.";

function friendlyFor(status, keyName) {
  if (status === 401 || status === 403) return `The API key was rejected. Check ${keyName}.`;
  if (status === 429) return "Too many requests right now (free plans have limits). Wait a minute and try again.";
  if (status === 400) return `The AI service rejected the request. Check that ${keyName} is a valid key.`;
  return "The AI service had a problem. Try again.";
}

export function extractJson(text) {
  // Be forgiving if the model wraps the JSON in code fences or adds stray text.
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in model response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function readBody(req) {
  try {
    return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return null;
  }
}

/**
 * Ask the AI something and get text back.
 * @param {"gemini"|"claude"} provider
 * @param {string} system   instructions for the AI
 * @param {string} userText the user's message
 * @param {{mimeType: string, data: string}|null} image optional photo (base64, no data: prefix)
 */
export async function askAi(provider, system, userText, image = null) {
  return provider === "gemini"
    ? callGemini(system, userText, image)
    : callClaude(system, userText, image);
}

async function callGemini(system, userText, image) {
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  parts.push({ text: userText });

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature: 0.7
    }
  });

  // If the main model is slow or busy, fall back to a backup model so the user still gets recipes.
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACKS.filter((m) => m !== GEMINI_MODEL)];
  let lastErr = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const apiRes = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body,
        signal: AbortSignal.timeout(i === 0 ? 20000 : 24000)
      });

      if (!apiRes.ok) {
        console.error(`Gemini API error (${model}):`, apiRes.status, await apiRes.text());
        lastErr = new AiError(friendlyFor(apiRes.status, "GEMINI_API_KEY"), apiRes.status === 429 ? 429 : 502);
        if (apiRes.status === 401 || apiRes.status === 403) throw lastErr; // a bad key won't fix itself
        continue;
      }

      const data = await apiRes.json();
      const text = (data?.candidates?.[0]?.content?.parts || [])
        .filter((p) => !p.thought)
        .map((p) => p.text || "")
        .join("");
      if (!text) {
        console.error(`Gemini returned no text (${model}):`, JSON.stringify(data).slice(0, 500));
        lastErr = new AiError("The AI didn't return anything this time. Please try again.", 502);
        continue;
      }
      return text;
    } catch (err) {
      if (err instanceof AiError) {
        if (err.status === 401 || err.status === 403) throw err;
        lastErr = err;
        continue;
      }
      console.error(`Gemini request failed (${model}):`, err?.name, err?.message);
      lastErr = new AiError("The AI is taking too long right now. Please try again in a moment.", 504);
    }
  }
  throw lastErr || new AiError("The AI is not available right now. Please try again.", 502);
}

async function callClaude(system, userText, image) {
  const content = [];
  if (image) {
    content.push({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } });
  }
  content.push({ type: "text", text: userText });

  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content }]
    })
  });

  if (!apiRes.ok) {
    console.error("Anthropic API error:", apiRes.status, await apiRes.text());
    throw new AiError(friendlyFor(apiRes.status, "ANTHROPIC_API_KEY"));
  }

  const data = await apiRes.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}
