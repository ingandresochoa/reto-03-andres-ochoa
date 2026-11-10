import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Entradas de los fixtures                                            */
/* ------------------------------------------------------------------ */

export const MonedaSchema = z.enum(["COP", "USD"]);
export type Moneda = z.infer<typeof MonedaSchema>;

export const SolicitudSchema = z.object({
  solicitud_id: z.string(),
  solicitante: z.string(),
  proveedor_nombre: z.string(),
  proveedor_nit: z.string().optional(),
  descripcion: z.string(),
  centro_costo: z.string(),
  subarea: z.string(),
  cantidad: z.number(),
  valor_unitario: z.number(),
  valor_total: z.number(),
  moneda: MonedaSchema,
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string(),
});
export type Solicitud = z.infer<typeof SolicitudSchema>;

export const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string().optional(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string().optional(),
  adjuntos: z.array(z.string()).optional(),
});
export type Correo = z.infer<typeof CorreoSchema>;

export const CotizacionSchema = z.object({
  ref: z.string().nullable(),
  proveedor: z.string(),
  nit: z.string().nullable(),
  total: z.number(),
  moneda: z.string(),
  validez_hasta: z.string().nullable(),
  texto: z.string(),
});
export type Cotizacion = z.infer<typeof CotizacionSchema>;

export const AprobacionSchema = z.object({
  de: z.string(),
  para: z.string().default(""),
  fecha: z.string(),
  asunto: z.string().default(""),
  aprobado: z.boolean(),
  texto: z.string(),
});
export type Aprobacion = z.infer<typeof AprobacionSchema>;

export const FacturaSchema = z.object({
  numero: z.string(),
  fecha: z.string(),
  total: z.number(),
});
export type Factura = z.infer<typeof FacturaSchema>;

export const PaqueteSchema = z.object({
  correo: CorreoSchema,
  solicitud: SolicitudSchema,
  cotizacion: CotizacionSchema.nullable(),
  aprobacion: AprobacionSchema.nullable(),
  factura: FacturaSchema.nullable(),
});
export type Paquete = z.infer<typeof PaqueteSchema>;

/* ------------------------------------------------------------------ */
/* Resultado de validación (RC1–RC10)                                  */
/* ------------------------------------------------------------------ */

export const BloqueoSchema = z.object({
  codigo: z.string(),
  detalle: z.string(),
});
export type Bloqueo = z.infer<typeof BloqueoSchema>;

export const ConfirmacionSchema = z.object({
  codigo: z.string(),
  detalle: z.string(),
});
export type Confirmacion = z.infer<typeof ConfirmacionSchema>;

export const ValidacionSchema = z.object({
  apta: z.boolean(),
  bloqueos: z.array(BloqueoSchema),
  confirmaciones: z.array(ConfirmacionSchema),
  derivados: z.record(z.string(), z.string()),
  retroactiva: z.boolean(),
});
export type Validacion = z.infer<typeof ValidacionSchema>;

/* ------------------------------------------------------------------ */
/* Payload de la orden de compra (sección 7.4 del PRD)                 */
/* ------------------------------------------------------------------ */

export const PosicionSchema = z.object({
  numero: z.number().int(),
  descripcion: z.string().max(40),
  cantidad: z.number(),
  unidad: z.enum(["UN", "H", "MES"]),
  precio_unitario: z.number(),
  centro_costo: z.string(),
  subarea: z.string(),
  indicador_iva: z.string(),
});
export type Posicion = z.infer<typeof PosicionSchema>;

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({
    codigo_sap: z.string(),
    nit: z.string(),
    nombre: z.string(),
  }),
  moneda: MonedaSchema,
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string(),
  }),
  posiciones: z.array(PosicionSchema).min(1),
  excepciones: z.array(
    z.object({
      codigo: z.string(),
      detalle: z.string(),
      confirmado_por: z.string().nullable(),
    }),
  ),
});
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>;

/* ------------------------------------------------------------------ */
/* Contexto de herramientas                                            */
/* ------------------------------------------------------------------ */

export type ToolContext = { directory: string; sessionId: string };

export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };
