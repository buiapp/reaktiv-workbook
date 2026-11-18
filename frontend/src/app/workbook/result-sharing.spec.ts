import { shareCellResults } from './result-sharing';
import type {CellResult} from '../sheet.types';
it('retains equal nested output identities while preserving changed values, metadata and deletions',()=>{
 const original={id:'A1',value:[[1,2]],display:'table',valueType:'list',error:null,outputPreparationMs:1,
  table:{rows:[[1,2]],columns:['x','y']}} as unknown as CellResult;
 const same=JSON.parse(JSON.stringify(original));
 expect(shareCellResults([original],[same])[0]).toBe(original);
 const timed={...same,outputPreparationMs:2};const next=shareCellResults([original],[timed])[0];
 expect(next.outputPreparationMs).toBe(2);expect(next.table).toBe(original.table);expect(next.value).toBe(original.value);
 expect(shareCellResults([original],[])).toEqual([]);
 const changed={...same,value:[[3,4]],table:{...same.table,rows:[[3,4]]}};
 const update=shareCellResults([original],[changed])[0];
 expect(update.value).toEqual([[3,4]]);expect(update.table).not.toBe(original.table);
});
