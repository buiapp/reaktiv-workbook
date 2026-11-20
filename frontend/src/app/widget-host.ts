export interface PathRequest {
  kind: 'file' | 'folder';
  current: string;
  label: string;
}

/** Optional host capabilities. Renderers request user intent; they never read files. */
export interface WidgetHost {
  pickPath?: (request: PathRequest) => Promise<string | null>;
  /** A shared session only accepts paths inside the workbook's folder. */
  pathsInWorkbookFolder?: boolean;
}

/** The host path widgets use; a CLI session installs its browser file picker here. */
export const widgetHost: WidgetHost = {};

/** Say whether path inputs are limited to the workbook's folder (a shared session). */
export function setPathsInWorkbookFolder(limited: boolean): void {
  widgetHost.pathsInWorkbookFolder = limited;
}

/** Install (or remove, with undefined) the picker of the attached Python session. */
export function setPathPicker(picker: WidgetHost['pickPath']): void {
  if (picker) widgetHost.pickPath = picker;
  else delete widgetHost.pickPath;
}
