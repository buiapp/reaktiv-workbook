export interface PathRequest {
  kind: 'file' | 'folder';
  current: string;
  label: string;
}

/** Optional host capabilities. Renderers request user intent; they never read files. */
export interface WidgetHost {
  pickPath?: (request: PathRequest) => Promise<string | null>;
}

/** The host path widgets use; a CLI session installs its browser file picker here. */
export const widgetHost: WidgetHost = {};

/** Install (or remove, with undefined) the picker of the attached Python session. */
export function setPathPicker(picker: WidgetHost['pickPath']): void {
  if (picker) widgetHost.pickPath = picker;
  else delete widgetHost.pickPath;
}
