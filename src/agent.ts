import path from "node:path";
import { z } from "zod";
import { ROOT, config } from "./config";
import { readText } from "./domain/fs";
import type { ToolContext } from "./domain/types";
import type {
  LlmAdapter,
  LlmMessage,
  LlmToolCall,
  LlmToolDefinition,
} from "./llm/adapter";
import {
  TOOLS,
  definicionesHerramientas,
  ejecutarTool,
  nombreHerramienta,
  type ToolKey,
} from "./tools/oc";

/* ------------------------------------------------------------------ */
/* Tipos de sesión y de turno                                          */
/* ------------------------------------------------------------------ */

export type ToolCallRecord = {
  name: string;
  args: unknown;
  ok: boolean;
  resumen: string;
  result: unknown;
};

export type PendingConfirmation = {
  caso: string;
  excepciones: string[];
  /** Turno en el que se pidió la confirmación (para exigir un turno posterior). */
  turn: number;
};

export type HistoryEntry =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCallRecord[] };

export type Session = {
  id: string;
  /** Mensajes en formato del proveedor LLM (incluye system y tool). */
  messages: LlmMessage[];
  /** Historial simplificado para el front. */
  history: HistoryEntry[];
  /** Todas las llamadas a herramientas de la sesión. */
  toolCalls: ToolCallRecord[];
  pendingConfirmation: PendingConfirmation | null;
  tokens: number;
  turn: number;
  lastUserMessage: string;
};

export type AgentTurn = {
  reply: string;
  toolCalls: ToolCallRecord[];
  needsConfirmation: boolean;
};

/* ------------------------------------------------------------------ */
/* Prompt de sistema (comportamiento + conocimiento)                   */
/* ------------------------------------------------------------------ */

function leerSiExiste(ruta: string, fallback: string): string {
  try {
    return readText(ruta);
  } catch {
    return fallback;
  }
}

function cargarSystemPrompt(root: string): string {
  const comportamiento = leerSiExiste(
    path.join(root, "agent", "prompt.md"),
    "Eres un asistente de compras. Usa las herramientas para obtener todos los valores.",
  );
  const conocimiento = leerSiExiste(
    path.join(root, "src", "knowledge", "ordenes-compra.md"),
    "",
  );
  return `${comportamiento}\n\n---\n\n# Base de conocimiento\n\n${conocimiento}`;
}

const SYSTEM_PROMPT = cargarSystemPrompt(ROOT);

/* ------------------------------------------------------------------ */
/* Registro de herramientas                                            */
/* ------------------------------------------------------------------ */

const TOOL_POR_NOMBRE = new Map<string, ToolKey>();
for (const key of Object.keys(TOOLS) as ToolKey[]) {
  TOOL_POR_NOMBRE.set(nombreHerramienta(key), key);
}

const HERRAMIENTAS: LlmToolDefinition[] = definicionesHerramientas();

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/** Detecta una confirmación explícita del usuario en español. */
export function esAfirmativo(texto: string): boolean {
  return /\b(s[ií]|confirmo|confirmado|confirma|adelante|procede|autorizo|de acuerdo|ok|dale|claro)\b/i.test(
    texto,
  );
}

function parsearResultado(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return texto;
  }
}

/**
 * Forma laxa de los `data` que devuelven las herramientas. Solo se usa para
 * resumir la llamada en el front; los valores reales los valida zod en cada
 * herramienta.
 */
type ResultadoData = {
  solicitud?: { solicitud_id?: string };
  apta?: boolean;
  confirmaciones?: Array<{ codigo: string; detalle: string }>;
  bloqueos?: Array<{ codigo: string; detalle: string }>;
  orden?: { referencia?: { solicitud_id?: string } };
  ruta?: string;
  numero_oc?: string;
  idempotente?: boolean;
  filas?: unknown[];
};

function resumir(nombre: string, parsed: unknown): string {
  if (typeof parsed !== "object" || parsed === null) {
    return "resultado no interpretable";
  }
  const sobre = parsed as { ok?: boolean; error?: string; data?: ResultadoData };
  if (sobre.ok === false) return sobre.error ?? "error";
  const data = sobre.data;
  switch (nombre) {
    case "oc_leer_paquete":
      return `Solicitud ${data?.solicitud?.solicitud_id ?? "?"}`;
    case "oc_validar":
      return data?.apta
        ? `apta; ${data?.confirmaciones?.length ?? 0} confirmación(es)`
        : `bloqueada; ${data?.bloqueos?.length ?? 0} bloqueo(s)`;
    case "oc_construir_payload":
      return `Payload ${data?.orden?.referencia?.solicitud_id ?? ""}`;
    case "oc_generar_evidencia":
      return `Evidencia ${data?.ruta ?? ""}`;
    case "oc_crear":
      return `OC ${data?.numero_oc ?? ""}${data?.idempotente ? " (idempotente)" : ""}`;
    case "oc_leer_excel":
      return `${data?.filas?.length ?? 0} fila(s)`;
    default:
      return "ok";
  }
}

/* ------------------------------------------------------------------ */
/* Sesión                                                              */
/* ------------------------------------------------------------------ */

export function crearSesion(id: string): Session {
  return {
    id,
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
    history: [],
    toolCalls: [],
    pendingConfirmation: null,
    tokens: 0,
    turn: 0,
    lastUserMessage: "",
  };
}

/* ------------------------------------------------------------------ */
/* Ciclo del agente                                                    */
/* ------------------------------------------------------------------ */

export class Agent {
  constructor(
    private readonly llm: LlmAdapter,
    /** Raíz del proyecto; permite aislar fixtures/out en pruebas. */
    private readonly root: string = ROOT,
  ) {}

  async run(session: Session, mensaje: string): Promise<AgentTurn> {
    session.turn += 1;
    session.lastUserMessage = mensaje;
    session.messages.push({ role: "user", content: mensaje });
    session.history.push({ role: "user", content: mensaje });

    const llamadasTurno: ToolCallRecord[] = [];
    let ultimoContenido = "";
    let iteraciones = 0;

    while (iteraciones < config.maxIterations) {
      iteraciones += 1;

      if (session.tokens > config.maxTokensPerSession) {
        return this.cerrar(
          session,
          llamadasTurno,
          "Se alcanzó el límite de tokens de la sesión. Abre una conversación nueva para continuar.",
        );
      }

      let respuesta;
      try {
        respuesta = await this.llm.enviar(session.messages, HERRAMIENTAS);
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        return this.cerrar(
          session,
          llamadasTurno,
          `No pude comunicarme con el proveedor LLM: ${detalle}`,
        );
      }

      session.tokens += respuesta.usage.totalTokens;
      if (respuesta.content) ultimoContenido = respuesta.content;

      session.messages.push({
        role: "assistant",
        content: respuesta.content,
        tool_calls:
          respuesta.toolCalls.length > 0 ? respuesta.toolCalls : undefined,
      });

      if (respuesta.toolCalls.length === 0) {
        const reply =
          respuesta.content?.trim() || ultimoContenido.trim() || "Listo.";
        return this.cerrar(session, llamadasTurno, reply);
      }

      for (const llamada of respuesta.toolCalls) {
        const registro = await this.ejecutarHerramienta(session, llamada);
        llamadasTurno.push(registro);
        session.toolCalls.push(registro);
        session.messages.push({
          role: "tool",
          tool_call_id: llamada.id,
          content: JSON.stringify(registro.result),
        });
      }
    }

    const reply = `Alcancé el límite de ${config.maxIterations} iteraciones en este turno. ${
      ultimoContenido
        ? `Esto es lo que tengo: ${ultimoContenido}`
        : "No obtuve una respuesta final del modelo."
    }`;
    return this.cerrar(session, llamadasTurno, reply);
  }

  private cerrar(
    session: Session,
    llamadasTurno: ToolCallRecord[],
    reply: string,
  ): AgentTurn {
    session.history.push({
      role: "assistant",
      content: reply,
      toolCalls: llamadasTurno,
    });
    return {
      reply,
      toolCalls: llamadasTurno,
      needsConfirmation: session.pendingConfirmation !== null,
    };
  }

  private async ejecutarHerramienta(
    session: Session,
    llamada: LlmToolCall,
  ): Promise<ToolCallRecord> {
    const key = TOOL_POR_NOMBRE.get(llamada.function.name);
    if (!key) {
      return {
        name: llamada.function.name,
        args: null,
        ok: false,
        resumen: "Herramienta desconocida",
        result: {
          ok: false,
          error: `Herramienta desconocida: ${llamada.function.name}`,
        },
      };
    }

    let args: unknown;
    try {
      args = JSON.parse(llamada.function.arguments || "{}") as unknown;
    } catch {
      return {
        name: llamada.function.name,
        args: llamada.function.arguments,
        ok: false,
        resumen: "Argumentos JSON inválidos",
        result: {
          ok: false,
          error: "Los argumentos de la herramienta no son JSON válido.",
        },
      };
    }

    const schema = z.object(TOOLS[key].args);
    const validacion = schema.safeParse(args);
    if (!validacion.success) {
      const error = validacion.error.issues
        .map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
        .join("; ");
      return {
        name: llamada.function.name,
        args,
        ok: false,
        resumen: `Argumentos inválidos: ${error}`,
        result: { ok: false, error: `Argumentos inválidos: ${error}` },
      };
    }

    const datos = validacion.data as {
      caso?: string;
      confirmado?: boolean;
    };

    // Puerta de confirmación humana (CA3). No se permite crear con
    // confirmado=true en el mismo turno de la validación ni sin un mensaje
    // afirmativo del usuario.
    if (key === "crear" && datos.confirmado === true) {
      const pendiente = session.pendingConfirmation;
      if (pendiente) {
        if (pendiente.caso !== datos.caso) {
          return {
            name: llamada.function.name,
            args,
            ok: false,
            resumen: "Confirmación de otro caso",
            result: {
              ok: false,
              error: `La confirmación pendiente es para ${pendiente.caso}, no para ${datos.caso}.`,
            },
          };
        }
        if (pendiente.turn === session.turn) {
          return {
            name: llamada.function.name,
            args,
            ok: false,
            resumen: "Falta el turno de confirmación",
            result: {
              ok: false,
              error:
                "Debes pedir confirmación al usuario y esperar su respuesta en el siguiente mensaje antes de crear la OC.",
            },
          };
        }
        if (!esAfirmativo(session.lastUserMessage)) {
          return {
            name: llamada.function.name,
            args,
            ok: false,
            resumen: "El usuario no confirmó",
            result: {
              ok: false,
              error:
                "El mensaje más reciente del usuario no confirma la creación. Pregúntale explícitamente.",
            },
          };
        }
      }
    }

    const ctx: ToolContext = { directory: this.root, sessionId: session.id };
    const texto = await ejecutarTool(key, validacion.data, ctx);
    const parsed = parsearResultado(texto);
    const ok =
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { ok?: boolean }).ok === true;

    if (key === "validar" && ok) {
      const data = (
        parsed as {
          data: {
            apta: boolean;
            confirmaciones: Array<{ codigo: string; detalle: string }>;
          };
        }
      ).data;
      if (data.apta && data.confirmaciones.length > 0) {
        const previo = session.pendingConfirmation;
        const caso = datos.caso ?? "";
        session.pendingConfirmation = {
          caso,
          excepciones: data.confirmaciones.map((item) => item.codigo),
          // Si el modelo re-valida el mismo caso en el turno de confirmación,
          // se conserva el turno original para no bloquear la creación.
          turn: previo && previo.caso === caso ? previo.turn : session.turn,
        };
      } else {
        session.pendingConfirmation = null;
      }
    }

    if (key === "crear" && ok) {
      session.pendingConfirmation = null;
    }

    return {
      name: llamada.function.name,
      args,
      ok,
      resumen: resumir(llamada.function.name, parsed),
      result: parsed,
    };
  }
}
