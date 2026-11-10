import { nitComparable, normalizarNombre } from "./extract";
import type { Aprobador, CentroCosto, Masters, Proveedor } from "./masters";
import type { Aprobacion, Solicitud } from "./types";

export function findProveedor(
  masters: Masters,
  solicitud: Pick<Solicitud, "proveedor_nit" | "proveedor_nombre">,
): Proveedor | undefined {
  if (solicitud.proveedor_nit) {
    const nit = nitComparable(solicitud.proveedor_nit);
    const byNit = masters.proveedores.find(
      (p) => nitComparable(p.nit) === nit,
    );
    if (byNit) return byNit;
  }
  const nombre = normalizarNombre(solicitud.proveedor_nombre);
  return masters.proveedores.find((p) => normalizarNombre(p.nombre) === nombre);
}

export function findCentro(masters: Masters, centroCosto: string): CentroCosto | undefined {
  return masters.centros.find((c) => c.centro_costo === centroCosto);
}

export function findAprobador(
  centro: CentroCosto | undefined,
  aprobacion: Aprobacion | null,
): Aprobador | undefined {
  if (!centro || !aprobacion) return undefined;
  const email = aprobacion.de.toLowerCase();
  return centro.aprobadores.find((a) => a.email.toLowerCase() === email);
}
