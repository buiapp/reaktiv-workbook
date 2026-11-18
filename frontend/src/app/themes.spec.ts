import { themes, importThemes } from './themes';

describe('JSON themes',()=>{
  afterEach(()=>{localStorage.clear(); themes().apply('system');});
  it('applies built-ins, restores original colours and follows system',()=>{
    expect(themes().all().map(t=>t.id)).toContain('nord');
    themes().apply('nord');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--theme-paper')).toBe('#2e3440');
    themes().apply('light');
    expect(document.documentElement.style.getPropertyValue('--theme-paper')).toBe('');
    themes().apply('system');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
  });
  it('imports, replaces and persists user palettes by name',()=>{
    const data={name:'Ocean',type:'dark',colors:{'editor.background':'#123456'}};
    importThemes([{name:'ocean.json',text:JSON.stringify(data)}]);
    themes().apply('custom:Ocean');
    expect(document.documentElement.style.getPropertyValue('--theme-paper')).toBe('#123456');
    data.colors['editor.background']='#223344';
    importThemes([{name:'ocean.json',text:JSON.stringify(data)}]);
    expect(themes().all().filter(t=>t.id==='custom:Ocean')).toHaveLength(1);
    themes().apply('custom:Ocean');
    expect(document.documentElement.style.getPropertyValue('--theme-paper')).toBe('#223344');
  });
  it('rejects invalid batches atomically and never accepts CSS or unknown tokens',()=>{
    const valid={name:'Valid',type:'dark',colors:{'editor.background':'#123456'}};
    for (const colors of [{'editor.background':'url(https://example.test)'},{'unsupported':'#123456'}]) {
      expect(()=>importThemes([{name:'valid.json',text:JSON.stringify(valid)},
        {name:'broken.json',text:JSON.stringify({...valid,name:'Broken',colors})}])).toThrow('broken.json');
      expect(themes().all().some(t=>t.id==='custom:Valid')).toBe(false);
    }
    expect(()=>themes().parse('x'.repeat(65537))).toThrow('64 KiB');
    expect(()=>importThemes([{name:'a.json',text:JSON.stringify(valid)},{name:'b.json',text:JSON.stringify(valid)}])).toThrow('unique');
  });
});
