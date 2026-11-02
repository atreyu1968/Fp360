import assert from "node:assert/strict";
import test from "node:test";
import { checkGroqAiEndpoint, listGroqAiModels, requestGroqAiJson } from "./groq-ai.ts";

test("GroqCloud connection check sends the key only to the fixed models endpoint", async () => {
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
    await checkGroqAiEndpoint({ model: "openai/gpt-oss-20b", apiKey: "test-only-key" });
    assert.equal(captured.url, "https://api.groq.com/openai/v1/models");
    assert.equal(captured.options.method, "GET");
    assert.equal(captured.options.redirect, "error");
    assert.equal(new Headers(captured.options.headers).get("authorization"), "Bearer test-only-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GroqCloud model catalog returns unique model IDs from the authenticated server request", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      data: [{ id: "model-b", owned_by: "provider" }, { id: "model-a" }, { id: "model-b" }, { name: "ignored" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    assert.deepEqual(await listGroqAiModels("test-only-key"), ["model-a", "model-b"]);
    assert.equal(captured.url, "https://api.groq.com/openai/v1/models");
    assert.equal(captured.options.method, "GET");
    assert.equal(captured.options.redirect, "error");
    assert.equal(new Headers(captured.options.headers).get("authorization"), "Bearer test-only-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GroqCloud model catalog rejects provider failures, malformed data, and empty catalogs", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("private provider detail", { status: 401 });
    await assert.rejects(listGroqAiModels("test-only-key"), /GroqCloud no aceptó la consulta del catálogo/);

    globalThis.fetch = async () => new Response(JSON.stringify({ data: "invalid" }), { status: 200 });
    await assert.rejects(listGroqAiModels("test-only-key"), /GroqCloud devolvió un catálogo no válido/);

    globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    await assert.rejects(listGroqAiModels("test-only-key"), /GroqCloud no devolvió modelos disponibles/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GroqCloud proposal requests use JSON mode and parse only assistant content", async () => {
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
    const result = await requestGroqAiJson(
      { model: "openai/gpt-oss-20b", apiKey: "test-only-key" },
      "Devuelve JSON.",
      '{"request":"test"}',
    );
    const requestBody = JSON.parse(captured.options.body);
    assert.equal(captured.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.redirect, "error");
    assert.equal(new Headers(captured.options.headers).get("authorization"), "Bearer test-only-key");
    assert.deepEqual(requestBody.response_format, { type: "json_object" });
    assert.equal(requestBody.max_completion_tokens, 10_000);
    assert.equal(requestBody.stream, false);
    assert.deepEqual(result, { title: "Escenario didáctico", events: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GroqCloud errors are sanitized and an empty key never makes a request", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return new Response("provider error includes sensitive details", { status: 401 });
  };

  try {
    await assert.rejects(
      checkGroqAiEndpoint({ model: "openai/gpt-oss-20b", apiKey: "" }),
      /Falta la clave de API de GroqCloud/,
    );
    assert.equal(callCount, 0);
    await assert.rejects(
      checkGroqAiEndpoint({ model: "openai/gpt-oss-20b", apiKey: "test-only-key" }),
      /GroqCloud no aceptó la comprobación de conexión/,
    );
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
