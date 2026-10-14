import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@csstools/normalize.css";
import "./index.css";
import { AppWrapper } from "./AppWrapper";
import { WebSocketProvider } from "./utils/useWebSocket";

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <WebSocketProvider>
      <AppWrapper />
    </WebSocketProvider>
  </StrictMode>,
);
