// Effects are inert descriptions of work; event handlers and timers run them.
// Running an effect only writes to state vars. The app loop batches all
// writes and stabilizes once per animation frame.

export class Eff<T = unknown> {
  constructor(readonly run: () => T) {}
}

let requestFrame: () => void = () => {};

export function setFrameRequester(f: () => void): void {
  requestFrame = f;
}

/** Run an effect from outside the graph (event, timer) and schedule a frame. */
export function perform(eff: Eff): void {
  eff.run();
  requestFrame();
}

export const none = new Eff(() => undefined);

export function seq(effs: { h: Eff; t: unknown } | null): Eff {
  return new Eff(() => {
    for (let l = effs; l !== null; l = l.t as typeof effs) l.h.run();
  });
}

export function print(s: string): Eff {
  return new Eff(() => console.log(s));
}
