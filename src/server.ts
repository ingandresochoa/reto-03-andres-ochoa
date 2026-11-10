import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { ROOT, config } from "./config";
import { Agent, crearSesion, type Session } from "./agent";
import { GroqAdapter } from "./llm/groq";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const adapter = new GroqAdapter();
const agent = new Agent(adapter);
const sesiones = new Map<string, Session>();

function obtenerSesion(id: string): Session {
  const existente = sesiones.get(id);
  if (existente) return existente;
  const nueva = crearSesion(id);
  sesiones.set(id, nueva);
  return nueva;
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "groq",
    model: config.groqModel,
    configured: adapter.configurado,
  });
});

app.post("/api/chat", async (req, res) => {
  const body = (req.body ?? {}) as { sessionId?: unknown; message?: unknown };
  const sessionId = body.sessionId;
  const message = body.message;

  if (
    typeof sessionId !== "string" ||
    sessionId.trim() === "" ||
    typeof message !== "string" ||
    message.trim() === ""
  ) {
    res.status(400).json({
      ok: false,
      error: "sessionId y message son obligatorios.",
    });
    return;
  }

  try {
    const session = obtenerSesion(sessionId.trim());
    const turno = await agent.run(session, message.trim());
    res.json({ ok: true, sessionId: session.id, ...turno });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      ok: false,
      error: `Error procesando el mensaje: ${detalle}`,
    });
  }
});

app.get("/api/sessions/:id", (req, res) => {
  const session = sesiones.get(req.params.id);
  if (!session) {
    res.status(404).json({ ok: false, error: "Sesión no encontrada." });
    return;
  }
  res.json({
    ok: true,
    sessionId: session.id,
    history: session.history,
    toolCalls: session.toolCalls,
    needsConfirmation: session.pendingConfirmation !== null,
  });
});

/* ------------------------------------------------------------------ */
/* Front compilado (producción)                                        */
/* ------------------------------------------------------------------ */

const webDist = path.join(ROOT, "web", "dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.listen(config.port, () => {
  console.log(`Servidor en http://localhost:${config.port}`);
  console.log(
    `Proveedor LLM: groq · modelo ${config.groqModel} · ${
      adapter.configurado ? "configurado" : "sin GROQ_API_KEY"
    }`,
  );
});
