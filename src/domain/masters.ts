import path from "node:path";
import { mastersDir, readJson } from "./fs";

export type Proveedor = {
  codigo_sap: string;
  nit: string;
  nombre: string;
  condiciones_pago_default: string;
  indicador_iva_default: string;
  activo: boolean;
};

export type Aprobador = {
  email: string;
  nombre: string;
  tope: number;
};

export type CentroCosto = {
  centro_costo: string;
  nombre: string;
  subareas: string[];
  aprobadores: Aprobador[];
};

export type IndicadorIva = {
  codigo: string;
  descripcion: string;
  tasa: number;
};

export type CondicionPago = {
  codigo: string;
  descripcion: string;
  dias: number;
};

export type Masters = {
  proveedores: Proveedor[];
  centros: CentroCosto[];
  iva: IndicadorIva[];
  condiciones: CondicionPago[];
};

export function loadMasters(root: string): Masters {
  const base = mastersDir(root);
  return {
    proveedores: readJson<Proveedor[]>(path.join(base, "proveedores.json")),
    centros: readJson<CentroCosto[]>(path.join(base, "centros-costo.json")),
    iva: readJson<IndicadorIva[]>(path.join(base, "indicadores-iva.json")),
    condiciones: readJson<CondicionPago[]>(path.join(base, "condiciones-pago.json")),
  };
}
