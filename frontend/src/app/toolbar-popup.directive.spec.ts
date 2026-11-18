import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { ToolbarPopupDirective } from './toolbar-popup.directive';

@Component({schemas: [CUSTOM_ELEMENTS_SCHEMA], imports: [ToolbarPopupDirective], template: `<div class="app-shell">
  <section appToolbarPopup="popup" class="popup"></section>
  <div appToolbarPopup="backdrop"><section class="settings-dialog"></section></div>
  <dialog appToolbarPopup="dialog"></dialog>
  <footer class="statusbar"></footer>
  @if (logs()) { <section class="logs-panel"></section> }
  @if (console()) { <app-debug-console></app-debug-console> }
</div>`})
class Host { readonly logs = signal(false); readonly console = signal(false); }

afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('constrains menus and modal content above open docks, tracks resizing and restores space on close', async () => {
  const resized: ResizeObserverCallback[] = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resized.push(callback); }
    observe() {} disconnect() {}
  });
  let dockTop = 420;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return { top: this.matches('.statusbar') ? 740 : this.matches('.logs-panel, app-debug-console') ? dockTop : 56 } as DOMRect;
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges(); await fixture.whenStable();
  const popup: HTMLElement = fixture.nativeElement.querySelector('.popup');
  const modal: HTMLElement = fixture.nativeElement.querySelector('.settings-dialog');
  const dialog: HTMLElement = fixture.nativeElement.querySelector('dialog');
  expect(popup.style.maxHeight).toBe('676px');
  fixture.componentInstance.logs.set(true); fixture.detectChanges(); await fixture.whenStable();
  expect(popup.style.maxHeight).toBe('356px');
  expect(modal.style.maxHeight).toBe('364px');
  expect(modal.style.minHeight).toBe('0px');
  expect(modal.style.boxSizing).toBe('border-box');
  expect(dialog.style.maxHeight).toBe('404px');
  dockTop = 300;
  for (const callback of resized) callback([], {} as ResizeObserver);
  expect(popup.style.maxHeight).toBe('236px');
  fixture.componentInstance.logs.set(false); fixture.componentInstance.console.set(true);
  fixture.detectChanges(); await fixture.whenStable();
  expect(popup.style.maxHeight).toBe('236px');
  fixture.componentInstance.console.set(false); fixture.detectChanges(); await fixture.whenStable();
  expect(popup.style.maxHeight).toBe('676px');
});
