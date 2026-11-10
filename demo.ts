import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./src/config";
import { cleanOut, ensureOut, rel } from "./src/domain/fs";
import type {
  OrdenCompra,
  Paquete,
  ToolContext,
  Validacion,
} from "./src/domain/types";
import { ejecutarTool, type ToolKey } from "./src/tools/oc";

/**
 * Verificación determinista del flujo completo, SIN clave de LLM.
 *
 * Procesa los 6 casos del fixture llamando directamente a las herramientas
 * (`oc_leer_paquete`, `oc_validar`, `oc_construir_payload`,
 * `oc_generar_evidencia` y `oc_crear`) a través de la misma capa de
 * ejecución que usa el agente, así que cada llamada queda registrada en
 * `out/log.jsonl` (PRD 6.6 y CA4). Muestra por caso: `apta`, bloqueos,
 * confirmaciones, derivados, `retroactiva` y el número de OC o el motivo.
 * Al final repite `sol-001` para demostrar la idempotencia y la puerta de
 * confirmación se ejercita con `sol-004`, `sol-005` y `sol-006`.
 */

// Fecha fija para que la demo sea determinista (ver config.hoyISO).
process.env.DEMO_FECHA ||= "2026-09-03";

const CASOS = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"];

/** Contexto de las herramientas: misma raíz del proyecto, sesión de demo. */
const CTX: ToolContext = { directory: ROOT, sessionId: "demo" };

type FilaResumen = {
  caso: string;
  resultado: string;
  numeroOc: string;
};

type Respuesta<T> = { ok: true; data: T } | { ok: false; error: string };

function lista(items: Array<{ codigo: string; detalle: string }>): string {
  if (items.length === 0) return "(ninguno)";
  return items.map((item) => `${item.codigo}: ${item.detalle}`).join(" | ");
}

function imprimirValidacion(validacion: Validacion): void {
  console.log(`apta: ${validacion.apta}`);
  console.log(`bloqueos: ${lista(validacion.bloqueos)}`);
  console.log(`confirmaciones: ${lista(validacion.confirmaciones)}`);
  console.log(`derivados: ${JSON.stringify(validacion.derivados)}`);
  console.log(`retroactiva: ${validacion.retroactiva}`);
}

/** Llama a una herramienta y parsea su respuesta JSON tipada. */
async function llamar<T>(
  key: ToolKey,
  args: Record<string, unknown>,
): Promise<Respuesta<T>> {
  const texto = await ejecutarTool(key, args, CTX);
  return JSON.parse(texto) as Respuesta<T>;
}

function existe(rutaRelativa: string): boolean {
  return fs.existsSync(path.join(ROOT, rutaRelativa));
}

async function main(): Promise<void> {
  cleanOut(ROOT);
  ensureOut(ROOT);

  const resumen: FilaResumen[] = [];

  for (const caso of CASOS) {
    console.log(`\n=== ${caso} ===`);

    // 1) Leer el paquete (HU-1).
    const paquete = await llamar<Paquete>("leer_paquete", { caso });
    if (!paquete.ok) {
      console.log(`oc_leer_paquete: ERROR — ${paquete.error}`);
      resumen.push({ caso, resultado: "error", numeroOc: "—" });
      continue;
    }
    console.log(`oc_leer_paquete: ${paquete.data.solicitud.solicitud_id}`);

    // 2) Validar RC1–RC10 (HU-2).
    const validacion = await llamar<Validacion>("validar", { caso });
    if (!validacion.ok) {
      console.log(`oc_validar: ERROR — ${validacion.error}`);
      resumen.push({ caso, resultado: "error", numeroOc: "—" });
      continue;
    }
    imprimirValidacion(validacion.data);

    if (!validacion.data.apta) {
      console.log("resultado: BLOQUEADO — no se crea la OC");
      resumen.push({ caso, resultado: "bloqueado", numeroOc: "—" });
      continue;
    }

    // 3) Payload y evidencia (HU-3, HU-4).
    const payload = await llamar<{
      orden: OrdenCompra;
      ruta_trazabilidad: string;
    }>("construir_payload", { caso });
    console.log(
      payload.ok
        ? `oc_construir_payload: válido · trazabilidad ${payload.data.ruta_trazabilidad}`
        : `oc_construir_payload: ERROR — ${payload.error}`,
    );

    const evidencia = await llamar<{ ruta: string; sha256: string }>(
      "generar_evidencia",
      { caso },
    );
    console.log(
      evidencia.ok
        ? `oc_generar_evidencia: ${evidencia.data.ruta} (sha256 ${evidencia.data.sha256.slice(0, 12)}…)`
        : `oc_generar_evidencia: ERROR — ${evidencia.error}`,
    );

    // 4) Crear (HU-5): la puerta de confirmación se ejercita dos veces.
    if (validacion.data.confirmaciones.length > 0) {
      const sinConfirmar = await llamar<{ numero_oc: string }>("crear", { caso });
      console.log(
        sinConfirmar.ok
          ? `oc_crear sin confirmar: OC ${sinConfirmar.data.numero_oc} (inesperado)`
          : `oc_crear sin confirmar: rechazada — ${sinConfirmar.error}`,
      );

      const confirmado = await llamar<{ numero_oc: string; fecha: string }>(
        "crear",
        { caso, confirmado: true },
      );
      if (!confirmado.ok) {
        console.log(`oc_crear con confirmación: ERROR — ${confirmado.error}`);
        resumen.push({ caso, resultado: "error", numeroOc: "—" });
        continue;
      }
      console.log(
        `oc_crear con confirmación: OC ${confirmado.data.numero_oc} creada (${confirmado.data.fecha})`,
      );
      resumen.push({
        caso,
        resultado: "creado",
        numeroOc: confirmado.data.numero_oc,
      });
      continue;
    }

    const creado = await llamar<{ numero_oc: string; fecha: string }>("crear", {
      caso,
    });
    if (!creado.ok) {
      console.log(`resultado: ERROR — ${creado.error}`);
      resumen.push({ caso, resultado: "error", numeroOc: "—" });
      continue;
    }
    console.log(
      `resultado: OC ${creado.data.numero_oc} creada (${creado.data.fecha})`,
    );
    resumen.push({ caso, resultado: "creado", numeroOc: creado.data.numero_oc });
  }

  // Idempotencia: repetir sol-001 no debe generar una segunda OC.
  console.log("\n=== sol-001 (segunda vez) ===");
  const idempotente = await llamar<{
    numero_oc: string;
    idempotente: boolean;
  }>("crear", { caso: "sol-001" });
  if (idempotente.ok) {
    console.log(
      `resultado: idempotente=${idempotente.data.idempotente} OC=${idempotente.data.numero_oc}`,
    );
    resumen.push({
      caso: "sol-001 (2.ª)",
      resultado: idempotente.data.idempotente ? "idempotente" : "creado",
      numeroOc: idempotente.data.numero_oc,
    });
  } else {
    console.log(`resultado: ERROR — ${idempotente.error}`);
    resumen.push({ caso: "sol-001 (2.ª)", resultado: "error", numeroOc: "—" });
  }

  // Resumen de la corrida.
  console.log("\n=== RESUMEN ===");
  for (const fila of resumen) {
    console.log(
      `${fila.caso.padEnd(14)} ${fila.resultado.padEnd(14)} ${fila.numeroOc}`,
    );
  }

  // Artefactos generados.
  console.log("\n=== ARTEFACTOS ===");
  const artefactos = [
    "out/sap/ordenes.jsonl",
    "out/control.csv",
    "out/log.jsonl",
    ...CASOS.map((caso) => `out/${caso}/aprobacion.txt`),
    ...CASOS.map((caso) => `out/${caso}/trazabilidad.json`),
  ];
  for (const ruta of artefactos) {
    console.log(`${existe(ruta) ? "✓" : "·"} ${ruta}`);
  }

  const control = path.join(ROOT, "out", "control.csv");
  if (fs.existsSync(control)) {
    console.log("\n=== out/control.csv ===");
    console.log(fs.readFileSync(control, "utf8").trimEnd());
  }

  const log = path.join(ROOT, "out", "log.jsonl");
  if (fs.existsSync(log)) {
    const lineas = fs
      .readFileSync(log, "utf8")
      .split(/\r?\n/)
      .filter((linea) => linea.trim().length > 0);
    const porHerramienta = new Map<string, number>();
    for (const linea of lineas) {
      const registro = JSON.parse(linea) as { herramienta: string };
      porHerramienta.set(
        registro.herramienta,
        (porHerramienta.get(registro.herramienta) ?? 0) + 1,
      );
    }
    console.log("\n=== out/log.jsonl (llamadas a herramientas) ===");
    for (const [herramienta, cantidad] of porHerramienta) {
      console.log(`${herramienta.padEnd(22)} ${cantidad}`);
    }
    console.log(`total: ${lineas.length}`);
  }

  const ordenes = path.join(ROOT, "out", "sap", "ordenes.jsonl");
  if (fs.existsSync(ordenes)) {
    console.log("\n=== out/sap/ordenes.jsonl (resumen) ===");
    const lineas = fs
      .readFileSync(ordenes, "utf8")
      .split(/\r?\n/)
      .filter((linea) => linea.trim().length > 0);
    for (const linea of lineas) {
      const registro = JSON.parse(linea) as {
        numero_oc: string;
        fecha: string;
        solicitud_id: string;
      };
      console.log(
        `${registro.numero_oc} · ${registro.solicitud_id} · ${registro.fecha}`,
      );
    }
  }

  console.log(`\nRaíz de artefactos: ${rel(ROOT, path.join(ROOT, "out"))}`);
}

main().catch((error) => {
  console.error("La demo falló:", error);
  process.exitCode = 1;
});
