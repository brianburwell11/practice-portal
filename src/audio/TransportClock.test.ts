import { describe, expect, it } from 'vitest';
import { TransportClock } from './TransportClock';

function setup(latency: number) {
  const ctx = { currentTime: 100 };
  const clock = new TransportClock(ctx as unknown as AudioContext, () => latency);
  clock.duration = 300;
  return { ctx, clock };
}

describe('TransportClock.audibleTime', () => {
  it('trails currentTime by the latency during playback', () => {
    const { ctx, clock } = setup(0.2);
    clock.seek(10);
    clock.play();
    ctx.currentTime += 1;
    expect(clock.currentTime).toBeCloseTo(11);
    expect(clock.audibleTime).toBeCloseTo(10.8);
  });

  it('holds at the start point until the first sound reaches the ear', () => {
    const { ctx, clock } = setup(0.2);
    clock.seek(10);
    clock.play();
    ctx.currentTime += 0.1;
    expect(clock.audibleTime).toBe(10);
    ctx.currentTime += 1;
    clock.seek(50);
    ctx.currentTime += 0.1;
    expect(clock.audibleTime).toBe(50);
  });

  it('does not jump back when the tempo changes mid-song', () => {
    const { ctx, clock } = setup(0.2);
    clock.play();
    ctx.currentTime += 5;
    const before = clock.audibleTime;
    clock.setTempoRatio(0.5);
    expect(before).toBeCloseTo(4.8);
    // Rebased at 5 s; the 0.2 s still in the pipe now covers 0.1 s of song
    expect(clock.audibleTime).toBeCloseTo(4.9);
    expect(clock.audibleTime).toBeLessThan(clock.currentTime);
  });

  it('scales the trail by tempo', () => {
    const { ctx, clock } = setup(0.2);
    clock.setTempoRatio(0.5);
    clock.play();
    ctx.currentTime += 2;
    expect(clock.audibleTime).toBeCloseTo(0.9);
  });

  it('wraps an A/B loop on the shifted time', () => {
    const { ctx, clock } = setup(0.2);
    clock.seek(5);
    clock.setLoop({ start: 5, end: 7 });
    clock.play();
    ctx.currentTime += 2.1; // raw 7.1 wraps to 5.1; heard 6.9
    expect(clock.currentTime).toBeCloseTo(5.1);
    expect(clock.audibleTime).toBeCloseTo(6.9);
  });

  it('equals currentTime when paused or with no latency', () => {
    const { ctx, clock } = setup(0.2);
    clock.play();
    ctx.currentTime += 3;
    clock.pause();
    expect(clock.audibleTime).toBe(clock.currentTime);

    const none = setup(0);
    none.clock.play();
    none.ctx.currentTime += 3;
    expect(none.clock.audibleTime).toBe(none.clock.currentTime);
  });
});
