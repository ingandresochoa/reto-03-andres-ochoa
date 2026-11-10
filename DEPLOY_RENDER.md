# Despliegue en vivo (Render + GitHub Pages)

Guía paso a paso para tener el agente respondiendo en una URL pública
permanente. La arquitectura:

- **Render (backend):** ejecuta `src/server.ts` con el ciclo del agente, las
  herramientas `oc_*`, el SAP simulado y la clave de Groq. Sirve la API
  (`/api/*`) y el front compilado **en un solo origen**.
- **GitHub Pages (front estático):** copia del front compilada en cada push a
  `main`; consume la API de Render vía `VITE_API_URL`.
- **GitHub Actions (keepalive):** el plan gratuito de Render duerme el servicio
  tras 15 min sin tráfico; el workflow `keepalive.yml` llama a `/api/health`
  cada 5 min para mantenerlo despierto.

## 1. Crear el servicio en Render (~5 min, una sola vez)

1. Entra en <https://render.com> y pulsa **Sign in with GitHub** (así puede
   leer este repositorio sin claves manuales).
2. **New + → Blueprint**, selecciona el repositorio `reto-03-andres-ochoa`.
   Render lee `render.yaml` y propone el servicio `reto-03-andres-ochoa`.
3. Al aplicar, pedirá el valor de `GROQ_API_KEY`: pégala ahí. Ese valor vive en
   el dashboard de Render (`sync: false`), **nunca** en el repositorio.
4. Espera el build (~2–3 min). La URL queda del estilo
   `https://reto-03-andres-ochoa.onrender.com`.
5. Verifica: abre `https://TU-URL.onrender.com/api/health` y comprueba
   `{"ok":true,"provider":"groq","model":"openai/gpt-oss-120b","configured":true}`.

## 2. Conectar el front de Pages con la API de Render (~1 min)

1. Copia la URL pública de Render (sin `/` final), por ejemplo
   `https://reto-03-andres-ochoa.onrender.com`.
2. En GitHub: **Settings → Secrets and variables → Actions → Variables →
   New repository variable**:
   - Name: `BACKEND_URL`
   - Value: la URL de Render
3. **Actions → "Deploy front a GitHub Pages" → Run workflow** para recompilar
   el front con la API conectada.
4. El front queda en `https://ingandresochoa.github.io/reto-03-andres-ochoa/`.

> El link principal para la defensa es el de **Render** (front + API en un
> solo origen). El de Pages es un respaldo estático que siempre está arriba.

## 3. Mantenimiento

| Situación | Qué hacer |
|---|---|
| Render duerme igual (p. ej. tras 60 días sin actividad en el repo, GitHub pausa los cron) | Cualquier push al repo reactiva los schedules; o ejecuta manualmente el workflow `keepalive` |
| Cambia la URL de Render | Actualiza la variable `BACKEND_URL`, ejecuta `Deploy front a GitHub Pages` y actualiza el README §8 |
| Primer request tras un reinicio en frío | Puede tardar ~30–60 s; es normal del plan gratuito |
| Cuota de Groq | El plan gratuito tiene ~8 000 tokens/min; el agente reintenta (ver `SOLUCION.md` §4) |

## Por qué no todo en GitHub Pages

GitHub Pages solo sirve archivos estáticos: no puede ejecutar Node ni mantener
la clave de Groq fuera del cliente. Por eso el ciclo del agente (backend)
vive en Render y Pages aloja únicamente el front.
