import path from "node:path";
import { hoyISO } from "../config";
import { nitComparable } from "../domain/extract";
import { appendJsonl, outDir, readJsonl } from "../domain/fs";
import { loadMasters } from "../domain/masters";
import type { OrdenCompra } from "../domain/types";
import type { SapAdapter } from "./adapter";

export type RegistroOrden = {
  numero_oc: string;
  fecha: string;
  solicitud_id: string;
  orden: OrdenCompra;
};

const PRIMER_NUMERO = 4_500_000_001;

/**
 * Implementación local del adaptador SAP.
 *
 * - Persiste una línea JSON por OC en `out/sap/ordenes.jsonl`.
 * - Numera secuencialmente desde `4500000001`.
 * - Es idempotente por `solicitud_id`: repetir la creación devuelve el número
 *   existente en lugar de generar una segunda orden.
 */
export class MockSapAdapter implements SapAdapter {
  constructor(
    private readonly root: string,
    private readonly fecha: string = hoyISO(),
  ) {}

  private get archivo(): string {
    return path.join(outDir(this.root), "sap", "ordenes.jsonl");
  }

  private registros(): RegistroOrden[] {
    return readJsonl<RegistroOrden>(this.archivo);
  }

  async consultarProveedor(
    nit: string,
  ): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const buscado = nitComparable(nit);
    const proveedor = loadMasters(this.root).proveedores.find(
      (p) => nitComparable(p.nit) === buscado,
    );
    return proveedor
      ? { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo }
      : null;
  }

  async buscarOrdenPorReferencia(
    solicitud_id: string,
  ): Promise<{ numero_oc: string } | null> {
    const existente = this.registros().find(
      (registro) => registro.solicitud_id === solicitud_id,
    );
    return existente ? { numero_oc: existente.numero_oc } : null;
  }

  async crearOrden(
    orden: OrdenCompra,
  ): Promise<{ numero_oc: string; fecha: string }> {
    const existente = await this.buscarOrdenPorReferencia(
      orden.referencia.solicitud_id,
    );
    if (existente) {
      return { numero_oc: existente.numero_oc, fecha: this.fecha };
    }

    const numero_oc = String(PRIMER_NUMERO + this.registros().length);
    const registro: RegistroOrden = {
      numero_oc,
      fecha: this.fecha,
      solicitud_id: orden.referencia.solicitud_id,
      orden,
    };
    appendJsonl(this.archivo, registro);
    return { numero_oc, fecha: this.fecha };
  }
}
