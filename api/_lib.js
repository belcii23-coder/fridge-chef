// Shared helpers for the serverless functions in this folder.
// Files starting with "_" are not exposed as web endpoints on Vercel.
//
// Which AI is used (checked in this order):
//   1. AI_PROVIDER=gemini or AI_PROVIDER=claude (explicit choice)
//   2. GEMINI_API_KEY is set  -> Google Gemini (has a free tier)
//   3. ANTHROPIC_API_KEY set  -> Claude

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const apiRes = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        temperature: 0.7
      }
    })
  });

  if (!apiRes.ok) {
    console.error("Gemini API error:", apiRes.status, await apiRes.text());
    throw new AiError(friendlyFor(apiRes.status, "GEMINI_API_KEY"));
  }

  const data = await apiRes.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) {
    console.error("Gemini returned no text:", JSON.stringify(data).slice(0, 500));
    throw new AiError("The AI didn't return anything this time. Please try again.", 502);
  }
  return text;
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
