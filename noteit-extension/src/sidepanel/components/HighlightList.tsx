import React from 'react';
import type { IHighlight } from '../../shared/types';

interface HighlightListProps {
  highlights: IHighlight[];
  onDelete: (id: string) => void;
  onJumpTo: (id: string) => void;
  showHostname?: boolean;
  invalidHighlights?: Set<string>;
}

export const HighlightList: React.FC<HighlightListProps> = ({ highlights, onDelete, onJumpTo, showHostname = true, invalidHighlights = new Set() }) => {
  if (highlights.length === 0) {
    return <p style={{ color: '#666', textAlign: 'center' }}>No highlights yet.</p>;
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {highlights.map((h) => {
        const isInvalid = invalidHighlights.has(h.id);
        return (
        <li
          key={h.id}
          style={{
            borderLeft: `4px solid ${h.color}`,
            padding: '8px',
            paddingRight: '28px',
            marginBottom: '8px',
            backgroundColor: '#f9f9f9',
            borderRadius: '4px',
            position: 'relative',
          }}
        >
           <div
             style={{ 
               fontSize: '14px', 
               marginBottom: '4px', 
               cursor: 'pointer',
               color: isInvalid ? '#999' : '#000',
               opacity: isInvalid ? 0.6 : 1,
             }}
             onClick={() => onJumpTo(h.id)}
             title={isInvalid ? "Highlight not found in page" : "Jump to highlight"}
           >
             {h.text}
           </div>
          {h.comment && (
            <div
              style={{
                fontSize: '12px',
                color: isInvalid ? '#999' : '#555',
                backgroundColor: isInvalid ? '#f5f5f5' : '#fff3cd',
                padding: '6px 8px',
                marginTop: '6px',
                borderRadius: '4px',
                borderLeft: `3px solid ${isInvalid ? '#ccc' : '#ffc107'}`,
                fontStyle: 'italic',
                opacity: isInvalid ? 0.6 : 1,
              }}
            >
              📝 {h.comment}
            </div>
          )}
          {showHostname && (
            <div style={{ fontSize: '10px', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '4px' }}>
              {new URL(h.url).hostname}
            </div>
          )}
          <button
            onClick={() => onDelete(h.id)}
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: '#ff4444',
              fontSize: '16px',
            }}
            title="Delete"
          >
            &times;
          </button>
        </li>
        );
      })}
    </ul>
  );
};
