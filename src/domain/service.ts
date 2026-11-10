import { hoyISO } from "../config";
import { MockSapAdapter } from "../sap/mock";
import { registrarControl, registrarControlValidacion } from "./control";
import { leerPaquete } from "./extract";
import { construirPayload, generarEvidencia } from "./payload";
import { validarPaquete } from "./rules";
import type { OrdenCompra, Paquete, Validacion } from "./types";

export type CrearResultado = {
  numero_oc: string;
  fecha: string;
  idempotente: boolean;
};

export type CrearResponse =
  | { ok: true; data: CrearResultado }
  | { ok: false; error: string };

export function leerCaso(root: string, caso: string): Paquete {
  return leerPaquete(root, caso);
}

export function validarCaso(
  root: string,
  caso: string,
): { paquete: Paquete; validacion: Validacion } {
  const paquete = leerPaquete(root, caso);
  const validacion = validarPaquete(root, paquete);
  registrarControlValidacion(root, paquete, validacion);
  return { paquete, validacion };
}

export function construirCaso(
  root: string,
  caso: string,
): {
  paquete: Paquete;
  validacion: Validacion;
  orden: OrdenCompra;
  ruta_trazabilidad: string;
} {
  const paquete = leerPaquete(root, caso);
  const validacion = validarPaquete(root, paquete);
  const { orden, ruta_trazabilidad } = construirPayload(root, caso, paquete, validacion);
  return { paquete, validacion, orden, ruta_trazabilidad };
}

export function evidenciaCaso(root: string, caso: string): { ruta: string; sha256: string } {
  const paquete = leerPaquete(root, caso);
  if (!paquete.aprobacion) {
    throw new Error("El caso no tiene correo de aprobación");
  }
  return generarEvidencia(root, caso, paquete);
}

/**
 * Intenta crear la OC. Vuelve a validar y reconstruye el payload desde el caso:
 * nunca confía en valores que lleguen del modelo. Aplica idempotencia por
 * solicitud_id y registra cada intento en out/control.csv.
 */
export async function crearCaso(
  root: string,
  caso: string,
  confirmado: boolean,
): Promise<CrearResponse> {
  const paquete = leerPaquete(root, caso);
  const validacion = validarPaquete(root, paquete);

  if (!validacion.apta) {
    registrarControl(root, paquete, validacion, "bloqueado");
    return {
      ok: false,
      error: `No se puede crear la OC. Bloqueos: ${describir(validacion.bloqueos)}`,
    };
  }

  if (validacion.confirmaciones.length > 0 && !confirmado) {
    registrarControl(root, paquete, validacion, "pendiente_confirmacion");
    return {
      ok: false,
      error: `Requiere confirmación explícita. Excepciones: ${describir(validacion.confirmaciones)}`,
    };
  }

  const sap = new MockSapAdapter(root, hoyISO());
  const existente = await sap.buscarOrdenPorReferencia(paquete.solicitud.solicitud_id);
  if (existente) {
    registrarControl(root, paquete, validacion, "idempotente", existente.numero_oc);
    return {
      ok: true,
      data: { numero_oc: existente.numero_oc, fecha: hoyISO(), idempotente: true },
    };
  }

  const { orden } = construirPayload(
    root,
    caso,
    paquete,
    validacion,
    confirmado ? "usuario" : null,
  );

  const creada = await sap.crearOrden(orden);
  registrarControl(root, paquete, validacion, "creado", creada.numero_oc);
  return { ok: true, data: { ...creada, idempotente: false } };
}

function describir(items: Array<{ codigo: string; detalle: string }>): string {
  return items.map((item) => `${item.codigo}: ${item.detalle}`).join("; ");
}
