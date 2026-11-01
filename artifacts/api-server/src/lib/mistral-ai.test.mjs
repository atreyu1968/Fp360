import assert from "node:assert/strict";
import test from "node:test";
import { checkMistralAiEndpoint, requestMistralAiJson } from "./mistral-ai.ts";

test("Mistral connection check sends the key only to the fixed models endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await checkMistralAiEndpoint({ model: "mistral-small-latest", apiKey: "test-only-key" });
    assert.equal(captured.url, "https://api.mistral.ai/v1/models");
    assert.equal(captured.options.method, "GET");
    assert.equal(captured.options.redirect, "error");
    assert.equal(new Headers(captured.options.headers).get("authorization"), "Bearer test-only-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Mistral proposal requests use JSON mode and parse only the assistant content", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"title":"Escenario didáctico","events":[]}' } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await requestMistralAiJson(
      { model: "mistral-small-latest", apiKey: "test-only-key" },
      "Devuelve JSON.",
      '{"request":"test"}',
    );
    const requestBody = JSON.parse(captured.options.body);
    assert.equal(captured.url, "https://api.mistral.ai/v1/chat/completions");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.redirect, "error");
    assert.equal(new Headers(captured.options.headers).get("authorization"), "Bearer test-only-key");
    assert.deepEqual(requestBody.response_format, { type: "json_object" });
    assert.equal(requestBody.stream, false);
    assert.deepEqual(result, { title: "Escenario didáctico", events: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Mistral errors are sanitized and an empty key never makes a request", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return new Response("provider error includes sensitive details", { status: 401 });
  };

  try {
    await assert.rejects(
      checkMistralAiEndpoint({ model: "mistral-small-latest", apiKey: "" }),
      /Falta la clave de API de Mistral/,
    );
    assert.equal(callCount, 0);
    await assert.rejects(
      checkMistralAiEndpoint({ model: "mistral-small-latest", apiKey: "test-only-key" }),
      /Mistral no aceptó la comprobación de conexión/,
    );
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
