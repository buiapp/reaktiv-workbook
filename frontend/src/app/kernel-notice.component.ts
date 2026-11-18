import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiIconComponent } from './ui-icon.component';

interface KernelNoticeState {
  title: string;
  detail: string;
  action: string;
  busy: boolean;
}

@Component({
  selector: 'app-kernel-notice',
  imports: [UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'region',
    'aria-label': 'Workbook interaction status',
    '[attr.aria-busy]': 'state().busy',
  },
  template: `
    <app-ui-icon name="power" />
    <div class="kernel-notice-copy" role="status">
      <strong>{{ state().title }}</strong>
      <span>{{ state().detail }}</span>
    </div>
    <ng-content />
  `,
  styles: `
:host {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-strong);
  color: var(--ink);
  background: var(--purple-soft);

  > app-ui-icon { color: var(--purple); }
}
.kernel-notice-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
@media (max-width: 640px) {
  :host { flex-wrap: wrap; gap: 8px; }
  :host > app-ui-icon { display: none; }
  .kernel-notice-copy { flex-basis: 100%; }
}

:host([hidden]) { display: none; }
`,
})
export class KernelNoticeComponent {
  readonly state = input.required<KernelNoticeState>();
}
