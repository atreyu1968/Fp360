import { isIP } from "node:net";

export type LocalAiConfiguration = {
  baseUrl: string;
  model: string;
};

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isLocalHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd");
  return normalized === "localhost" || normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") || normalized.endsWith(".internal") || !normalized.includes(".");
}

export function normalizeLocalAiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Introduce una URL válida para la API local.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("La API debe usar HTTP(S), sin credenciales, parámetros ni fragmentos en la URL.");
  }
  if (!isLocalHost(url.hostname)) {
    throw new Error("Solo se admiten endpoints locales o de red privada para proteger los datos de la empresa.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

function endpoint(baseUrl: string, path: string): string {
  const url = new URL(normalizeLocalAiBaseUrl(baseUrl));
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  return url.toString();
}

export async function checkLocalAiEndpoint(configuration: LocalAiConfiguration): Promise<void> {
  const response = await fetch(endpoint(configuration.baseUrl, "/models"), {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("El endpoint local no respondió correctamente.");
  await response.body?.cancel();
}

export async function requestLocalAiJson(
  configuration: LocalAiConfiguration,
  systemPrompt: string,
  userPrompt: string,
): Promise<unknown> {
  const response = await fetch(endpoint(configuration.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: configuration.model,
      stream: false,
      max_tokens: 10_000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("El modelo local no pudo generar la propuesta.");
  }
  const text = await response.text();
  if (text.length > 500_000) throw new Error("La respuesta del modelo supera el tamaño permitido.");
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error("El modelo local devolvió una respuesta no válida.");
  }
  const content = (envelope as {
    choices?: Array<{ message?: { content?: unknown } }>;
  })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length > 100_000) {
    throw new Error("El modelo local no devolvió el plan esperado.");
  }
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error("El modelo local no devolvió JSON válido para la propuesta.");
  }
}
