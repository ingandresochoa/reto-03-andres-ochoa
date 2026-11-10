/**
 * Interfaz propia del proveedor LLM.
 *
 * El ciclo del agente (`src/agent.ts`) solo conoce estos tipos. Cambiar de
 * proveedor implica crear otra implementación de `LlmAdapter` sin tocar el
 * bucle, las herramientas ni el servidor.
 */

export type LlmToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: LlmToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type LlmResponse = {
  content: string | null;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
};

export interface LlmAdapter {
  enviar(
    mensajes: LlmMessage[],
    herramientas: LlmToolDefinition[],
  ): Promise<LlmResponse>;
}
