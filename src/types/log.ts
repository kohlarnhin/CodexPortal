export const LOG_DISPLAY_LIMIT = 100;

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  sequence: number;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface LogSnapshot {
  entries: LogEntry[];
  filePath: string | null;
  fileError: string | null;
}

export interface LogUpdate {
  entry: LogEntry;
  fileError: string | null;
}
