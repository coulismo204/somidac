/// <reference types="vite/client" />
import type { ApiSomidac } from '../../commun/ipc';

declare global {
  interface Window {
    somidac: ApiSomidac;
  }
}
