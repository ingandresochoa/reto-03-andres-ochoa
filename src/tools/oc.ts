import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { logTool, readCsv } from "../domain/fs";
import {
  construirCaso,
  crearCaso,
  evidenciaCaso,
  leerCaso,
  validarCaso,
} from "../domain/service";
import type { ToolContext } from "../domain/types";

/* ------------------------------------------------------------------ */
/* Utilidades comunes                                                  */
/* ------------------------------------------------------------------ */

function ok(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}

function fail(error: string): string {
  return JSON.stringify({ ok: false, error });
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fallo(
  ctx: ToolContext,
  herramienta: string,
  caso: string | undefined,
  error: unknown,
): string {
  const texto = mensaje(error);
  logTool(ctx.directory, { herramienta, caso, ok: false, resumen: texto });
  return fail(texto);
}

export type ToolEntry<Args = Record<string, unknown>> = {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (args: Args, ctx: ToolContext) => Promise<string>;
};

/* ------------------------------------------------------------------ */
/* oc_leer_paquete                                                     */
/* ------------------------------------------------------------------ */

export const leer_paquete: ToolEntry<{ caso: string }> = {
  description:
    "Lee y normaliza el paquete documental de un caso: correo, solicitud, cotización, aprobación y factura.",
  args: {
    caso: z
      .string()
      .describe(
        "Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (por ejemplo sol-001)",
      ),
  },
  async execute(args: { caso: string }, ctx) {
    try {
      const paquete = leerCaso(ctx.directory, args.caso);
      logTool(ctx.directory, {
        herramienta: "oc_leer_paquete",
        caso: args.caso,
        ok: true,
        resumen: `Paquete ${paquete.solicitud.solicitud_id} leído`,
      });
      return ok(paquete);
    } catch (error) {
      return fallo(ctx, "oc_leer_paquete", args.caso, error);
    }
  },
};

/* ------------------------------------------------------------------ */
/* oc_validar                                                          */
/* ------------------------------------------------------------------ */

export const validar: ToolEntry<{ caso: string }> = {
  description:
    "Aplica las reglas RC1–RC10 y devuelve si la orden es apta, los bloqueos, las confirmaciones y los valores derivados.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
  },
  async execute(args: { caso: string }, ctx) {
    try {
      // La decisión siempre se recalcula desde el caso canónico. Si el modelo
      // envía `paquete`, zod lo ignora: no es fuente de verdad.
      const { validacion } = validarCaso(ctx.directory, args.caso);
      logTool(ctx.directory, {
        herramienta: "oc_validar",
        caso: args.caso,
        ok: true,
        resumen: validacion.apta
          ? `apta; confirmaciones=${validacion.confirmaciones.length}`
          : `bloqueada; bloqueos=${validacion.bloqueos.length}`,
      });
      return ok(validacion);
    } catch (error) {
      return fallo(ctx, "oc_validar", args.caso, error);
    }
  },
};

/* ------------------------------------------------------------------ */
/* oc_construir_payload                                                */
/* ------------------------------------------------------------------ */

export const construir_payload: ToolEntry<{ caso: string }> = {
  description:
    "Construye y valida con zod el payload de la orden de compra y escribe la trazabilidad de cada valor.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
  },
  async execute(args: { caso: string }, ctx) {
    try {
      // Relee el caso y recalcula los derivados: no depende de que el modelo
      // repita el paquete ni los valores derivados.
      const { orden, ruta_trazabilidad } = construirCaso(ctx.directory, args.caso);
      logTool(ctx.directory, {
        herramienta: "oc_construir_payload",
        caso: args.caso,
        ok: true,
        resumen: `Payload válido para ${orden.referencia.solicitud_id}`,
      });
      return ok({ orden, ruta_trazabilidad });
    } catch (error) {
      return fallo(ctx, "oc_construir_payload", args.caso, error);
    }
  },
};

/* ------------------------------------------------------------------ */
/* oc_generar_evidencia                                                */
/* ------------------------------------------------------------------ */

export const generar_evidencia: ToolEntry<{ caso: string }> = {
  description:
    "Genera el archivo de evidencia de la aprobación y devuelve su ruta y hash SHA-256.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
  },
  async execute(args: { caso: string }, ctx) {
    try {
      const evidencia = evidenciaCaso(ctx.directory, args.caso);
      logTool(ctx.directory, {
        herramienta: "oc_generar_evidencia",
        caso: args.caso,
        ok: true,
        resumen: `Evidencia ${evidencia.ruta} (${evidencia.sha256.slice(0, 12)}…)`,
      });
      return ok(evidencia);
    } catch (error) {
      return fallo(ctx, "oc_generar_evidencia", args.caso, error);
    }
  },
};

/* ------------------------------------------------------------------ */
/* oc_crear                                                            */
/* ------------------------------------------------------------------ */

export const crear: ToolEntry<{
  caso: string;
  confirmado?: boolean;
}> = {
  description:
    "Crea la orden de compra en el SAP simulado si el caso es apto y las excepciones están confirmadas; es idempotente por solicitud_id.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
    confirmado: z
      .boolean()
      .optional()
      .describe(
        "true solo si el usuario confirmó explícitamente las excepciones en el chat",
      ),
  },
  async execute(args: { caso: string; confirmado?: boolean }, ctx) {
    try {
      // `crearCaso` reconstruye el payload desde el caso y revalida; cualquier
      // `payload` enviado por el modelo se ignora (zod lo descarta).
      const resultado = await crearCaso(
        ctx.directory,
        args.caso,
        args.confirmado ?? false,
      );
      if (!resultado.ok) {
        logTool(ctx.directory, {
          herramienta: "oc_crear",
          caso: args.caso,
          ok: false,
          resumen: resultado.error,
        });
        return fail(resultado.error);
      }
      logTool(ctx.directory, {
        herramienta: "oc_crear",
        caso: args.caso,
        ok: true,
        resumen: `OC ${resultado.data.numero_oc}${
          resultado.data.idempotente ? " (idempotente)" : ""
        }`,
      });
      return ok(resultado.data);
    } catch (error) {
      return fallo(ctx, "oc_crear", args.caso, error);
    }
  },
};

/* ------------------------------------------------------------------ */
/* oc_leer_excel (P1)                                                  */
/* ------------------------------------------------------------------ */

export const leer_excel: ToolEntry<{ ruta: string }> = {
  description:
    "Lee una solicitud normalizada en JSON o CSV (P1). Los .xlsx binarios no se procesan en esta demo.",
  args: {
    ruta: z
      .string()
      .describe("Ruta del archivo relativa a la raíz del proyecto"),
  },
  async execute(args: { ruta: string }, ctx) {
    try {
      const raiz = path.resolve(ctx.directory);
      const absoluta = path.resolve(raiz, args.ruta);
      if (absoluta !== raiz && !absoluta.startsWith(raiz + path.sep)) {
        throw new Error("La ruta debe estar dentro del proyecto");
      }
      if (!fs.existsSync(absoluta)) {
        throw new Error(`No existe el archivo: ${args.ruta}`);
      }

      const extension = path.extname(absoluta).toLowerCase();
      let filas: unknown[];
      if (extension === ".xlsx") {
        throw new Error(
          "Los .xlsx binarios no se procesan; use la versión normalizada .json o .csv",
        );
      }
      if (extension === ".json") {
        const data: unknown = JSON.parse(fs.readFileSync(absoluta, "utf8"));
        filas = Array.isArray(data) ? data : [data];
      } else if (extension === ".csv") {
        filas = readCsv(absoluta);
      } else {
        throw new Error(`Extensión no soportada: ${extension || "(sin extensión)"}`);
      }

      logTool(ctx.directory, {
        herramienta: "oc_leer_excel",
        ok: true,
        resumen: `${filas.length} fila(s) leídas de ${args.ruta}`,
      });
      return ok({ filas });
    } catch (error) {
      return fallo(ctx, "oc_leer_excel", undefined, error);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Registro de herramientas                                            */
/* ------------------------------------------------------------------ */

export const TOOLS = {
  leer_paquete,
  validar,
  construir_payload,
  generar_evidencia,
  crear,
  leer_excel,
};

export type ToolKey = keyof typeof TOOLS;
export type ToolName = `oc_${ToolKey}`;

/**
 * Ejecuta una herramienta con argumentos ya validados por zod.
 * El cast es seguro: el llamador valida con el mismo `args` de la entrada.
 */
export async function ejecutarTool(
  key: ToolKey,
  args: unknown,
  ctx: ToolContext,
): Promise<string> {
  const entrada = TOOLS[key] as unknown as ToolEntry<unknown>;
  return entrada.execute(args, ctx);
}

/** Nombre expuesto al modelo: `<archivo>_<export>` (PRD 6.2). */
export function nombreHerramienta(key: ToolKey): ToolName {
  return `oc_${key}`;
}

/** Definiciones en formato function-calling (OpenAI / Groq). */
export function definicionesHerramientas() {
  return (Object.keys(TOOLS) as ToolKey[]).map((key) => ({
    type: "function" as const,
    function: {
      name: nombreHerramienta(key),
      description: TOOLS[key].description,
      parameters: zodToJsonSchema(z.object(TOOLS[key].args), {
        target: "openAi",
        $refStrategy: "none",
      }),
    },
  }));
}
