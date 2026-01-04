import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { API_BASE } from "../lib/apiBase";

/**
 * STREAMLINE WELCOME PAGE - REDESIGNED
 * 
 * CRITICAL STYLING RULES - DO NOT MODIFY:
 * - Background: Pure black (#000000)
 * - Theme: Glassmorphism with red accents
 * - Layout: Centered vertically and horizontally
 * - Logo: Must use /logosmall.png image
 * - All cards must have backdrop-blur-md
 * - Animated background gradients are required
 */

const Welcome = () => {
  const nav = useNavigate();

  const [stats, setStats] = useState({ streamers: null, hoursStreamed: null, streamersActive: null });
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/stats/public`, { credentials: "include" });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!cancelled) {
          setStats({
            streamers: data?.streamers ?? null,
            hoursStreamed: data?.hoursStreamed ?? null,
            streamersActive: data?.streamersActive ?? null,
          });
        }
      } catch (e) {
        if (!cancelled) setStatsError(e?.message || "Failed to load stats");
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fmtK = (n) => {
    if (n == null) return null;
    if (n >= 1_000_000) return `${Math.floor(n / 1_000_000)}M+`;
    if (n >= 1_000) return `${Math.floor(n / 1_000)}K+`;
    return String(n);
  };

  return (
    <div 
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000000',
        color: '#ffffff',
        padding: '24px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      
      {/* ANIMATED BACKGROUND - DO NOT REMOVE */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <div 
          style={{
            position: 'absolute',
            top: '20%',
            left: '10%',
            width: '500px',
            height: '500px',
            background: 'rgba(220, 38, 38, 0.15)',
            borderRadius: '50%',
            filter: 'blur(120px)',
            animation: 'pulse 4s ease-in-out infinite'
          }}
        />
        <div 
          style={{
            position: 'absolute',
            bottom: '20%',
            right: '10%',
            width: '600px',
            height: '600px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '50%',
            filter: 'blur(150px)',
            animation: 'pulse 4s ease-in-out infinite',
            animationDelay: '2s'
          }}
        />
      </div>

      {/* MAIN CONTENT - MUST BE CENTERED */}
      <div style={{ position: 'relative', zIndex: 10, maxWidth: '800px', margin: '0 auto' }}>
        
        {/* LOGO - USE ACTUAL IMAGE */}
        <div style={{ marginBottom: '48px', display: 'flex', justifyContent: 'center' }}>
          <img
            src="/logosmall.png"
            alt="StreamLine Logo"
            style={{
              width: '120px',
              height: '120px',
              filter: 'drop-shadow(0 0 25px rgba(220, 38, 38, 0.5))'
            }}
          />
        </div>

        {/* HERO TEXT */}
        <div style={{ marginBottom: '48px' }}>
          <h1 
            style={{
              fontSize: 'clamp(48px, 8vw, 84px)',
              fontWeight: 700,
              marginBottom: '24px',
              background: 'linear-gradient(to right, #ffffff, #fecaca, #ffffff)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              lineHeight: 1.1
            }}
          >
            Welcome to<br />StreamLine
          </h1>
          <p 
            style={{
              fontSize: 'clamp(18px, 3vw, 28px)',
              color: '#9ca3af',
              fontWeight: 300,
              letterSpacing: '0.05em'
            }}
          >
            Stream Anywhere, Anytime
          </p>
        </div>

        {/* FEATURE CARDS - MUST BE 3 COLUMNS ON DESKTOP */}
        <div 
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '48px',
            padding: '0 16px'
          }}
        >
          {/* Card 1 */}
          <div 
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              backdropFilter: 'blur(15px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '16px',
              padding: '24px',
              transition: 'all 0.3s ease',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.3)';
              e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎥</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', marginBottom: '4px' }}>
              Multi-Platform
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              Stream to all platforms at once
            </div>
          </div>

          {/* Card 2 */}
          <div 
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              backdropFilter: 'blur(15px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '16px',
              padding: '24px',
              transition: 'all 0.3s ease',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.3)';
              e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚡</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', marginBottom: '4px' }}>
              Ultra Low Latency
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              Real-time interaction
            </div>
          </div>

          {/* Card 3 */}
          <div 
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              backdropFilter: 'blur(15px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '16px',
              padding: '24px',
              transition: 'all 0.3s ease',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.3)';
              e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>✂️</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', marginBottom: '4px' }}>
              Built-in Editor
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              Edit and share instantly
            </div>
          </div>
        </div>

        {/* CALL TO ACTION BUTTONS */}
        <div 
          style={{
            display: 'flex',
            flexDirection: window.innerWidth < 640 ? 'column' : 'row',
            gap: '16px',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: '32px'
          }}
        >
          <button
            onClick={() => nav("/login")}
            style={{
              width: window.innerWidth < 640 ? '100%' : 'auto',
              background: 'linear-gradient(to right, #dc2626, #ef4444)',
              color: '#ffffff',
              padding: '16px 40px',
              borderRadius: '16px',
              fontWeight: 600,
              fontSize: '18px',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 8px 32px rgba(220, 38, 38, 0.3)',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(to right, #ef4444, #f87171)';
              e.currentTarget.style.boxShadow = '0 12px 40px rgba(220, 38, 38, 0.4)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(to right, #dc2626, #ef4444)';
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(220, 38, 38, 0.3)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            Get Started
          </button>
          
          <button
            onClick={() => nav("/learnmore")}
            style={{
              width: window.innerWidth < 640 ? '100%' : 'auto',
              background: 'rgba(255, 255, 255, 0.05)',
              backdropFilter: 'blur(15px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              padding: '16px 40px',
              borderRadius: '16px',
              fontWeight: 600,
              fontSize: '18px',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }}
          >
            Learn More
          </button>
        </div>

        {/* STATS SECTION */}
        <div 
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '32px',
            textAlign: 'center',
            marginBottom: '32px',
            flexWrap: 'wrap'
          }}
        >
          <div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: '#ffffff' }}>
              {stats.streamers != null ? fmtK(stats.streamers) : "10K+"}
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Streamers
            </div>
          </div>
          <div style={{ width: '1px', background: 'rgba(255, 255, 255, 0.1)' }}></div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: '#ffffff' }}>
              {stats.hoursStreamed != null ? fmtK(stats.hoursStreamed) : "50M+"}
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Hours Streamed
            </div>
          </div>
          <div style={{ width: '1px', background: 'rgba(255, 255, 255, 0.1)' }}></div>
          <div>
            {stats.streamersActive != null ? (
              <>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#ffffff' }}>
                  {fmtK(stats.streamersActive)}
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Active Now
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#ffffff' }}>99.9%</div>
                <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Uptime
                </div>
              </>
            )}
          </div>
        </div>

      </div>

      {/* DEV BYPASS - BOTTOM RIGHT */}
      <button
        onClick={() => nav("/join")}
        style={{
          position: 'absolute',
          bottom: '24px',
          right: '24px',
          color: 'rgba(248, 113, 113, 0.5)',
          fontSize: '12px',
          background: 'rgba(0, 0, 0, 0.2)',
          backdropFilter: 'blur(10px)',
          padding: '6px 12px',
          borderRadius: '8px',
          border: '1px solid rgba(220, 38, 38, 0.2)',
          cursor: 'pointer',
          transition: 'all 0.3s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'rgba(248, 113, 113, 1)';
          e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.4)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'rgba(248, 113, 113, 0.5)';
          e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.2)';
        }}
      >
        dev bypass →
      </button>
      {/* Destinations settings quick link for testing */}
      <button
        onClick={() => nav("/settings/destinations")}
        className="absolute bottom-4 left-4 text-blue-400 text-xs underline hover:text-blue-300"
      >
        destinations
      </button>

      {/* FOOTER LINKS - BOTTOM LEFT */}
      <div 
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '24px',
          display: 'flex',
          gap: '24px',
          fontSize: '12px',
          color: '#4b5563'
        }}
      >
        <Link 
          to="/privacy" 
          style={{ color: '#4b5563', textDecoration: 'none', transition: 'color 0.3s ease' }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#4b5563'}
        >
          Privacy
        </Link>
        <Link 
          to="/terms" 
          style={{ color: '#4b5563', textDecoration: 'none', transition: 'color 0.3s ease' }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#4b5563'}
        >
          Terms
        </Link>
        <Link 
          to="/support" 
          style={{ color: '#4b5563', textDecoration: 'none', transition: 'color 0.3s ease' }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#4b5563'}
        >
          Support
        </Link>
      </div>

      {/* CSS ANIMATION KEYFRAMES */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.25; transform: scale(1.05); }
        }
      `}</style>

    </div>
  );
};

export default Welcome;
