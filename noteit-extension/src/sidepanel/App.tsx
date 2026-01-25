import { useState, useEffect } from 'react';
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
  invalidHighlights,
}: {
  url: string;
  highlights: IHighlight[];
  onDelete: (id: string) => void;
  onJumpTo: (id: string) => void;
  invalidHighlights?: Set<string>;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Get title and favicon from the first highlight
  const pageTitle = highlights[0]?.pageTitle || new URL(url).hostname;
  const favicon = highlights[0]?.favicon;
  const hasFavicon = favicon && favicon.trim() !== '';
  const [showFavicon, setShowFavicon] = useState(hasFavicon);

  // Sort highlights by their position in the article (start offset)
  // Highlights without start position fall back to timestamp ordering
  const sortedHighlights = [...highlights].sort((a, b) => {
    // If both have start positions, sort by position
    if (a.start != null && b.start != null) {
      return a.start - b.start;
    }
    // If only one has start, prioritize it
    if (a.start != null) return -1;
    if (b.start != null) return 1;
    // If neither has start, sort by timestamp
    return a.timestamp - b.timestamp;
  });

  // Sync showFavicon when favicon changes
  useEffect(() => {
    setShowFavicon(hasFavicon);
  }, [hasFavicon]);

  // Default globe icon SVG
  const DefaultIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" stroke="#9CA3AF" strokeWidth="1.5" fill="none"/>
      <path d="M8 1C8 1 6 4 6 8C6 12 8 15 8 15M8 1C8 1 10 4 10 8C10 12 8 15 8 15M8 1V15M2 8H14M3 5H13M3 11H13" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );

  return (
    <div
      style={{
        marginBottom: '8px',
        background: 'white',
        border: '1px solid #e8e8e8',
        borderRadius: '8px',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#d0d0d0';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#e8e8e8';
      }}
    >
      <div
        style={{
          padding: '12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', flex: 1 }}>
          <div style={{ 
            width: '16px', 
            height: '16px', 
            marginRight: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            {showFavicon ? (
              <img 
                src={favicon!} 
                alt="" 
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '2px',
                  display: 'block',
                }}
                onError={() => setShowFavicon(false)}
              />
            ) : (
              <DefaultIcon />
            )}
          </div>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div
              style={{
                fontSize: '14px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: '#1a1a1a',
              }}
            >
              {pageTitle}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: '12px', gap: '12px' }}>
          <span
            style={{
              fontSize: '12px',
              color: '#999',
            }}
          >
            {highlights.length}
          </span>
          <span 
            style={{ 
              fontSize: '10px',
              color: '#999',
              transition: 'transform 0.2s ease',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            ▶
          </span>
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: '0 12px 12px 12px', borderTop: '1px solid #f5f5f5' }}>
          <HighlightList
            highlights={sortedHighlights}
            onDelete={onDelete}
            onJumpTo={onJumpTo}
            showHostname={false}
            invalidHighlights={invalidHighlights}
          />
        </div>
      )}
    </div>
  );
};

function App() {
  const { highlights, removeHighlight, jumpToHighlight, currentUrl, invalidHighlights } = useHighlights();
  const [activeTab, setActiveTab] = useState<'current' | 'websites'>('current');
  const [showSettings, setShowSettings] = useState(false);
  const [isExtensionEnabled, setIsExtensionEnabled] = useState<boolean | null>(null);

  // Get extension state for current page
  useEffect(() => {
    const checkExtensionState = async () => {
      if (!currentUrl) return;
      
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;

        // Request current state from content script
        chrome.tabs.sendMessage(tab.id, { action: 'GET_EXTENSION_STATE' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Could not get extension state:', chrome.runtime.lastError);
            // Default to checking storage
            checkStorageState();
            return;
          }
          if (response && typeof response.enabled === 'boolean') {
            setIsExtensionEnabled(response.enabled);
          }
        });
      } catch (error) {
        console.error('Failed to check extension state:', error);
        checkStorageState();
      }
    };

    const checkStorageState = async () => {
      if (!currentUrl) return;
      try {
        const result = await chrome.storage.local.get(['enabledSites', 'highlights']);
        const enabledSites = (result.enabledSites as string[]) || [];
        const allHighlights = (result.highlights as IHighlight[]) || [];
        
        // Check if enabled or has highlights
        const hasHighlights = allHighlights.some(h => h.url === currentUrl);
        const isEnabled = enabledSites.includes(currentUrl) || hasHighlights;
        setIsExtensionEnabled(isEnabled);
      } catch (error) {
        console.error('Failed to check storage state:', error);
      }
    };

    checkExtensionState();

    // Listen for state changes
    const handleStorageChange = (changes: any) => {
      if (changes.enabledSites) {
        checkStorageState();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [currentUrl]);

  const toggleExtension = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      // Toggle local state immediately for better UX
      const newState = !isExtensionEnabled;
      setIsExtensionEnabled(newState);
      
      // Send message to content script
      chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_EXTENSION' });
      
      // Wait a bit and verify state from storage (only check enabledSites, not auto-enable from highlights)
      setTimeout(async () => {
        try {
          const result = await chrome.storage.local.get(['enabledSites']);
          const enabledSites = (result.enabledSites as string[]) || [];
          const isEnabled = enabledSites.includes(currentUrl);
          setIsExtensionEnabled(isEnabled);
        } catch (error) {
          console.error('Failed to verify state:', error);
        }
      }, 200);
    } catch (error) {
      console.error('Failed to toggle extension:', error);
    }
  };

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

  const currentHighlights = highlights
    .filter((h) => normalizeUrl(h.url) === currentNormalized)
    .sort((a, b) => {
      // Sort by position in article (start offset)
      if (a.start != null && b.start != null) {
        return a.start - b.start;
      }
      if (a.start != null) return -1;
      if (b.start != null) return 1;
      // Fallback to timestamp for old data without position
      return a.timestamp - b.timestamp;
    });

  // Helper to get time category
  const getTimeCategory = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const dayInMs = 24 * 60 * 60 * 1000;
    
    if (diff < dayInMs) return 'Today';
    if (diff < 2 * dayInMs) return 'Yesterday';
    if (diff < 7 * dayInMs) return 'This Week';
    return 'Earlier';
  };

  // Group for websites tab
  const groupedHighlights = highlights.reduce((acc, h) => {
    const key = normalizeUrl(h.url);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(h);
    return acc;
  }, {} as Record<string, IHighlight[]>);

  // Sort websites by most recent highlight and group by time
  const sortedWebsites = Object.entries(groupedHighlights)
    .map(([url, groupHighlights]) => {
      const latestTimestamp = Math.max(...groupHighlights.map(h => h.timestamp));
      return { url, highlights: groupHighlights, latestTimestamp };
    })
    .sort((a, b) => b.latestTimestamp - a.latestTimestamp);

  // Group by time category
  const websitesByTime = sortedWebsites.reduce((acc, item) => {
    const category = getTimeCategory(item.latestTimestamp);
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(item);
    return acc;
  }, {} as Record<string, typeof sortedWebsites>);

  const timeOrder = ['Today', 'Yesterday', 'This Week', 'Earlier'];

  return (
    <div style={{ padding: '16px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', margin: 0 }}>NoteIt 📝</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Toggle Switch */}
          <button
            onClick={toggleExtension}
            disabled={isExtensionEnabled === null}
            style={{
              position: 'relative',
              width: '48px',
              height: '28px',
              background: isExtensionEnabled ? '#22c55e' : '#d1d5db',
              border: 'none',
              borderRadius: '14px',
              cursor: isExtensionEnabled === null ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.3s ease',
              opacity: isExtensionEnabled === null ? 0.5 : 1,
              padding: 0,
              outline: 'none',
            }}
            title={isExtensionEnabled ? 'Disable for this site' : 'Enable for this site'}
          >
            <div
              style={{
                position: 'absolute',
                top: '2px',
                left: isExtensionEnabled ? '22px' : '2px',
                width: '24px',
                height: '24px',
                background: 'white',
                borderRadius: '50%',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                transition: 'left 0.3s ease',
              }}
            />
          </button>
          
          {/* Settings Button */}
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
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          marginBottom: '16px',
          borderBottom: '1px solid #e8e8e8',
        }}
      >
        <button
          onClick={() => setActiveTab('current')}
          style={{
            flex: 1,
            padding: '10px',
            border: 'none',
            background: 'transparent',
            borderBottom: activeTab === 'current' ? '2px solid #1a1a1a' : '2px solid transparent',
            cursor: 'pointer',
            color: activeTab === 'current' ? '#1a1a1a' : '#999',
            fontSize: '14px',
            transition: 'all 0.2s ease',
          }}
        >
          Current Page
        </button>
        <button
          onClick={() => setActiveTab('websites')}
          style={{
            flex: 1,
            padding: '10px',
            border: 'none',
            background: 'transparent',
            borderBottom: activeTab === 'websites' ? '2px solid #1a1a1a' : '2px solid transparent',
            cursor: 'pointer',
            color: activeTab === 'websites' ? '#1a1a1a' : '#999',
            fontSize: '14px',
            transition: 'all 0.2s ease',
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
                invalidHighlights={invalidHighlights}
              />
          ) : (
              <p style={{ color: '#666', textAlign: 'center' }}>Loading...</p>
          )}
         
        </div>
      ) : (
        <div>
          {timeOrder.map((category) => {
            const websites = websitesByTime[category];
            if (!websites || websites.length === 0) return null;
            
            return (
              <div key={category} style={{ marginBottom: '24px' }}>
                <h3 style={{ 
                  fontSize: '12px', 
                  fontWeight: '600', 
                  color: '#999', 
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '12px',
                  marginTop: 0,
                }}>
                  {category}
                </h3>
                {websites.map(({ url, highlights: groupHighlights }) => (
                  <WebsiteGroup
                    key={url}
                    url={url}
                    highlights={groupHighlights}
                    onDelete={removeHighlight}
                    onJumpTo={jumpToHighlight}
                    invalidHighlights={invalidHighlights}
                  />
                ))}
              </div>
            );
          })}
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
