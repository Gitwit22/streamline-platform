import { useState, useEffect } from "react";
import { PLAN_IDS, PlanId, isPlanId } from "../lib/planIds";
import { useNavigate } from "react-router-dom";
import { editingApi } from "../lib/editingApi";

type Recording = {
  id: string;
  title: string;
  status: "recording" | "processing" | "ready";
  progress: number;
  duration: number;
  viewerCount: number;
  peakViewers: number;
  createdAt: string;
};

type Project = {
  id: string;
  name: string;
  assetId: string;
  createdAt: string;
  duration?: number;
};

/**
 * STREAMLINE DASHBOARD - REDESIGNED
 * Glassmorphism black/red/white theme
 */

export default function Dashboard() {
  const nav = useNavigate();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<any>(null);
  // Canonical plan id for display
  function canonicalPlanId(planId: string | undefined): PlanId {
    if (!planId) return "free";
    if (planId === "starter_paid" || planId === "starter_trial") return "starter";
    if (isPlanId(planId)) return planId;
    return "free";
  }
  const [totalViewers, setTotalViewers] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);

  const readyRecordings = recordings.filter((r) => r.status === "ready");

  const handleDeleteRecording = (recordingId: string) => {
    if (confirm("Are you sure you want to delete this recording? This cannot be undone.")) {
      // Remove from state
      setRecordings(recordings.filter((r) => r.id !== recordingId));
      // Delete from backend
      editingApi.deleteRecording(recordingId).catch((err) => {
        console.error("Failed to delete recording:", err);
      });
    }
  };

  return (
    <div 
      style={{
        minHeight: '100vh',
        backgroundColor: '#000000',
        color: '#ffffff',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      
      {/* ANIMATED BACKGROUND */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <div 
          style={{
            position: 'absolute',
            top: '10%',
            left: '5%',
            width: '600px',
            height: '600px',
            background: 'rgba(220, 38, 38, 0.1)',
            borderRadius: '50%',
            filter: 'blur(140px)',
            animation: 'pulse 5s ease-in-out infinite'
          }}
        />
        <div 
          style={{
            position: 'absolute',
            bottom: '10%',
            right: '5%',
            width: '700px',
            height: '700px',
            background: 'rgba(239, 68, 68, 0.08)',
            borderRadius: '50%',
            filter: 'blur(160px)',
            animation: 'pulse 5s ease-in-out infinite',
            animationDelay: '2.5s'
          }}
        />
      </div>

      {/* HEADER */}
      <div 
        style={{
          position: 'relative',
          zIndex: 10,
          background: 'rgba(15, 15, 15, 0.7)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '20px 32px'
        }}
      >
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            maxWidth: '1400px',
            margin: '0 auto'
          }}
        >
          <div>
            <h1 
              style={{
                fontSize: '28px',
                fontWeight: 700,
                marginBottom: '4px',
                background: 'linear-gradient(to right, #ffffff, #fecaca)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}
            >
              Welcome back, {user?.displayName || "Streamer"}! 👋
            </h1>
            <p style={{ fontSize: '14px', color: '#6b7280' }}>
              {canonicalPlanId(user?.planId).toUpperCase()} Plan
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Settings & Billing button (left side) */}
            <button
              onClick={() => nav("/settings/billing")}
              style={{
                padding: '12px 24px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.borderColor = 'rgba(34,197,94,0.6)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
              }}
            >
              ⚙️ Settings & Billing
            </button>
            {/* Content and New Stream buttons (right side) */}
            <button
              onClick={() => nav("/join")}
              style={{
                padding: '12px 24px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.6)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
              }}
            >
              🎬 My Content
            </button>
            <button
              onClick={() => nav("/join")}
              style={{
                padding: '12px 24px',
                background: 'linear-gradient(to right, #dc2626, #ef4444)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 8px 32px rgba(220, 38, 38, 0.3)',
                transition: 'all 0.3s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 12px 40px rgba(220, 38, 38, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 8px 32px rgba(220, 38, 38, 0.3)';
              }}
            >
              + New Stream
            </button>
          </div>
        </div>
      </div>

      {/* STATS GRID */}
      <div 
        style={{
          position: 'relative',
          zIndex: 10,
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '32px'
        }}
      >
        <div 
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '20px',
            marginBottom: '40px'
          }}
        >
          <StatCard
            label="Recordings"
            value={recordings.length}
            detail={`${readyRecordings.length} ready`}
            icon="🎬"
          />
          <StatCard
            label="Total Viewers"
            value={totalViewers.toLocaleString()}
            detail="Peak viewers"
            icon="👥"
          />
          <StatCard
            label="Total Minutes"
            value={Math.round(totalDuration).toLocaleString()}
            detail="Streamed"
            icon="⏱️"
          />
          <StatCard
            label="Projects"
            value={projects.length}
            detail="Edited"
            icon="✂️"
          />
        </div>

        {/* RECENT RECORDINGS */}
        <div style={{ marginBottom: '40px' }}>
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '20px'
            }}
          >
            <h2 style={{ fontSize: '24px', fontWeight: 700 }}>Recent Recordings</h2>
            <button
              onClick={() => nav("/editing/assets")}
              style={{
                fontSize: '14px',
                color: '#ef4444',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              View All →
            </button>
          </div>

          {recordings.length === 0 ? (
            <div 
              style={{
                background: 'rgba(15, 15, 15, 0.7)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '16px',
                padding: '48px',
                textAlign: 'center'
              }}
            >
              <p style={{ color: '#9ca3af', marginBottom: '20px' }}>No recordings yet</p>
              <button
                onClick={() => nav("/join")}
                style={{
                  padding: '12px 24px',
                  background: 'linear-gradient(to right, #dc2626, #ef4444)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer'
                }}
              >
                Start your first stream
              </button>
            </div>
          ) : (
            <div 
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '20px'
              }}
            >
              {recordings.slice(0, 6).map((rec) => (
                <RecordingCard
                  key={rec.id}
                  recording={rec}
                  onEdit={() => nav(`/editing/editor/new?recordingId=${rec.id}`)}
                  onDelete={() => handleDeleteRecording(rec.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* RECENT PROJECTS */}
        <div>
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '20px'
            }}
          >
            <h2 style={{ fontSize: '24px', fontWeight: 700 }}>Recent Projects</h2>
            <button
              onClick={() => nav("/editing/projects")}
              style={{
                fontSize: '14px',
                color: '#ef4444',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              View All →
            </button>
          </div>

          {projects.length === 0 ? (
            <div 
              style={{
                background: 'rgba(15, 15, 15, 0.7)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '16px',
                padding: '48px',
                textAlign: 'center'
              }}
            >
              <p style={{ color: '#9ca3af', marginBottom: '20px' }}>No projects yet</p>
              <button
                onClick={() => nav("/editing/assets")}
                style={{
                  padding: '12px 24px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  cursor: 'pointer'
                }}
              >
                Create your first project
              </button>
            </div>
          ) : (
            <div 
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: '20px'
              }}
            >
              {projects.slice(0, 8).map((proj) => (
                <ProjectCard
                  key={proj.id}
                  project={proj}
                  onEdit={() => nav(`/editing/editor/${proj.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* CSS ANIMATIONS */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.1; transform: scale(1); }
          50% { opacity: 0.15; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}

function StatCard({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: string }) {
  return (
    <div 
      style={{
        background: 'rgba(15, 15, 15, 0.7)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        padding: '24px',
        transition: 'all 0.3s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.3)';
        e.currentTarget.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
        {icon} {label}
      </p>
      <p style={{ fontSize: '32px', fontWeight: 700, marginBottom: '4px' }}>{value}</p>
      <p style={{ fontSize: '12px', color: '#9ca3af' }}>{detail}</p>
    </div>
  );
}

function RecordingCard({ recording, onEdit, onDelete }: { recording: Recording; onEdit: () => void; onDelete: () => void }) {
  return (
    <div 
      style={{
        background: 'rgba(15, 15, 15, 0.7)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        overflow: 'hidden',
        transition: 'all 0.3s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.3)';
        e.currentTarget.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div 
        style={{
          aspectRatio: '16/9',
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '48px'
        }}
      >
        🎬
      </div>
      <div style={{ padding: '16px' }}>
        <h3 style={{ fontWeight: 600, fontSize: '15px', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {recording.title}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span 
            style={{
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '6px',
              background: recording.status === 'ready' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)',
              color: recording.status === 'ready' ? '#22c55e' : '#eab308'
            }}
          >
            {recording.status === 'ready' ? '✅ Ready' : '⏳ Processing'}
          </span>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>
            {Math.round(recording.duration / 60)}m
          </span>
        </div>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
          👥 {recording.peakViewers} viewers
        </p>
        <div style={{ display: 'flex', gap: '0', width: '100%' }}>
          <button
            onClick={onDelete}
            style={{
              flex: 1,
              padding: '10px',
              background: '#dc2626',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px 0 0 8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#b91c1c';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#dc2626';
            }}
          >
            Delete
          </button>
          <button
            onClick={onEdit}
            style={{
              flex: 1,
              padding: '10px',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0 8px 8px 0',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#1d4ed8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#2563eb';
            }}
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, onEdit }: { project: Project; onEdit: () => void }) {
  return (
    <div 
      style={{
        background: 'rgba(15, 15, 15, 0.7)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        overflow: 'hidden',
        transition: 'all 0.3s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.3)';
        e.currentTarget.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div 
        style={{
          aspectRatio: '16/9',
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '48px'
        }}
      >
        🎞️
      </div>
      <div style={{ padding: '16px' }}>
        <h3 style={{ fontWeight: 600, fontSize: '15px', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name}
        </h3>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
          {new Date(project.createdAt).toLocaleDateString()}
        </p>
        <button
          onClick={onEdit}
          style={{
            width: '100%',
            padding: '10px',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#ffffff',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Open
        </button>
      </div>
    </div>
  );
}
