export * from '../bindings';

export interface WatcherEvent {
  link_id: string;
  paths: string[];
  kind: string;
  timestamp: string;
}

export interface WatcherStatus {
  [linkId: string]: boolean;
}
