import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { firstSupportedImage } from './embedded-image';
import { ProseKitBlockEditorComponent } from './prosekit-block-editor.component';

describe('ProseKit block dialogs', () => {
  it('creates a custom-sized table without a browser prompt', async () => {
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
    await TestBed.configureTestingModule({
      imports: [ProseKitBlockEditorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProseKitBlockEditorComponent);
    fixture.componentRef.setInput('source', '');
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.querySelector('.ProseMirror')).not.toBeNull(),
    );
    const prompt = vi.spyOn(window, 'prompt');

    (
      fixture.componentInstance as unknown as {
        openTableDialog(): void;
      }
    ).openTableDialog();
    fixture.detectChanges();
    const inputs = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      '.editor-dialog input',
    );
    inputs[0].value = '4';
    inputs[0].dispatchEvent(new Event('input'));
    inputs[1].value = '5';
    inputs[1].dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.dialog-actions .primary') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(prompt).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('.ProseMirror table tr')).toHaveLength(4);
    expect(
      fixture.nativeElement.querySelectorAll('.ProseMirror table tr:first-child th'),
    ).toHaveLength(5);
    expect(fixture.nativeElement.querySelector('.editor-dialog')).toBeNull();
  });

  it('inserts a Markdown link without using a browser prompt', async () => {
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
    await TestBed.configureTestingModule({
      imports: [ProseKitBlockEditorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProseKitBlockEditorComponent);
    fixture.componentRef.setInput('source', 'Links');
    let source = '';
    fixture.componentInstance.sourceChange.subscribe((value) => (source = value));
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.querySelector('.ProseMirror')).not.toBeNull(),
    );

    fixture.componentInstance.openLinkDialog();
    fixture.detectChanges();
    const inputs = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      '.link-dialog input',
    );
    inputs[0].value = 'OpenAI';
    inputs[0].dispatchEvent(new Event('input'));
    inputs[1].value = 'openai.com';
    inputs[1].dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.link-dialog .primary') as HTMLButtonElement).click();

    expect(source).toContain('[OpenAI](https://openai.com/)');
  });

  it('restores and changes image dimensions through the image context menu', async () => {
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
    await TestBed.configureTestingModule({
      imports: [ProseKitBlockEditorComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProseKitBlockEditorComponent);
    fixture.componentRef.setInput(
      'source',
      '![chart](https://example.com/chart.png "reaktiv-size:480x270")',
    );
    let source = '';
    fixture.componentInstance.sourceChange.subscribe((value) => (source = value));
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.querySelector('.ProseMirror img')).not.toBeNull(),
    );
    const image = fixture.nativeElement.querySelector('.ProseMirror img') as HTMLImageElement;
    expect(image.getAttribute('width')).toBe('480');
    expect(image.getAttribute('height')).toBe('270');

    image.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }),
    );
    fixture.detectChanges();
    const small = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.image-size-presets button',
      ),
    ].find((button) => button.textContent?.trim() === 'Small');
    small?.click();

    expect(source).toContain('"reaktiv-size:240x135"');
  });
});

describe('pasted note image persistence', () => {
  it('stores HTML clipboard images as assets instead of publishing temporary blob URLs', async () => {
    Object.defineProperty(Element.prototype, 'getAnimations', {configurable:true,value:()=>[]});
    await TestBed.configureTestingModule({imports:[ProseKitBlockEditorComponent]}).compileComponents();
    const fixture=TestBed.createComponent(ProseKitBlockEditorComponent);
    fixture.componentRef.setInput('source','');
    let source='';
    fixture.componentInstance.sourceChange.subscribe(value=>source=value);
    fixture.detectChanges();
    await vi.waitFor(()=>expect(fixture.nativeElement.querySelector('.ProseMirror')).not.toBeNull());
    const url=URL.createObjectURL(new Blob(['image bytes'],{type:'image/png'}));
    try {
      const event=new Event('paste',{bubbles:true,cancelable:true});
      Object.defineProperty(event,'clipboardData',{value:{files:[],items:[],types:['text/html'],getData:(type:string)=>type==='text/html'?`<p>Clipboard image</p><img src="${url}">`:''}});
      fixture.nativeElement.querySelector('.ProseMirror').dispatchEvent(event);
      await vi.waitFor(()=>expect(source).toMatch(/!\[\]\(assets\/[0-9a-f]{16}\.png\)/));
      expect(source).toContain('Clipboard image');
      expect(source).not.toContain('blob:');
    } finally {URL.revokeObjectURL(url);fixture.destroy();}
  });
});

it('accepts clipboard image items even when the FileList is empty',()=>{
  const file=new File(['bytes'],'clipboard.png',{type:'image/png'});
  const items=[{kind:'file',type:'image/png',getAsFile:()=>file}] as unknown as DataTransferItemList;
  expect(firstSupportedImage(undefined,items)).toBe(file);
});
