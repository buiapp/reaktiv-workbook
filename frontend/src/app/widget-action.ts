import type { ActionBinding, CellView } from './sheet.types';
export interface WidgetActionRequest {
  cellId: string;
  name: string;
  arguments: Record<string, ActionBinding>;
}
export interface WidgetActionFeedback {
  cellId: string;
  name: string;
  error: string;
}

/** Invocation feedback belongs to the view; it never writes a workbook input. */
export function actionWidgetState<
  T extends { type: string; action?: string; cancelWhileRunning?: boolean; disabled?: boolean; loading?: boolean },
>(
  widget: T,
  cellId: string,
  running: string | null | readonly string[],
  busy: boolean,
  feedback: WidgetActionFeedback | null,
  cancelling: readonly string[] = [],
): T & { actionError?: string; actionState?: 'running' | 'cancelling' } {
  if (widget.type !== 'button' || !widget.action) return widget;
  const active = Array.isArray(running) ? running.includes(widget.action) : running === widget.action;
  const stopping = active && cancelling.includes(widget.action);
  return {
    ...widget,
    actionState: active ? stopping ? 'cancelling' : 'running' : undefined,
    disabled: widget.disabled || busy || stopping,
    loading: widget.loading || (active && !widget.cancelWhileRunning),
    actionError:
      feedback?.cellId === cellId && feedback.name === widget.action ? feedback.error : undefined,
  };
}

/** Remap only cell bindings; a literal containing a coordinate remains literal data. */
export function remapWidgetActionBindings(
  view: CellView | undefined,
  rename: (id: string) => string,
): CellView | undefined {
  const bindings = view?.widget?.actionArguments;
  if (!bindings) return view;
  return {
    ...view,
    widget: {
      ...view!.widget!,
      actionArguments: Object.fromEntries(
        Object.entries(bindings).map(([name, binding]) => [
          name,
          binding.cell ? { cell: rename(binding.cell) } : binding,
        ]),
      ),
    },
  };
}
