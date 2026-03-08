import React from "react";
import { useNavigate } from "react-router-dom";

/**
 * Terms of Service Page - Nxt Lvl Technology Solutions LLC
 * StreamLine Application
 */
export default function Terms() {
  const nav = useNavigate();

  return (
    <div style={styles.container}>
      {/* Animated Background */}
      <div style={styles.orb1} />
      <div style={styles.orb2} />

      <div style={styles.content}>
        {/* Header */}
        <div style={styles.header}>
          <h1 style={styles.title}>Terms &amp; Conditions</h1>
          <p style={styles.subtitle}>Nxt Lvl Technology Solutions LLC</p>
          <p style={styles.updated}>Last Updated: January 12, 2026</p>
        </div>

        {/* Content Card */}
        <div style={styles.card}>
          <p style={styles.intro}>
            These Terms &amp; Conditions ("Terms") govern your access to and use of StreamLine, a
            platform owned and operated by Nxt Lvl Technology Solutions LLC ("we," "us," or "our").
            By accessing or using StreamLine, you acknowledge that you have read, understood, and
            agree to be bound by these Terms. If you do not agree, you may not use the platform.
          </p>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Eligibility and Accounts</h2>
            <p style={styles.text}>
              You must be at least eighteen (18) years of age to create an account or use
              StreamLine. By registering, you represent that you meet this requirement.
            </p>
            <p style={styles.text}>
              You are responsible for maintaining the confidentiality of your account credentials
              and for all activity that occurs under your account. You agree to provide accurate,
              current, and complete information and to keep your account information updated.
            </p>
            <p style={styles.text}>
              You may not impersonate another individual or entity, misrepresent your identity, or
              use another person&apos;s account without authorization.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Acceptable Use of the Platform</h2>
            <p style={styles.text}>
              StreamLine is provided for lawful streaming, recording, broadcasting, and related
              content creation purposes. You agree to use the platform only in compliance with
              applicable laws and these Terms.
            </p>
            <p style={styles.text}>
              You may not use StreamLine in any manner that interferes with, disrupts, or degrades
              the service, the servers, or the experience of other users. Any attempt to exploit,
              manipulate, or reverse-engineer platform features is prohibited.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Prohibited Content</h2>
            <p style={styles.text}>
              You may not create, stream, upload, record, distribute, or otherwise make available
              content that is unlawful, harmful, or abusive. This includes, but is not limited to,
              content that promotes or facilitates illegal activity, violence, terrorism, or
              criminal conduct.
            </p>
            <p style={styles.text}>
              You may not engage in harassment, hate speech, threats, intimidation, or
              discriminatory conduct directed at individuals or groups. Content that exploits,
              endangers, or sexually involves minors is strictly prohibited.
            </p>
            <p style={styles.text}>
              You may not stream or distribute content that infringes on intellectual property
              rights, including copyrighted material for which you do not have proper
              authorization.
            </p>
            <p style={styles.text}>
              You may not share non-consensual recordings, private communications, or surveillance
              content without the explicit permission of all parties involved.
            </p>
            <p style={styles.text}>
              You may not use StreamLine to bypass platform safeguards, abuse usage limits, share
              access tokens, interfere with other users&apos; rooms, or automate activity in ways not
              expressly permitted.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Streaming, Recording, and HLS Broadcasts</h2>
            <p style={styles.text}>
              Only authorized users may initiate or control live streams, recordings,
              multistreaming, or HLS broadcast pages. Access to certain features, including HLS
              broadcast pages, is subject to plan availability and usage limits.
            </p>
            <p style={styles.text}>
              Broadcast time initiated by a host counts toward the host&apos;s usage limits. Viewers
              accessing HLS broadcast pages do not contribute to usage calculations.
            </p>
            <p style={styles.text}>
              You are solely responsible for ensuring that your streams and recordings comply with
              all applicable consent, recording, and privacy laws.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Roles, Permissions, and Access Control</h2>
            <p style={styles.text}>
              Room owners control participant roles and permissions within their rooms. Permissions
              are enforced server-side and cannot be overridden or escalated through client-side
              manipulation.
            </p>
            <p style={styles.text}>
              You may not attempt to gain unauthorized access, elevate privileges, or bypass
              permission checks. Any such attempts may result in suspension or termination.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Billing, Plans, and Usage Enforcement</h2>
            <p style={styles.text}>
              Certain features of StreamLine require a paid subscription. Feature availability,
              limits, and pricing are determined by your active plan.
            </p>
            <p style={styles.text}>
              Usage limits are enforced automatically. Attempts to circumvent plan restrictions,
              usage tracking, or billing systems may result in immediate suspension or termination
              without refund.
            </p>
            <p style={styles.text}>
              We reserve the right to modify plans, pricing, or feature availability, subject to
              reasonable notice.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Data, Content, and Privacy</h2>
            <p style={styles.text}>
              You retain ownership of the content you create. By using StreamLine, you grant Nxt
              Lvl Technology Solutions LLC the rights necessary to host, process, store, transmit,
              and display your content solely for the purpose of operating and improving the
              platform.
            </p>
            <p style={styles.text}>
              Your use of StreamLine is subject to our Privacy Policy, which governs how data is
              collected and processed.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Service Availability and Changes</h2>
            <p style={styles.text}>
              StreamLine is provided on an &quot;as-is&quot; and &quot;as-available&quot; basis. We do not guarantee
              uninterrupted or error-free service.
            </p>
            <p style={styles.text}>
              We may update, modify, suspend, or discontinue features or services at any time. We
              are not liable for any resulting impact on your content, usage, or access.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Suspension and Termination</h2>
            <p style={styles.text}>
              We reserve the right to suspend or terminate your account if you violate these Terms,
              misuse the platform, engage in prohibited conduct, or if required by law or safety
              concerns.
            </p>
            <p style={styles.text}>You may discontinue use of StreamLine at any time.</p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Limitation of Liability</h2>
            <p style={styles.text}>
              To the fullest extent permitted by law, Nxt Lvl Technology Solutions LLC shall not be
              liable for indirect, incidental, consequential, or punitive damages arising from your
              use of the platform.
            </p>
            <p style={styles.text}>
              We are not responsible for user-generated content or the actions of other users. You
              use StreamLine at your own risk.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Governing Law</h2>
            <p style={styles.text}>
              These Terms are governed by and construed in accordance with the laws applicable to
              Nxt Lvl Technology Solutions LLC, without regard to conflict-of-law principles.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Contact Information</h2>
            <div style={styles.contactInfo}>
              <p style={styles.text}>Nxt Lvl Technology Solutions LLC</p>
              <p style={styles.text}>
                Email: {" "}
                <a href="mailto:nxtlvltechllc@gmail.com" style={styles.link}>
                  nxtlvltechllc@gmail.com
                </a>
              </p>
              <p style={styles.text}>
                Website: {" "}
                <a href="https://nxtlvlts.com" target="_blank" rel="noopener noreferrer" style={styles.link}>
                  https://nxtlvlts.com
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
    fontWeight: 500,
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
