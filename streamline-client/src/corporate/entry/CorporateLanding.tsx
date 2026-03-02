import { Link } from "react-router-dom";
import '../corporate.css';

export default function CorporateLanding() {
  return (
    <div id="landing-page" className="page active">
      <nav id="main-nav">
        <img src="/corp_logo.png" alt="StreamLine Logo" className="nav-logo" />
        <div className="nav-links">
          <a href="#features" className="nav-link">Features</a>
          <a href="#pricing" className="nav-link">Pricing</a>
          <a href="#integrations" className="nav-link">Integrations</a>
        </div>
        <div className="nav-spacer"></div>
        <div className="nav-btns">
          <Link to="/streamline/corporate/login" className="btn btn-outline">Log In</Link>
          <Link to="/streamline/corporate/login" className="btn btn-primary">Get Started</Link>
        </div>
      </nav>

      <main>
        <section className="hero">
          <div className="hero-grid"></div>
          <div className="hero-orb1"></div>
          <div className="hero-orb2"></div>
          <div className="hero-orb3"></div>

          <div className="hero-content">
            <div className="hero-badge">
              <span className="badge-dot"></span>
              ENTERPRISE GRADE
            </div>
            <h1 className="hero-headline">
              Secure, reliable infrastructure for <em>enterprise communication</em>.
            </h1>
            <p className="hero-sub">
              StreamLine provides a unified platform for internal broadcasts, secure meetings, and compliance-ready media management.
            </p>
            <div className="hero-ctas">
              <a href="mailto:nxtlvl@gmail.com?subject=StreamLine%20Corporate%20Demo%20Request&body=Hi%20StreamLine%20team%2C%0A%0AI'd%20like%20to%20request%20a%20demo%20of%20StreamLine%20Corporate.%0A%0AOrganization%3A%0AName%3A%0ARole%3A%0A" className="btn btn-primary btn-xl">Request a Demo</a>
              <a href="#features" className="btn btn-outline btn-xl">Explore Features</a>
            </div>
            <div className="hero-trust">
              <span>TRUSTED BY LEADING ORGANIZATIONS</span>
            </div>
          </div>
        </section>

        <div className="hero-mockup">
          <div className="mockup-chrome">
            <div className="mockup-bar">
              <div className="mb-dot mb-red"></div>
              <div className="mb-dot mb-yellow"></div>
              <div className="mb-dot mb-green"></div>
              <div className="mb-url">https://console.streamline.app/dashboard</div>
            </div>
            <div className="mockup-inner">
              <div className="faux-dash">
                <div className="fd-topbar">
                  <img src="/corp_logo_sm.png" alt="logo" className="fd-logo" />
                  <div className="fd-search">Search...</div>
                  <div className="fd-spacer"></div>
                  <div className="fd-dot"></div>
                </div>
                <div className="fd-sidebar">
                  <div className="fds-item act"><span className="fds-dot"></span> Dashboard</div>
                  <div className="fds-item"><span className="fds-dot"></span> Broadcasts</div>
                  <div className="fds-item"><span className="fds-dot"></span> Meetings</div>
                  <div className="fds-item"><span className="fds-dot"></span> Media Library</div>
                  <div className="fds-item"><span className="fds-dot"></span> Compliance</div>
                  <div className="fds-item"><span className="fds-dot"></span> Analytics</div>
                  <div className="fds-item"><span className="fds-dot"></span> Settings</div>
                </div>
                <div className="fd-main">
                  <div className="fd-banner">
                    <div className="fd-live-pill">LIVE</div>
                    <div className="fd-banner-text">
                      <strong>All-Hands Q1 2026</strong> is now live. <span>(Internal)</span>
                    </div>
                  </div>
                  <div className="fd-stats">
                    <div className="fd-stat">
                      <div className="fd-stat-label">Active Viewers</div>
                      <div className="fd-stat-val">14,822</div>
                    </div>
                    <div className="fd-stat">
                      <div className="fd-stat-label">Total Meetings</div>
                      <div className="fd-stat-val">1,204</div>
                    </div>
                    <div className="fd-stat">
                      <div className="fd-stat-label">New Media</div>
                      <div className="fd-stat-val">215</div>
                    </div>
                    <div className="fd-stat">
                      <div className="fd-stat-label">Compliance</div>
                      <div className="fd-stat-val">99.8%</div>
                    </div>
                  </div>
                  <div className="fd-grid2">
                    <div className="fd-panel">
                      <div className="fd-panel-title">Upcoming Events</div>
                      <div className="fd-row"><span>Town Hall - Engineering</span> <div className="fd-tag req">REQ</div></div>
                      <div className="fd-row"><span>Marketing Sync</span> <div className="fd-tag live">LIVE</div></div>
                      <div className="fd-row"><span>Security Training</span> <div className="fd-tag opt">OPT</div></div>
                    </div>
                    <div className="fd-panel">
                      <div className="fd-panel-title">Compliance Tasks</div>
                      <div className="fd-comp-item">
                        <div className="fd-comp-hd"><span>Q4 Review</span><span>85%</span></div>
                        <div className="fd-comp-bar"><div className="fd-comp-fill" style={{ width: '85%', background: '#f5c842' }}></div></div>
                      </div>
                      <div className="fd-comp-item">
                        <div className="fd-comp-hd"><span>HR Module</span><span>100%</span></div>
                        <div className="fd-comp-bar"><div className="fd-comp-fill" style={{ width: '100%', background: '#3de8a0' }}></div></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section id="features" className="section">
          <div className="section-inner">
            <div className="section-tag">Key Features</div>
            <h2 className="section-title">A <em>unified platform</em> for modern enterprise.</h2>
            <p className="section-sub">
              Consolidate your internal communication tools into a single, secure, and scalable solution.
            </p>
            <div className="feature-grid">
              <div className="feature-card">
                <div className="fc-icon"> {/* SVG icon */} </div>
                <h3 className="fc-title">Internal Broadcasts</h3>
                <p className="fc-desc">Stream all-hands meetings, town halls, and critical announcements with ultra-low latency and robust security.</p>
              </div>
              <div className="feature-card">
                <div className="fc-icon"> {/* SVG icon */} </div>
                <h3 className="fc-title">Secure Meetings</h3>
                <p className="fc-desc">End-to-end encrypted video conferencing with granular access controls and detailed audit logs.</p>
              </div>
              <div className="feature-card">
                <div className="fc-icon"> {/* SVG icon */} </div>
                <h3 className="fc-title">Compliance & Archiving</h3>
                <p className="fc-desc">Automated recording, transcription, and archiving for legal holds and regulatory requirements.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
