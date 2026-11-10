import { loadMasters } from "./masters";
import { findAprobador, findCentro, findProveedor } from "./match";
import type { Bloqueo, Confirmacion, Paquete, Validacion } from "./types";

const IVA_POR_DEFECTO = "C1";
const TOLERANCIA_COTIZACION = 0.02;
const TOLERANCIA_ARITMETICA = 1;

/**
 * Aplica las reglas de control RC1–RC10 del PRD.
 * Es una función pura respecto al paquete: solo lee los maestros del disco.
 */
export function validarPaquete(root: string, paquete: Paquete): Validacion {
  const masters = loadMasters(root);
  const solicitud = paquete.solicitud;

  const bloqueos: Bloqueo[] = [];
  const confirmaciones: Confirmacion[] = [];
  const derivados: Record<string, string> = {};
  let retroactiva = false;

  const proveedor = findProveedor(masters, solicitud);
  const centro = findCentro(masters, solicitud.centro_costo);
  const aprobador = findAprobador(centro, paquete.aprobacion);

  // RC1 — el proveedor debe existir y estar activo
  if (!proveedor) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `Proveedor no existe en el maestro: ${solicitud.proveedor_nombre}${
        solicitud.proveedor_nit ? ` (NIT ${solicitud.proveedor_nit})` : ""
      }`,
    });
  } else if (!proveedor.activo) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `Proveedor inactivo: ${proveedor.nombre} (${proveedor.codigo_sap})`,
    });
  }

  // RC4 — el centro debe existir y la subárea pertenecerle
  if (!centro) {
    bloqueos.push({
      codigo: "RC4",
      detalle: `Centro de costo inexistente: ${solicitud.centro_costo}`,
    });
  } else if (!centro.subareas.includes(solicitud.subarea)) {
    bloqueos.push({
      codigo: "RC4",
      detalle: `Subárea "${solicitud.subarea}" no pertenece a ${centro.centro_costo} (${centro.nombre})`,
    });
  }

  // RC2 — aprobación existente, con "Aprobado" y de un aprobador del centro
  if (!paquete.aprobacion) {
    bloqueos.push({ codigo: "RC2", detalle: "No hay correo de aprobación" });
  } else {
    if (!paquete.aprobacion.aprobado) {
      bloqueos.push({
        codigo: "RC2",
        detalle: "El correo de aprobación no contiene la palabra 'Aprobado'",
      });
    }
    if (centro && !aprobador) {
      bloqueos.push({
        codigo: "RC2",
        detalle: `${paquete.aprobacion.de} no es aprobador del centro ${centro.centro_costo}`,
      });
    }
  }

  // RC3 — el valor no supera el tope del aprobador
  if (aprobador && solicitud.valor_total > aprobador.tope) {
    bloqueos.push({
      codigo: "RC3",
      detalle: `Valor ${solicitud.valor_total} excede el tope ${aprobador.tope} de ${aprobador.email}`,
    });
  }

  // RC5 — la cotización debe coincidir con la solicitud (±2 %)
  if (!paquete.cotizacion) {
    confirmaciones.push({ codigo: "RC5", detalle: "No hay cotización adjunta" });
  } else {
    const denominador = solicitud.valor_total === 0 ? 1 : solicitud.valor_total;
    const ratio = Math.abs(paquete.cotizacion.total - solicitud.valor_total) / denominador;
    if (ratio > TOLERANCIA_COTIZACION) {
      confirmaciones.push({
        codigo: "RC5",
        detalle: `Cotización (${paquete.cotizacion.total}) difiere de la solicitud (${solicitud.valor_total}) en ${(
          ratio * 100
        ).toFixed(2)}% (tope 2%)`,
      });
    }
  }

  // RC6 — IVA ausente: se deriva del proveedor y se confirma
  if (!solicitud.indicador_iva) {
    const derivado = proveedor?.indicador_iva_default ?? IVA_POR_DEFECTO;
    derivados.indicador_iva = derivado;
    confirmaciones.push({
      codigo: "RC6",
      detalle: `IVA no informado; se deriva ${derivado} del proveedor`,
    });
  }

  // RC7 — condiciones de pago ausentes: se derivan del proveedor (solo informar)
  if (!solicitud.condiciones_pago && proveedor?.condiciones_pago_default) {
    derivados.condiciones_pago = proveedor.condiciones_pago_default;
  }

  // RC8 — factura anterior a la solicitud: OC retroactiva
  if (paquete.factura && paquete.factura.fecha < solicitud.fecha_solicitud) {
    retroactiva = true;
    confirmaciones.push({
      codigo: "RC8",
      detalle: `Factura ${paquete.factura.numero} (${paquete.factura.fecha}) es anterior a la solicitud (${solicitud.fecha_solicitud}); OC retroactiva`,
    });
  }

  // RC9 — la aprobación no puede ser anterior a la solicitud
  const fechaAprobacion = paquete.aprobacion?.fecha.slice(0, 10) ?? "";
  if (fechaAprobacion && fechaAprobacion < solicitud.fecha_solicitud) {
    confirmaciones.push({
      codigo: "RC9",
      detalle: `Aprobación (${fechaAprobacion}) anterior a la solicitud (${solicitud.fecha_solicitud})`,
    });
  }

  // RC10 — cantidad × valor unitario debe cuadrar con el total
  const esperado = solicitud.cantidad * solicitud.valor_unitario;
  if (Math.abs(esperado - solicitud.valor_total) > TOLERANCIA_ARITMETICA) {
    bloqueos.push({
      codigo: "RC10",
      detalle: `Cantidad × valor unitario (${esperado}) no cuadra con valor_total (${solicitud.valor_total})`,
    });
  }

  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    derivados,
    retroactiva,
  };
}
