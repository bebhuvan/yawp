/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YAWP_SIDECAR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
