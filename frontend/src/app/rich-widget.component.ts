import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  inject,
} from '@angular/core';
import { WidgetType, WidgetValue, renderRichWidget } from './input-widgets';

/** A rich input widget (list, multiselect, textarea, button) in a grid tile or graph card. */
@Component({
  selector: 'app-rich-widget',
  template: '',
  host: { class: 'rich-widget', '(keydown)': '$event.stopPropagation()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RichWidgetComponent implements OnChanges {
  @Input({ required: true }) type!: WidgetType;
  @Input() label = '';
  @Input() value: unknown = null;
  @Input() options: readonly string[] = [];
  @Input() disabled = false;
  @Input() visible = true;
  @Input() loading = false;
  @Input() pressed?: boolean;
  @Input() placeholder = '';
  @Input() buttonMode: 'count' | 'toggle' | 'action' = 'count';
  @Input() action?: string;
  @Input() cancelWhileRunning = false;
  @Input() actionState?: 'running' | 'cancelling';
  @Input() actionError?: string;
  @Input() rejected?: { value: string; message: string };
  @Output() readonly actionInvoked = new EventEmitter<string>();
  @Output() readonly valueChange = new EventEmitter<WidgetValue>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private shown = '';

  ngOnChanges(): void {
    const model = {
      type: this.type,
      label: this.label,
      value: this.value,
      options: this.options,
      disabled: this.disabled,
      visible: this.visible,
      loading: this.loading,
      pressed: this.pressed,
      placeholder: this.placeholder,
      buttonMode: this.buttonMode,
      action: this.action,
      cancelWhileRunning: this.cancelWhileRunning,
      actionState: this.actionState,
      actionError: this.actionError,
      rejected: this.rejected,
    };
    const signature = JSON.stringify(model);
    if (signature === this.shown) return;
    this.shown = signature;
    renderRichWidget(
      this.host,
      model,
      (value) => this.valueChange.emit(value),
      (name) => this.actionInvoked.emit(name),
    );
  }
}
