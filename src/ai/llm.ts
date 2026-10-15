import OpenAI from "openai";
import type { z } from "zod";
import { config } from "../config";

/** Any OpenAI-compatible provider (Groq by default; Gemini / OpenRouter work via LLM_BASE_URL). */
const client = config.LLM_API_KEY
  ? new OpenAI({ apiKey: config.LLM_API_KEY, baseURL: config.LLM_BASE_URL, maxRetries: 5, timeout: 90_000 })
  : null;

export const llmEnabled = () => client !== null;

/** Chat completion constrained to JSON and validated against a zod schema. */
export async function chatJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  if (!client) throw new Error("LLM is not configured (LLM_API_KEY is empty)");
  const res = await client.chat.completions.create({
    model: config.LLM_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text = res.choices[0]?.message.content ?? "";
  return schema.parse(JSON.parse(text));
}

const sttClient = config.STT_API_KEY
  ? new OpenAI({ apiKey: config.STT_API_KEY, baseURL: config.STT_BASE_URL, maxRetries: 3, timeout: 300_000 })
  : null;

export const sttEnabled = () => sttClient !== null;

export async function transcribe(file: Parameters<OpenAI["audio"]["transcriptions"]["create"]>[0]["file"]) {
  if (!sttClient) throw new Error("STT is not configured");
  const res = await sttClient.audio.transcriptions.create({ file, model: config.STT_MODEL, response_format: "text" });
  return String(res);
}
