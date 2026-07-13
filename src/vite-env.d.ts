/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OpenAI-compatible base URL ending in /v1. Defaults to the "/v1" proxy. */
  readonly VITE_LLM_BASE_URL?: string;
  /** Model name sent to the endpoint. */
  readonly VITE_LLM_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
