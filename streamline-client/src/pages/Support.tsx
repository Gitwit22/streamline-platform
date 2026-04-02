import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, apiFetchAuth, ApiUnauthorizedError } from "../lib/api";

/**
 * Support Page - Nxt Lvl Technology Solutions LLC
 * StreamLine Application
 */
export default function Support() {
  const nav = useNavigate();
  const [copied, setCopied] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketEmail, setTicketEmail] = useState("");
  const [ticketCategory, setTicketCategory] = useState("general");
  const [ticketPriority, setTicketPriority] = useState("normal");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketSuccessId, setTicketSuccessId] = useState<string | null>(null);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText("nxtlvltechllc@gmail.com");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTicketSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTicketSubmitting(true);
    setTicketError(null);
    setTicketSuccessId(null);

    const payload = {
      subject: ticketSubject.trim(),
      email: ticketEmail.trim(),
      category: ticketCategory,
      priority: ticketPriority,
      message: ticketMessage.trim(),
      pageUrl: typeof window !== "undefined" ? window.location.href : "",
      context: {
        route: "/support",
        origin: "support_page",
      },
    };

    try {
      let response: Response;
      try {
        response = await apiFetchAuth(
          "/api/support/tickets/submit",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          { allowNonOk: true, suppressAuthSideEffects: true },
        );
      } catch (err) {
        if (!(err instanceof ApiUnauthorizedError)) {
          throw err;
        }
        response = await apiFetch(
          "/api/support/tickets/submit",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          { allowNonOk: true },
        );
      }

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = String(body?.error || "submit_failed");
        throw new Error(message);
      }

      setTicketSuccessId(String(body?.ticketId || ""));
      setTicketSubject("");
      setTicketEmail("");
      setTicketCategory("general");
      setTicketPriority("normal");
      setTicketMessage("");
    } catch (err: any) {
      const code = String(err?.message || "submit_failed");
      if (code === "email_required_for_anonymous") {
        setTicketError("Email is required when submitting without login.");
      } else if (code === "rate_limited") {
        setTicketError("Please wait a moment before submitting another ticket.");
      } else if (code === "subject_required") {
        setTicketError("Please add a short subject.");
      } else if (code === "message_required") {
        setTicketError("Please provide a detailed message.");
      } else {
        setTicketError("Could not submit your ticket right now. Please try again.");
      }
    } finally {
      setTicketSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Animated Background */}
      <div style={styles.orb1} />
      <div style={styles.orb2} />

      <div style={styles.content}>
        {/* Back Button */}
        <button onClick={() => nav(-1)} style={styles.backButton}>
          ← Back
        </button>

        {/* Header */}
        <div style={styles.header}>
          <h1 style={styles.title}>Support</h1>
          <p style={styles.subtitle}>Nxt Lvl Technology Solutions LLC</p>
          <p style={styles.tagline}>Need help? We've got you.</p>
        </div>

        {/* Contact Card */}
        <div style={styles.card}>
          <div style={styles.contactSection}>
            <h2 style={styles.sectionTitle}>📧 Contact Support</h2>
            <div style={styles.emailBox}>
              <span style={styles.emailText}>nxtlvltechllc@gmail.com</span>
              <button onClick={handleCopyEmail} style={styles.copyButton}>
                {copied ? "✓ Copied!" : "📋 Copy"}
              </button>
            </div>
            <a
              href="mailto:nxtlvltechllc@gmail.com"
              style={styles.emailLink}
            >
              Open Email Client →
            </a>
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>🎫 Submit A Support Ticket</h2>
          <p style={styles.text}>Send your issue directly from StreamLine. The support team will process it in Support Hub.</p>
          <form onSubmit={handleTicketSubmit} style={styles.formGrid}>
            <label style={styles.formLabel}>
              Subject
              <input
                type="text"
                value={ticketSubject}
                onChange={(e) => setTicketSubject(e.target.value)}
                placeholder="Brief summary of your issue"
                maxLength={180}
                required
                style={styles.formInput}
              />
            </label>

            <label style={styles.formLabel}>
              Email (required for guest submissions)
              <input
                type="email"
                value={ticketEmail}
                onChange={(e) => setTicketEmail(e.target.value)}
                placeholder="you@example.com"
                style={styles.formInput}
              />
            </label>

            <div style={styles.formRow}>
              <label style={styles.formLabel}>
                Category
                <select value={ticketCategory} onChange={(e) => setTicketCategory(e.target.value)} style={styles.formInput}>
                  <option value="general">General</option>
                  <option value="billing">Billing</option>
                  <option value="streaming">Streaming</option>
                  <option value="technical">Technical</option>
                  <option value="account">Account</option>
                  <option value="feature_request">Feature request</option>
                </select>
              </label>
              <label style={styles.formLabel}>
                Priority
                <select value={ticketPriority} onChange={(e) => setTicketPriority(e.target.value)} style={styles.formInput}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>

            <label style={styles.formLabel}>
              Message
              <textarea
                value={ticketMessage}
                onChange={(e) => setTicketMessage(e.target.value)}
                placeholder="Describe what happened, what you expected, and steps to reproduce"
                minLength={10}
                maxLength={5000}
                required
                style={styles.formTextarea}
              />
            </label>

            {ticketError && <div style={styles.formError}>{ticketError}</div>}
            {ticketSuccessId && (
              <div style={styles.formSuccess}>Ticket submitted successfully. Ticket ID: {ticketSuccessId}</div>
            )}

            <button type="submit" disabled={ticketSubmitting} style={styles.submitButton}>
              {ticketSubmitting ? "Submitting..." : "Submit Ticket"}
            </button>
          </form>
        </div>

        {/* What to Include Card */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>📝 Please Include</h2>
          <p style={styles.text}>
            To help us resolve your issue quickly, please include:
          </p>
          <ul style={styles.list}>
            <li style={styles.listItem}>
              <span style={styles.bullet}>•</span>
              Your account email
            </li>
            <li style={styles.listItem}>
              <span style={styles.bullet}>•</span>
              A brief description of the issue
            </li>
            <li style={styles.listItem}>
              <span style={styles.bullet}>•</span>
              Screenshots or error messages (if applicable)
            </li>
          </ul>
        </div>

        {/* Common Topics Card */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>💡 Common Topics</h2>
          <div style={styles.topicsGrid}>
            <div style={styles.topicItem}>
              <span style={styles.topicIcon}>💳</span>
              <span style={styles.topicText}>Billing & subscriptions</span>
            </div>
            <div style={styles.topicItem}>
              <span style={styles.topicIcon}>📈</span>
              <span style={styles.topicText}>Plan upgrades or downgrades</span>
            </div>
            <div style={styles.topicItem}>
              <span style={styles.topicIcon}>🎥</span>
              <span style={styles.topicText}>Streaming issues</span>
            </div>
            <div style={styles.topicItem}>
              <span style={styles.topicIcon}>🔐</span>
              <span style={styles.topicText}>Account access</span>
            </div>
            <div style={styles.topicItem}>
              <span style={styles.topicIcon}>🔧</span>
              <span style={styles.topicText}>Technical problems</span>
            </div>
            <div style={styles.topicItem}>
              <span style={styles.topicIcon}>💬</span>
              <span style={styles.topicText}>Feature requests</span>
            </div>
          </div>
        </div>

        {/* Response Time Card */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>⏱️ Response Time</h2>
          <p style={styles.text}>
            We typically respond within <strong>1–2 business days</strong>.
          </p>
          <p style={styles.textSmall}>
            For urgent billing issues, please include "URGENT" in your subject line.
          </p>
        </div>

        {/* Quick Links */}
        <div style={styles.quickLinks}>
          <button onClick={() => nav("/privacy")} style={styles.quickLink}>
            Privacy Policy
          </button>
          <button
            onClick={() => window.open("/terms", "_blank", "noopener,noreferrer")}
            style={styles.quickLink}
          >
            Terms of Service
          </button>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <p style={styles.footerText}>
            © {new Date().getFullYear()} Nxt Lvl Technology Solutions LLC. All rights reserved.
          </p>
        </div>
      </div>

      <style>{CSS}</style>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#000000",
    color: "#ffffff",
    position: "relative",
    overflow: "hidden",
  },
  orb1: {
    position: "fixed",
    top: "10%",
    left: "5%",
    width: "500px",
    height: "500px",
    background: "rgba(220, 38, 38, 0.08)",
    borderRadius: "50%",
    filter: "blur(120px)",
    pointerEvents: "none",
  },
  orb2: {
    position: "fixed",
    bottom: "10%",
    right: "5%",
    width: "600px",
    height: "600px",
    background: "rgba(239, 68, 68, 0.06)",
    borderRadius: "50%",
    filter: "blur(140px)",
    pointerEvents: "none",
  },
  content: {
    position: "relative",
    zIndex: 10,
    maxWidth: "800px",
    margin: "0 auto",
    padding: "40px 24px",
  },
  backButton: {
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "#ffffff",
    padding: "10px 20px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    marginBottom: "24px",
    transition: "all 0.3s ease",
  },
  header: {
    marginBottom: "32px",
    textAlign: "center",
  },
  title: {
    fontSize: "36px",
    fontWeight: 700,
    marginBottom: "8px",
    background: "linear-gradient(to right, #ffffff, #fecaca)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  subtitle: {
    fontSize: "16px",
    color: "#9ca3af",
    marginBottom: "8px",
  },
  tagline: {
    fontSize: "20px",
    color: "#22c55e",
    fontWeight: 600,
  },
  card: {
    background: "rgba(15, 15, 15, 0.7)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "20px",
    padding: "32px",
    marginBottom: "20px",
  },
  contactSection: {
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: "20px",
    fontWeight: 600,
    color: "#ef4444",
    marginBottom: "20px",
  },
  emailBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "12px",
    padding: "16px 24px",
    marginBottom: "16px",
    flexWrap: "wrap",
  },
  emailText: {
    fontSize: "18px",
    fontWeight: 600,
    color: "#ffffff",
  },
  copyButton: {
    background: "rgba(220, 38, 38, 0.2)",
    border: "1px solid rgba(220, 38, 38, 0.4)",
    color: "#ef4444",
    padding: "8px 16px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.3s ease",
  },
  emailLink: {
    color: "#3b82f6",
    textDecoration: "none",
    fontSize: "15px",
    fontWeight: 500,
  },
  text: {
    fontSize: "15px",
    lineHeight: 1.7,
    color: "#d1d5db",
    marginBottom: "16px",
  },
  textSmall: {
    fontSize: "14px",
    color: "#9ca3af",
  },
  formGrid: {
    display: "grid",
    gap: "12px",
  },
  formLabel: {
    display: "grid",
    gap: "8px",
    fontSize: "13px",
    color: "#cbd5e1",
  },
  formRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px",
  },
  formInput: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(255, 255, 255, 0.14)",
    background: "rgba(2, 6, 23, 0.8)",
    color: "#e5e7eb",
    fontSize: "14px",
  },
  formTextarea: {
    width: "100%",
    minHeight: "130px",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(255, 255, 255, 0.14)",
    background: "rgba(2, 6, 23, 0.8)",
    color: "#e5e7eb",
    fontSize: "14px",
    resize: "vertical",
  },
  submitButton: {
    border: "1px solid rgba(220, 38, 38, 0.42)",
    background: "rgba(220, 38, 38, 0.16)",
    color: "#fecaca",
    borderRadius: "10px",
    padding: "10px 14px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
  },
  formError: {
    border: "1px solid rgba(248, 113, 113, 0.45)",
    background: "rgba(127, 29, 29, 0.45)",
    color: "#fecaca",
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "13px",
  },
  formSuccess: {
    border: "1px solid rgba(74, 222, 128, 0.45)",
    background: "rgba(20, 83, 45, 0.45)",
    color: "#bbf7d0",
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "13px",
  },
  list: {
    margin: "0",
    padding: "0",
    listStyle: "none",
  },
  listItem: {
    fontSize: "15px",
    lineHeight: 1.8,
    color: "#d1d5db",
    marginBottom: "12px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  bullet: {
    color: "#ef4444",
    fontSize: "18px",
  },
  topicsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "12px",
  },
  topicItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "10px",
    padding: "14px 16px",
  },
  topicIcon: {
    fontSize: "20px",
  },
  topicText: {
    fontSize: "14px",
    color: "#d1d5db",
  },
  quickLinks: {
    display: "flex",
    justifyContent: "center",
    gap: "12px",
    flexWrap: "wrap",
    marginTop: "24px",
  },
  quickLink: {
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "#9ca3af",
    padding: "10px 20px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.3s ease",
  },
  footer: {
    marginTop: "40px",
    textAlign: "center",
  },
  footerText: {
    fontSize: "13px",
    color: "#6b7280",
  },
};

const CSS = `
  button:hover {
    background: rgba(255, 255, 255, 0.1) !important;
    border-color: rgba(220, 38, 38, 0.5) !important;
  }
  a:hover {
    text-decoration: underline;
  }
`;
