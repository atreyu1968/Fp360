import { readFileSync, writeFileSync } from "node:fs";

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url !== "https://api.groq.com/openai/v1/chat/completions") {
    return originalFetch(input, options);
  }

  const authorization = new Headers(options.headers).get("authorization");
  const requestBody = JSON.parse(options.body);
  writeFileSync(process.env.GROQ_TEST_CAPTURE_FILE, JSON.stringify({
    url,
    authorization,
    requestBody,
  }));
  const fakeResponse = JSON.parse(readFileSync(process.env.GROQ_TEST_RESPONSE_FILE, "utf8"));
  return new Response(JSON.stringify({
    choices: [{ message: { content: fakeResponse.content } }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
