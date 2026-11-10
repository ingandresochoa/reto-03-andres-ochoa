# Reto 03 — Órdenes de Compra SAP

Agente conversacional que lee el paquete documental de una solicitud, aplica las
reglas de control **RC1–RC10**, pide confirmación humana cuando hay excepciones y
crea la orden de compra en un **SAP simulado** con idempotencia por
`solicitud_id`.

- **Reto:** 03 — Órdenes de Compra SAP (Periferia IT Group).
- **Stack:** Node 22 + TypeScript (`tsx`), React + Vite, Express, Groq (API
  compatible con OpenAI), `zod`.
- **Demo sin clave:** `npm run demo` ejecuta los 6 casos del fixture llamando
  directamente a las herramientas, sin modelo.

---

## 1. Requisitos

- Node.js 22 o superior (`node -v`).
- npm 10 o superior.
- Una `GROQ_API_KEY` **solo** si quieres usar el chat con el modelo real.
  `demo.ts`, `typecheck` y los tests no la necesitan.

## 2. Levantar en local (un comando)

```bash
npm install
cp .env.example .env      # en PowerShell: Copy-Item .env.example .env
npm run dev
```

`npm run dev` levanta **backend y front a la vez**:

- API: <http://localhost:3000>
- Front de chat (Vite): <http://localhost:5173>

Abre <http://localhost:5173>. El front hace proxy de `/api` al backend en el
puerto 3000.

### Modo producción

```bash
npm run build     # compila el front en web/dist
npm start         # sirve API + front compilado en http://localhost:3000
```

## 3. Variables de entorno

Copia `.env.example` a `.env`. Nunca subas `.env` al repositorio.

| Variable | Obligatoria | Default | Para qué |
|---|---|---|---|
| `GROQ_API_KEY` | Solo para el chat | — | Clave del proveedor LLM. Vive solo en el backend. |
| `GROQ_MODEL` | No | `openai/gpt-oss-120b` | Modelo a usar. |
| `GROQ_BASE_URL` | No | `https://api.groq.com/openai/v1` | Endpoint compatible con OpenAI. |
| `PORT` | No | `3000` | Puerto del backend. |
| `MAX_ITERATIONS` | No | `25` | Tope de iteraciones herramienta → modelo por turno. |
| `MAX_TOKENS_PER_SESSION` | No | `120000` | Tope de tokens por sesión (control de costo). |
| `LLM_TIMEOUT_MS` | No | `30000` | Timeout de una llamada al LLM. |
| `DEMO_FECHA` | No | fecha del sistema | Fija la fecha de la demo para que sea determinista. |

> La clave **no** se envía al front, no se registra en logs y no aparece en
> `/api/health` (solo se informa `configured: true/false`).

## 4. Verificación sin modelo (`demo.ts`)

```bash
npm run demo
```

Limpia `out/`, procesa `sol-001` … `sol-006` **llamando directamente a las
herramientas** (`oc_leer_paquete`, `oc_validar`, `oc_construir_payload`,
`oc_generar_evidencia` y `oc_crear`), sin modelo ni clave, y muestra por caso:
`apta`, bloqueos, confirmaciones, derivados, `retroactiva` y el número de OC o
el motivo. Al final repite `sol-001` para demostrar la idempotencia. Cada
llamada queda registrada en `out/log.jsonl` (CA4).

Resultado esperado:

| Caso | Resultado | N.º OC |
|---|---|---|
| `sol-001` | creada | `4500000001` |
| `sol-002` | bloqueada por RC1 (proveedor inexistente) | — |
| `sol-003` | bloqueada por RC2 (aprobador sin autoridad) | — |
| `sol-004` | confirmación RC5 y luego creada | `4500000002` |
| `sol-005` | confirmación RC8 (retroactiva) y luego creada | `4500000003` |
| `sol-006` | derivados RC6 + confirmación, luego creada | `4500000004` |
| `sol-001` (2.ª vez) | idempotente | `4500000001` |

Artefactos generados en `out/`:

- `out/sap/ordenes.jsonl` — órdenes creadas.
- `out/control.csv` — un registro por intento (`bloqueado`,
  `pendiente_confirmacion`, `creado`, `idempotente`).
- `out/log.jsonl` — cada llamada a herramienta.
- `out/<caso>/aprobacion.txt` — evidencia de la aprobación.
- `out/<caso>/trazabilidad.json` — de dónde salió cada valor del payload.

## 5. Pruebas y calidad

```bash
npm run typecheck   # TypeScript sin errores ni any explícito
npm test            # 25 tests: reglas, utilidades, SAP simulado, agente y módulo
```

Los tests del agente usan un LLM simulado (guion de respuestas), así que corren
sin red ni clave. Verifican, entre otras cosas, que no se crea una OC con
`confirmado=true` en el mismo turno de la validación ni sin un mensaje
afirmativo del usuario.

## 6. Cómo se usa el chat

Escribe el caso que quieres procesar:

```
Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué
validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.
```

El agente:

1. Lee el paquete con `oc_leer_paquete`.
2. Valida con `oc_validar` (RC1–RC10).
3. Si hay bloqueos, los explica y **no** crea nada.
4. Si hay excepciones, termina el turno pidiendo un **"sí"** o **"no"**. El front
   resalta el estado y ofrece botones.
5. Solo tras tu confirmación construye el payload, genera la evidencia y llama a
   `oc_crear`.
6. Reporta el `numero_oc`, la fecha y las excepciones registradas.

Cada llamada a herramienta es visible en el chat (argumentos y resultado).

## 7. API

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | `{ ok, provider, model, configured }` sin exponer la clave. |
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation }`. |
| `GET` | `/api/sessions/:id` | Historial y tool calls de la sesión. |

## 8. Link público para la defensa

Arquitectura en vivo (dos servicios gratuitos, siempre activos):

- **Render (backend):** ejecuta el ciclo del agente, las herramientas `oc_*`,
  el SAP simulado y la clave de Groq (solo en variables de entorno del
  servicio). Sirve la API y el front compilado **en un solo origen**.
- **GitHub Pages (front):** construido por Actions en cada push a `main`;
  consume la API de Render.
- **Keepalive:** el workflow `keepalive.yml` llama a `/api/health` cada 10 min
  para que el plan gratuito de Render no duerma el servicio.

> **Link de prueba (Render, front + API en un origen):** pendiente de
> desplegar — ver `DEPLOY_RENDER.md` (5 min).
>
> **Link de prueba (GitHub Pages, front estático + API de Render):**
> <https://ingandresochoa.github.io/reto-03-andres-ochoa/>
>
> **Clave de acceso:** no aplica (el chat no requiere login).

Si una URL cambia: actualiza la variable `BACKEND_URL` en GitHub, re-ejecuta
el workflow "Deploy front a GitHub Pages" y actualiza esta sección. La guía
completa está en `DEPLOY_RENDER.md`.

## 9. Estructura

```
agent/prompt.md                  # comportamiento del agente (system prompt)
src/knowledge/ordenes-compra.md  # conocimiento del proceso
src/tools/oc.ts                  # herramientas oc_* (ejecución)
src/domain/                      # reglas, extracción, payload, control (puro)
src/sap/                         # SapAdapter + implementación simulada
src/llm/                         # interfaz del proveedor + adaptador Groq
src/agent.ts                     # ciclo del agente y confirmación humana
src/server.ts                    # API HTTP y front compilado
web/                             # front React + Vite
fixtures/                        # datos entregados (no modificar)
out/                             # artefactos generados (no se entrega)
demo.ts                          # verificación sin modelo
modulo/                          # bonus: agente empaquetado reutilizable
.github/workflows/               # Pages (front) + keepalive del backend
render.yaml                      # blueprint del backend en Render
DEPLOY_RENDER.md                 # guía de despliegue en vivo
SOLUCION.md                      # decisiones, arquitectura y diseño SAP real
```

## 10. Entrega

No se incluyen `node_modules/`, `out/` ni `.env`. Para regenerar todo:

```bash
npm install
npm run demo
npm test
```
