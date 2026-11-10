import type { OrdenCompra } from "../domain/types";

/**
 * Contrato mínimo del sistema de registro (SAP).
 *
 * El agente y las herramientas solo conocen esta interfaz. En producción se
 * implementa contra OData (`API_PURCHASEORDER_PROCESS_SRV`) o BAPI; en esta
 * demo la implementa `MockSapAdapter` sobre `out/sap/`.
 */
export interface SapAdapter {
  consultarProveedor(
    nit: string,
  ): Promise<{ codigo_sap: string; activo: boolean } | null>;

  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>;

  buscarOrdenPorReferencia(
    solicitud_id: string,
  ): Promise<{ numero_oc: string } | null>;
}
