import { placeInView } from './keep-in-view';

describe('placeInView', () => {
  const viewport = { width: 1000, height: 700 };

  it('opens at the pointer when the menu fits', () => {
    expect(placeInView(100, 200, 180, 300, viewport)).toEqual({ left: 100, top: 200 });
  });

  it('opens above / to the left of the pointer near the bottom / right edge', () => {
    expect(placeInView(950, 600, 180, 300, viewport)).toEqual({ left: 770, top: 300 });
  });

  it('is pushed inside when it fits neither below nor above', () => {
    expect(placeInView(100, 300, 180, 500, viewport)).toEqual({ left: 100, top: 192 });
    expect(placeInView(100, 300, 180, 900, viewport)).toEqual({ left: 100, top: 8 });
  });
});
