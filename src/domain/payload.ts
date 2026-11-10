import crypto from "node:crypto";
import path from "node:path";
import { caseOutDir, rel, writeJson, writeText } from "./fs";
import { loadMasters } from "./masters";
import { findAprobador, findCentro, findProveedor } from "./match";
import {
  OrdenCompraSchema,
  type Aprobacion,
  type OrdenCompra,
  type Paquete,
  type Validacion,
} from "./types";

/* ------------------------------------------------------------------ */
/* Evidencia de aprobación                                             */
/* ------------------------------------------------------------------ */

export function renderAprobacion(aprobacion: Aprobacion | null): string {
  if (!aprobacion) return "";
  const encabezado = [
    `De: ${aprobacion.de}`,
    `Para: ${aprobacion.para}`,
    `Fecha: ${aprobacion.fecha}`,
    `Asunto: ${aprobacion.asunto}`,
    "",
  ].join("\n");
  return `${encabezado}${aprobacion.texto}\n`;
}

export function sha256(texto: string): string {
  return crypto.createHash("sha256").update(texto, "utf8").digest("hex");
}

export function generarEvidencia(
  root: string,
  caso: string,
  paquete: Paquete,
): { ruta: string; sha256: string } {
  const contenido = renderAprobacion(paquete.aprobacion);
  const hash = sha256(contenido);
  const archivo = path.join(caseOutDir(root, caso), "aprobacion.txt");
  writeText(archivo, `${contenido}\nsha256: ${hash}\n`);
  return { ruta: rel(root, archivo), sha256: hash };
}

/* ------------------------------------------------------------------ */
/* Construcción del payload                                            */
/* ------------------------------------------------------------------ */

/** Heurística de unidad: horas -> H, meses de servicio -> MES, resto -> UN. */
export function extraerUnidad(descripcion: string): "UN" | "H" | "MES" {
  const texto = descripcion.toLowerCase();
  if (/\bhoras?\b/.test(texto)) return "H";
  if (/\bmes(es)?\b/.test(texto) && !/vigencia/.test(texto)) return "MES";
  return "UN";
}

/** SAP limita el texto breve de la posición a 40 caracteres. */
export function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  return texto.slice(0, max).trimEnd();
}

type Traza = Record<string, { valor: unknown; fuente: string }>;

export function construirPayload(
  root: string,
  caso: string,
  paquete: Paquete,
  validacion: Validacion,
  confirmadoPor: string | null = null,
): { orden: OrdenCompra; ruta_trazabilidad: string } {
  const masters = loadMasters(root);
  const solicitud = paquete.solicitud;

  const proveedor = findProveedor(masters, solicitud);
  const centro = findCentro(masters, solicitud.centro_costo);
  const aprobador = findAprobador(centro, paquete.aprobacion);

  // Genera (idempotente) la evidencia y obtiene el hash que va en el payload.
  const evidencia = generarEvidencia(root, caso, paquete);

  const indicadorIva =
    solicitud.indicador_iva ??
    validacion.derivados.indicador_iva ??
    proveedor?.indicador_iva_default ??
    "";
  const condicionesPago =
    solicitud.condiciones_pago ??
    validacion.derivados.condiciones_pago ??
    proveedor?.condiciones_pago_default ??
    "";

  const orden: OrdenCompra = {
    referencia: {
      solicitud_id: solicitud.solicitud_id,
      correo_id: paquete.correo.id,
      cotizacion_ref: paquete.cotizacion?.ref ?? null,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: {
      codigo_sap: proveedor?.codigo_sap ?? "",
      nit: proveedor?.nit ?? solicitud.proveedor_nit ?? "",
      nombre: proveedor?.nombre ?? solicitud.proveedor_nombre,
    },
    moneda: solicitud.moneda,
    condiciones_pago: condicionesPago,
    aprobador: {
      email: aprobador?.email ?? paquete.aprobacion?.de ?? "",
      fecha_aprobacion: (paquete.aprobacion?.fecha ?? "").slice(0, 10),
      evidencia_sha256: evidencia.sha256,
    },
    posiciones: [
      {
        numero: 10,
        descripcion: recortar(solicitud.descripcion, 40),
        cantidad: solicitud.cantidad,
        unidad: extraerUnidad(solicitud.descripcion),
        precio_unitario: solicitud.valor_unitario,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva: indicadorIva,
      },
    ],
    excepciones: validacion.confirmaciones.map((c) => ({
      codigo: c.codigo,
      detalle: c.detalle,
      confirmado_por: confirmadoPor,
    })),
  };

  const validada = OrdenCompraSchema.parse(orden);

  const traza: Traza = {
    "referencia.solicitud_id": { valor: solicitud.solicitud_id, fuente: "solicitud" },
    "referencia.correo_id": { valor: paquete.correo.id, fuente: "correo" },
    "referencia.cotizacion_ref": {
      valor: paquete.cotizacion?.ref ?? null,
      fuente: "cotizacion",
    },
    "proveedor.codigo_sap": { valor: proveedor?.codigo_sap ?? "", fuente: "maestro.proveedores" },
    "proveedor.nit": { valor: proveedor?.nit ?? "", fuente: "maestro.proveedores" },
    "proveedor.nombre": { valor: proveedor?.nombre ?? "", fuente: "maestro.proveedores" },
    moneda: { valor: solicitud.moneda, fuente: "solicitud" },
    condiciones_pago: {
      valor: condicionesPago,
      fuente: solicitud.condiciones_pago
        ? "solicitud"
        : validacion.derivados.condiciones_pago
          ? "derivado"
          : "maestro.proveedores",
    },
    "aprobador.email": { valor: aprobador?.email ?? "", fuente: "aprobacion" },
    "aprobador.fecha_aprobacion": {
      valor: (paquete.aprobacion?.fecha ?? "").slice(0, 10),
      fuente: "aprobacion",
    },
    "aprobador.evidencia_sha256": { valor: evidencia.sha256, fuente: "aprobacion (sha256)" },
    "posiciones[0].descripcion": { valor: recortar(solicitud.descripcion, 40), fuente: "solicitud" },
    "posiciones[0].cantidad": { valor: solicitud.cantidad, fuente: "solicitud" },
    "posiciones[0].unidad": { valor: extraerUnidad(solicitud.descripcion), fuente: "derivado" },
    "posiciones[0].precio_unitario": { valor: solicitud.valor_unitario, fuente: "solicitud" },
    "posiciones[0].centro_costo": { valor: solicitud.centro_costo, fuente: "solicitud" },
    "posiciones[0].subarea": { valor: solicitud.subarea, fuente: "solicitud" },
    "posiciones[0].indicador_iva": {
      valor: indicadorIva,
      fuente: solicitud.indicador_iva
        ? "solicitud"
        : validacion.derivados.indicador_iva
          ? "derivado"
          : "maestro.proveedores",
    },
    excepciones: { valor: validada.excepciones, fuente: "validacion" },
  };

  const archivoTraza = path.join(caseOutDir(root, caso), "trazabilidad.json");
  writeJson(archivoTraza, traza);

  return { orden: validada, ruta_trazabilidad: rel(root, archivoTraza) };
}
