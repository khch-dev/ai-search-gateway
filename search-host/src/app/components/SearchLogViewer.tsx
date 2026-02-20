'use client';

import { useState, useCallback } from 'react';
import type { GatewayLogEntry } from '../types/gateway-log';

interface SearchLogViewerProps {
  entries: GatewayLogEntry[];
  onClear: () => void;
}

function tryFormatJson(s: string): string {
  try {
    const parsed = JSON.parse(s);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return s;
  }
}

export function SearchLogViewer({ entries, onClear }: SearchLogViewerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyEntry = useCallback(async (entry: GatewayLogEntry) => {
    const text = `[Request]\n${entry.requestBody}\n\n[Response ${entry.responseStatus}]\n${entry.responseBody}`;
    await navigator.clipboard.writeText(text);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  if (entries.length === 0) {
    return (
      <section className="search-log-viewer" aria-label="Host-Gateway 로그">
        <div className="search-log-viewer__header">
          <span className="search-log-viewer__title">Host ↔ Gateway 로그</span>
          <span className="search-log-viewer__empty">검색 시 요청/응답이 여기에 표시됩니다</span>
        </div>
        <div className="search-log-viewer__body search-log-viewer__body--empty">
          <p className="search-log-viewer__placeholder">아직 로그가 없습니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="search-log-viewer" aria-label="Host-Gateway 로그">
      <div className="search-log-viewer__header">
        <span className="search-log-viewer__title">Host ↔ Gateway 로그</span>
        <span className="search-log-viewer__count">{entries.length}개 요청</span>
        <button type="button" className="search-log-viewer__clear" onClick={onClear} aria-label="로그 비우기">
          비우기
        </button>
      </div>
      <div className="search-log-viewer__body" role="log" aria-live="polite">
        <ul className="search-log-viewer__list">
          {entries.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const statusClass =
              entry.responseStatus >= 200 && entry.responseStatus < 300
                ? 'search-log-viewer__status--ok'
                : 'search-log-viewer__status--err';
            return (
              <li key={entry.id} className="search-log-viewer__entry">
                <button
                  type="button"
                  className="search-log-viewer__summary"
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  aria-expanded={isExpanded}
                  aria-controls={`log-detail-${entry.id}`}
                >
                  <span className="search-log-viewer__method">{entry.method}</span>
                  <span className="search-log-viewer__url" title={entry.url}>
                    {entry.url.replace(/^https?:\/\//, '')}
                  </span>
                  <span className={`search-log-viewer__status ${statusClass}`}>{entry.responseStatus}</span>
                  <span className="search-log-viewer__time">
                    {new Date(entry.timestamp).toLocaleTimeString('ko-KR', {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </button>
                {isExpanded && (
                  <div id={`log-detail-${entry.id}`} className="search-log-viewer__detail">
                    <div className="search-log-viewer__detail-section">
                      <div className="search-log-viewer__detail-label">Request body</div>
                      <pre className="search-log-viewer__pre">{tryFormatJson(entry.requestBody)}</pre>
                    </div>
                    <div className="search-log-viewer__detail-section">
                      <div className="search-log-viewer__detail-label">Response body</div>
                      <pre className="search-log-viewer__pre">{tryFormatJson(entry.responseBody)}</pre>
                    </div>
                    <button
                      type="button"
                      className="search-log-viewer__copy"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyEntry(entry);
                      }}
                    >
                      {copiedId === entry.id ? '복사됨' : '복사'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
