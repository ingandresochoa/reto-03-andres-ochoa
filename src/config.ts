import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Raíz del proyecto (carpeta que contiene package.json, fixtures/ y out/). */
export const ROOT = path.resolve(here, "..");

// Carga .env desde la raíz del proyecto, sin depender del directorio de trabajo.
dotenv.config({ path: path.join(ROOT, ".env") });

export const config = {
  root: ROOT,
  port: Number(process.env.PORT ?? 3000),
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  groqBaseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  maxIterations: Number(process.env.MAX_ITERATIONS ?? 25),
  maxTokensPerSession: Number(process.env.MAX_TOKENS_PER_SESSION ?? 120_000),
  /** Timeout de una llamada al proveedor LLM (ms). */
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30_000),
} as const;

/**
 * Fecha "hoy" usada por el adaptador SAP y los reportes.
 * `DEMO_FECHA` permite fijarla para que la demo sea determinista.
 */
export function hoyISO(): string {
  const fixed = process.env.DEMO_FECHA?.trim();
  if (fixed) return fixed;
  return new Date().toISOString().slice(0, 10);
}
