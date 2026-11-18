import type { RichWidgetModel, WidgetValue } from './input-widgets';
import { widgetHost, type WidgetHost } from './widget-host';

/** A path string editor with an optional native picker; shared by notes and grid tiles. */
export function renderPathWidget(
  root: HTMLElement,
  model: RichWidgetModel,
  change: (value: WidgetValue) => void,
  host: WidgetHost = widgetHost,
): void {
  const kind = model.type === 'folder' ? 'folder' : 'file';
  const row = document.createElement('div'); row.className = 'rw-path-row';
  const field = document.createElement('input');
  field.type = 'text'; field.value = String(model.value ?? '');
  field.placeholder = model.placeholder || `Enter a ${kind} path`;
  field.setAttribute('aria-label', model.label || `${kind} path`);
  field.disabled = model.disabled;
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = 'Browse…';
  button.setAttribute('aria-label', `Choose ${kind}${model.label ? ': ' + model.label : ''}`);
  button.disabled = model.disabled || !host.pickPath;
  const hint = document.createElement('small'); hint.className = 'rw-path-hint';
  hint.textContent = host.pickPath
    ? 'The path must be accessible to your Python kernel.'
    : 'Enter a path accessible to your Python kernel. Browse… needs a workbook opened with reaktiv-workbook edit.';
  button.title = host.pickPath ? `Choose ${kind}` : 'Browsing needs a workbook opened with reaktiv-workbook edit';
  const error = document.createElement('span'); error.className = 'rw-action-error';
  error.setAttribute('role', 'alert'); error.hidden = true;
  const active = () => root.isConnected && root.contains(field);
  let picking = false;
  field.addEventListener('change', () => {
    if (!model.disabled && !picking) change(field.value);
  });
  button.addEventListener('click', async () => {
    if (!host.pickPath || model.disabled || picking) return;
    picking = true; button.disabled = true; field.disabled = true;
    error.hidden = true; root.setAttribute('aria-busy', 'true');
    try {
      const selected = await host.pickPath({kind, current: field.value, label: model.label});
      // A newer value/configuration replaces this control. Never overwrite it with a late dialog result.
      if (selected !== null && active()) { field.value = selected; change(selected); }
    } catch (reason) {
      if (active()) {
        error.textContent = reason instanceof Error ? reason.message : String(reason);
        error.hidden = false;
      }
    } finally {
      picking = false;
      if (active()) {
        root.setAttribute('aria-busy', 'false');
        field.disabled = model.disabled; button.disabled = model.disabled || !host.pickPath;
      }
    }
  });
  row.append(field, button); root.replaceChildren(row, hint, error);
}
