import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type UiIconName =
  | 'equal'
  | 'minus'
  | 'input-signal'
  | 'function'
  | 'note'
  | 'async-resource'
  | 'bolt'
  | 'arrow-left'
  | 'arrow-right'
  | 'artifact'
  | 'branch'
  | 'check'
  | 'code'
  | 'copy'
  | 'edit'
  | 'export'
  | 'folder-open'
  | 'graph'
  | 'grid'
  | 'help'
  | 'history'
  | 'image'
  | 'inspect'
  | 'link'
  | 'logs'
  | 'minus'
  | 'moon'
  | 'more'
  | 'new-file'
  | 'plus'
  | 'power'
  | 'stop'
  | 'collapse'
  | 'expand'
  | 'play'
  | 'pin'
  | 'pointer'
  | 'redo'
  | 'restart'
  | 'search'
  | 'save'
  | 'settings'
  | 'split'
  | 'sidebar'
  | 'panel-right-open'
  | 'panel-right-close'
  | 'sun'
  | 'swap-horizontal'
  | 'theme-auto'
  | 'trash'
  | 'undo'
  | 'widget'
  | 'window'
  | 'zoom-in'
  | 'zoom-out';

@Component({
  selector: 'app-ui-icon',
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (name) {
        @case ('pin') { <path d="M8 3h8M9 3v6l-3 4v2h12v-2l-3-4V3M12 15v6" /> }
        @case ('equal') { <path d="M4 8h16M4 16h16" /> }
        @case ('minus') { <path d="M4 12h16" /> }
        @case ('input-signal') {
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M1 12h10m-3-3 3 3-3 3M15 9v6" />
        }
        @case ('function') {
          <path d="M17 4h-3a3 3 0 0 0-3 3v10a3 3 0 0 1-3 3H6M7 10h9" />
        }
        @case ('note') {
          <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h4" />
        }
        @case ('async-resource') {
          <path d="M7 16H6a4 4 0 0 1-.7-7.9A6 6 0 0 1 17 7a4 4 0 0 1 1 7.9M12 11v10m-3-3 3 3 3-3" />
        }
        @case ('bolt') { <path d="m13 2-9 12h7l-1 8 10-13h-8z" /> }

        @case ('power') { <path d="M12 3v9M6.3 5.7a8 8 0 1 0 11.4 0" /> }
        @case ('stop') { <rect x="6" y="6" width="12" height="12" rx="1" /> }
        @case ('collapse') { <path d="m8 4 4 4 4-4M8 20l4-4 4 4" /> }
        @case ('expand') { <path d="m8 8 4-4 4 4M8 16l4 4 4-4" /> }
        @case ('play') { <path d="m8 4 12 8-12 8z" /> }
        @case ('arrow-left') { <path d="M20 12H4m6-6-6 6 6 6" /> }
        @case ('arrow-right') { <path d="M4 12h16m-6-6 6 6-6 6" /> }
        @case ('new-file') {
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5M12 12v6m-3-3h6" />
        }
        @case ('folder-open') {
          <path d="M3 7h7l2 2h9l-2 10H5z" />
          <path d="M3 7v12h2" />
        }
        @case ('export') {
          <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" />
          <path d="M5 13v7h14v-7" />
        }
        @case ('save') {
          <path d="M5 3h12l2 2v16H5z" />
          <path d="M8 3v6h8V3M8 21v-7h8v7" />
        }
        @case ('settings') {
          <path d="M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M6 14v6" />
        }
        @case ('artifact') {
          <path d="M4 5h16v14H4z" />
          <circle cx="9" cy="10" r="2" />
          <path d="m5 17 4-4 3 3 2-2 5 4" />
        }
        @case ('logs') {
          <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
        }
        @case ('undo') {
          <path d="m9 7-5 5 5 5" />
          <path d="M5 12h8a6 6 0 0 1 6 6" />
        }
        @case ('redo') {
          <path d="m15 7 5 5-5 5" />
          <path d="M19 12h-8a6 6 0 0 0-6 6" />
        }
        @case ('restart') {
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M18.2 12A7 7 0 0 0 6.4 7.1L4 9M5.8 12a7 7 0 0 0 11.8 4.9L20 15" />
        }
        @case ('help') {
          <circle cx="12" cy="12" r="9" />
          <path d="M9.8 9a2.4 2.4 0 1 1 3.1 2.3c-.9.4-.9 1-.9 1.7" />
          <path d="M12 17h.01" />
        }
        @case ('sun') {
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        }
        @case ('more') {
          <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
        }
        @case ('moon') {
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
        }
        @case ('theme-auto') {
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" stroke="none" />
        }
        @case ('window') {
          <rect x="3" y="6" width="13" height="13" rx="2" />
          <path d="M8 6V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3" />
        }
        @case ('branch') {
          <circle cx="6" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="7" r="2" />
          <path d="M6 7v10M18 9c0 5-6 4-11 8.5" />
        }
        @case ('history') {
          <path d="M4 5v5h5M5.2 9.5A8 8 0 1 1 4 14" />
          <path d="M12 7v5l3 2" />
        }
        @case ('check') {
          <path d="m5 12 4 4L19 6" />
        }
        @case ('edit') {
          <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
        }
        @case ('pointer') {
          <path d="m6 3 12 9-6 1 3 6-3 2-3-6-4 4z" />
        }
        @case ('zoom-out') {
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 21 21M7.5 10.5h6" />
        }
        @case ('zoom-in') {
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 21 21M7.5 10.5h6M10.5 7.5v6" />
        }
        @case ('plus') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('minus') {
          <path d="M5 12h14" />
        }
        @case ('image') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="2" />
          <path d="m4 18 5-5 3 3 2-2 6 5" />
        }
        @case ('link') {
          <path d="M10 13a4 4 0 0 0 5.7.1l2.1-2.1a4 4 0 0 0-5.7-5.7L11 6.4" />
          <path d="M14 11a4 4 0 0 0-5.7-.1L6.2 13a4 4 0 0 0 5.7 5.7l1.1-1.1" />
        }
        @case ('widget') {
          <path d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="9" cy="6" r="2" fill="white" />
          <circle cx="15" cy="12" r="2" fill="white" />
          <circle cx="11" cy="18" r="2" fill="white" />
        }
        @case ('copy') {
          <rect x="8" y="8" width="11" height="12" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
        }
        @case ('inspect') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16M18 9h.01M18 13h.01" />
        }
        @case ('grid') {
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
        }
        @case ('split') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M12 4v16M7 8h2M15 8h2M15 12h2" />
        }
        @case ('sidebar') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        }
        @case ('panel-right-open') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16m-5-11-3 3 3 3" />
        }
        @case ('panel-right-close') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16m-7-11 3 3-3 3" />
        }
        @case ('swap-horizontal') {
          <path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4 4-4-4 4-4" />
        }
        @case ('trash') {
          <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
        }
        @case ('graph') {
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="8" r="2" />
          <circle cx="9" cy="18" r="2" />
          <path d="m8 6 8 2M7 8l2 8m2-1 5-5" />
        }
        @case ('search') { <circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /> }
        @case ('code') {
          <path d="m9 7-5 5 5 5m6-10 5 5-5 5" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiIconComponent {
  @Input({ required: true }) name!: UiIconName;
}
