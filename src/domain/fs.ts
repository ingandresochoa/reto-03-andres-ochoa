import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ */
/* Rutas                                                               */
/* ------------------------------------------------------------------ */

export const FIXTURES_REL = path.join("fixtures", "reto-03");

export function fixturesDir(root: string): string {
  return path.join(root, FIXTURES_REL);
}

export function mastersDir(root: string): string {
  return path.join(fixturesDir(root), "maestros");
}

export function caseFixtureDir(root: string, caso: string): string {
  assertSafeCaso(caso);
  return path.join(fixturesDir(root), "solicitudes", caso);
}

export function outDir(root: string): string {
  return path.join(root, "out");
}

export function caseOutDir(root: string, caso: string): string {
  assertSafeCaso(caso);
  return path.join(outDir(root), caso);
}

/** Evita path traversal en el argumento `caso`. */
export function assertSafeCaso(caso: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(caso)) {
    throw new Error(`Nombre de caso inválido: "${caso}"`);
  }
  return caso;
}

/** Ruta relativa a la raíz con separadores POSIX (para mostrar en docs/JSON). */
export function rel(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

/* ------------------------------------------------------------------ */
/* Lectura / escritura                                                 */
/* ------------------------------------------------------------------ */

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file: string): string {
  return fs.readFileSync(file, "utf8");
}

export function readJson<T>(file: string): T {
  return JSON.parse(readText(file)) as T;
}

export function writeText(file: string, content: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

export function writeJson(file: string, value: unknown): void {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function appendJsonl(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return readText(file)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function appendCsvRow(
  file: string,
  header: readonly string[],
  row: readonly (string | number | boolean | null | undefined)[],
): void {
  ensureDir(path.dirname(file));
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${header.map(csvCell).join(",")}\n`, "utf8");
  }
  fs.appendFileSync(file, `${row.map(csvCell).join(",")}\n`, "utf8");
}

export function readCsv(file: string): string[][] {
  if (!fs.existsSync(file)) return [];
  return readText(file)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseCsvLine(line));
}

/** Parser CSV mínimo (soporta comillas dobles y comas embebidas). */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/* ------------------------------------------------------------------ */
/* Ciclo de vida de out/                                               */
/* ------------------------------------------------------------------ */

export function cleanOut(root: string): void {
  fs.rmSync(outDir(root), { recursive: true, force: true });
}

export function ensureOut(root: string): void {
  ensureDir(outDir(root));
}

/* ------------------------------------------------------------------ */
/* Log de herramientas                                                 */
/* ------------------------------------------------------------------ */

export type LogEntry = {
  ts: string;
  herramienta: string;
  caso?: string;
  ok: boolean;
  resumen: string;
};

export function logTool(root: string, entry: Omit<LogEntry, "ts">): void {
  appendJsonl(path.join(outDir(root), "log.jsonl"), {
    ts: new Date().toISOString(),
    ...entry,
  });
}
