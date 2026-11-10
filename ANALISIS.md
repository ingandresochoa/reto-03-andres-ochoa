# Análisis previo al desarrollo — Reto 03 "Órdenes de Compra SAP"

> Documento de trabajo previo a codificar. No es el entregable (`SOLUCION.md`), es la
> ingeniería de requisitos: qué pide el PRD, qué traen los fixtures, cómo se traduce
> cada regla a código y qué decisiones hay que tomar antes de escribir la primera línea.
>
> Estado: **análisis** · Autor: Andrés Ochoa · Fecha: 2026-11-09

---

## 0. Resumen de la decisión

El reto se resuelve con un agente conversacional cuyo valor real está en una **capa de
dominio determinista** (lectura de paquete, validación RC1–RC10, construcción de payload,
evidencia, adaptador SAP simulado). El LLM solo orquesta y conversa: **no calcula ni
afirma valores**. Los 6 casos de fixture tienen resultado esperado explícito, lo que
permite construir y verificar todo el dominio **sin clave de modelo** vía `demo.ts`.

Conclusión del levantamiento: la dificultad no está en el LLM, está en implementar bien
10 reglas, la idempotencia y la trazabilidad. Es un reto **acotado y verificable**.

---

## 1. Qué se evalúa (lectura del PRD)

| Componente | Obligatorio | Implicación para el diseño |
|---|---|---|
| Front de chat | Sí | Historial, entrada, "pensando", **tool calls visibles**, resaltar confirmación |
| Backend | Sí | API de chat, ciclo del agente con tope de iteraciones, sesión |
| Herramientas `zod` | Sí | Separadas del HTTP, importables desde `demo.ts`, **nunca lanzan** |
| Adaptador LLM | Sí | Interfaz propia `enviar(...)`; cambiar proveedor no toca el ciclo |
| `agent/prompt.md` | Sí | Comportamiento fuera del código |
| `src/knowledge/ordenes-compra.md` | Sí | Conocimiento fuera del código |
| Persistencia / auth | No | Archivos en `out/`; link público permitido |
| `demo.ts` | Sí | Corre sin clave; idempotencia `sol-001`; confirmación `sol-004` |
| `SOLUCION.md` | Sí | 12 secciones obligatorias |
| Link público | Sí | Si no se despliega: `-10` |
| Bonus `modulo/` | Opcional | +10 si las 3 piezas son las mismas que usa la app |

**Criterios de aprobación:** 70/100. **Separación evaluada:** comportamiento
(`prompt.md`) / conocimiento (`knowledge/`) / ejecución (`tools/`).

---

## 2. Inventario de fixtures (verificado, 29 archivos)

```
fixtures/reto-03/
├── maestros/
│   ├── proveedores.json        (5 proveedores)
│   ├── centros-costo.json      (3 centros, con subáreas y aprobadores+tope)
│   ├── indicadores-iva.json    (C0=0%, C1=19%, C2=5%)
│   └── condiciones-pago.json   (Z000, Z015, Z030, Z060)
└── solicitudes/
    ├── sol-001/  correo.json, solicitud.json, cotizacion.txt, aprobacion.json
    ├── sol-002/  ...
    ├── sol-003/  ...
    ├── sol-004/  ...
    ├── sol-005/  ... + factura.txt  (caso retroactivo)
    └── sol-006/  ...
```

Formato de archivos por caso:
- `correo.json`: `{ id, de, para, asunto, fecha, cuerpo, adjuntos[], nota_fixture }`
- `solicitud.json`: `{ solicitud_id, solicitante, proveedor_nombre, proveedor_nit?, descripcion, centro_costo, subarea, cantidad, valor_unitario, valor_total, moneda, indicador_iva?, condiciones_pago?, fecha_solicitud }`
- `cotizacion.txt`: texto con `COTIZACIÓN <ref>`, `Proveedor`, `NIT`, ítems, `TOTAL (IVA incluido)`, `Validez de la oferta: N días`.
- `aprobacion.json`: `{ de, para, cc[], fecha, asunto, cuerpo }` (el cuerpo contiene o no "Aprobado").
- `factura.txt` (solo sol-005): `No. FC-88231`, fecha, total.

Los fixtures están en **UTF-8 sin BOM** (verificado). Node los lee bien por defecto.

---

## 3. Maestros (datos reales de los fixtures)

### 3.1 Proveedores

| código SAP | NIT | Nombre | Cond. pago | IVA | Activo |
|---|---|---|---|---|---|
| 100234 | 900555111 | TecnoSuministros S.A.S. | Z030 | C1 | ✅ |
| 100310 | 901222333 | Cloud Andina S.A.S. | Z000 | C1 | ✅ |
| 100118 | 800444555 | Papelería Central Ltda. | Z015 | C1 | ✅ |
| 100150 | 830111222 | Mobiliario Andino S.A. | Z030 | C1 | ✅ |
| 100402 | 901777888 | Consultores Ágiles S.A.S. | Z030 | C1 | ❌ inactivo |

### 3.2 Centros de costo

| Centro | Nombre | Subáreas | Aprobadores (tope COP) |
|---|---|---|---|
| CC-1010 | Tecnología | Infraestructura, Soporte, Desarrollo | mlopez@… (50.000.000), dgarcia@… (200.000.000) |
| CC-2020 | Administración | Compras, Servicios Generales | rtorres@… (30.000.000) |
| CC-3030 | Comercial | Preventa, Marketing | fvargas@… (80.000.000) |

### 3.3 IVA y condiciones

- IVA: `C0` (0%), `C1` (19%), `C2` (5%).
- Condiciones: `Z000` (0 d), `Z015` (15 d), `Z030` (30 d), `Z060` (60 d).

---

## 4. Matriz caso × regla (núcleo del análisis)

Esta tabla es la especificación ejecutable de la demo. Se calculó a mano contra los
fixtures; el código debe reproducirla exactamente.

| Caso | RC1 proveedor | RC2 aprobación | RC3 tope | RC4 subárea | RC5 cotización | RC6 IVA | RC7 cond. pago | RC8 retroactiva | RC9 fecha aprob. | RC10 aritmética | Resultado esperado |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **sol-001** | ✅ activo | ✅ mlopez, "Aprobado" | ✅ 11.4M ≤ 50M | ✅ Infraestructura | ✅ 11.4M = 11.4M (0%) | ✅ C1 | ✅ Z030 | — | ✅ 08-21 ≥ 08-20 | ✅ 120×95k | **apta, sin confirmaciones → crea OC** |
| **sol-002** | ❌ **no existe** (901999000) | ✅ mlopez | ✅ 8.5M ≤ 50M | ✅ Desarrollo | ✅ 8.5M = 8.5M | ✅ C1 | ✅ Z030 | — | ✅ | ✅ 5×1.7M | **BLOQUEO RC1 → no crea** |
| **sol-003** | ✅ activo | ❌ **fvargas no es aprobador de CC-2020** | ❌/— 74M > 30M (rtorres) | ✅ Servicios Generales | ✅ 74M = 74M | ✅ C1 | ✅ Z030 | — | ✅ | ✅ 40×1.85M | **BLOQUEO RC2 (y RC3) → no crea** |
| **sol-004** | ✅ activo | ✅ dgarcia | ✅ 25M ≤ 200M | ✅ Desarrollo | ❌ **26.5M vs 25M = 6% > 2%** | ✅ C1 | ✅ Z000 | — | ✅ 08-26 ≥ 08-26 | ✅ 100×250k | **CONFIRMACIÓN RC5 → crea con `confirmado=true`** |
| **sol-005** | ✅ activo | ✅ rtorres | ✅ 3.2M ≤ 30M | ✅ Compras | ✅ 3.2M = 3.2M | ✅ C1 | ✅ Z015 | ❌ **factura 08-10 < solicitud 08-27** | ✅ 08-28 ≥ 08-27 | ✅ 1×3.2M | **CONFIRMACIÓN RC8 + `retroactiva=true`** |
| **sol-006** | ✅ activo | ✅ mlopez | ✅ 5.4M ≤ 50M | ✅ Soporte | ✅ 5.4M = 5.4M | ⚠️ **ausente → deriva C1** | ⚠️ **ausente → deriva Z030** | — | ✅ 08-29 ≥ 08-29 | ✅ 30×180k | **DERIVADOS + CONFIRMACIÓN RC6** |

### 4.1 Reglas que NO disparan en los fixtures (pero hay que implementar)

- **RC3**: solo sol-003 de forma secundaria; el resto está bajo el tope.
- **RC4**: las 6 subáreas son válidas.
- **RC9**: las 6 fechas de aprobación son ≥ fecha de solicitud.
- **RC10**: las 6 multiplicaciones cuadran exactamente.

> Riesgo a cubrir: el evaluador puede añadir casos. Implementar las 10 reglas, no solo
> las que disparan. La demo debe evidenciar las que sí disparan.

### 4.2 Precedencia de reglas

1. Se evalúan **todas** las reglas y se acumulan `bloqueos[]`, `confirmaciones[]`, `derivados`.
2. `apta = bloqueos.length === 0`.
3. `retroactiva` es un flag independiente (RC8) que también genera confirmación.
4. Un bloqueo impide crear aunque las confirmaciones estén resueltas.
5. RC3 se evalúa **con el tope del aprobador que realmente firmó** (match por email dentro
   del centro). Si el aprobador no pertenece al centro (RC2), RC3 no se evalúa (RC2 domina).

---

## 5. Reglas operativas RC1–RC10 (traducción a código)

```text
normalizarNit(s) = s.replace(/\D/g, "")            // "900.555.111-2" -> "900555111"

RC1  proveedor = maestros.proveedores.find(p => normalizarNit(p.nit) === normalizarNit(sol.proveedor_nit))
     si no hay nit: buscar por nombre normalizado (trim + minúsculas + sin tildes)
     si !proveedor || !proveedor.activo -> BLOQUEO "proveedor inexistente/inactivo"

RC2  si !aprobacion || !/aprobado/i.test(aprobacion.cuerpo) -> BLOQUEO "sin aprobación"
     centro = maestros.centros.find(c => c.centro_costo === sol.centro_costo)
     aprobador = centro.aprobadores.find(a => a.email === aprobacion.de)
     si !aprobador -> BLOQUEO "aprobador sin autoridad en el centro de costo"

RC3  si aprobador && sol.valor_total > aprobador.tope -> BLOQUEO "excede tope del aprobador"

RC4  si !centro.subareas.includes(sol.subarea) -> BLOQUEO "subárea no pertenece al centro"

RC5  si !cotizacion -> CONFIRMACIÓN "no hay cotización"
     ratio = abs(cot.total - sol.valor_total) / sol.valor_total
     si ratio > 0.02 -> CONFIRMACIÓN "diferencia cotización vs solicitud" (ambos valores)

RC6  si !sol.indicador_iva -> derivado.indicador_iva = proveedor.indicador_iva_default; CONFIRMACIÓN

RC7  si !sol.condiciones_pago -> derivado.condiciones_pago = proveedor.condiciones_pago_default  (solo informar)

RC8  si factura && factura.fecha < sol.fecha_solicitud -> retroactiva = true; CONFIRMACIÓN

RC9  si aprobacion.fecha < sol.fecha_solicitud -> CONFIRMACIÓN "aprobación previa a la solicitud"

RC10 si abs(sol.cantidad * sol.valor_unitario - sol.valor_total) > 1 -> BLOQUEO "aritmética no cuadra"
```

Cada `bloqueo`/`confirmación` lleva `{ codigo, detalle }` para que el agente lo muestre y
para poblar `excepciones[]` del payload.

---

## 6. Contrato de herramientas (firmas y responsabilidades)

Todas devuelven **string JSON** `{ ok: true, data }` o `{ ok: false, error }`. Nunca lanzan.

| Herramienta | Args | `data` | Notas de implementación |
|---|---|---|---|
| `oc_leer_paquete` | `{ caso }` | `Paquete` (7.2) | Lee JSON/TXT; adjunto ausente → `null`, no error |
| `oc_validar` | `{ caso, paquete }` | `{ apta, bloqueos[], confirmaciones[], derivados, retroactiva }` | Aplica RC1–RC10; registra control para `bloqueado`/`pendiente` |
| `oc_construir_payload` | `{ caso, paquete, derivados }` | `{ orden: OrdenCompra, ruta_trazabilidad }` | Valida con zod; escribe `trazabilidad.json`; calcula `evidencia_sha256` |
| `oc_generar_evidencia` | `{ caso }` | `{ ruta, sha256 }` | P0 `.txt`; P1 `.pdf` opcional |
| `oc_crear` | `{ caso, payload, confirmado? }` | `{ numero_oc, fecha, idempotente }` o error | Re-valida internamente; idempotente por `solicitud_id`; escribe `ordenes.jsonl` y control |
| `oc_leer_excel` | `{ ruta }` | `{ filas[] }` | **P1 opcional** (fixtures ya vienen normalizados) |

### 6.1 Dependencia entre herramientas (importante)

El payload exige `aprobador.evidencia_sha256`, pero `oc_construir_payload` **no recibe**
la evidencia como argumento. Decisión: `oc_construir_payload` y `oc_generar_evidencia`
comparten una función pura `renderAprobacion(aprobacion) -> string` y
`sha256(utf8(render))`. Así el hash es idéntico sin importar el orden de llamada.
`oc_construir_payload` garantiza que el archivo de evidencia exista (escritura idempotente).

### 6.2 Defensa en profundidad (clave frente a CA2)

- `oc_crear` **no confía** en el `payload` que le pasa el modelo: lo reconstruye
  determinísticamente desde `caso` y vuelve a validar. Si el payload del modelo difiere,
  se ignora y se usa el canónico (y se registra la discrepancia en el log).
- Esto cumple "el modelo no puede afirmar un valor que no salga de una herramienta".

---

## 7. Modelo de datos y validación `zod`

```ts
type Solicitud = {
  solicitud_id: string; solicitante: string;
  proveedor_nombre: string; proveedor_nit?: string;
  descripcion: string; centro_costo: string; subarea: string;
  cantidad: number; valor_unitario: number; valor_total: number;
  moneda: "COP" | "USD";
  indicador_iva?: string; condiciones_pago?: string;
  fecha_solicitud: string; // YYYY-MM-DD
}

type Paquete = {
  correo: { id: string; de: string; asunto: string; fecha: string };
  solicitud: Solicitud;
  cotizacion: { ref: string | null; proveedor: string; nit: string | null; total: number;
                moneda: string; validez_hasta: string | null; texto: string } | null;
  aprobacion: { de: string; para: string; fecha: string; asunto: string;
                aprobado: boolean; texto: string } | null;   // se amplía con para/asunto/cuerpo
  factura: { numero: string; fecha: string; total: number } | null;
}

type OrdenCompra = {
  referencia: { solicitud_id: string; correo_id: string; cotizacion_ref: string | null };
  sociedad: "1000"; organizacion_compras: "1000";
  proveedor: { codigo_sap: string; nit: string; nombre: string };
  moneda: "COP" | "USD";
  condiciones_pago: string;
  aprobador: { email: string; fecha_aprobacion: string; evidencia_sha256: string };
  posiciones: Array<{
    numero: number; descripcion: string; cantidad: number;
    unidad: "UN" | "H" | "MES"; precio_unitario: number;
    centro_costo: string; subarea: string; indicador_iva: string;
  }>;
  excepciones: Array<{ codigo: string; detalle: string; confirmado_por: string | null }>;
}
```

`OrdenCompra` se define como esquema `zod` y se valida antes de persistir.

---

## 8. Artefactos de salida (`out/`)

| Ruta | Contenido | Regla |
|---|---|---|
| `out/sap/ordenes.jsonl` | Una línea por OC creada `{ numero_oc, fecha, solicitud_id, orden }` | Secuencial desde `4500000001` |
| `out/control.csv` | `solicitud_id, resultado, numero_oc, retroactiva, bloqueos, confirmaciones, ts` | Una fila por intento: `bloqueado`, `pendiente_confirmacion`, `creado`, `idempotente` |
| `out/<caso>/aprobacion.txt` | Encabezados (de, para, fecha, asunto) + cuerpo + `sha256` | P0 |
| `out/<caso>/aprobacion.pdf` | Mismo contenido | P1 opcional |
| `out/<caso>/trazabilidad.json` | Cada valor del payload con su fuente (`solicitud`, `cotizacion`, `maestro.<x>`, `derivado`) | HU-3 |
| `out/log.jsonl` | `{ ts, herramienta, caso, ok, resumen }` | Toda llamada |
| `out/procesados.json` | No aplica en este reto (sí en reto-02) | — |

### 8.1 Decisión sobre `control.csv` (ambigüedad del PRD)

El PRD dice "oc_crear solo se ejecuta si apta=true" **y** "cada intento (exitoso, bloqueado
o pendiente) agrega una fila a control.csv". Para cumplir ambas:

- `oc_validar` escribe la fila cuando el resultado terminal es `bloqueado` o
  `pendiente_confirmacion` (no hay creación posible).
- `oc_crear` escribe la fila cuando crea (`creado`) o cuando detecta duplicado
  (`idempotente`).
- Flujo canónico del agente/demo: `leer → validar → (generar evidencia) → construir payload
  → crear`. Así ningún intento queda sin registro y no hay filas duplicadas.

---

## 9. Arquitectura propuesta

```
reto-03-ANDRES OCHOA/
├── agent/
│   └── prompt.md                 # comportamiento (no reglas de negocio)
├── src/
│   ├── server.ts                 # HTTP + ciclo del agente
│   ├── config.ts                 # env, topes de iteraciones/tokens
│   ├── llm/
│   │   ├── adapter.ts            # interfaz enviar(mensajes, herramientas)
│   │   └── groq.ts               # Groq vía API compatible con OpenAI
│   ├── tools/
│   │   └── oc.ts                 # 6 herramientas (wrappers finos)
│   ├── domain/                   # LÓGICA PURA (sin LLM, sin HTTP)
│   │   ├── types.ts              # tipos + esquemas zod
│   │   ├── extract.ts            # cotización/factura (regex deterministas)
│   │   ├── rules.ts              # RC1–RC10
│   │   ├── payload.ts            # construcción + trazabilidad + evidencia
│   │   └── fs.ts                 # jsonl/csv/paths/limpieza de out/
│   ├── sap/
│   │   ├── adapter.ts            # interface SapAdapter (dada por el PRD)
│   │   └── mock.ts               # implementación sobre out/sap/
│   └── knowledge/
│       └── ordenes-compra.md     # conocimiento del proceso (para el prompt)
├── web/                          # front de chat (React + Vite)
├── test/                         # pruebas unitarias del dominio
├── fixtures/                     # ya copiados (solo lectura)
├── out/                          # generado
├── demo.ts                       # verificación sin modelo
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── SOLUCION.md
```

**Por qué `domain/` separado:** permite testear RC1–RC10 y la construcción del payload con
pruebas unitarias, sin LLM ni servidor. Es la base de `demo.ts` y de la defensa técnica.

---

## 10. Ciclo del agente y confirmación

1. `POST /api/chat { sessionId, message }` → el servidor arma mensajes (system + historial).
2. Bucle: `modelo → tool calls → ejecutar herramientas → devolver resultados → modelo`.
3. Tope de iteraciones por turno: **25** (configurable). Al alcanzarlo responde con lo que
   tiene y lo que falta.
4. Cada tool call se emite al front (nombre, args, resultado resumido) y se guarda en
   `out/log.jsonl`.
5. Si una acción requiere confirmación (`confirmaciones[]` no vacío, o `retroactiva`), el
   turno termina con **pregunta explícita** y `needsConfirmation=true`.
6. Solo si el siguiente mensaje del usuario confirma se llama `oc_crear` con
   `confirmado=true`.
7. Errores de herramienta/LLM se muestran en lenguaje claro; la sesión no muere.
8. Topes de tokens por sesión configurables (costo).

**System prompt (`agent/prompt.md`):** rol, flujo canónico, prohibición de inventar
valores, cuándo pedir confirmación, cómo reportar bloqueos, tono. Sin reglas RC embebidas
(esas viven en `domain/rules.ts` y se describen en `knowledge/`).

---

## 11. `demo.ts` (verificación sin modelo)

Debe, sin clave de proveedor:

1. Limpiar `out/` al inicio (determinismo).
2. Procesar `sol-001 … sol-006` en orden y, por caso, imprimir:
   `apta`, `bloqueos`, `confirmaciones`, `derivados`, `retroactiva`, número de OC o motivo.
3. **Idempotencia:** ejecutar `sol-001` dos veces → segundo resultado
   `idempotente=true` con el **mismo** `numero_oc`.
4. **Confirmación:** `sol-004` sin `confirmado` → rechazado por `requiere confirmación`;
   luego con `confirmado=true` → OC creada. (Igual para sol-005 y sol-006.)
5. Mostrar rutas generadas: `out/sap/ordenes.jsonl`, `out/control.csv`,
   `out/sol-00X/aprobacion.txt`, `trazabilidad.json`.

Salida esperada (resumen):

| Caso | Resultado | OC |
|---|---|---|
| sol-001 | creado | 4500000001 |
| sol-002 | bloqueado (RC1) | — |
| sol-003 | bloqueado (RC2/RC3) | — |
| sol-004 | pendiente → creado tras confirmar | 4500000002 |
| sol-005 | pendiente (retroactiva) → creado tras confirmar | 4500000003 |
| sol-006 | pendiente (RC6) → creado tras confirmar | 4500000004 |
| sol-001 (2.ª) | idempotente | 4500000001 |

---

## 12. Ambigüedades detectadas y decisión propuesta

| # | Ambigüedad | Decisión |
|---|---|---|
| A1 | `unidad` no viene en `solicitud.json` | Derivar: `H` si la descripción menciona "hora"; `MES` si "mes"; por defecto `UN`. Documentar en `SOLUCION.md` |
| A2 | `descripcion` SAP máx. 40 caracteres | Truncar a 40 (`slice(0,40)`), sin cortar palabras a medias si es posible |
| A3 | `evidencia_sha256` sin argumento en `construir_payload` | Función pura compartida `renderAprobacion` + `sha256` |
| A4 | `cotizacion_ref` no es campo del fixture | Extraer el id de la primera línea (`COT-…`, `CA-…`, `PC-…`); fallback `null` |
| A5 | `aprobacion` en 7.2 no incluye `para/asunto/cuerpo`, pero HU-4 los exige | Ampliar el tipo con esos campos (superset del fixture) |
| A6 | `control.csv`: "cada intento" vs "oc_crear solo si apta" | `validar` registra bloqueado/pendiente; `crear` registra creado/idempotente (§8.1) |
| A7 | `log.jsonl` pide `mensaje_id` (viene del reto-02) | Usar `caso`/`solicitud_id`; documentar la adaptación |
| A8 | Fecha de la OC es "hoy" (no determinista) | Permitir `DEMO_FECHA`/`ctx.now`; por defecto fecha del sistema. El resto es determinista |
| A9 | `validez_hasta` de cotización es texto ("30 días") | Calcular `fecha_cotizacion + días`; si no parsea → `null` |
| A10 | RC3 con aprobador inválido (sol-003) | Si RC2 falla, no evaluar RC3; reportar RC2 (y notar el tope real) |
| A11 | Moneda `PEN/PAB/HNL` existen en reto-02, pero aquí el schema solo admite `COP\|USD` | Restringir a `COP\|USD` como pide 7.4; los fixtures usan COP |

---

## 13. Riesgos técnicos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El modelo "arregla" montos o fechas | Alto | Herramientas deterministas como única fuente; `oc_crear` reconstruye el payload |
| Serverless (Vercel) sin FS persistente para `out/` | Alto | Desplegar en host de proceso largo (Render/Railway/Fly) o túnel estable |
| Falla el tool-calling del proveedor | Medio | Prompt claro + bucle tolerante + timeouts + mensaje de error legible |
| `evidencia_sha256` inconsistente entre tools | Medio | Una sola función de render/hash |
| Numeración de OC no determinista entre corridas | Bajo | `out/` se limpia al inicio de la demo; contador derivado de `ordenes.jsonl` |
| Encoding de fixtures | Bajo | UTF-8 verificado; leer con `fs.readFile(..., 'utf8')` |
| Costo/tokens desbordados | Medio | Tope de iteraciones (25) y de tokens por sesión configurables |
| Reglas no disparadas en fixtures quedan sin probar | Medio | Tests unitarios por regla + casos sintéticos en `demo` (opcional) |

---

## 14. Plan de implementación (fases)

| Fase | Entregable | Criterio de salida |
|---|---|---|
| **F0** Scaffold | `package.json`, `tsconfig`, `.env.example`, estructura, `config.ts` | `npm run dev` arranca en vacío |
| **F1** Dominio | `types`, `extract`, `rules`, `payload`, `fs` + tests | RC1–RC10 reproducen §4; tests verdes |
| **F2** Herramientas + demo | `tools/oc.ts`, `sap/mock.ts`, `demo.ts` | §11 completo sin clave |
| **F3** LLM + agente | `llm/adapter`, implementación, `prompt.md`, `knowledge/`, `server.ts` | Chat responde y ejecuta tools |
| **F4** Front | `web/` con tool calls y confirmación resaltada | Flujo E2E en navegador |
| **F5** Docs + deploy | `README.md`, `SOLUCION.md`, link público | Link activo; docs completos |
| **F6** Bonus | `modulo/agent.md`, `tools/oc.ts`, `skill/ordenes-compra/SKILL.md` | Piezas idénticas a la app |
| **F7** Hardening | timeouts, topes, errores, seguridad | Checklist §16 completo |

**Dependencias mínimas:** `zod` (obligatoria), framework HTTP (Fastify/Express/Hono),
`tsx`/`typescript`, `dotenv`. Opcionales P1: `pdf-lib`, `xlsx`. Justificar en `SOLUCION.md`.

---

## 15. Plan de documentación y entrega

- `SOLUCION.md` con las 12 secciones del PRD: problema, arquitectura, ciclo del agente,
  elección de modelo + costo, **matriz RC1–RC10**, **diseño del adaptador SAP real (7.5)**,
  lectura del proceso (OC retroactivas), ≥3 trade-offs, supuestos, cobertura HU, uso de IA,
  riesgos.
- `README.md`: un comando para levantar, variables de entorno, cómo correr `demo.ts`,
  link de prueba y clave si aplica.
- `.env.example` sin valores.
- Entrega: repo Git con historial o `.zip` **sin** `node_modules/`, `out/` ni `.env`.

---

## 16. Definición de "hecho" (acceptance checklist)

- [ ] HU-1: `oc_leer_paquete` devuelve paquete normalizado; adjunto ausente → `null`.
- [ ] HU-2: `oc_validar` aplica RC1–RC10 y devuelve `apta/bloqueos/confirmaciones/derivados`.
- [ ] HU-3: `oc_construir_payload` produce `OrdenCompra` válido en zod + `trazabilidad.json`.
- [ ] HU-4: `aprobacion.txt` con encabezados + cuerpo + `sha256` (P0); `.pdf` (P1 opcional).
- [ ] HU-5: `oc_crear` con guardas, idempotencia por `solicitud_id`, secuencial desde `4500000001`, `control.csv` por intento.
- [ ] HU-6: errores `{ ok:false, error }` legibles; un caso malo no aborta el lote.
- [ ] `demo.ts` sin clave: 6 casos + idempotencia sol-001 + confirmación sol-004.
- [ ] Front muestra tool calls y resalta confirmación.
- [ ] `agent/prompt.md`, `src/knowledge/`, `src/tools/` separados.
- [ ] `.env` fuera del repo; clave nunca en front/logs/respuestas.
- [ ] Link público activo (o local con `-10` asumido).
- [ ] `SOLUCION.md` y `README.md` completos.
- [ ] Bonus `modulo/` (si se decide incluirlo).

---

## 17. Estimación de esfuerzo (relativa)

| Bloque | Esfuerzo |
|---|---|
| Dominio (reglas + payload + extractores + tests) | 35% |
| Herramientas + SAP mock + demo | 20% |
| LLM adapter + bucle + prompt + server | 20% |
| Front | 10% |
| Docs + deploy | 10% |
| Bonus + hardening | 5% |

El bloque de mayor valor y menor riesgo es el dominio; conviene construirlo y verificarlo
**antes** de conectar el modelo.

---

## 18. Decisiones confirmadas (stack)

| # | Decisión | Elección | Implicación |
|---|---|---|---|
| D1 | Runtime | **Node 22 + `tsx`** | `tsx` en runtime (dev y prod); Vite solo para el front |
| D2 | Front | **React + Vite** | `web/` con Vite; en dev proxy `/api` → backend; en prod el server sirve `web/dist` |
| D3 | LLM | **Groq** (API compatible con OpenAI) | Cliente `openai` apuntando a `https://api.groq.com/openai/v1`; `GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-120b`) |
| D4 | Despliegue | **Túnel local** (cloudflared/ngrok) | URL pública durante la defensa; el FS de `out/` es local y escribible |
| D5 | Bonus | **Sí, incluir `modulo/`** | Reutiliza `prompt.md`, `tools/oc.ts` y `knowledge/` sin divergencia |
| D6 | Idioma | Español | UI, docs y mensajes del agente en español |

> Nota D4: el PRD penaliza `-10` solo si se corre **en local** durante la defensa. Un túnel
> que expone el backend en una URL pública cumple el requisito de "link para probar"; usar
> un túnel con nombre/dominio reservado para que el link sea estable durante la sesión.

Arranco por **F0 → F2** (scaffold, dominio, herramientas y `demo.ts` verificable sin clave)
y después F3 → F7.
