import { CellActivityTracker, markActivity } from './cell-activity';

describe('CellActivityTracker', () => {
  let clock = 0;
  const tracker = () => new CellActivityTracker(() => clock);

  it('marks expected cells pending until each one finishes or the result arrives', () => {
    const activity = tracker();
    activity.expect(['B1', 'B2', 'B3']);
    expect(activity.activity('B1')).toBe('pending');
    activity.progress({ event: 'start', cellId: 'B1' });
    expect(activity.activity('B1')).toBe('running');
    activity.progress({ event: 'end', cellId: 'B1' });
    expect(activity.activity('B1')).toBeNull();
    expect(activity.activity('B2')).toBe('pending');
    activity.settle();
    expect(activity.activity('B2')).toBeNull();
    expect(activity.current()).toBeNull();
  });

  it('shows the innermost cell as running and the one waiting for it as pending', () => {
    const activity = tracker();
    clock = 100;
    activity.progress({ event: 'start', cellId: 'summary' });
    clock = 150;
    activity.progress({ event: 'start', cellId: 'data' });
    expect(activity.activity('data')).toBe('running');
    expect(activity.activity('summary')).toBe('pending');
    expect(activity.current()).toEqual({ id: 'data', since: 150 });
    activity.progress({ event: 'end', cellId: 'data' });
    expect(activity.activity('summary')).toBe('running');
    expect(activity.current()?.since).toBe(100);
  });

  it('marks note values by the cells they read', () => {
    const activity = tracker();
    const root = document.createElement('div');
    root.innerHTML = '<span data-cells="A1 B1"></span><span data-cells="C1"></span><span data-cells=""></span>';
    const [first, second, third] = [...root.querySelectorAll('span')];
    activity.expect(['C1']);
    activity.progress({ event: 'start', cellId: 'B1' });
    markActivity(root, activity.states());
    expect(first.classList.contains('cell-running')).toBe(true);
    expect(second.classList.contains('cell-pending')).toBe(true);
    expect(third.className).toBe('');
    activity.settle();
    markActivity(root, activity.states());
    expect(first.className + second.className).toBe('');
  });
});
