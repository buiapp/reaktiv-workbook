import { RichOutputCache } from './rich-output-cache';
const full = (key: string, data = 'abcd') => ({outputCacheVersion:1,cells:[{id:'A1',richOutput:{cacheKey:key,mimeType:'test',dataBase64:data}}]});
const ref = (key: string) => ({cells:[{id:'A1',richOutput:{cacheKey:key}}]});
describe('rich output transport cache', () => {
  it('hydrates references and shares immutable content across skipped progress frames', () => {
    const cache=new RichOutputCache();
    const first=cache.decode(full('a'));
    const next=cache.decode(ref('a')) as unknown as typeof first;
    expect(next.cells[0].richOutput).toBe(first.cells[0].richOutput);
    expect(next.cells[0].richOutput.dataBase64).toBe('abcd');
    expect(cache.supported).toBe(true);
    cache.clear();expect(cache.lease().keys).toEqual([]);
    expect(()=>cache.decode(ref('a'))).toThrow('unavailable');
  });
  it('pins announced entries across concurrent responses and bounds retained data', () => {
    const cache=new RichOutputCache(8,2);
    cache.decode(full('a'));cache.decode(full('b'));
    const lease=cache.lease();
    cache.decode(full('c')); // returned in full, but cannot displace in-flight references
    expect(cache.decode(ref('a')).cells[0].richOutput).toEqual({mimeType:'test',dataBase64:'abcd'});
    expect(()=>cache.decode(ref('c'))).toThrow();
    lease.release();lease.release();
    cache.decode(full('c'));
    expect(cache.lease().keys).toHaveLength(2);
    expect(()=>cache.decode(ref('a'))).toThrow();
  });
});

it('rotates a saturated cache only after all advertised keys are released',()=>{
 const cache=new RichOutputCache(8,2);cache.decode(full('a'));cache.decode(full('b'));
 const first=cache.lease(), second=cache.lease();cache.decode(full('c'));
 first.release();expect(cache.decode(ref('a')).cells[0].richOutput).toBeTruthy();
 second.release();const next=cache.lease();cache.decode(full('c'));next.release();
 expect(cache.lease().keys).toContain('c');
});

it('an old lease cannot unpin a new connection with identical content keys',()=>{
 const cache=new RichOutputCache(4,1);cache.decode(full('a'));const old=cache.lease();
 cache.clear();cache.decode(full('a'));const current=cache.lease();old.release();
 cache.decode(full('b'));expect(cache.decode(ref('a')).cells[0].richOutput).toBeTruthy();
 current.release();
});
