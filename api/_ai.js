export function pickProvider() {
  const forced = (process.env.AI_PROVIDER || "").toLowerCase();
  if (forced === "gemini") return process.env.GEMINI_API_KEY ? "gemini" : null;
  if (forced === "claude") return process.env.ANTHROPIC_API_KEY ? "claude" : null;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

export class AiError extends Error {
  constructor(friendly, status = 502) {
    super(friendly);
    this.friendly = friendly;
    this.status = status;
  }
}

export function friendlyFor(status, keyName) {
  if (status === 401 || status === 403) return `The API key was rejected. Check ${keyName}.`;
  if (status === 429) return "Too many requests right now (free plans have limits). Wait a minute and try again.";
  if (status === 400) return `The AI service rejected the request. Check that ${keyName} is a valid key.`;
  return "The AI service had a problem. Try again.";
}

export function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in model response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function callGemini(model, systemPrompt, userMessage, images = [], temperature = 0.7) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const parts = [{ text: userMessage }, ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } }))];

  const apiRes = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
        temperature
      }
    })
  });

  if (!apiRes.ok) {
    console.error("Gemini API error:", apiRes.status, await apiRes.text());
    throw new AiError(friendlyFor(apiRes.status, "GEMINI_API_KEY"));
  }

  const data = await apiRes.json();
  const resParts = data?.candidates?.[0]?.content?.parts || [];
  const text = resParts.map((p) => p.text || "").join("");
  if (!text) {
    console.error("Gemini returned no text:", JSON.stringify(data).slice(0, 500));
    throw new AiError("The AI didn't return a result this time. Please try again.", 502);
  }
  return text;
}

export async function callClaude(model, systemPrompt, userMessage, images = [], maxTokens = 2000) {
  const content = [
    ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.data } })),
    { type: "text", text: userMessage }
  ];

  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
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
