import { describe, expect, it } from 'vitest';
import { fitWithin, LOGO_MAX_HEIGHT, LOGO_MAX_WIDTH } from './shrinkLogo';

const fit = (w: number, h: number) => fitWithin(w, h, LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT);

describe('fitWithin', () => {
  it('leaves an image that already fits alone', () => {
    expect(fit(400, 100)).toEqual({ width: 400, height: 100 });
  });

  it('never scales up', () => {
    expect(fit(20, 10)).toEqual({ width: 20, height: 10 });
  });

  it('shrinks a tall image to the height limit, keeping its shape', () => {
    expect(fit(4000, 4000)).toEqual({ width: 240, height: 240 });
  });

  it('shrinks a very wide wordmark to the width limit', () => {
    expect(fit(6000, 300)).toEqual({ width: 1200, height: 60 });
  });
});
