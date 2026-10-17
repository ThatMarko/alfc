import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  FanControlActivity,
  MessageToClient,
  MessageToServer,
  State,
} from "../../../common/types";

export type Command = Omit<MessageToServer, "requestId">;
export type BackendConnection = {
  // The last validated snapshot can remain visible during a disconnect.
  state: State | null;
  activity: FanControlActivity | null;
  isActivityStale: boolean;
  // True only after the current socket supplies its own validated snapshot.
  isConnected: boolean;
  connectionError: string | null;
  sendRequest: (message: Command, notify?: boolean) => Promise<MessageToClient>;
};

export const BackendContext = createContext<BackendConnection | null>(null);

export function useWebSocket() {
  const connection = use(BackendContext);
  if (!connection)
    throw new Error("The backend connection provider is missing.");
  return connection;
}

export function useBackendCommand() {
  const { sendRequest } = useWebSocket();
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const commandFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (isPending) {
      const onFocus = () => {
        if (
          document.activeElement !== document.body &&
          document.activeElement !== commandFocusRef.current
        )
          commandFocusRef.current = null;
      };
      // Remember navigation even when a second form subsequently disables its
      // own focused control. An older completion must not reclaim that focus.
      document.addEventListener("focusin", onFocus);
      return () => document.removeEventListener("focusin", onFocus);
    }
    const target = commandFocusRef.current;
    commandFocusRef.current = null;
    // Disabling a pending control can move focus to the document body. Restore
    // it after the controls re-enable, while respecting deliberate navigation.
    if (target?.isConnected && document.activeElement === document.body)
      target.focus({ preventScroll: true });
    return undefined;
  }, [isPending]);
  const runCommand = useCallback(
    async (message: Command, notify = true) => {
      if (pendingRef.current) return undefined;
      commandFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      pendingRef.current = true;
      setIsPending(true);
      try {
        return await sendRequest(message, notify);
      } catch {
        return undefined;
      } finally {
        // The provider displays the backend error once.
        pendingRef.current = false;
        if (mountedRef.current) setIsPending(false);
      }
    },
    [sendRequest],
  );
  return { isPending, runCommand };
}

// Resync only when this form's backend values change. Unrelated broadcasts
// must not erase edits to another field or fan table.
export function useBackendDraft<T>(backendValue: T) {
  const [draft, setDraft] = useState(() => backendValue);
  const serialized = JSON.stringify(backendValue);
  const [previous, setPrevious] = useState(serialized);
  // Adjust before commit when this field changes; an effect would first
  // commit an outdated draft and then render the whole form a second time.
  if (previous !== serialized) {
    setPrevious(serialized);
    setDraft(() => backendValue);
  }
  return [draft, setDraft] as const;
}
