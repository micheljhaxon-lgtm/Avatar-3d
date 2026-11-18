/**
 * Lusy AI Gateway - Cloudflare Worker
 *
 * Routes in order:
 * 1) Google Gemini (primary)
 * 2) Cloudflare Workers AI (fallback 1)
 * 3) OpenRouter free model router (fallback 2)
 *
 * Required Cloudflare setup:
 * - Workers AI binding named AI
 * - Secret GEMINI_API_KEY
 * - Secret OPENROUTER_API_KEY
 * - Optional variable GEMINI_MODEL (defaults to the model currently used by the app)
 *
 * Keep this Worker URL in script.js as GEMINI_WORKER_URL.
 */

const ALLOWED_ORIGINS = new Set([
  "https://micheljhaxon-lgtm.github.io"
]);

const CLOUDFLARE_MODEL = "@cf/zai-org/glm-4.7-flash";
const OPENROUTER_MODEL = "openrouter/free";

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://micheljhaxon-lgtm.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function getMessages(body) {
  const messages = [];
  const systemText = body?.systemInstruction?.parts
    ?.map(part => part?.text || "")
    .join("\n")
    .trim();

  if (systemText) messages.push({ role: "system", content: systemText });

  for (const item of (Array.isArray(body?.contents) ? body.contents : [])) {
    const role = item?.role === "model" ? "assistant" : "user";
    const text = (item?.parts || [])
      .map(part => typeof part?.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n");
    if (text) messages.push({ role, content: text });
  }
  return messages;
}

function toGeminiResponse(text, provider) {
  return {
    candidates: [{
      content: {
        role: "model",
        parts: [{ text }]
      },
      finishReason: "STOP"
    }],
    provider
  };
}

function isTemporaryStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function tryGemini(body, env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = Object.assign(new Error(`Gemini returned HTTP ${response.status}: ${detail.slice(0, 500)}`), { status: response.status });
    throw error;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map(part => part?.text || "")
    .join("")
    .trim();

  if (!text) throw new Error("Gemini returned an empty response");
  return toGeminiResponse(text, "gemini");
}

async function tryCloudflare(messages, body, env) {
  if (!env.AI || typeof env.AI.run !== "function") {
    throw new Error("Workers AI binding named AI is not configured");
  }

  const result = await env.AI.run(CLOUDFLARE_MODEL, {
    messages,
    max_tokens: body?.generationConfig?.maxOutputTokens || 1024,
    temperature: 0.7
  });

  const text = typeof result === "string"
    ? result
    : (result?.response || result?.result?.response || "");

  if (!text || typeof text !== "string") {
    throw new Error("Cloudflare Workers AI returned an empty response");
  }
  return toGeminiResponse(text, "cloudflare-workers-ai");
}

async function tryOpenRouter(messages, body, env) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://micheljhaxon-lgtm.github.io/Avatar-3d/",
      "X-Title": "Lusy AI Assistant"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      max_tokens: body?.generationConfig?.maxOutputTokens || 1024,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = Object.assign(new Error(`OpenRouter returned HTTP ${response.status}: ${detail.slice(0, 500)}`), { status: response.status });
    throw error;
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    throw new Error("OpenRouter returned an empty response");
  }
  return toGeminiResponse(text, "openrouter");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return new Response("Origin not allowed", { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ error: "Origin not allowed" }, 403, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON request" }, 400, origin);
    }

    if (!Array.isArray(body?.contents) || body.contents.length === 0) {
      return jsonResponse({ error: "Missing conversation contents" }, 400, origin);
    }

    const messages = getMessages(body);
    const failures = [];

    try {
      return jsonResponse(await tryGemini(body, env), 200, origin);
    } catch (error) {
      failures.push({ provider: "gemini", status: error.status || null, message: error.message });
      if (error.status && !isTemporaryStatus(error.status)) {
        // Configuration, authentication, invalid-model and safety errors should not
        // silently switch providers; report them so the owner can correct the cause.
        return jsonResponse({ error: error.message, provider: "gemini", fallbackSkipped: true }, error.status, origin);
      }
    }

    try {
      return jsonResponse(await tryCloudflare(messages, body, env), 200, origin);
    } catch (error) {
      failures.push({ provider: "cloudflare-workers-ai", status: error.status || null, message: error.message });
    }

    try {
      return jsonResponse(await tryOpenRouter(messages, body, env), 200, origin);
    } catch (error) {
      failures.push({ provider: "openrouter", status: error.status || null, message: error.message });
    }

    return jsonResponse({
      error: "Los tres proveedores de IA no están disponibles. Inténtalo de nuevo en unos segundos.",
      providers: failures.map(item => ({
        provider: item.provider,
        status: item.status
      }))
    }, 503, origin);
  }
};
