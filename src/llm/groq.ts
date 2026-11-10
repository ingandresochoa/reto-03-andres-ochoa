import OpenAI from "openai";
import { config } from "../config";
import type {
  LlmAdapter,
  LlmMessage,
  LlmResponse,
  LlmToolDefinition,
} from "./adapter";

/**
 * Adaptador de Groq.
 *
 * Groq expone una API compatible con la de OpenAI; solo cambia `baseURL`.
 * La clave se lee de `GROQ_API_KEY` y nunca se envía al front ni se registra.
 */
export class GroqAdapter implements LlmAdapter {
  private readonly client: OpenAI | null;

  constructor() {
    this.client = config.groqApiKey
      ? new OpenAI({
          apiKey: config.groqApiKey,
          baseURL: config.groqBaseUrl,
          timeout: config.llmTimeoutMs,
          maxRetries: 3,
        })
      : null;
  }

  /** Indica si hay clave configurada (para `/api/health`, sin exponerla). */
  get configurado(): boolean {
    return this.client !== null;
  }

  async enviar(
    mensajes: LlmMessage[],
    herramientas: LlmToolDefinition[],
  ): Promise<LlmResponse> {
    if (!this.client) {
      throw new Error(
        "Falta GROQ_API_KEY. Configúrala en .env para usar el chat (demo.ts no la necesita).",
      );
    }

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create({
        model: config.groqModel,
        messages:
          mensajes as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        tools:
          herramientas as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 1024,
      });
    } catch (error) {
      const nombre =
        error instanceof Error ? error.name : "";
      if (nombre === "APIConnectionTimeoutError" || nombre === "AbortError") {
        throw new Error(
          `El proveedor LLM no respondió en ${Math.round(
            config.llmTimeoutMs / 1000,
          )} s. Intenta de nuevo en unos segundos.`,
        );
      }
      const detalle = error instanceof Error ? error.message : String(error);
      throw new Error(`El proveedor LLM devolvió un error: ${detalle}`);
    }

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error("El proveedor LLM devolvió una respuesta vacía.");
    }

    return {
      content: message.content ?? null,
      toolCalls: (message.tool_calls ?? []).map((llamada) => ({
        id: llamada.id,
        type: "function" as const,
        function: {
          name: llamada.function.name,
          arguments: llamada.function.arguments,
        },
      })),
      usage: {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
      },
    };
  }
}
