# SOLUCION — Reto 03: Órdenes de Compra SAP

> Documento de decisiones. El código está en `src/`, el comportamiento en
> `agent/prompt.md`, el conocimiento en `src/knowledge/` y la ejecución en
> `src/tools/oc.ts` + `src/domain/`.

---

## 1. Problema en una frase

La analista administrativa arma órdenes de compra copiando datos de correos,
cotizaciones, aprobaciones y maestros; cada copia es una oportunidad de error y
cada OC inválida cuesta reproceso, retraso de pago y hallazgos de auditoría.
**Le duele a la analista** (trabajo manual repetitivo), **a Contabilidad** (gasto
sin control) y **a Auditoría** (evidencia dispersa).

El agente convierte ese paquete documental en un payload validado y trazable, y
solo crea la OC cuando las reglas lo permiten y una persona confirma las
excepciones.

---

## 2. Arquitectura

```
┌────────────────────┐   HTTP/JSON    ┌──────────────────────┐
│ Front React + Vite │ ─────────────▶ │ Express /api/chat    │
│ (web/src/App.tsx)  │ ◀───────────── │ (src/server.ts)      │
└────────────────────┘  reply + tools └──────────┬───────────┘
                                                 │
                                     ┌───────────▼───────────┐
                                     │ Agent (src/agent.ts)  │
                                     │ bucle + confirmación  │
                                     └─────┬───────────┬─────┘
                                           │           │
                              ┌────────────▼──┐   ┌────▼─────────────┐
                              │ LLM (Groq)    │   │ Herramientas oc_*│
                              │ src/llm/      │   │ src/tools/oc.ts  │
                              └───────────────┘   └────┬─────────────┘
                                                       │
                                     ┌─────────────────▼─────────────────┐
                                     │ Dominio puro (src/domain/)        │
                                     │ extract · rules · payload ·       │
                                     │ control · service                 │
                                     └───────┬───────────────┬───────────┘
                                             │               │
                                     ┌───────▼──────┐ ┌──────▼─────────┐
                                     │ fixtures/    │ │ SAP simulado   │
                                     │ (solo leer)  │ │ src/sap/mock.ts│
                                     └──────────────┘ └──────┬─────────┘
                                                             │
                                                     ┌───────▼─────────┐
                                                     │ out/            │
                                                     │ sap/ ordenes    │
                                                     │ control.csv     │
                                                     │ log.jsonl       │
                                                     │ <caso>/...      │
                                                     └─────────────────┘
```

**Dónde vive cada cosa:**

| Capa | Archivo | Cambia cuando… |
|---|---|---|
| Comportamiento | `agent/prompt.md` | cambia el tono o el flujo conversacional |
| Conocimiento | `src/knowledge/ordenes-compra.md` | cambia el proceso de negocio o la semántica de una regla |
| Ejecución | `src/tools/oc.ts`, `src/domain/`, `src/sap/` | cambia un cálculo, un control o la integración |

El front nunca ve la clave ni habla con Groq: solo consume `/api/*`. Las
herramientas no ejecutan comandos de shell y resuelven todas las rutas desde la
raíz del proyecto (`ctx.directory`), con validación de *path traversal* en el
nombre del caso.

---

## 3. Ciclo del agente

`Agent.run(session, mensaje)` implementa un bucle **modelo → herramientas →
modelo**:

1. Agrega el mensaje del usuario al historial de la sesión.
2. Llama al LLM con las definiciones de herramientas (`function calling`).
3. Si el modelo devuelve `tool_calls`, valida los argumentos con **zod**, ejecuta
   cada herramienta, guarda el resultado y lo devuelve al modelo.
4. Repite hasta que el modelo responde sin herramientas o se alcanza un límite.

**Límites y control de costo:**

- `MAX_ITERATIONS` (default 25) por turno. Al alcanzarlo, el agente responde con
  lo que tiene y lo que falta.
- `MAX_TOKENS_PER_SESSION` (default 120 000). Antes de cada llamada se verifica;
  al superarlo, se cierra el turno con un mensaje claro.
- `LLM_TIMEOUT_MS` (default 30 s) en el cliente de Groq, con traducción a un
  mensaje legible.
- `max_tokens: 1024` por respuesta del modelo.

**Confirmación humana (CA3):** la puerta no vive solo en el prompt, vive en el
código. `src/agent.ts` mantiene `session.pendingConfirmation` y rechaza
`oc_crear` con `confirmado=true` si:

- no hay una validación previa con excepciones,
- la confirmación es del mismo turno en que se validó,
- el caso confirmado no coincide con el pendiente, o
- el último mensaje del usuario no es afirmativo (`sí`, `confirmo`, `adelante`,
  `procede`, `autorizo`, …).

Además, `oc_crear` **re-valida y reconstruye** el payload desde el caso
(`crearCaso`), así que el modelo no puede alterar montos, fechas ni códigos
aunque los envíe. La confirmación es una condición de negocio, no un dato de
confianza del modelo.

**Idempotencia:** `MockSapAdapter` busca por `solicitud_id` antes de crear. Un
segundo intento devuelve el mismo `numero_oc` y se registra como `idempotente`.

---

## 4. Elección del modelo

- **Proveedor:** Groq, API compatible con OpenAI (`/openai/v1`).
- **Modelo por defecto:** `openai/gpt-oss-120b`.
- **Por qué:** soporta *tool calling* de forma estable, responde en español y es
  rápido (clave para una demo conversacional). Al usar el SDK de OpenAI solo
  cambia `baseURL`, y el resto del código queda aislado tras `LlmAdapter`
  (`src/llm/adapter.ts`), así que cambiar de modelo es una variable de entorno.
- **Cómo se eligió:** la cuenta de Groq usada para la demo no tiene acceso a
  `llama-3.3-70b-versatile` (devuelve 404). Se listaron los modelos disponibles
  con `GET /openai/v1/models` y se eligió `openai/gpt-oss-120b` por soportar
  *tool calling*. `openai/gpt-oss-20b` y `qwen/qwen3.8-27b` quedan como
  alternativas si el límite de tokens por minuto aprieta.
- **Límite de cuota:** el plan gratuito de Groq impone ~8 000 TPM. Un turno
  completo (prompt + conocimiento + resultados de herramientas) ronda los
  4 000 tokens, así que dos turnos seguidos pueden tocar el límite. Mitigación:
  `maxRetries: 3` en el cliente, `max_tokens: 1024` por respuesta y argumentos
  de herramienta mínimos (`{ caso }` en vez de repetir el paquete completo), lo
  que además evita truncamientos del JSON de *tool call*.

**Costo estimado por caso (orden de magnitud):** un caso típico hace 3–5
llamadas al modelo, con ~2 000–5 000 tokens de entrada (prompt + conocimiento +
resultados de herramientas) y ~300–800 de salida. Con precios de referencia de
Groq para `gpt-oss-120b` (~US$0,15/M entrada y ~US$0,60/M salida), el costo es
**≈ US$0,001–0,005 por caso**, más reintentos. El tope de tokens por sesión
acota el peor caso. Los precios deben verificarse en la página de Groq antes de
presupuestar.

---

## 5. Matriz de controles

Implementados en `src/domain/rules.ts`. Se evalúan **todas** las reglas; un
bloqueo gana sobre cualquier confirmación.

| Regla | Implementación | Efecto | Caso que la dispara |
|---|---|---|---|
| **RC1** | Busca proveedor por NIT comparable (tolera dígito de verificación) o nombre normalizado; exige `activo`. | Bloqueo | `sol-002` (NIT inexistente) |
| **RC2** | Exige aprobación, palabra `Aprobado` y remitente en `aprobadores[]` del centro. | Bloqueo | `sol-003` (aprobador de otro centro) |
| **RC3** | Compara `valor_total` con el `tope` del aprobador que firmó. | Bloqueo | Sintético (test) |
| **RC4** | Valida que el centro exista y que `subarea` esté en su lista. | Bloqueo | Sintético (test) |
| **RC5** | `abs(cotización − total) / total ≤ 2 %`; si no hay cotización o excede, confirmación con ambos valores. | Confirmación | `sol-004` (6 %) |
| **RC6** | Si falta `indicador_iva`, deriva del proveedor y pide confirmación. | Confirmación + derivado | `sol-006` |
| **RC7** | Si faltan `condiciones_pago`, deriva del proveedor y solo informa. | Derivado | `sol-006` |
| **RC8** | Si hay factura con fecha < `fecha_solicitud`, marca `retroactiva=true` y pide confirmación. | Confirmación + marca | `sol-005` |
| **RC9** | Si la aprobación es anterior a la solicitud, pide confirmación. | Confirmación | Sintético (test) |
| **RC10** | `cantidad × valor_unitario` debe igualar `valor_total` (±1 COP). | Bloqueo | Sintético (test) |

**La más difícil fue RC2/RC3 en conjunto.** RC2 tiene dos causas distintas (no
hay correo vs. el remitente no es aprobador del centro) y RC3 depende de *quién*
firmó. Si el aprobador no pertenece al centro, no tiene sentido evaluar su tope:
el resultado sería un bloqueo redundante y confuso. La decisión fue **no evaluar
RC3 cuando RC2 ya falló por autoridad**, y dejar ambos códigos separados para que
la analista sepa si el problema es la persona o el monto.

La segunda dificultad fue **RC8 vs. RC9**: ambas comparan fechas, pero una mira
la factura (retroactiva) y la otra la aprobación. Se comparan solo fechas
`YYYY-MM-DD`, ignorando la hora y la zona, porque el fixture trae
`-05:00` y comparar strings completos daría falsos positivos.

---

## 6. Diseño del adaptador SAP real

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV`** (servicio estándar de
SAP S/4HANA). Es la vía más directa para crear una OC (`POST
A_PurchaseOrder`) sin instalar middleware, expone el modelo de datos estándar y
permite leer maestros (proveedor, centro de costo) por la misma API.

- **Por qué no BAPI/RFC:** `BAPI_PO_CREATE1` exige conectividad RFC (puerto 33xx,
  SAP GUI, librería nativa) y su manejo de errores es más rígido. OData usa
  HTTPS y JSON, encaja con Node y con el mismo stack del agente.
- **Por qué no Integration Suite:** es la opción correcta si la empresa ya tiene
  BTP y necesita orquestar varios sistemas, pero agrega costo y tiempo de
  aprovisionamiento que no se justifican para un solo flujo.
- **Por qué no carga por archivo:** es el Plan B, no la primera opción; pierde
  validación en línea y devolución inmediata del número de OC.

**Mapeo del payload (7.4) a OData:**

| Payload del reto | OData `A_PurchaseOrder` |
|---|---|
| `sociedad: "1000"` | `CompanyCode` |
| `organizacion_compras: "1000"` | `PurchasingOrganization` |
| `proveedor.codigo_sap` | `Supplier` |
| `moneda` | `DocumentCurrency` |
| `condiciones_pago` | `PaymentTerms` |
| `referencia.solicitud_id` | `PurchaseOrderID` externo o campo de referencia (`YY1_*` / `SupplierRespSalesPersonName` según extensión) |
| `aprobador.evidencia_sha256` | adjunto (`Attachment`) o campo de extensión |
| `posiciones[]` | `to_PurchaseOrderItem` (`PurchaseOrderItem`, `Material`, `OrderQuantity`, `PurchaseOrderQuantityUnit`, `NetPriceAmount`, `CostCenter`, `TaxCode`) |
| `posiciones[].descripcion` | `PurchaseOrderItemText` (máx. 40) |
| `excepciones[]` | comentario de cabecera / log de auditoría |

**Autenticación y credenciales:** OAuth 2.0 *client credentials* contra SAP
BTP/Cloud Connector, o *destination* administrado en BTP. Las credenciales
viven en el **secret store del backend** (variables de entorno o vault), nunca en
el prompt, el front ni el repositorio. El agente solo invoca una interfaz
`SapAdapter`; no conoce tokens.

**Idempotencia y errores parciales:**

- Se envía un identificador de correlación (`solicitud_id`) y se consulta
  `buscarOrdenPorReferencia` antes de crear.
- Si SAP responde timeout, se vuelve a consultar por referencia antes de
  reintentar; nunca se crea a ciegas.
- Si SAP devuelve error parcial (cabecera creada, posición rechazada), se
  registra el `numero_oc` y el detalle, se marca el caso como
  `creado_con_error` y se alerta a la analista. No se reintenta la creación
  completa para no duplicar.
- Los errores HTTP 4xx de negocio se traducen a mensajes legibles; los 5xx se
  reintentan con *backoff* acotado.

**Plan B si la conexión no es viable:** el agente sigue ahorrando tiempo si
genera (a) la OC lista para pegar en SAP, (b) un archivo de carga masiva
(CSV/Excel con el layout de `A_PurchaseOrder`) y (c) la evidencia y la
trazabilidad para adjuntar. El `SapAdapter` tendría una implementación
`FileSapAdapter` que escribe ese archivo y devuelve un número provisional; el
resto del flujo no cambia.

---

## 7. Lectura del proceso: OC retroactivas

Una OC retroactiva significa que **el gasto ya ocurrió antes de la autorización**.
No es un detalle contable: es una señal de control interno. Puede ser una
urgencia legítima (una caída de infraestructura que no admite esperar) o una
compra hecha al margen del proceso. El agente no debe ocultarlas ni tratarlas
como un caso normal: las **detecta, las marca y las deja registradas** con
evidencia y confirmación humana.

A la dirección le diría tres cosas:

1. **Medir, no solo bloquear.** Hoy el indicador clave es cuántas OC retroactivas
   hay por mes, por centro y por proveedor. Sin esa medición, el problema es
   invisible.
2. **Tolerarlas solo con marca y confirmación.** Rechazarlas en bloque empuja la
   compra fuera del sistema; tolerarlas sin registro normaliza el desorden. La
   vía intermedia es permitirlas con evidencia, aprobación y un motivo.
3. **Atacar la causa.** Si la mayoría son urgencias de tecnología o servicios
   recurrentes, el cambio de proceso es anticipar esas compras con solicitudes
   marco o acuerdos de precio, no pedirle a la analista que corra más rápido.

La política de si se aceptan o se rechazan es una decisión de negocio fuera del
alcance del agente; el agente la hace visible y medible.

---

## 8. Decisiones y trade-offs

1. **Dominio puro separado de las herramientas.**
   - *Alternativa descartada:* poner toda la lógica dentro de `execute` de cada
     herramienta.
   - *Por qué:* el dominio se prueba sin LLM, sin HTTP y sin disco de producción
     (25 tests). `demo.ts` ejecuta las mismas herramientas `oc_*` que el agente
     y los tests usan exactamente el mismo código.
2. **El modelo no construye el payload final.**
   - *Alternativa descartada:* dejar que el modelo arme el JSON y validarlo con
     zod.
   - *Por qué:* un modelo puede "corregir" un monto para que cuadre. Aquí
     `oc_crear` reconstruye desde el caso canónico; el payload del modelo solo se
     valida como forma. Es defensa en profundidad, no confianza.
3. **Confirmación en código, no solo en el prompt.**
   - *Alternativa descartada:* confiar en que el prompt respete la puerta humana.
   - *Por qué:* los prompts se degradan con el contexto. `src/agent.ts` impone la
     regla del turno posterior y del mensaje afirmativo; los tests la cubren.
4. **SAP simulado por archivos JSONL.**
   - *Alternativa descartada:* un mock en memoria.
   - *Por qué:* JSONL es inspeccionable, sobrevive reinicios, permite demostrar
     idempotencia y se parece a un *append-only log* real.
5. **`tsx` como dependencia de producción.**
   - *Alternativa descartada:* compilar con `tsc` a `dist/`.
   - *Por qué:* `npm start` funciona sin un paso de build del backend; el front
     sí se compila con Vite. Se prioriza la simplicidad de la demo.

---

## 9. Supuestos

- Los maestros de `fixtures/reto-03/maestros/` son completos y están vigentes.
  En producción se consultan en SAP en tiempo real.
- El correo de aprobación es evidencia suficiente. Auditoría podría exigir firma
  digital o aprobación en workflow; el diseño deja el hash listo para adjuntar.
- El NIT del maestro es la base de 9 dígitos y los documentos pueden traer el
  dígito de verificación (10). Se compara descartando el último dígito cuando
  hay 10.
- La unidad se infiere de la descripción (`horas` → `H`, `mes/meses` de servicio
  → `MES`, resto → `UN`). Es una heurística documentada, no una regla del PRD.
- La descripción se recorta a 40 caracteres por el límite de SAP.
- `DEMO_FECHA` fija la fecha para que la demo sea determinista; en producción se
  usa la fecha del sistema.
- Un caso se identifica por el nombre de su carpeta (`sol-001`); el
  `solicitud_id` es el que manda para idempotencia.
- El chat no tiene autenticación: es una demo. En producción iría detrás de SSO.

---

## 10. Cobertura

| Historia | Estado | Evidencia | Qué falta para producción |
|---|---|---|---|
| **HU-1** Leer el paquete | Hecho | `oc_leer_paquete`, `extract.ts`, `demo.ts` | Lectura real de adjuntos (PDF/Excel binario); hoy `oc_leer_excel` cubre JSON/CSV |
| **HU-2** Validar RC1–RC10 | Hecho | `rules.ts`, 6 casos + 6 sintéticos | Reglas configurables por centro/país sin tocar código |
| **HU-3** Construir payload | Hecho | `payload.ts`, `trazabilidad.json` | Más posiciones por OC; hoy una posición (número 10) |
| **HU-4** Evidencia | Parcial (P0) | `aprobacion.txt` + SHA-256 | PDF (P1) y adjunto real en SAP |
| **HU-5** Crear OC | Hecho (simulado) | `MockSapAdapter`, `control.csv`, idempotencia | Adaptador OData real (sección 6) |
| **HU-6** Manejo de errores | Hecho | `{ ok:false, error }`, timeout, mensajes al chat | Reintentos con *backoff* y alertas operativas |
| **Bonus** Módulo reutilizable | Hecho | `modulo/` | Publicación como paquete npm / plugin |
| **Link público** | Hecho | `README.md` §8 | Túnel activo durante la defensa |

**Para producción faltaría:** autenticación SSO, adaptador SAP real con
credenciales en vault, lectura de PDF/Excel binario, aprobaciones en workflow,
observabilidad (métricas y trazas), y una política formal de retención de
evidencias.

---

## 11. Uso de IA

Usé asistentes de IA (incluido el agente de código de OpenCode) para:

- **Diseño y scaffolding:** proponer la separación `domain/` vs. `tools/` y el
  contrato de `SapAdapter`.
- **Redacción:** borradores de `agent/prompt.md` y de este documento.
- **Pruebas:** generar casos sintéticos para las reglas que los fixtures no
  disparan (RC3, RC4, RC7, RC9) y revisar los mensajes de error.
- **Revisión:** detectar el problema del dígito de verificación del NIT y el
  `any` explícito en el registro de herramientas.

**Qué descarté y por qué:**

- Un diseño donde el modelo armaba el payload y solo se validaba con zod: lo
  descarté por riesgo de que "ajustara" montos. Se reemplazó por reconstrucción
  desde el caso.
- Un *streaming* de tokens en el front: agrega complejidad y no aporta a la
  demo; se prefirió una respuesta completa con tool calls visibles.
- Un mock SAP en memoria: no permitía demostrar idempotencia entre reinicios.
- Copiar el prompt y el conocimiento en `modulo/`: el PRD exige que las piezas
  sean las mismas; se reutilizan por importación, no por copia divergente.

Las decisiones de negocio (qué reglas son bloqueo vs. confirmación, política de
retroactivas) no se delegaron al modelo: están en código y en el conocimiento,
revisadas contra el PRD.

---

## 12. Riesgos de producción y mitigación

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El modelo altera un valor o inventa un dato | OC incorrecta | Los valores salen de herramientas; `oc_crear` reconstruye desde el caso y re-valida |
| SAP no es viable en el corto plazo | No se puede crear la OC | Plan B: archivo de carga masiva + OC lista para pegar (sección 6) |
| Timeout o caída del proveedor LLM | Turno perdido | Timeout configurable, mensaje claro, sesión viva; el dominio sigue funcionando sin LLM |
| Costo descontrolado | Factura inesperada | Topes de iteraciones y tokens por sesión; `max_tokens` acotado |
| Inyección de prompt vía documentos | El agente obedece texto malicioso | El modelo no tiene permisos de escritura ni shell; las herramientas solo leen fixtures y escriben en `out/`; validación de rutas |
| Fuga de la clave | Uso no autorizado | Clave solo en el backend, nunca en front/logs/respuestas; rotación |
| Duplicación de OC por reintento | Gasto duplicado | Idempotencia por `solicitud_id` + consulta previa por referencia |
| Evidencia insuficiente para auditoría | Hallazgo | SHA-256 del contenido, trazabilidad por valor y adjunto en SAP (P1) |
| Datos personales en logs | Cumplimiento | Los fixtures son ficticios; en producción se anonimizan correos y se define retención |
| Cambios de reglas sin trazabilidad | Comportamiento inesperado | Reglas en código versionado + conocimiento separado; tests por regla |

---

## Anexo: cómo verificar

```bash
npm install
npm run demo      # 6 casos + idempotencia, sin clave, vía herramientas oc_*
npm test          # 25 tests
npm run typecheck # sin errores ni any explícito
npm run dev       # front en :5173, API en :3000
```

Resultados esperados de la demo: `4500000001` (sol-001), bloqueo RC1
(sol-002), bloqueo RC2 (sol-003), `4500000002` (sol-004), `4500000003`
(sol-005), `4500000004` (sol-006) y `4500000001` idempotente en la segunda
pasada de sol-001.

Verificación en vivo (sin instalar nada): abre
<https://reto-03-andres-ochoa.onrender.com> y procesa `sol-002` (bloqueo RC1)
o `sol-004` (pide confirmación antes de crear). El front estático de
<https://ingandresochoa.github.io/reto-03-andres-ochoa/> consume la misma API
de Render.
