import type { WhiskerApi } from '../shared/types';

declare global {
  interface Window {
    /** Exposed by src/preload/preload.ts. */
    whisker: WhiskerApi;
  }
}

export const api = window.whisker;
