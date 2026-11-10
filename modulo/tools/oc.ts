/**
 * Bonus — herramientas reutilizables fuera del servidor.
 *
 * Este archivo NO duplica la lógica: re-exporta el registro real que usa la
 * aplicación (`src/tools/oc.ts`) y sus tipos. Así cualquier plataforma de
 * agentes puede importar `TOOLS`, `definicionesHerramientas()` y
 * `ejecutarTool()` sin levantar Express ni el front.
 *
 * Ejemplo de integración:
 *
 * ```ts
 * import { TOOLS, definicionesHerramientas, ejecutarTool } from "./modulo/tools/oc";
 *
 * const herramientas = definicionesHerramientas(); // function calling
 * const ctx = { directory: process.cwd(), sessionId: "ses-1" };
 * const salida = await ejecutarTool("leer_paquete", { caso: "sol-001" }, ctx);
 * ```
 *
 * Si se copia `modulo/` a otro repositorio, hay que llevar también `src/domain/`,
 * `src/sap/`, `src/config.ts` y `fixtures/`; el módulo no depende del servidor,
 * pero sí del dominio determinista.
 */

export {
  TOOLS,
  crear,
  construir_payload,
  definicionesHerramientas,
  ejecutarTool,
  generar_evidencia,
  leer_excel,
  leer_paquete,
  nombreHerramienta,
  validar,
} from "../../src/tools/oc";

export type { ToolEntry, ToolKey, ToolName } from "../../src/tools/oc";
export type { ToolContext } from "../../src/domain/types";
