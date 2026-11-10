# Módulo reutilizable (bonus)

Empaquetado del agente para integrarlo a otras plataformas de agentes sin
levantar este servidor.

```
modulo/
├── agent.md                        # comportamiento (system prompt + permisos)
├── tools/oc.ts                     # re-exporta las herramientas reales
└── skill/ordenes-compra/SKILL.md   # conocimiento del proceso
```

## Por qué no hay copias

- `tools/oc.ts` **re-exporta** `src/tools/oc.ts`: no existe un segundo registro
  de herramientas que pueda quedar desactualizado.
- El cuerpo de `agent.md` es idéntico a `agent/prompt.md`.
- El cuerpo de `SKILL.md` es idéntico a `src/knowledge/ordenes-compra.md`.

El test `test/modulo.test.ts` falla si cualquiera de las tres piezas diverge.

## Integración

```ts
import {
  TOOLS,
  definicionesHerramientas,
  ejecutarTool,
} from "./modulo/tools/oc";

// 1. Pasa las definiciones al proveedor LLM (function calling).
const herramientas = definicionesHerramientas();

// 2. Ejecuta una herramienta con argumentos ya validados por zod.
const ctx = { directory: process.cwd(), sessionId: "ses-1" };
const salida = await ejecutarTool("leer_paquete", { caso: "sol-001" }, ctx);
// salida es un string JSON: { ok: true, data } | { ok: false, error }
```

El módulo no depende de Express ni del front, pero sí del dominio determinista.
Si se copia a otro repositorio, hay que llevar también `src/domain/`, `src/sap/`,
`src/config.ts` y `fixtures/`.

## Permisos

`agent.md` declara `edit: deny` y `bash: deny`: el agente solo puede leer y usar
sus herramientas; no modifica archivos ni ejecuta comandos.
