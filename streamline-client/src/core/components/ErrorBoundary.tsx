import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error?: unknown;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: undefined };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] rendering error", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const message = String((this.state.error as any)?.message ?? this.state.error ?? "Unknown error");
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000000",
            color: "#ffffff",
            padding: "1.5rem",
            textAlign: "center",
          }}
        >
          <div>
            <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>Something went wrong.</h1>
            <p style={{ fontSize: "0.9rem", opacity: 0.8, marginBottom: "0.75rem" }}>
              The live room UI hit an unexpected error. Try refreshing the page. If this keeps happening, contact
              support with a screenshot of the browser console.
            </p>
            <button
              type="button"
              onClick={() => {
                try {
                  window.location.href = "/join";
                } catch {
                  // ignore
                }
              }}
              style={{
                marginBottom: "0.9rem",
                padding: "0.6rem 1.2rem",
                borderRadius: "0.5rem",
                border: "none",
                background: "linear-gradient(135deg,#dc2626,#ef4444)",
                color: "#ffffff",
                fontWeight: 600,
                fontSize: "0.9rem",
                cursor: "pointer",
              }}
            >
              ⬅ Back to Join Room
            </button>
            <pre
              style={{
                marginTop: "0.75rem",
                fontSize: "0.8rem",
                background: "rgba(15,23,42,0.9)",
                padding: "0.75rem 1rem",
                borderRadius: "0.5rem",
                textAlign: "left",
                maxWidth: "640px",
                whiteSpace: "pre-wrap",
              }}
            >
              {message}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
