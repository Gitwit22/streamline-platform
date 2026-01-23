import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Support Page - Nxt Lvl Technology Solutions LLC
 * StreamLine Application
 */
export default function Support() {
  const nav = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText("nxtlvltechllc@gmail.com");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          <button onClick={() => nav("/settings/billing")} style={styles.quickLink}>
            Manage Billing
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
