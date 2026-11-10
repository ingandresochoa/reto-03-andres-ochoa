import fs from "node:fs";
import path from "node:path";
import { appendCsvRow, outDir } from "./fs";
import type { Paquete, Validacion } from "./types";

const HEADER = [
  "solicitud_id",
  "resultado",
  "numero_oc",
  "retroactiva",
  "bloqueos",
  "confirmaciones",
  "ts",
] as const;

export type ResultadoControl =
  | "bloqueado"
  | "pendiente_confirmacion"
  | "creado"
  | "idempotente";

/**
 * Registra un intento en out/control.csv.
 * Es idempotente por (solicitud_id, resultado): evita filas duplicadas si la
 * misma herramienta se invoca dos veces en la misma corrida.
 */
export function registrarControl(
  root: string,
  paquete: Paquete,
  validacion: Validacion,
  resultado: ResultadoControl,
  numeroOc = "",
): void {
  const archivo = path.join(outDir(root), "control.csv");
  const solicitudId = paquete.solicitud.solicitud_id;

  if (existeFila(archivo, solicitudId, resultado)) return;

  appendCsvRow(archivo, HEADER, [
    solicitudId,
    resultado,
    numeroOc,
    validacion.retroactiva,
    validacion.bloqueos.map((b) => `${b.codigo}: ${b.detalle}`).join(" | "),
    validacion.confirmaciones.map((c) => `${c.codigo}: ${c.detalle}`).join(" | "),
    new Date().toISOString(),
  ]);
}

/** Registra el estado terminal de la validación cuando no habrá creación inmediata. */
export function registrarControlValidacion(
  root: string,
  paquete: Paquete,
  validacion: Validacion,
): void {
  if (!validacion.apta) {
    registrarControl(root, paquete, validacion, "bloqueado");
  } else if (validacion.confirmaciones.length > 0) {
    registrarControl(root, paquete, validacion, "pendiente_confirmacion");
  }
}

function existeFila(archivo: string, solicitudId: string, resultado: ResultadoControl): boolean {
  if (!fs.existsSync(archivo)) return false;
  const filas = fs
    .readFileSync(archivo, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(1); // sin encabezado
  const prefijo = `${solicitudId},${resultado},`;
  return filas.some((fila) => fila.startsWith(prefijo));
}
