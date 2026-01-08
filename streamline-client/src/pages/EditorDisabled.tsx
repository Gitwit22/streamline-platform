import React from 'react';

const EditorDisabled: React.FC = () => {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#000000',
      color: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      textAlign: 'center'
    }}>
      <div style={{ maxWidth: '600px' }}>
        <h1 style={{
          fontSize: '3rem',
          fontWeight: 'bold',
          marginBottom: '1rem',
          background: 'linear-gradient(135deg, #dc2626, #ef4444)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          Coming Soon! ✨
        </h1>
        <p style={{
          fontSize: '1.2rem',
          color: 'rgba(255, 255, 255, 0.8)',
          marginBottom: '2rem',
          lineHeight: '1.6'
        }}>
          Our powerful editing suite is coming soon. For now, focus on creating amazing live streams!
        </p>
        <button
          onClick={() => window.location.href = '/'}
          style={{
            padding: '1rem 2rem',
            fontSize: '1.1rem',
            borderRadius: '0.75rem',
            background: 'linear-gradient(135deg, #dc2626, #ef4444)',
            color: '#ffffff',
            border: 'none',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, #b91c1c, #dc2626)';
            e.currentTarget.style.boxShadow = '0 0 20px rgba(220, 38, 38, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, #dc2626, #ef4444)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          Back to Streaming
        </button>
      </div>
    </div>
  );
};

export default EditorDisabled;