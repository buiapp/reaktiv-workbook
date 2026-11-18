/** IDs and presentation only. The app's document/results remain the source of content. */
export interface AgentCellContext { id: string; name: string; kind: string; title?: string; }
export interface AgentPaneContext {
  index: number;
  view: 'notes' | 'sheet' | 'graph';
  worksheet: string;
  note: AgentCellContext | null;
}
export interface AgentViewContext {
  windowFocused: boolean;
  lastFocusedAt: string;
  view: 'notes' | 'sheet' | 'graph' | 'split';
  activePane: number;
  panes: AgentPaneContext[];
  selectedCell: AgentCellContext | null;
  selectedCellIds: string[];
  inspectedCell: AgentCellContext | null;
  focusedCellId: string | null;
  editorCellId: string | null;
  notesEditing: boolean;
  actionsOpen: boolean;
  consoleOpen: boolean;
}
