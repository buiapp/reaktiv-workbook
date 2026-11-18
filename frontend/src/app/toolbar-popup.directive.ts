import { afterEveryRender, DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

/** Keep toolbar surfaces above the status bar and any open bottom dock. */
@Directive({ selector: '[appToolbarPopup]' })
export class ToolbarPopupDirective {
  readonly appToolbarPopup = input<'popup' | 'backdrop' | 'dialog' | 'none'>('popup');
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;
  private readonly observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.place());
  private docks: HTMLElement[] = [];

  constructor() {
    afterEveryRender(() => {
      if (this.appToolbarPopup() === 'none' || !this.element.getClientRects().length) return;
      const shell = this.element.closest('.app-shell') ?? this.element.parentElement?.querySelector('.app-shell');
      const docks = [...(shell?.querySelectorAll<HTMLElement>(
        '.statusbar, .bottom-dock:not([hidden]), .logs-panel, .artifacts-panel, app-debug-console:not([hidden])',
      ) ?? [])];
      if (docks.length !== this.docks.length || docks.some((dock, i) => dock !== this.docks[i])) {
        this.observer?.disconnect();
        this.docks = docks;
        for (const dock of docks) this.observer?.observe(dock);
        this.observer?.observe(this.element);
      }
      this.place();
    });
    window.addEventListener('resize', this.place);
    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      window.removeEventListener('resize', this.place);
    });
  }

  private readonly place = (): void => {
    const mode = this.appToolbarPopup();
    if (mode === 'none') return;
    const bottom = Math.min(window.innerHeight, ...this.docks.filter(dock => dock.getClientRects().length)
      .map(dock => dock.getBoundingClientRect().top));
    const style = this.element.style;
    if (mode === 'backdrop' || mode === 'dialog') {
      style.bottom = `${window.innerHeight - bottom + 8}px`;
      if (mode === 'dialog') style.top = '8px';
      // Modal containers are centered within the remaining space; their content scrolls.
      const dialog = mode === 'dialog' ? this.element : this.element.querySelector<HTMLElement>('.settings-dialog, .dialog');
      if (dialog) {
        dialog.style.minHeight = '0';
        dialog.style.boxSizing = 'border-box';
        dialog.style.maxHeight = `${Math.max(0, bottom - (mode === 'dialog' ? 16 : 56))}px`;
      }
    } else {
      style.boxSizing = 'border-box';
      style.maxHeight = `${Math.max(0, bottom - this.element.getBoundingClientRect().top - 8)}px`;
      style.overflowY = 'auto';
    }
  };
}
