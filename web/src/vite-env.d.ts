/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * URL base de la API cuando el front se sirve desde otro origen
   * (GitHub Pages). Vacía = mismo origen (dev con proxy, Render).
   */
  readonly VITE_API_URL?: string;
}
