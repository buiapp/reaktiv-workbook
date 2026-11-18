import { WorkbookCommandQueue } from './workbook-command-queue';

describe('workbook command queue', () => {
  it('runs moves after an unfinished apply and observes its final state', async () => {
    const queue = new WorkbookCommandQueue();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let value = 'old';
    const apply = queue.run(async () => {
      await held;
      value = 'new';
    });
    const move = queue.run(async () => value);
    await Promise.resolve();
    expect(value).toBe('old');
    release();
    await apply;
    expect(await move).toBe('new');
  });
  it('continues after refusals and cancels queued work on a document switch', async () => {
    const queue = new WorkbookCommandQueue();
    await expect(
      queue.run(async () => {
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    const run = vi.fn(async () => true);
    const pending = queue.run(run);
    queue.reset();
    expect(await pending).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    expect(await queue.run(async () => 42)).toBe(42);
  });
});

it('overlaps action lifetimes but waits for all of them before structural edits', async()=>{
  const queue=new WorkbookCommandQueue();
  let first!:()=>void, second!:()=>void;
  const one=queue.start(()=>new Promise<void>(resolve=>first=resolve));
  const two=queue.start(()=>new Promise<void>(resolve=>second=resolve));
  await vi.waitFor(()=>expect(second).toBeTypeOf('function'));
  const edit=vi.fn(async()=>42), pending=queue.run(edit);
  first();await one;expect(edit).not.toHaveBeenCalled();
  second();await two;expect(await pending).toBe(42);
});
