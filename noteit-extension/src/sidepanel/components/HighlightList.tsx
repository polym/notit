import React from 'react';
import type { IHighlight } from '../../shared/types';

interface HighlightListProps {
  highlights: IHighlight[];
  onDelete: (id: string) => void;
  onJumpTo: (id: string) => void;
  showHostname?: boolean;
}

export const HighlightList: React.FC<HighlightListProps> = ({ highlights, onDelete, onJumpTo, showHostname = true }) => {
  if (highlights.length === 0) {
    return <p style={{ color: '#666', textAlign: 'center' }}>No highlights yet.</p>;
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {highlights.map((h) => (
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
             style={{ fontSize: '14px', marginBottom: '4px', cursor: 'pointer' }}
             onClick={() => onJumpTo(h.id)}
             title="Jump to highlight"
           >
             {h.text}
           </div>
          {h.comment && (
            <div
              style={{
                fontSize: '12px',
                color: '#555',
                backgroundColor: '#fff3cd',
                padding: '6px 8px',
                marginTop: '6px',
                borderRadius: '4px',
                borderLeft: '3px solid #ffc107',
                fontStyle: 'italic',
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
      ))}
    </ul>
  );
};
