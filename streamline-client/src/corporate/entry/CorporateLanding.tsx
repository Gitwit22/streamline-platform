import { Link } from "react-router-dom";
import '../corporate.css';

export default function CorporateLanding() {
  return (
    <div id="landing-page" className="page active">
      <nav id="main-nav">
        <img src="/logo.png" alt="StreamLine Logo" className="nav-logo" />
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
              <Link to="/streamline/corporate/login" className="btn btn-primary btn-xl">Get Started</Link>
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
                  <img src="/logosmall.png" alt="StreamLine logo" className="fd-logo" />
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

        {/* How It Works */}
        <section className="section">
          <div className="section-inner">
            <div className="section-tag">How It Works</div>
            <h2 className="section-title">From login to <em>live broadcast</em> in three steps.</h2>
            <p className="section-sub">
              No complex setup. No hardware purchases. Just open a browser and go.
            </p>
            <div className="feature-grid">
              <div className="feature-card" style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', top: '-12px', left: '20px', background: 'var(--blue)', color: '#04090f', borderRadius: '20px', padding: '2px 12px', fontSize: '12px', fontWeight: 700 }}>01</span>
                <h3 className="fc-title">Create a Room</h3>
                <p className="fc-desc">An admin opens a broadcast room, sets the title, and invites presenters. Rooms are provisioned in seconds with scoped permissions.</p>
              </div>
              <div className="feature-card" style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', top: '-12px', left: '20px', background: 'var(--blue)', color: '#04090f', borderRadius: '20px', padding: '2px 12px', fontSize: '12px', fontWeight: 700 }}>02</span>
                <h3 className="fc-title">Go Live</h3>
                <p className="fc-desc">Presenters join the greenroom from any browser—no downloads. Add cameras, screen-shares, and overlays, then push the stream live.</p>
              </div>
              <div className="feature-card" style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', top: '-12px', left: '20px', background: 'var(--blue)', color: '#04090f', borderRadius: '20px', padding: '2px 12px', fontSize: '12px', fontWeight: 700 }}>03</span>
                <h3 className="fc-title">Watch &amp; Archive</h3>
                <p className="fc-desc">Employees watch via an internal link or embedded player. The recording is auto-archived and available for on-demand playback instantly.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Role-Based Access */}
        <section className="section">
          <div className="section-inner">
            <div className="section-tag">Access Control</div>
            <h2 className="section-title">Granular, <em>role-based</em> permissions.</h2>
            <p className="section-sub">
              Every participant receives exactly the access they need—nothing more.
            </p>
            <div className="feature-grid">
              <div className="feature-card">
                <h3 className="fc-title">Org Admin</h3>
                <p className="fc-desc">Full control over rooms, users, billing, and compliance settings. Manage your entire organization from one dashboard.</p>
              </div>
              <div className="feature-card">
                <h3 className="fc-title">Host / Presenter</h3>
                <p className="fc-desc">Start broadcasts, invite co-hosts, manage cameras and screen-shares, and control who speaks during a live session.</p>
              </div>
              <div className="feature-card">
                <h3 className="fc-title">Viewer</h3>
                <p className="fc-desc">Watch the live HLS stream via a secure link—no account required. Works on every device and network.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Security & Compliance */}
        <section className="section">
          <div className="section-inner">
            <div className="section-tag">Security</div>
            <h2 className="section-title">Enterprise-grade <em>security</em> at every layer.</h2>
            <p className="section-sub">
              Built for organizations that can't afford to compromise on data protection or regulatory compliance.
            </p>
            <div className="feature-grid">
              <div className="feature-card">
                <h3 className="fc-title">Token-Gated Rooms</h3>
                <p className="fc-desc">Every participant authenticates with a scoped, time-limited JWT. Unauthorized access is impossible.</p>
              </div>
              <div className="feature-card">
                <h3 className="fc-title">Audit Logging</h3>
                <p className="fc-desc">Timestamped records of every room creation, join, publish, and recording event for full traceability.</p>
              </div>
              <div className="feature-card">
                <h3 className="fc-title">Cloud Storage &amp; Retention</h3>
                <p className="fc-desc">Recordings stored in compliant cloud infrastructure with configurable retention policies and access controls.</p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="section" style={{ textAlign: 'center', paddingBottom: '80px' }}>
          <div className="section-inner">
            <h2 className="section-title">Ready to modernize your <em>internal&nbsp;communications</em>?</h2>
            <p className="section-sub" style={{ margin: '0 auto 32px' }}>
              Join organizations that trust StreamLine for secure, reliable enterprise broadcasting.
            </p>
            <div className="hero-ctas" style={{ justifyContent: 'center' }}>
              <Link to="/streamline/corporate/login" className="btn btn-primary btn-xl">Get Started</Link>
              <a href="#features" className="btn btn-outline btn-xl">Explore Features</a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
