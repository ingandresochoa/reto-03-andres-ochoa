# Checklist de aceptación — Reto 03

Mapa entre los requisitos del `PRD.md` y la evidencia en el repositorio.

## Historias de usuario

| HU | Criterio | Estado | Evidencia |
|---|---|---|---|
| HU-1 | `oc_leer_paquete` devuelve el paquete normalizado | Hecho | `src/tools/oc.ts`, `src/domain/extract.ts` |
| HU-1 | Adjunto ausente se reporta como `null`, sin excepción | Hecho | `extract.ts` usa `existsSync` para cotización, aprobación y factura |
| HU-2 | `oc_validar` aplica RC1–RC10 | Hecho | `src/domain/rules.ts` |
| HU-2 | `bloqueos`, `confirmaciones` y `derivados` separados | Hecho | `Validacion` en `types.ts` |
| HU-3 | Payload válido contra esquema zod | Hecho | `OrdenCompraSchema` en `types.ts`, `construirPayload` |
| HU-3 | Trazabilidad por valor | Hecho | `out/<caso>/trazabilidad.json` |
| HU-4 | Evidencia `.txt` con encabezados, cuerpo y SHA-256 | Hecho (P0) | `generarEvidencia` en `payload.ts` |
| HU-4 | Evidencia `.pdf` | Pendiente (P1) | Requiere `pdf-lib`; documentado en `SOLUCION.md` §10 |
| HU-5 | `oc_crear` exige `apta` y confirmación | Hecho | `crearCaso` + puerta en `agent.ts` |
| HU-5 | Numeración desde `4500000001` | Hecho | `MockSapAdapter` |
| HU-5 | Idempotencia por `solicitud_id` | Hecho | `MockSapAdapter.buscarOrdenPorReferencia` |
| HU-5 | `out/control.csv` por intento | Hecho | `src/domain/control.ts` |
| HU-6 | Errores `{ ok: false, error }` legibles | Hecho | `src/tools/oc.ts` (`fail`/`fallo`) |

## Ciclo del agente

| Regla | Estado | Evidencia |
|---|---|---|
| CA1 — tope de iteraciones por turno | Hecho | `MAX_ITERATIONS` (25) en `config.ts` y `agent.ts` |
| CA2 — el modelo no afirma valores | Hecho | Prompt + `oc_crear` reconstruye desde el caso |
| CA3 — confirmación humana | Hecho | `pendingConfirmation`, `esAfirmativo`, front con botones |
| CA4 — tool calls visibles y en `out/log.jsonl` | Hecho | `logTool` + `web/src/App.tsx` + `demo.ts` (vía herramientas) |
| CA5 — error de herramienta/LLM no mata la sesión | Hecho | `{ ok:false }`, try/catch del LLM, timeout |

## Requisitos no funcionales

| Requisito | Estado | Evidencia |
|---|---|---|
| Un comando levanta front y backend | Hecho | `npm run dev` (`concurrently`) |
| `demo.ts` determinista y sin clave | Hecho | `DEMO_FECHA`, `cleanOut`, `npm run demo` (llama a las herramientas `oc_*`) |
| Clave solo en el backend | Hecho | `GROQ_API_KEY` en `config.ts`; `/api/health` no la expone |
| Herramientas sin shell | Hecho | Solo `fs`, `path` y dominio |
| Topes de iteraciones y tokens | Hecho | `MAX_ITERATIONS`, `MAX_TOKENS_PER_SESSION` |
| Timeout al LLM | Hecho | `LLM_TIMEOUT_MS` en `src/llm/groq.ts` |
| TypeScript sin `any` explícito | Hecho | `npm run typecheck`; `ToolEntry<Args>` genérico |
| `zod` en argumentos de herramientas | Hecho | `args` de cada herramienta + validación en `agent.ts` |

## Entregable

| Requisito | Estado | Evidencia |
|---|---|---|
| `agent/prompt.md` | Hecho | Comportamiento |
| `src/knowledge/ordenes-compra.md` | Hecho | Conocimiento |
| `src/tools/oc.ts` | Hecho | Ejecución |
| `src/sap/adapter.ts` + `mock.ts` | Hecho | Interfaz + simulación |
| `src/llm/adapter.ts` + `groq.ts` | Hecho | Interfaz + Groq |
| `demo.ts` | Hecho | Verificación sin modelo |
| `README.md` | Hecho | Arranque, variables, demo, API, túnel |
| `SOLUCION.md` (12 secciones) | Hecho | Ver índice del documento |
| `modulo/` (bonus) | Hecho | `agent.md`, `tools/oc.ts`, `skill/.../SKILL.md` |
| Sin `node_modules/`, `out/`, `.env` | Hecho | `.gitignore` y limpieza final |
| Link público | Hecho | Render (backend, `render.yaml`) + GitHub Pages (front) + keepalive en Actions; ver `DEPLOY_RENDER.md` y README §8 |

## Verificación reproducible

```bash
npm install
npm run typecheck   # 0 errores
npm test            # 25 tests
npm run demo        # 4500000001..4500000004 + idempotencia
npm run build       # web/dist
npm start           # http://localhost:3000
```
