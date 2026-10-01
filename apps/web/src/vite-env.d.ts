/// <reference types="vite/client" />

interface Window {
  /** Fades out the opening screen defined in index.html (phones only). */
  __hideSplash?: () => void;
}
