import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ROOT } from "../src/config";
import { TOOLS } from "../src/tools/oc";
import * as modulo from "../modulo/tools/oc";

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function leer(rutaRelativa: string): string {
  return fs
    .readFileSync(path.join(ROOT, rutaRelativa), "utf8")
    .replace(/\r\n/g, "\n");
}

/** Separa el frontmatter YAML del cuerpo Markdown. */
function separarFrontmatter(contenido: string): {
  frontmatter: string;
  cuerpo: string;
} {
  const lineas = contenido.split("\n");
  assert.equal(lineas[0], "---", "el archivo debe empezar con frontmatter");
  const cierre = lineas.indexOf("---", 1);
  assert.ok(cierre > 0, "el frontmatter debe cerrar con ---");
  return {
    frontmatter: lineas.slice(1, cierre).join("\n"),
    cuerpo: lineas.slice(cierre + 1).join("\n").trim(),
  };
}

/* ------------------------------------------------------------------ */
/* Bonus: las piezas no deben divergir de la aplicación                */
/* ------------------------------------------------------------------ */

test("modulo/agent.md usa el mismo prompt que agent/prompt.md", () => {
  const fuente = leer("agent/prompt.md").trim();
  const { frontmatter, cuerpo } = separarFrontmatter(leer("modulo/agent.md"));

  assert.equal(cuerpo, fuente, "el cuerpo de agent.md debe ser idéntico al prompt");
  assert.match(frontmatter, /^description:\s*\S+/m);
  assert.match(frontmatter, /^mode:\s*primary$/m);
  assert.match(frontmatter, /^\s{2}edit:\s*deny$/m);
  assert.match(frontmatter, /^\s{2}bash:\s*deny$/m);
});

test("modulo/skill/ordenes-compra/SKILL.md usa el mismo conocimiento", () => {
  const fuente = leer("src/knowledge/ordenes-compra.md").trim();
  const { frontmatter, cuerpo } = separarFrontmatter(
    leer("modulo/skill/ordenes-compra/SKILL.md"),
  );

  assert.equal(cuerpo, fuente, "el cuerpo de SKILL.md debe ser idéntico al conocimiento");
  assert.match(frontmatter, /^name:\s*ordenes-compra$/m);
  assert.match(frontmatter, /^description:\s*\S+/m);
});

test("modulo/tools/oc.ts re-exporta exactamente las mismas herramientas", () => {
  assert.deepEqual(
    Object.keys(modulo.TOOLS).sort(),
    Object.keys(TOOLS).sort(),
    "el módulo no debe declarar un registro distinto",
  );
  for (const clave of Object.keys(TOOLS) as Array<keyof typeof TOOLS>) {
    assert.equal(
      modulo.TOOLS[clave],
      TOOLS[clave],
      `la herramienta ${clave} debe ser la misma instancia`,
    );
  }
  assert.equal(typeof modulo.ejecutarTool, "function");
  assert.equal(typeof modulo.definicionesHerramientas, "function");
});
