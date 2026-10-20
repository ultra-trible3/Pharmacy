import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './shared/ipc.js';
import type {
  ApiRequestPayload,
  ApiResponse,
  AppInfo,
  LoginPayload,
  PharmacyBridge,
  PrintOptions,
  PrintResult,
  ServerHealth,
  SessionState,
} from './shared/ipc.js';

/**
 * The preload bridge — the renderer's ONLY route to the outside world.
 *
 * - `contextIsolation` is enabled, so this file shares no JavaScript context
 *   with the page; only the frozen object below crosses the boundary.
 * - Every call is bound to an explicit channel from `IPC`; the renderer cannot
 *   invoke arbitrary channels, read files, or spawn processes.
 */
const bridge: PharmacyBridge = {
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  health: (): Promise<ServerHealth> => ipcRenderer.invoke(IPC.appHealth),
  auth: {
    login: (payload: LoginPayload) => ipcRenderer.invoke(IPC.authLogin, payload),
    logout: (): Promise<void> => ipcRenderer.invoke(IPC.authLogout),
    session: (): Promise<SessionState> => ipcRenderer.invoke(IPC.authSession),
    onChange: (listener: (state: SessionState) => void): (() => void) => {
      const handler = (_event: unknown, state: SessionState) => listener(state);
      ipcRenderer.on(IPC.authChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.authChanged, handler);
      };
    },
  },
  api: {
    request: <T = unknown>(payload: ApiRequestPayload): Promise<ApiResponse<T>> =>
      ipcRenderer.invoke(IPC.apiRequest, payload) as Promise<ApiResponse<T>>,
  },
  print: (options?: PrintOptions): Promise<PrintResult> =>
    ipcRenderer.invoke(IPC.appPrint, options) as Promise<PrintResult>,
};

contextBridge.exposeInMainWorld('pharmacy', Object.freeze(bridge));
