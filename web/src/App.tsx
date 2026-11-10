import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

type ToolCallRecord = {
  name: string;
  args: unknown;
  ok: boolean;
  resumen: string;
  result: unknown;
};

type Mensaje =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCallRecord[] };

type Health = {
  ok: boolean;
  provider: string;
  model: string;
  configured: boolean;
};

type ChatResponse = {
  ok: boolean;
  sessionId?: string;
  reply?: string;
  toolCalls?: ToolCallRecord[];
  needsConfirmation?: boolean;
  error?: string;
};

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

const BIENVENIDA =
  "Hola. Soy el asistente de órdenes de compra de Periferia IT Group. " +
  "Puedo leer el paquete documental de un caso, validar las reglas RC1–RC10, " +
  "pedirte confirmación cuando hay excepciones y crear la OC en el SAP simulado. " +
  "Dime qué caso quieres procesar (por ejemplo sol-001) o usa los botones de abajo.";

const CASOS = [
  { id: "sol-001", nota: "crea sin excepciones" },
  { id: "sol-002", nota: "bloqueo RC1" },
  { id: "sol-003", nota: "bloqueo RC2" },
  { id: "sol-004", nota: "confirmación RC5" },
  { id: "sol-005", nota: "retroactiva RC8" },
  { id: "sol-006", nota: "derivados RC6" },
];

/**
 * URL base de la API. Vacía = mismo origen (`npm run dev` usa el proxy de
 * Vite; el despliegue en Render sirve front y API en un solo origen). En el
 * build de GitHub Pages se inyecta la URL del backend vía `VITE_API_URL`.
 */
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function nuevoSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ses-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function obtenerSessionId(): string {
  try {
    const guardado = localStorage.getItem("oc-session-id");
    if (guardado) return guardado;
    const nuevo = nuevoSessionId();
    localStorage.setItem("oc-session-id", nuevo);
    return nuevo;
  } catch {
    return nuevoSessionId();
  }
}

function recortarJson(value: unknown): string {
  const texto = JSON.stringify(value, null, 2) ?? String(value);
  return texto.length > 4000 ? `${texto.slice(0, 4000)}\n… (truncado)` : texto;
}

function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(texto: string): string {
  return escapeHtml(texto)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

/* ------------------------------------------------------------------ */
/* Render de texto del asistente (Markdown mínimo y seguro)            */
/* ------------------------------------------------------------------ */

function TextoAsistente({ texto }: { texto: string }) {
  const bloques: ReactNode[] = [];
  let lista: string[] = [];

  const vaciarLista = () => {
    if (lista.length === 0) return;
    bloques.push(
      <ul key={`ul-${bloques.length}`}>
        {lista.map((item, indice) => (
          <li
            key={indice}
            dangerouslySetInnerHTML={{ __html: inline(item) }}
          />
        ))}
      </ul>,
    );
    lista = [];
  };

  texto.split(/\r?\n/).forEach((linea, indice) => {
    const limpia = linea.trim();
    if (/^[-*]\s+/.test(limpia)) {
      lista.push(limpia.replace(/^[-*]\s+/, ""));
      return;
    }
    vaciarLista();
    if (limpia === "") {
      bloques.push(<div key={`esp-${indice}`} className="espacio" />);
      return;
    }
    if (/^#{1,4}\s+/.test(limpia)) {
      bloques.push(
        <h4
          key={`h-${indice}`}
          dangerouslySetInnerHTML={{
            __html: inline(limpia.replace(/^#{1,4}\s+/, "")),
          }}
        />,
      );
      return;
    }
    bloques.push(
      <p
        key={`p-${indice}`}
        dangerouslySetInnerHTML={{ __html: inline(limpia) }}
      />,
    );
  });
  vaciarLista();

  return <div className="texto">{bloques}</div>;
}

/* ------------------------------------------------------------------ */
/* Tarjeta de tool call                                                */
/* ------------------------------------------------------------------ */

function ToolCall({ tool }: { tool: ToolCallRecord }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className={`tool ${tool.ok ? "ok" : "error"}`}>
      <button
        type="button"
        className="tool-cabecera"
        onClick={() => setAbierto((valor) => !valor)}
        aria-expanded={abierto}
      >
        <span className="tool-estado">{tool.ok ? "✓" : "✕"}</span>
        <span className="tool-nombre">{tool.name}</span>
        <span className="tool-resumen">{tool.resumen}</span>
        <span className="tool-flecha">{abierto ? "▾" : "▸"}</span>
      </button>
      {abierto && (
        <div className="tool-detalle">
          <div>
            <strong>Argumentos</strong>
            <pre>{recortarJson(tool.args)}</pre>
          </div>
          <div>
            <strong>Resultado</strong>
            <pre>{recortarJson(tool.result)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [sessionId, setSessionId] = useState<string>(obtenerSessionId);
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    { role: "assistant", content: BIENVENIDA, toolCalls: [] },
  ]);
  const [entrada, setEntrada] = useState("");
  const [cargando, setCargando] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const finRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let activo = true;
    fetch(`${API_BASE}/api/health`)
      .then((respuesta) => respuesta.json() as Promise<Health>)
      .then((data) => {
        if (activo) setHealth(data);
      })
      .catch(() => {
        if (activo) setHealth(null);
      });
    return () => {
      activo = false;
    };
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes, cargando, needsConfirmation]);

  const enviar = useCallback(
    async (texto: string) => {
      const limpio = texto.trim();
      if (!limpio || cargando) return;

      setError(null);
      setEntrada("");
      setMensajes((previos) => [
        ...previos,
        { role: "user", content: limpio },
      ]);
      setCargando(true);

      try {
        const respuesta = await fetch(`${API_BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: limpio }),
        });
        const data = (await respuesta.json()) as ChatResponse;
        if (!respuesta.ok || !data.ok) {
          throw new Error(data.error ?? `Error HTTP ${respuesta.status}`);
        }
        setMensajes((previos) => [
          ...previos,
          {
            role: "assistant",
            content: data.reply ?? "Listo.",
            toolCalls: data.toolCalls ?? [],
          },
        ]);
        setNeedsConfirmation(Boolean(data.needsConfirmation));
      } catch (fallo) {
        setError(fallo instanceof Error ? fallo.message : String(fallo));
        setNeedsConfirmation(false);
      } finally {
        setCargando(false);
      }
    },
    [cargando, sessionId],
  );

  const enviarFormulario = (evento: FormEvent) => {
    evento.preventDefault();
    void enviar(entrada);
  };

  const nuevaConversacion = () => {
    const nuevo = nuevoSessionId();
    try {
      localStorage.setItem("oc-session-id", nuevo);
    } catch {
      // localStorage puede estar deshabilitado; la sesión sigue en memoria.
    }
    setSessionId(nuevo);
    setMensajes([{ role: "assistant", content: BIENVENIDA, toolCalls: [] }]);
    setNeedsConfirmation(false);
    setError(null);
    setEntrada("");
  };

  return (
    <div className="app">
      <header className="cabecera">
        <div className="marca">
          <div className="logo">OC</div>
          <div>
            <h1>Órdenes de Compra · SAP</h1>
            <p>Agente de compras · Periferia IT Group</p>
          </div>
        </div>
        <div className="cabecera-derecha">
          {health && (
            <span
              className={`badge ${health.configured ? "ok" : "warn"}`}
              title={
                health.configured
                  ? "El proveedor LLM está configurado"
                  : "Falta GROQ_API_KEY en .env"
              }
            >
              {health.configured ? "Groq listo" : "Sin GROQ_API_KEY"} ·{" "}
              {health.model}
            </span>
          )}
          <button
            type="button"
            className="boton secundario"
            onClick={nuevaConversacion}
          >
            Nueva conversación
          </button>
        </div>
      </header>

      <main className="chat">
        <section className="mensajes" aria-live="polite">
          {mensajes.map((mensaje, indice) => (
            <div key={indice} className={`mensaje ${mensaje.role}`}>
              <div className="burbuja">
                {mensaje.role === "assistant" ? (
                  <TextoAsistente texto={mensaje.content} />
                ) : (
                  <span>{mensaje.content}</span>
                )}
              </div>
              {mensaje.role === "assistant" &&
                mensaje.toolCalls.length > 0 && (
                  <div className="herramientas">
                    <div className="herramientas-titulo">
                      Herramientas ejecutadas
                    </div>
                    {mensaje.toolCalls.map((tool, posicion) => (
                      <ToolCall key={posicion} tool={tool} />
                    ))}
                  </div>
                )}
            </div>
          ))}

          {cargando && (
            <div className="mensaje assistant">
              <div className="burbuja pensando">
                Pensando<span className="puntos">…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="alerta error" role="alert">
              <strong>No pude completar el turno.</strong> {error}
            </div>
          )}

          {needsConfirmation && !cargando && (
            <div className="alerta confirmacion" role="status">
              <div>
                <strong>Se requiere tu confirmación.</strong> Revisa las
                excepciones de la última respuesta. La OC no se creará hasta
                que confirmes.
              </div>
              <div className="acciones-confirmacion">
                <button
                  type="button"
                  className="boton"
                  onClick={() =>
                    void enviar("Sí, confirmo la creación de la OC.")
                  }
                >
                  Sí, confirmo
                </button>
                <button
                  type="button"
                  className="boton secundario"
                  onClick={() => void enviar("No, cancela la creación.")}
                >
                  No, cancelar
                </button>
              </div>
            </div>
          )}

          <div ref={finRef} />
        </section>

        <section className="casos" aria-label="Casos de prueba">
          <span className="casos-titulo">Casos de prueba:</span>
          {CASOS.map((caso) => (
            <button
              key={caso.id}
              type="button"
              className="chip"
              disabled={cargando}
              onClick={() => void enviar(`Procesa el caso ${caso.id}.`)}
              title={caso.nota}
            >
              {caso.id}
              <small>{caso.nota}</small>
            </button>
          ))}
        </section>

        <form className="entrada" onSubmit={enviarFormulario}>
          <textarea
            value={entrada}
            onChange={(evento) => setEntrada(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === "Enter" && !evento.shiftKey) {
                evento.preventDefault();
                void enviar(entrada);
              }
            }}
            placeholder="Escribe: procesa el caso sol-004 (Enter para enviar, Shift+Enter para salto de línea)"
            rows={2}
            disabled={cargando}
          />
          <button
            type="submit"
            className="boton"
            disabled={cargando || entrada.trim() === ""}
          >
            {cargando ? "Procesando…" : "Enviar"}
          </button>
        </form>
      </main>

      <footer className="pie">
        <span>
          Sesión <code>{sessionId.slice(0, 8)}</code> · Los valores salen de las
          herramientas, no del modelo.
        </span>
      </footer>
    </div>
  );
}
