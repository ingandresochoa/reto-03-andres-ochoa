import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Agent, crearSesion } from "../src/agent";
import { ROOT } from "../src/config";
import { leerPaquete } from "../src/domain/extract";
import { construirCaso } from "../src/domain/service";
import type { LlmAdapter, LlmMessage, LlmResponse } from "../src/llm/adapter";

/* ------------------------------------------------------------------ */
/* LLM simulado: ejecuta un guion de respuestas, sin red ni clave      */
/* ------------------------------------------------------------------ */

type Paso = (mensajes: LlmMessage[]) => LlmResponse;

class GuionAdapter implements LlmAdapter {
  private indice = 0;

  constructor(private readonly pasos: Paso[]) {}

  async enviar(mensajes: LlmMessage[]): Promise<LlmResponse> {
    const paso = this.pasos[this.indice];
    this.indice += 1;
    if (!paso) {
      return {
        content: "Fin del guion.",
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    return paso(mensajes);
  }
}

function llamada(nombre: string, args: unknown): LlmResponse {
  return {
    content: null,
    toolCalls: [
      {
        id: `call-${nombre}-${Math.random().toString(16).slice(2)}`,
        type: "function",
        function: { name: nombre, arguments: JSON.stringify(args) },
      },
    ],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

function texto(contenido: string): LlmResponse {
  return {
    content: contenido,
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

function prepararRaiz(): string {
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), "oc-agent-"));
  fs.cpSync(path.join(ROOT, "fixtures"), path.join(temporal, "fixtures"), {
    recursive: true,
  });
  return temporal;
}

function extraerNumero(turno: { toolCalls: Array<{ name: string; result: unknown }> }): string {
  const creacion = turno.toolCalls.find((item) => item.name === "oc_crear");
  assert.ok(creacion, "debía ejecutarse oc_crear");
  const result = creacion.result as {
    ok: boolean;
    data?: { numero_oc: string };
  };
  assert.equal(result.ok, true);
  return result.data?.numero_oc ?? "";
}

/* ------------------------------------------------------------------ */
/* Pruebas                                                             */
/* ------------------------------------------------------------------ */

test("el agente crea una OC apta sin confirmaciones", async () => {
  const raiz = prepararRaiz();
  try {
    const { orden } = construirCaso(raiz, "sol-001");
    const agente = new Agent(
      new GuionAdapter([
        () =>
          llamada("oc_crear", {
            caso: "sol-001",
            payload: orden,
            confirmado: false,
          }),
        () => texto("OC 4500000001 creada."),
      ]),
      raiz,
    );

    const sesion = crearSesion("test-crea");
    const turno = await agente.run(sesion, "Procesa el caso sol-001.");

    assert.equal(turno.reply, "OC 4500000001 creada.");
    assert.equal(turno.needsConfirmation, false);
    assert.equal(extraerNumero(turno), "4500000001");
    assert.ok(
      fs.existsSync(path.join(raiz, "out", "sap", "ordenes.jsonl")),
      "debía persistirse la orden",
    );
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test("el agente pide confirmación y solo crea tras un turno afirmativo", async () => {
  const raiz = prepararRaiz();
  try {
    const paquete = leerPaquete(raiz, "sol-004");
    const { orden } = construirCaso(raiz, "sol-004");
    const agente = new Agent(
      new GuionAdapter([
        () => llamada("oc_validar", { caso: "sol-004", paquete }),
        () =>
          texto(
            "La cotización difiere en 6 %. ¿Confirmas la creación de la OC?",
          ),
        () =>
          llamada("oc_crear", {
            caso: "sol-004",
            payload: orden,
            confirmado: true,
          }),
        () => texto("OC 4500000001 creada con confirmación."),
      ]),
      raiz,
    );

    const sesion = crearSesion("test-confirma");
    const primero = await agente.run(sesion, "Procesa el caso sol-004.");

    assert.equal(primero.needsConfirmation, true);
    assert.ok(primero.toolCalls.some((item) => item.name === "oc_validar"));
    assert.ok(!primero.toolCalls.some((item) => item.name === "oc_crear"));

    const segundo = await agente.run(sesion, "Sí, confirmo.");
    assert.equal(segundo.needsConfirmation, false);
    assert.equal(extraerNumero(segundo), "4500000001");
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test("el agente no crea con confirmado=true en el mismo turno de la validación", async () => {
  const raiz = prepararRaiz();
  try {
    const paquete = leerPaquete(raiz, "sol-004");
    const { orden } = construirCaso(raiz, "sol-004");
    const agente = new Agent(
      new GuionAdapter([
        () => llamada("oc_validar", { caso: "sol-004", paquete }),
        () =>
          llamada("oc_crear", {
            caso: "sol-004",
            payload: orden,
            confirmado: true,
          }),
        () => texto("Necesito tu confirmación explícita."),
      ]),
      raiz,
    );

    const sesion = crearSesion("test-mismo-turno");
    const turno = await agente.run(sesion, "Procesa sol-004 y confirma todo.");

    const creacion = turno.toolCalls.find((item) => item.name === "oc_crear");
    assert.ok(creacion);
    assert.equal(creacion.ok, false);
    assert.match(creacion.resumen, /turno de confirmación/i);
    assert.equal(turno.needsConfirmation, true);
    assert.equal(
      fs.existsSync(path.join(raiz, "out", "sap", "ordenes.jsonl")),
      false,
    );
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test("el agente no crea si el usuario no confirma", async () => {
  const raiz = prepararRaiz();
  try {
    const paquete = leerPaquete(raiz, "sol-004");
    const { orden } = construirCaso(raiz, "sol-004");
    const agente = new Agent(
      new GuionAdapter([
        () => llamada("oc_validar", { caso: "sol-004", paquete }),
        () => texto("¿Confirmas la creación?"),
        () =>
          llamada("oc_crear", {
            caso: "sol-004",
            payload: orden,
            confirmado: true,
          }),
        () => texto("No crearé la OC sin tu confirmación."),
      ]),
      raiz,
    );

    const sesion = crearSesion("test-niega");
    await agente.run(sesion, "Procesa sol-004.");
    const turno = await agente.run(sesion, "No, espera.");

    const creacion = turno.toolCalls.find((item) => item.name === "oc_crear");
    assert.ok(creacion);
    assert.equal(creacion.ok, false);
    assert.match(creacion.resumen, /no confirmó/i);
    assert.equal(
      fs.existsSync(path.join(raiz, "out", "sap", "ordenes.jsonl")),
      false,
    );
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});
