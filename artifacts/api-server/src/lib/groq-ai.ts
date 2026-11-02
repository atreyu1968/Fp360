export type GroqAiConfiguration = {
  model: string;
  apiKey: string;
};

const GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";
const MAX_GROQ_MODELS_RESPONSE_BYTES = 1_000_000;

function assertApiKey(apiKey: string): void {
  if (!apiKey.trim()) throw new Error("Falta la clave de API de GroqCloud.");
}

export async function checkGroqAiEndpoint(configuration: GroqAiConfiguration): Promise<void> {
  assertApiKey(configuration.apiKey);
  const response = await fetch(`${GROQ_API_BASE_URL}/models`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${configuration.apiKey}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("GroqCloud no aceptó la comprobación de conexión.");
  }
  await response.body?.cancel();
}

export async function listGroqAiModels(apiKey: string): Promise<string[]> {
  assertApiKey(apiKey);
  const response = await fetch(`${GROQ_API_BASE_URL}/models`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("GroqCloud no aceptó la consulta del catálogo.");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("GroqCloud devolvió una respuesta vacía.");
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > MAX_GROQ_MODELS_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("El catálogo de GroqCloud supera el tamaño permitido.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let payload: unknown;
  try {
    const bytes = new Uint8Array(byteCount);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("GroqCloud devolvió un catálogo no válido.");
  }
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("GroqCloud devolvió un catálogo no válido.");
  const models = [...new Set(data.flatMap((item: unknown) => {
    const id = (item as { id?: unknown } | null)?.id;
    return typeof id === "string" && id.length > 0 && id.length <= 120 ? [id] : [];
  }))].sort((left, right) => left.localeCompare(right));
  if (!models.length) throw new Error("GroqCloud no devolvió modelos disponibles.");
  return models;
}

export async function requestGroqAiJson(
  configuration: GroqAiConfiguration,
  systemPrompt: string,
  userPrompt: string,
): Promise<unknown> {
  assertApiKey(configuration.apiKey);
  const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${configuration.apiKey}`,
      "Content-Type": "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: configuration.model,
      stream: false,
      max_completion_tokens: 10_000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("GroqCloud no pudo generar la propuesta.");
  }
  const text = await response.text();
  if (text.length > 500_000) throw new Error("La respuesta de GroqCloud supera el tamaño permitido.");

  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error("GroqCloud devolvió una respuesta no válida.");
  }
  const content = (envelope as {
    choices?: Array<{ message?: { content?: unknown } }>;
  })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length > 100_000) {
    throw new Error("GroqCloud no devolvió el plan esperado.");
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error("GroqCloud no devolvió JSON válido para la propuesta.");
  }
}
