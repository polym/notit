import { useState } from 'react';
import { useHighlights } from './hooks/useHighlights';
import { HighlightList } from './components/HighlightList';
import { Settings } from './components/Settings';
import type { IHighlight } from '../shared/types';

// Collapsible Website Group Component
const WebsiteGroup = ({
  url,
  highlights,
  onDelete,
  onJumpTo,
}: {
  url: string;
  highlights: IHighlight[];
  onDelete: (id: string) => void;
  onJumpTo: (id: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleNavigate = () => {
    chrome.tabs.create({ url });
  };

  return (
    <div
      style={{
        marginBottom: '8px',
        border: '1px solid #eee',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px',
          backgroundColor: '#f5f5f5',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
          <span style={{ marginRight: '8px', fontSize: '12px' }}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <div style={{ overflow: 'hidden' }}>
            <div
              style={{
                fontWeight: 'bold',
                fontSize: '13px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {new URL(url).hostname}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: '#666',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {new URL(url).pathname}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: '8px' }}>
          <span
            style={{
              fontSize: '11px',
              color: '#888',
              marginRight: '8px',
              backgroundColor: '#e0e0e0',
              padding: '2px 6px',
              borderRadius: '10px',
            }}
          >
            {highlights.length}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNavigate();
            }}
            title="Open in new tab"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '2px',
            }}
          >
            🔗
          </button>
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: '8px' }}>
          <HighlightList
            highlights={highlights}
            onDelete={onDelete}
            onJumpTo={onJumpTo}
            showHostname={false}
          />
        </div>
      )}
    </div>
  );
};

function App() {
  const { highlights, removeHighlight, jumpToHighlight, currentUrl } = useHighlights();
  const [activeTab, setActiveTab] = useState<'current' | 'websites'>('current');
  const [showSettings, setShowSettings] = useState(false);

  if (showSettings) {
    return <Settings onBack={() => setShowSettings(false)} />;
  }

  // Helper to normalize URL (ignore hash/query for grouping)
  const normalizeUrl = (url: string) => {
    try {
      const u = new URL(url);
      return u.origin + u.pathname;
    } catch {
      return url;
    }
  };

  const currentNormalized = normalizeUrl(currentUrl);

  const currentHighlights = highlights.filter(
    (h) => normalizeUrl(h.url) === currentNormalized
  );

  // Group for websites tab
  const groupedHighlights = highlights.reduce((acc, h) => {
    const key = normalizeUrl(h.url);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(h);
    return acc;
  }, {} as Record<string, IHighlight[]>);

  return (
    <div style={{ padding: '16px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', margin: 0 }}>NoteIt 📝</h1>
        <button
          onClick={() => setShowSettings(true)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '20px',
            padding: '4px',
          }}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          marginBottom: '16px',
          borderBottom: '1px solid #eee',
        }}
      >
        <button
          onClick={() => setActiveTab('current')}
          style={{
            flex: 1,
            padding: '8px',
            border: 'none',
            background: 'transparent',
            borderBottom: activeTab === 'current' ? '2px solid #007bff' : 'none',
            fontWeight: activeTab === 'current' ? 'bold' : 'normal',
            cursor: 'pointer',
            color: activeTab === 'current' ? '#007bff' : '#333',
          }}
        >
          Current Page
        </button>
        <button
          onClick={() => setActiveTab('websites')}
          style={{
            flex: 1,
            padding: '8px',
            border: 'none',
            background: 'transparent',
            borderBottom: activeTab === 'websites' ? '2px solid #007bff' : 'none',
            fontWeight: activeTab === 'websites' ? 'bold' : 'normal',
            cursor: 'pointer',
            color: activeTab === 'websites' ? '#007bff' : '#333',
          }}
        >
          Websites
        </button>
      </div>

      {activeTab === 'current' ? (
        <div>
          {currentUrl ? (
              <HighlightList
                highlights={currentHighlights}
                onDelete={removeHighlight}
                onJumpTo={jumpToHighlight}
                showHostname={false}
              />
          ) : (
              <p style={{ color: '#666', textAlign: 'center' }}>Loading...</p>
          )}
         
        </div>
      ) : (
        <div>
          {Object.entries(groupedHighlights).map(([url, groupHighlights]) => (
            <WebsiteGroup
              key={url}
              url={url}
              highlights={groupHighlights}
              onDelete={removeHighlight}
              onJumpTo={jumpToHighlight}
            />
          ))}
          {Object.keys(groupedHighlights).length === 0 && (
            <p style={{ color: '#666', textAlign: 'center' }}>
              No highlights yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
