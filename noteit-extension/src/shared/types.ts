export interface IHighlight {
  id: string;
  text: string;
  url: string;
  color: string;
  timestamp: number;
  start?: number;
  length?: number;
  // For robust anchoring (Phase 4), but defining structure now
  context?: {
    prefix: string;
    suffix: string;
    offset: number;
  };
  // Fallback or alternative
  xpath?: string;
  // User comment attached to the highlight
  comment?: string;
  // Page metadata
  pageTitle?: string;
  favicon?: string;
}

export interface IStorageSchema {
  highlights: IHighlight[];
}
