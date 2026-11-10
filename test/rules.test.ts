import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ROOT } from "../src/config";
import { leerPaquete, parseAmount } from "../src/domain/extract";
import { extraerUnidad, recortar } from "../src/domain/payload";
import { validarPaquete } from "../src/domain/rules";
import type { OrdenCompra, Paquete } from "../src/domain/types";
import { MockSapAdapter } from "../src/sap/mock";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function caso(id: string): Paquete {
  return leerPaquete(ROOT, id);
}

function clonar(paquete: Paquete): Paquete {
  return structuredClone(paquete);
}

function tieneBloqueo(
  validacion: ReturnType<typeof validarPaquete>,
  codigo: string,
): boolean {
  return validacion.bloqueos.some((bloqueo) => bloqueo.codigo === codigo);
}

function tieneConfirmacion(
  validacion: ReturnType<typeof validarPaquete>,
  codigo: string,
): boolean {
  return validacion.confirmaciones.some((item) => item.codigo === codigo);
}

function ordenDePrueba(solicitudId: string): OrdenCompra {
  return {
    referencia: {
      solicitud_id: solicitudId,
      correo_id: "correo-prueba",
      cotizacion_ref: null,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: {
      codigo_sap: "100234",
      nit: "900555111",
      nombre: "TecnoSuministros S.A.S.",
    },
    moneda: "COP",
    condiciones_pago: "Z030",
    aprobador: {
      email: "mlopez@periferia-ficticia.com",
      fecha_aprobacion: "2026-08-21",
      evidencia_sha256: "hash-de-prueba",
    },
    posiciones: [
      {
        numero: 10,
        descripcion: "Prueba",
        cantidad: 1,
        unidad: "UN",
        precio_unitario: 1000,
        centro_costo: "CC-1010",
        subarea: "Infraestructura",
        indicador_iva: "C1",
      },
    ],
    excepciones: [],
  };
}

/* ------------------------------------------------------------------ */
/* Casos del fixture                                                   */
/* ------------------------------------------------------------------ */

test("sol-001 es apta y no requiere confirmaciones", () => {
  const validacion = validarPaquete(ROOT, caso("sol-001"));
  assert.equal(validacion.apta, true);
  assert.deepEqual(validacion.bloqueos, []);
  assert.deepEqual(validacion.confirmaciones, []);
  assert.equal(validacion.retroactiva, false);
});

test("sol-002 se bloquea por RC1: proveedor inexistente", () => {
  const validacion = validarPaquete(ROOT, caso("sol-002"));
  assert.equal(validacion.apta, false);
  assert.ok(tieneBloqueo(validacion, "RC1"));
});

test("sol-003 se bloquea por RC2: aprobador sin autoridad en el centro", () => {
  const validacion = validarPaquete(ROOT, caso("sol-003"));
  assert.equal(validacion.apta, false);
  assert.ok(tieneBloqueo(validacion, "RC2"));
  // RC2 domina: no se evalúa RC3 con un aprobador que no pertenece al centro.
  assert.ok(!tieneBloqueo(validacion, "RC3"));
});

test("sol-004 es apta pero requiere confirmación por RC5", () => {
  const validacion = validarPaquete(ROOT, caso("sol-004"));
  assert.equal(validacion.apta, true);
  assert.ok(tieneConfirmacion(validacion, "RC5"));
});

test("sol-005 marca retroactiva y requiere confirmación por RC8", () => {
  const validacion = validarPaquete(ROOT, caso("sol-005"));
  assert.equal(validacion.apta, true);
  assert.equal(validacion.retroactiva, true);
  assert.ok(tieneConfirmacion(validacion, "RC8"));
});

test("sol-006 deriva IVA y condición de pago, y pide confirmación por RC6", () => {
  const validacion = validarPaquete(ROOT, caso("sol-006"));
  assert.equal(validacion.apta, true);
  assert.equal(validacion.derivados.indicador_iva, "C1");
  assert.equal(validacion.derivados.condiciones_pago, "Z030");
  assert.ok(tieneConfirmacion(validacion, "RC6"));
});

/* ------------------------------------------------------------------ */
/* Reglas no disparadas por los fixtures (casos sintéticos)            */
/* ------------------------------------------------------------------ */

test("RC1 bloquea un proveedor inactivo", () => {
  const paquete = clonar(caso("sol-001"));
  paquete.solicitud.proveedor_nit = "901777888";
  paquete.solicitud.proveedor_nombre = "Consultores Ágiles S.A.S.";
  const validacion = validarPaquete(ROOT, paquete);
  assert.ok(
    validacion.bloqueos.some(
      (bloqueo) => bloqueo.codigo === "RC1" && /inactivo/i.test(bloqueo.detalle),
    ),
  );
});

test("RC2 bloquea una aprobación sin la palabra Aprobado", () => {
  const paquete = clonar(caso("sol-001"));
  paquete.aprobacion!.aprobado = false;
  const validacion = validarPaquete(ROOT, paquete);
  assert.ok(tieneBloqueo(validacion, "RC2"));
});

test("RC3 bloquea cuando el valor supera el tope del aprobador", () => {
  const paquete = clonar(caso("sol-001"));
  paquete.solicitud.valor_total = 60_000_000;
  paquete.solicitud.valor_unitario = 500_000;
  paquete.solicitud.cantidad = 120;
  const validacion = validarPaquete(ROOT, paquete);
  assert.equal(validacion.apta, false);
  assert.ok(tieneBloqueo(validacion, "RC3"));
});

test("RC4 bloquea una subárea que no pertenece al centro", () => {
  const paquete = clonar(caso("sol-001"));
  paquete.solicitud.subarea = "Marketing";
  const validacion = validarPaquete(ROOT, paquete);
  assert.ok(tieneBloqueo(validacion, "RC4"));
});

test("RC5 pide confirmación si no hay cotización", () => {
  const paquete = clonar(caso("sol-001"));
  paquete.cotizacion = null;
  const validacion = validarPaquete(ROOT, paquete);
  assert.ok(tieneConfirmacion(validacion, "RC5"));
});

test("RC9 pide confirmación si la aprobación es anterior a la solicitud", () => {
  const paquete = clonar(caso("sol-001"));
  paquete.aprobacion!.fecha = "2026-08-01T10:00:00-05:00";
  const validacion = validarPaquete(ROOT, paquete);
  assert.ok(tieneConfirmacion(validacion, "RC9"));
});

test("RC10 bloquea cuando cantidad × unitario no cuadra con el total", () => {
  const paquete = clonar(caso("sol-001"));
  paquete.solicitud.cantidad = 121;
  const validacion = validarPaquete(ROOT, paquete);
  assert.ok(tieneBloqueo(validacion, "RC10"));
});

/* ------------------------------------------------------------------ */
/* Utilidades puras                                                    */
/* ------------------------------------------------------------------ */

test("parseAmount interpreta formatos colombianos y anglosajones", () => {
  assert.equal(parseAmount("COP 11.400.000"), 11_400_000);
  assert.equal(parseAmount("265,000.00"), 265_000);
  assert.equal(parseAmount("95.000"), 95_000);
  assert.equal(parseAmount("1.700.000"), 1_700_000);
});

test("extraerUnidad infiere H, MES y UN", () => {
  assert.equal(extraerUnidad("Bolsa de 100 horas de arquitectura"), "H");
  assert.equal(extraerUnidad("Suscripción mensual por 12 meses"), "MES");
  assert.equal(extraerUnidad("Licencia anual antivirus"), "UN");
  assert.equal(extraerUnidad("Renovación con vigencia 12 meses"), "UN");
});

test("recortar limita el texto a 40 caracteres", () => {
  assert.equal(recortar("a".repeat(50), 40).length, 40);
  assert.equal(recortar("corto", 40), "corto");
});

/* ------------------------------------------------------------------ */
/* Adaptador SAP simulado                                              */
/* ------------------------------------------------------------------ */

test("MockSapAdapter numera desde 4500000001 y es idempotente", async () => {
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), "oc-test-"));
  try {
    const sap = new MockSapAdapter(temporal, "2026-09-03");
    const orden = ordenDePrueba("SOL-TEST-001");

    const primera = await sap.crearOrden(orden);
    assert.equal(primera.numero_oc, "4500000001");

    const repetida = await sap.crearOrden(orden);
    assert.equal(repetida.numero_oc, "4500000001");

    const segunda = await sap.crearOrden(ordenDePrueba("SOL-TEST-002"));
    assert.equal(segunda.numero_oc, "4500000002");

    const buscada = await sap.buscarOrdenPorReferencia("SOL-TEST-002");
    assert.equal(buscada?.numero_oc, "4500000002");
    assert.equal(await sap.buscarOrdenPorReferencia("SOL-INEXISTENTE"), null);
  } finally {

    fs.rmSync(temporal, { recursive: true, force: true });
  }
});

test("MockSapAdapter consulta proveedores desde el maestro", async () => {
  const sap = new MockSapAdapter(ROOT, "2026-09-03");
  assert.deepEqual(await sap.consultarProveedor("900.555.111-2"), {
    codigo_sap: "100234",
    activo: true,
  });
  assert.deepEqual(await sap.consultarProveedor("901777888"), {
    codigo_sap: "100402",
    activo: false,
  });
  assert.equal(await sap.consultarProveedor("000000000"), null);
});
