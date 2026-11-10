# Conocimiento del proceso de órdenes de compra

> Esta base describe el proceso de negocio. No es el prompt de comportamiento:
> el agente la usa para interpretar reglas y campos, pero la decisión final la
> toma la herramienta `oc_validar` (código determinista).

## 1. Qué es una OC y por qué existe

Una orden de compra (OC) es el documento con el que Periferia IT Group autoriza
a un proveedor a entregar un bien o servicio y a facturar por ello. En SAP se
registra con sociedad `1000`, organización de compras `1000`, proveedor,
condiciones de pago, posiciones, centro de costo e indicador de IVA.

Sin OC no debería haber factura. Cuando la factura llega antes que la OC se
habla de **OC retroactiva**: el gasto ya ocurrió y la orden se crea después para
poder radicarla. El proceso debe medirlo, no ocultarlo.

## 2. Datos maestros

- **Proveedores**: código SAP, NIT, nombre, condiciones de pago por defecto,
  indicador de IVA por defecto y estado (activo/inactivo). Un proveedor
  inexistente o inactivo no puede recibir una OC.
- **Centros de costo**: cada centro tiene subáreas y una lista de aprobadores
  con un tope en COP. El aprobador debe pertenecer al centro de la solicitud y
  el valor no puede superar su tope.
- **Indicadores de IVA**: `C0` (0 %), `C1` (19 %), `C2` (5 %).
- **Condiciones de pago**: `Z000` (inmediato), `Z015` (15 días), `Z030`
  (30 días), `Z060` (60 días).

## 3. Reglas de control RC1–RC10

| Código | Regla | Efecto |
|---|---|---|
| RC1 | El proveedor debe existir en el maestro y estar activo. | Bloqueo |
| RC2 | Debe existir un correo de aprobación con la palabra "Aprobado" y el remitente debe ser aprobador del centro de costo. | Bloqueo |
| RC3 | El valor total no puede superar el tope del aprobador que firmó. | Bloqueo |
| RC4 | La subárea debe pertenecer al centro de costo. | Bloqueo |
| RC5 | La cotización debe coincidir con el valor de la solicitud dentro de ±2 %. Si no hay cotización o la diferencia es mayor, se pide confirmación. | Confirmación |
| RC6 | Si la solicitud no informa el indicador de IVA, se deriva del proveedor y se pide confirmación. | Confirmación |
| RC7 | Si la solicitud no informa condiciones de pago, se derivan del proveedor y se informa. | Informativo |
| RC8 | Si la factura es anterior a la fecha de la solicitud, la OC es retroactiva y se pide confirmación. | Confirmación + marca |
| RC9 | La fecha de aprobación no puede ser anterior a la fecha de la solicitud. Si lo es, se pide confirmación. | Confirmación |
| RC10 | `cantidad × valor_unitario` debe igualar `valor_total` (±1 COP). | Bloqueo |

**Precedencia:** se evalúan todas las reglas. Un bloqueo impide crear aunque las
confirmaciones estén resueltas. Si el aprobador no pertenece al centro (RC2), no
se evalúa RC3 con ese aprobador.

## 4. Payload de la OC

- `referencia`: `solicitud_id`, `correo_id` y `cotizacion_ref`.
- `sociedad` y `organizacion_compras`: siempre `1000`.
- `proveedor`: `codigo_sap`, `nit`, `nombre` tomados del maestro.
- `moneda`: `COP` o `USD`.
- `condiciones_pago`: de la solicitud o derivadas del proveedor.
- `aprobador`: email, fecha de aprobación y `evidencia_sha256`.
- `posiciones[]`: descripción (máx. 40 caracteres), cantidad, unidad (`UN`, `H`,
  `MES`), precio unitario, centro de costo, subárea e indicador de IVA.
- `excepciones[]`: código, detalle y `confirmado_por` (`null` si no se confirmó).

La unidad se infiere de la descripción: "horas" → `H`; "mes/meses" de servicio
→ `MES`; en los demás casos → `UN`. La descripción se recorta a 40 caracteres
porque SAP limita el texto breve de la posición.

## 5. Evidencia y trazabilidad

- La evidencia de aprobación es un archivo de texto con los encabezados del
  correo (de, para, fecha, asunto), el cuerpo y el `sha256` del contenido. El
  hash se calcula con una función compartida para que coincida siempre con el
  `evidencia_sha256` del payload.
- `out/<caso>/trazabilidad.json` indica, para cada valor del payload, de qué
  documento o maestro salió (`solicitud`, `cotizacion`, `maestro.*`,
  `derivado`).

## 6. Idempotencia y control

- La creación es idempotente por `solicitud_id`: repetirla devuelve el mismo
  `numero_oc` y no genera una segunda orden.
- La numeración es secuencial desde `4500000001`.
- Cada intento queda en `out/control.csv` con: `solicitud_id`, `resultado`
  (`bloqueado`, `pendiente_confirmacion`, `creado`, `idempotente`),
  `numero_oc`, `retroactiva`, `bloqueos`, `confirmaciones` y `ts`.
- Cada llamada a herramienta queda en `out/log.jsonl`.

## 7. Lectura del proceso para la dirección

Las OC retroactivas son una señal de control interno: indican que se compró
antes de autorizar. La recomendación es tolerarlas solo con marca, evidencia y
confirmación humana, medirlas mensualmente y atacar la causa (compras urgentes
sin solicitud previa). La política de si se aceptan o se rechazan es una
decisión de negocio fuera del alcance de este agente; el agente las detecta y
las deja registradas.

## 8. Errores frecuentes y qué pedir

- Proveedor no encontrado o inactivo → pedir el NIT correcto o activar el
  proveedor en el maestro.
- Aprobador sin autoridad → pedir la aprobación del aprobador del centro.
- Valor sobre el tope → escalar al siguiente aprobador o dividir la compra.
- Cotización que no coincide → pedir la cotización correcta o explicar la
  diferencia.
- Aritmética que no cuadra → pedir la corrección de cantidad, valor unitario o
  total.
- Factura anterior a la solicitud → confirmar que se trata de una OC retroactiva.
