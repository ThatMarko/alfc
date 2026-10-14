import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import useReactWebSocket, { ReadyState } from "react-use-websocket";
import {
  MessageToClientKind,
  MessageToServerKind,
  type FanControlActivity,
  type MessageToClient,
  type MessageToServer,
  type State,
} from "../../../common/types";
import { isFanControlActivity, isState } from "../../../common/protocol";
import { BackendRequests } from "./backendRequests";
import { errorToast, successToast } from "./misc";

type Command = Omit<MessageToServer, "requestId">;
type BackendConnection = {
  state: State | null;
  activity: FanControlActivity | null;
  isActivityStale: boolean;
  isConnected: boolean;
  connectionError: string | null;
  sendRequest: (message: Command, notify?: boolean) => Promise<MessageToClient>;
};

const BackendContext = createContext<BackendConnection | null>(null);
const shouldReconnect = () => true;
const ignoreMessageRender = () => false;

function resolveWebSocketUrl(): string {
  if (typeof window === "undefined" || !window.location.hostname)
    return "ws://localhost:5522/ws";
  const hostname = window.location.hostname;
  const host =
    hostname.includes(":") && !hostname.startsWith("[")
      ? `[${hostname}]`
      : hostname;
  return `ws://${host}:5522/ws`;
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [activity, setActivity] = useState<FanControlActivity | null>(null);
  const [isActivityStale, setIsActivityStale] = useState(false);
  const activityTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [requests] = useState(() => new BackendRequests());
  const connected = useRef(false);

  const clearActivityTimeout = useCallback(() => {
    if (activityTimeout.current !== null) clearTimeout(activityTimeout.current);
    activityTimeout.current = null;
  }, []);

  const resetConnection = useCallback(() => {
    connected.current = false;
    setState(null);
    setActivity(null);
    setIsActivityStale(false);
    clearActivityTimeout();
    requests.disconnect();
  }, [clearActivityTimeout, requests]);

  const { sendJsonMessage, readyState } = useReactWebSocket(
    resolveWebSocketUrl(),
    {
      // Bun handles protocol-level PING/PONG. Avoid application heartbeat timers
      // that can disconnect a healthy socket when a browser suspends its tab.
      // Event callbacks own parsing and state updates; avoid an extra parsed
      // lastMessage snapshot and render for every acknowledgement.
      disableJson: true,
      filter: ignoreMessageRender,
      retryOnError: true,
      reconnectAttempts: Number.MAX_SAFE_INTEGER,
      reconnectInterval: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      shouldReconnect,
      onOpen: () => {
        connected.current = true;
        setConnectionError(null);
      },
      onClose: resetConnection,
      onError: resetConnection,
      onMessage: (event) => {
        if (event.data === "pong") return;
        let message: MessageToClient;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!message || typeof message !== "object") return;
        if (message.kind === MessageToClientKind.State) {
          if (isState(message.data)) {
            connected.current = true;
            setState(message.data);
            setConnectionError(null);
          } else {
            connected.current = false;
            setState(null);
            setActivity(null);
            setIsActivityStale(false);
            clearActivityTimeout();
            requests.disconnect(
              "The server sent an invalid state. Check the server before applying more changes; pending requests could not be confirmed.",
            );
            setConnectionError(
              "The server sent an incompatible or invalid state. This web UI requires ALFC protocol 1.1 or a compatible later 1.x version.",
            );
          }
        } else if (
          connected.current &&
          message.kind === MessageToClientKind.FanControlActivity &&
          isFanControlActivity(message.data)
        ) {
          clearActivityTimeout();
          setActivity(message.data);
          setIsActivityStale(false);
          // Match the Plasma widget: a live socket does not establish that
          // temperature collection or hardware writes are still progressing.
          activityTimeout.current = setTimeout(() => {
            activityTimeout.current = null;
            setIsActivityStale(true);
          }, 10000);
        } else {
          requests.receive(message);
        }
      },
    },
  );

  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      // Subscribe once for every connection, in both fixed and automatic mode.
      sendJsonMessage(
        { kind: MessageToServerKind.RegisterActivitySocket },
        false,
      );
    }
  }, [readyState, sendJsonMessage]);

  useEffect(() => {
    const currentRequests = requests;
    return () => {
      connected.current = false;
      clearActivityTimeout();
      currentRequests.disconnect();
    };
  }, [clearActivityTimeout, requests]);

  const sendRequest = useCallback(
    async (message: Command, notify = true) => {
      try {
        if (!connected.current)
          throw new Error(
            "The server is disconnected. Reconnect before applying changes.",
          );
        const response = await requests.send(message, (payload) => {
          // Never replay a hardware write automatically after reconnection.
          sendJsonMessage(payload, false);
        });
        if (notify) successToast("Successfully applied.");
        return response;
      } catch (error) {
        errorToast(
          error instanceof Error ? error.message : "The request failed.",
        );
        throw error;
      }
    },
    [requests, sendJsonMessage],
  );

  return createElement(
    BackendContext.Provider,
    {
      value: {
        state,
        activity,
        isActivityStale,
        connectionError,
        isConnected: readyState === ReadyState.OPEN && state !== null,
        sendRequest,
      },
    },
    children,
  );
}

export function useWebSocket() {
  const connection = useContext(BackendContext);
  if (!connection)
    throw new Error("The backend connection provider is missing.");
  return connection;
}

export function useBackendCommand() {
  const { sendRequest } = useWebSocket();
  const [isPending, setIsPending] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const runCommand = useCallback(
    async (message: Command, notify = true) => {
      if (pending.current) return undefined;
      pending.current = true;
      setIsPending(true);
      try {
        return await sendRequest(message, notify);
      } catch {
        return undefined;
      } finally {
        // The provider displays the backend error once.
        pending.current = false;
        if (mounted.current) setIsPending(false);
      }
    },
    [sendRequest],
  );
  return { isPending, runCommand };
}

// Resync only when this form's backend values change. Unrelated broadcasts
// must not erase edits to another field or fan table.
export function useBackendDraft<T>(backendValue: T) {
  const [draft, setDraft] = useState(backendValue);
  const serialized = JSON.stringify(backendValue);
  const previous = useRef(serialized);
  useEffect(() => {
    if (previous.current !== serialized) {
      previous.current = serialized;
      setDraft(backendValue);
    }
  }, [backendValue, serialized]);
  return [draft, setDraft] as const;
}
