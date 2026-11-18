import { Directive, ElementRef, OnDestroy, inject, output } from '@angular/core';

/** Activate pane context before a nested control handles a pointer or keyboard event. */
@Directive({ selector: '[appPaneActivation]' })
export class PaneActivationDirective implements OnDestroy {
  readonly paneActivated = output<void>();
  private readonly element = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly activate = () => this.paneActivated.emit();
  constructor() {
    for (const event of ['pointerdown', 'focusin', 'contextmenu']) {
      this.element.addEventListener(event, this.activate, true);
    }
  }
  ngOnDestroy(): void {
    for (const event of ['pointerdown', 'focusin', 'contextmenu']) {
      this.element.removeEventListener(event, this.activate, true);
    }
  }
}
