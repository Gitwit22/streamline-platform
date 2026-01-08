import React from "react";
import { useNavigate } from "react-router-dom";

/**
 * Privacy Policy Page - Nxt Lvl Technology Solutions LLC
 * StreamLine Application
 */
export default function Privacy() {
  const nav = useNavigate();

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
          <h1 style={styles.title}>Privacy Policy</h1>
          <p style={styles.subtitle}>Nxt Lvl Technology Solutions LLC</p>
          <p style={styles.updated}>Last updated: January 2026</p>
        </div>

        {/* Content Card */}
        <div style={styles.card}>
          <p style={styles.intro}>
            Nxt Lvl Technology Solutions LLC ("Nxt Lvl," "we," "our," or "us") respects your 
            privacy and is committed to protecting your information. This Privacy Policy explains 
            how we collect, use, and safeguard your data when you use our services, including 
            StreamLine and related platforms.
          </p>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Information We Collect</h2>
            <p style={styles.text}>We may collect:</p>
            <ul style={styles.list}>
              <li style={styles.listItem}>Account information (name, email address)</li>
              <li style={styles.listItem}>
                Billing information (handled securely by Stripe; we do not store card numbers)
              </li>
              <li style={styles.listItem}>Usage data (streaming minutes, feature usage, diagnostics)</li>
              <li style={styles.listItem}>Device and browser information</li>
              <li style={styles.listItem}>Cookies and similar technologies for authentication and analytics</li>
            </ul>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>How We Use Information</h2>
            <p style={styles.text}>We use your information to:</p>
            <ul style={styles.list}>
              <li style={styles.listItem}>Provide and operate our services</li>
              <li style={styles.listItem}>Manage accounts, billing, and subscriptions</li>
              <li style={styles.listItem}>Enforce usage limits and plan features</li>
              <li style={styles.listItem}>Improve platform performance and reliability</li>
              <li style={styles.listItem}>Communicate important service or billing updates</li>
            </ul>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Data Sharing</h2>
            <p style={styles.text}>
              <strong>We do not sell your data.</strong>
            </p>
            <p style={styles.text}>We may share limited information with:</p>
            <ul style={styles.list}>
              <li style={styles.listItem}>Payment processors (Stripe)</li>
              <li style={styles.listItem}>Infrastructure providers (cloud hosting, streaming services)</li>
              <li style={styles.listItem}>Legal authorities if required by law</li>
            </ul>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Data Security</h2>
            <p style={styles.text}>
              We implement reasonable technical and organizational safeguards to protect your data. 
              However, no system is 100% secure.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Your Rights</h2>
            <p style={styles.text}>You may:</p>
            <ul style={styles.list}>
              <li style={styles.listItem}>Request access to or deletion of your data</li>
              <li style={styles.listItem}>Cancel your subscription at any time</li>
              <li style={styles.listItem}>Contact us regarding privacy concerns</li>
            </ul>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Contact</h2>
            <div style={styles.contactInfo}>
              <p style={styles.text}>
                <strong>Nxt Lvl Technology Solutions LLC</strong>
              </p>
              <p style={styles.text}>Detroit, MI</p>
              <p style={styles.text}>
                📧{" "}
                <a href="mailto:nxtlvltechllc@gmail.com" style={styles.link}>
                  nxtlvltechllc@gmail.com
                </a>
              </p>
            </div>
          </section>
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
    marginBottom: "4px",
  },
  updated: {
    fontSize: "14px",
    color: "#6b7280",
  },
  card: {
    background: "rgba(15, 15, 15, 0.7)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "20px",
    padding: "40px",
  },
  intro: {
    fontSize: "16px",
    lineHeight: 1.7,
    color: "#d1d5db",
    marginBottom: "32px",
  },
  section: {
    marginBottom: "32px",
  },
  sectionTitle: {
    fontSize: "20px",
    fontWeight: 600,
    color: "#ef4444",
    marginBottom: "16px",
  },
  text: {
    fontSize: "15px",
    lineHeight: 1.7,
    color: "#d1d5db",
    marginBottom: "12px",
  },
  list: {
    margin: "0",
    paddingLeft: "24px",
  },
  listItem: {
    fontSize: "15px",
    lineHeight: 1.8,
    color: "#d1d5db",
    marginBottom: "8px",
  },
  contactInfo: {
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "12px",
    padding: "20px",
  },
  link: {
    color: "#ef4444",
    textDecoration: "none",
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
