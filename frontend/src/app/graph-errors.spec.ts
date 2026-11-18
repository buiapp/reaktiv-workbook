import { graphErrors } from './graph-errors';
import type { CellResult } from './sheet.types';

const failed = (id: string, origin?: string): CellResult => ({id, display: '', value: null, valueType: 'error', error: `Failure in ${id}`, ...(origin ? {errorDetail: {origin}} : {})});

describe('graph error provenance', () => {
  it('distinguishes independent errors and resolves chains to the reported origin', () => {
    const errors = graphErrors([failed('A1'), failed('B1', 'A1'), failed('C1', 'B1'), failed('D1'), {id: 'E1', display: '2', value: 2, valueType: 'int', error: null}]);
    expect(errors.get('A1')).toEqual({message: 'Failure in A1', origin: 'A1'});
    expect(errors.get('C1')?.origin).toBe('A1');
    expect(errors.get('D1')?.origin).toBe('D1');
    expect(errors.has('E1')).toBe(false);
  });

  it('keeps externally reported origins and handles cyclic provenance without inventing a root', () => {
    const errors = graphErrors([failed('A1', 'Remote!B1'), failed('B1', 'C1'), failed('C1', 'B1'), failed('D1', 'D1')]);
    expect(errors.get('A1')?.origin).toBe('Remote!B1');
    expect(errors.get('B1')?.origin).toBeNull();
    expect(errors.get('C1')?.origin).toBeNull();
    expect(errors.get('D1')?.origin).toBe('D1');
  });
});
