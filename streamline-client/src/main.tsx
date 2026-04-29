import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { setLogLevel, LogLevel } from "livekit-client";
import App from "./App";
import "@livekit/components-styles";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./lib/toast";
import { RecordingToastListener } from "./components/RecordingToastListener";

// Reduce LiveKit SDK console noise and avoid logging room/participant identifiers.
// In production, only warnings+errors are logged; in development, keep info-level.
setLogLevel(import.meta.env.PROD ? LogLevel.warn : LogLevel.info);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <App />
          <RecordingToastListener />
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
