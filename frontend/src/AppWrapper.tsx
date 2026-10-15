import App from "./App";
import { useWebSocket } from "./utils/useWebSocket";
import { ErrorBoundary } from "react-error-boundary";
import { ToastContainer } from "react-toastify/unstyled";
import "react-toastify/dist/ReactToastify.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFan } from "@fortawesome/free-solid-svg-icons";

export function AppWrapper() {
  const { isConnected, connectionError, state } = useWebSocket();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <FontAwesomeIcon icon={faFan} />
          </span>
          <div>
            <strong>ALFC</strong>
            <small>Aorus laptop fan control</small>
          </div>
        </div>
        <span className="connection-badge" data-connected={isConnected}>
          <span className="connection-dot" aria-hidden="true" />
          {isConnected
            ? "Connected"
            : connectionError
              ? "Invalid response"
              : state
                ? "Reconnecting"
                : "Connecting"}
        </span>
      </header>
      <main className="app-main">
        <ErrorBoundary
          fallbackRender={() => (
            <div className="empty-state" role="alert">
              <h1>The interface could not be displayed</h1>
              <p>
                Reload this page. If the problem continues, report the ALFC
                version and the action that caused it.
              </p>
            </div>
          )}
        >
          {state !== null ? (
            <>
              {!isConnected && (
                <div
                  className="notice"
                  role={connectionError ? "alert" : "status"}
                >
                  <strong>
                    {connectionError
                      ? "The server response could not be validated."
                      : "Connection lost. Reconnecting…"}
                  </strong>
                  <p>
                    {connectionError ??
                      "Your edits are preserved. Last confirmed settings are shown; changes are disabled until a fresh connection is confirmed."}
                  </p>
                </div>
              )}
              <App />
            </>
          ) : (
            <section
              className="empty-state"
              role={connectionError ? "alert" : "status"}
            >
              <h1>
                {connectionError
                  ? "Unable to read server settings"
                  : "Connecting to ALFC"}
              </h1>
              <p>{connectionError ?? "Waiting for server connection..."}</p>
              <p>
                Start the ALFC service on this computer, then keep this page
                open. It will reconnect automatically.
              </p>
            </section>
          )}
        </ErrorBoundary>
      </main>
      <ToastContainer theme="dark" position="bottom-right" />
    </div>
  );
}
