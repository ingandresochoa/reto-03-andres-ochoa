import fs from "node:fs";
import path from "node:path";
import { caseFixtureDir, readJson, readText } from "./fs";
import {
  SolicitudSchema,
  type Aprobacion,
  type Correo,
  type Cotizacion,
  type Factura,
  type Paquete,
  type Solicitud,
} from "./types";

/* ------------------------------------------------------------------ */
/* Normalizadores                                                      */
/* ------------------------------------------------------------------ */

export function normalizarNit(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * NIT comparable contra el maestro.
 *
 * Los documentos del proveedor suelen traer el dígito de verificación
 * ("900.555.111-2" → 10 dígitos), mientras el maestro guarda la base de 9.
 * Si el valor normalizado tiene 10 dígitos, se descarta el último.
 */
export function nitComparable(value: string): string {
  const digitos = normalizarNit(value);
  return digitos.length === 10 ? digitos.slice(0, 9) : digitos;
}

export function normalizarNombre(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Montos y fechas                                                     */
/* ------------------------------------------------------------------ */

/**
 * Convierte montos con separadores colombianos/anglosajones.
 * "11.400.000" -> 11400000 · "265,000.00" -> 265000 · "95.000" -> 95000
 */
export function parseAmount(raw: string): number {
  let text = raw.replace(/[^\d.,]/g, "");
  if (!text) return Number.NaN;

  const hasDot = text.includes(".");
  const hasComma = text.includes(",");

  if (hasDot && hasComma) {
    const decimalSep = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    text = text.split(thousandsSep).join("");
    text = text.replace(decimalSep, ".");
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const parts = text.split(sep);
    const last = parts[parts.length - 1] ?? "";
    const isDecimal = parts.length === 2 && last.length !== 3;
    text = isDecimal ? `${parts[0]}.${last}` : parts.join("");
  }

  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

function addDays(isoDate: string, days: number): string | null {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const CURRENCY_RE = /\b(COP|USD|PEN|PAB|HNL)\b/;

function findTotalLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^TOTAL\b/i.test(line)) ?? ""
  );
}

function parseTotalFromLine(line: string): { total: number; moneda: string } {
  const moneda = line.match(CURRENCY_RE)?.[1] ?? "COP";
  const amountMatch = line.match(/(?:COP|USD|PEN|PAB|HNL)\s*([\d][\d.,]*)/i) ?? line.match(/([\d][\d.,]*)/);
  const total = amountMatch?.[1] ? parseAmount(amountMatch[1]) : Number.NaN;
  return { total, moneda };
}

/* ------------------------------------------------------------------ */
/* Extractores de texto                                                */
/* ------------------------------------------------------------------ */

export function extractCotizacion(texto: string): Cotizacion {
  const ref = texto.match(/COTIZACI[OÓ]N\s+([A-Z0-9][A-Z0-9-]*)/i)?.[1] ?? null;
  const proveedor = texto.match(/Proveedor:\s*(.+)/i)?.[1]?.trim() ?? "";
  const nitRaw = texto.match(/NIT:\s*([\d.\-]+)/i)?.[1] ?? null;
  const nit = nitRaw ? normalizarNit(nitRaw) : null;

  const { total, moneda } = parseTotalFromLine(findTotalLine(texto));

  const fechaCotizacion = texto.match(/Fecha:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
  const diasValidez = texto.match(/Validez de la oferta:\s*(\d+)\s*d[ií]as/i)?.[1];
  const validez_hasta =
    fechaCotizacion && diasValidez ? addDays(fechaCotizacion, Number(diasValidez)) : null;

  return { ref, proveedor, nit, total, moneda, validez_hasta, texto };
}

export function extractFactura(texto: string): Factura {
  const numero = texto.match(/No\.\s*([A-Z0-9-]+)/i)?.[1] ?? "";
  const fecha = texto.match(/Fecha de emisi[oó]n:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? "";
  const { total } = parseTotalFromLine(findTotalLine(texto));
  return { numero, fecha, total };
}

type RawAprobacion = {
  de?: string;
  para?: string;
  fecha?: string;
  asunto?: string;
  cuerpo?: string;
};

export function extractAprobacion(raw: RawAprobacion): Aprobacion {
  const texto = raw.cuerpo ?? "";
  return {
    de: raw.de ?? "",
    para: raw.para ?? "",
    fecha: raw.fecha ?? "",
    asunto: raw.asunto ?? "",
    aprobado: /\baprobad[oa]\b/i.test(texto),
    texto,
  };
}

/* ------------------------------------------------------------------ */
/* Lectura de un caso completo                                         */
/* ------------------------------------------------------------------ */

export function leerPaquete(root: string, caso: string): Paquete {
  const dir = caseFixtureDir(root, caso);
  if (!fs.existsSync(dir)) {
    throw new Error(`Caso inexistente: ${caso}`);
  }

  const correo = readJson<Correo>(path.join(dir, "correo.json"));
  const solicitud: Solicitud = SolicitudSchema.parse(readJson(path.join(dir, "solicitud.json")));

  const cotizacionPath = path.join(dir, "cotizacion.txt");
  const cotizacion = fs.existsSync(cotizacionPath) ? extractCotizacion(readText(cotizacionPath)) : null;

  const aprobacionPath = path.join(dir, "aprobacion.json");
  const aprobacion = fs.existsSync(aprobacionPath)
    ? extractAprobacion(readJson<RawAprobacion>(aprobacionPath))
    : null;

  const facturaPath = path.join(dir, "factura.txt");
  const factura = fs.existsSync(facturaPath) ? extractFactura(readText(facturaPath)) : null;

  return { correo, solicitud, cotizacion, aprobacion, factura };
}
