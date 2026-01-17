import React, { useState, useEffect } from 'react';

interface SupabaseConfig {
  url: string;
  key: string;
}

export const Settings: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    chrome.storage.sync.get('supabase_config').then((result) => {
      const config = result.supabase_config as SupabaseConfig | undefined;
      if (config) {
        setUrl(config.url);
        setKey(config.key);
      }
    });
  }, []);

  const handleSave = async () => {
    setStatus('saving');
    await chrome.storage.sync.set({
      supabase_config: { url, key },
    });
    setStatus('saved');
    setTimeout(() => setStatus('idle'), 2000);
  };

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px',
            marginRight: '8px',
            padding: '4px',
          }}
        >
          ←
        </button>
        <h2 style={{ margin: 0, fontSize: '18px' }}>Settings</h2>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          Supabase URL
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-project.supabase.co"
          style={{
            width: '100%',
            padding: '8px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          Supabase Anon Key
        </label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="your-anon-key"
          style={{
            width: '100%',
            padding: '8px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <button
        onClick={handleSave}
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontWeight: 'bold',
        }}
      >
        {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved!' : 'Save Configuration'}
      </button>
      
      <p style={{ marginTop: '16px', fontSize: '12px', color: '#666' }}>
        Note: Ensure your Supabase project has a 'highlights' table.
      </p>
    </div>
  );
};
