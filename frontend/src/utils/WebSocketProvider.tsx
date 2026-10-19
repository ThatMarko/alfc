import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import webSocketModule from "react-use-websocket";
import {
  MessageToClientKind,
  MessageToServerKind,
  type FanControlActivity,
  type State,
} from "../../../common/types";
import { isFanControlActivity, isState } from "../../../common/protocol";
import { BackendRequests } from "./backendRequests";
import { errorToast, successToast } from "./misc";
import { parseBackendMessage, sendBackendMessage } from "./webSocketTransport";
import {
  BackendContext,
  type BackendConnection,
  type Command,
} from "./useWebSocket";

// The package publishes CommonJS exports.default. Vite 8 preserves
// module.exports for default imports in ESM importers; older interop unwraps it.
const useReactWebSocket =
  typeof webSocketModule === "function"
    ? webSocketModule
    : (webSocketModule as unknown as { default: typeof webSocketModule })
        .default;

const ignoreMessageRender = () => false;
const reconnectInterval = (attempt: number) =>
  Math.min(1000 * 2 ** Math.min(attempt, 4), 10000);

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
  // Keep the last validated snapshot while reconnecting so forms can preserve
  // their drafts. Only readiness for this socket may authorize new commands.
  const [state, setState] = useState<State | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activity, setActivity] = useState<FanControlActivity | null>(null);
  const [isActivityStale, setIsActivityStale] = useState(false);
  const activityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [requests] = useState(() => new BackendRequests());
  const activeSocketRef = useRef<WebSocket | null>(null);
  const connectedRef = useRef(false);
  const activityExpectedRef = useRef(false);
  const mountedRef = useRef(true);

  const clearInitialStateTimeout = useCallback(() => {
    if (initialStateTimeoutRef.current !== null)
      clearTimeout(initialStateTimeoutRef.current);
    initialStateTimeoutRef.current = null;
  }, []);

  const clearActivityTimeout = useCallback(() => {
    if (activityTimeoutRef.current !== null)
      clearTimeout(activityTimeoutRef.current);
    activityTimeoutRef.current = null;
  }, []);

  const startActivityTimeout = useCallback(() => {
    clearActivityTimeout();
    activityTimeoutRef.current = setTimeout(() => {
      activityTimeoutRef.current = null;
      setIsActivityStale(true);
    }, 10000);
  }, [clearActivityTimeout]);

  const resetConnection = useCallback(() => {
    activeSocketRef.current = null;
    connectedRef.current = false;
    activityExpectedRef.current = false;
    setIsConnected(false);
    setActivity(null);
    setIsActivityStale(false);
    clearInitialStateTimeout();
    clearActivityTimeout();
    requests.disconnect();
  }, [clearActivityTimeout, clearInitialStateTimeout, requests]);

  const onOpen = useCallback(
    (event: Event) => {
      const socket = event.target;
      if (
        !mountedRef.current ||
        !(socket instanceof WebSocket) ||
        socket.readyState !== WebSocket.OPEN
      )
        return;
      // A transport opening is not enough: only this connection's validated
      // snapshot may enable commands. Retire any previous pending requests.
      resetConnection();
      activeSocketRef.current = socket;
      setConnectionError(null);
      // An open transport can still fail to supply its initial settings.
      // Retire it before closing so late messages cannot authorize writes.
      initialStateTimeoutRef.current = setTimeout(() => {
        if (activeSocketRef.current !== socket) return;
        resetConnection();
        socket.close(1000, "ALFC initial state timed out");
      }, 10000);
      // Subscribe once per actual socket rather than after a render effect.
      sendBackendMessage(socket, {
        kind: MessageToServerKind.RegisterActivitySocket,
      });
    },
    [resetConnection],
  );

  const onDisconnect = useCallback(
    (event: Event) => {
      // The library can still call options callbacks for a socket it closed
      // during cleanup. Such events must not clear a replacement connection.
      if (event.target === activeSocketRef.current) resetConnection();
    },
    [resetConnection],
  );

  const onMessage = useCallback(
    (event: MessageEvent) => {
      const socket = activeSocketRef.current;
      if (!socket || event.target !== socket) return;
      const message = parseBackendMessage(event.data);
      if (!message) return;
      if (message.kind === MessageToClientKind.State) {
        if (isState(message.data)) {
          clearInitialStateTimeout();
          // Monitoring is intentionally off when fan control is unavailable.
          // Its return starts a new grace period; unrelated snapshots do not
          // extend an existing collector deadline.
          const activityExpected = message.data.isFanControlAvailable !== false;
          if (!activityExpected) {
            clearActivityTimeout();
            setActivity(null);
            setIsActivityStale(false);
          } else if (!activityExpectedRef.current) {
            setIsActivityStale(false);
            startActivityTimeout();
          }
          activityExpectedRef.current = activityExpected;
          connectedRef.current = true;
          setIsConnected(true);
          setState(message.data);
          setConnectionError(null);
        } else {
          connectedRef.current = false;
          setIsConnected(false);
          setActivity(null);
          // Keep this socket's existing expectation deadline. An invalid then
          // valid settings broadcast must not grant a silent collector more
          // time; disconnected status masks the warning until validation.
          requests.disconnect(
            "The server sent an invalid state. Check the server before applying more changes; pending requests could not be confirmed.",
          );
          setConnectionError(
            "The server sent an incompatible or invalid state. This web UI requires ALFC protocol 1.1 or a compatible later 1.x version.",
          );
        }
      } else if (
        connectedRef.current &&
        activityExpectedRef.current &&
        message.kind === MessageToClientKind.FanControlActivity &&
        isFanControlActivity(message.data)
      ) {
        setActivity(message.data);
        setIsActivityStale(false);
        // A live socket does not establish that collection or hardware writes
        // are still progressing. Match the Plasma widget's freshness window.
        startActivityTimeout();
      } else if (connectedRef.current) {
        requests.receive(message);
      }
    },
    [
      clearActivityTimeout,
      clearInitialStateTimeout,
      requests,
      startActivityTimeout,
    ],
  );

  const shouldReconnect = useCallback(
    (event: CloseEvent) =>
      mountedRef.current &&
      (!activeSocketRef.current ||
        event.target === activeSocketRef.current ||
        activeSocketRef.current.readyState !== WebSocket.OPEN),
    [],
  );
  useReactWebSocket(resolveWebSocketUrl(), {
    // Bun handles protocol-level PING/PONG. Avoid application heartbeat timers
    // that can disconnect a healthy socket when a browser suspends its tab.
    // Event callbacks own parsing and state updates; avoid an extra parsed
    // lastMessage snapshot and render for every acknowledgement.
    disableJson: true,
    filter: ignoreMessageRender,
    // Native WebSockets emit close after error. Retrying both schedules two
    // reconnect timers in react-use-websocket 4.13; close owns reconnection.
    retryOnError: false,
    reconnectAttempts: Number.MAX_SAFE_INTEGER,
    reconnectInterval,
    shouldReconnect,
    onOpen,
    onClose: onDisconnect,
    onError: onDisconnect,
    onMessage,
  });

  useEffect(() => {
    mountedRef.current = true;
    const currentRequests = requests;
    return () => {
      mountedRef.current = false;
      activeSocketRef.current = null;
      connectedRef.current = false;
      activityExpectedRef.current = false;
      clearInitialStateTimeout();
      clearActivityTimeout();
      currentRequests.disconnect();
    };
  }, [clearActivityTimeout, clearInitialStateTimeout, requests]);

  const sendRequest = useCallback(
    async (message: Command, notify = true) => {
      try {
        const socket = activeSocketRef.current;
        if (!connectedRef.current || !socket)
          throw new Error(
            "The server is disconnected. Reconnect before applying changes.",
          );
        const response = await requests.send(message, (payload) => {
          // Send on the validated connection itself; never queue or replay a
          // hardware write on whichever socket happens to open next.
          sendBackendMessage(socket, payload);
        });
        if (notify) successToast("Change accepted.");
        return response;
      } catch (error) {
        errorToast(
          error instanceof Error ? error.message : "The request failed.",
        );
        throw error;
      }
    },
    [requests],
  );

  const connection = useMemo<BackendConnection>(
    () => ({
      state,
      activity,
      isActivityStale,
      connectionError,
      isConnected,
      sendRequest,
    }),
    [
      state,
      activity,
      isActivityStale,
      connectionError,
      isConnected,
      sendRequest,
    ],
  );

  return <BackendContext value={connection}>{children}</BackendContext>;
}
