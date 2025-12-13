export default function EditorDisabled() {
  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: '#000',
      color: '#fff'
    }}>
      <div style={{ textAlign: 'center', maxWidth: '500px', padding: '24px' }}>
        <h1 style={{ fontSize: '48px', marginBottom: '16px' }}>✂️</h1>
        <h2 style={{ fontSize: '32px', marginBottom: '16px' }}>
          Editing Suite
        </h2>
        <p style={{ color: '#9ca3af', marginBottom: '24px' }}>
          Our powerful editing suite is coming soon! For now, you can download 
          your recordings and edit them in your favorite video editor.
        </p>
        <button
          onClick={() => window.location.href = '/'}
          style={{
            background: '#dc2626',
            padding: '12px 24px',
            borderRadius: '8px',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 600
          }}
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
