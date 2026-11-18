import { scheduleChartDraw } from './chart-draw-queue';
it('serializes charts, yields before each draw and continues after a drawing failure',async()=>{
 const order:string[]=[];let finish!:()=>void;
 const first=scheduleChartDraw(async()=>{order.push('first');await new Promise<void>(r=>finish=r);});
 const second=scheduleChartDraw(async()=>{order.push('second');throw new Error('draw');});
 const failed=expect(second).rejects.toThrow('draw');
 await vi.waitFor(()=>expect(order).toEqual(['first']));finish();await first;await failed;
 await scheduleChartDraw(async()=>{order.push('third');});
 expect(order).toEqual(['first','second','third']);
});
