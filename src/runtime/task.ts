// Tasks: inert descriptions of asynchronous work, like effects but producing
// a value later. Running a task takes an AbortSignal, so whoever runs it
// (a `resource`, or `Task.attempt`) can cancel it.

import { Eff } from "./effect.ts";

export class Task<T> {
  constructor(readonly run: (signal: AbortSignal) => Promise<T>) {}
}

/** Thrown by `Task.fail`; its message becomes the `Failed` payload. */
export class TaskError extends Error {}

export const isAbort = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";

const abortError = () => new DOMException("aborted", "AbortError");

export const Task_succeed = <T>(x: T) => new Task(async () => x);

export const Task_fail = (msg: string) =>
  new Task<never>(async () => {
    throw new TaskError(msg);
  });

export const Task_map = <A, B>(f: (a: A) => B, t: Task<A>) => new Task(async (s) => f(await t.run(s)));

export const Task_and_then = <A, B>(f: (a: A) => Task<B>, t: Task<A>) =>
  new Task(async (s) => {
    const a = await t.run(s);
    if (s.aborted) throw abortError();
    return f(a).run(s);
  });

export const Task_sleep = (ms: number) =>
  new Task<undefined>(
    (s) =>
      new Promise((resolve, reject) => {
        if (s.aborted) return reject(abortError());
        const t = setTimeout(() => {
          s.removeEventListener("abort", onAbort);
          resolve(undefined);
        }, ms);
        const onAbort = () => {
          clearTimeout(t);
          reject(abortError());
        };
        s.addEventListener("abort", onAbort, { once: true });
      }),
  );

export const Http_get_text = (url: string) =>
  new Task(async (s) => {
    const r = await fetch(url, { signal: s });
    if (!r.ok) throw new TaskError(`HTTP ${r.status} ${r.statusText}`.trim());
    return r.text();
  });

// Constructor indices (`i`) must match declaration order in the Moss prelude.
export type Remote<T> = { $: "Loading"; i: 0 } | { $: "Loaded"; i: 1; v: T } | { $: "Failed"; i: 2; v: string };

export const Loading: Remote<never> = { $: "Loading", i: 0 };
export const Loaded = <T>(v: T): Remote<T> => ({ $: "Loaded", i: 1, v });
export const Failed = (e: unknown): Remote<never> => ({
  $: "Failed",
  i: 2,
  v: e instanceof Error ? e.message : String(e),
});

/** Run `t` and pass its outcome (`Loaded`/`Failed`) to `k` as an effect. Not cancellable. */
export const Task_attempt = <T>(t: Task<T>, k: (r: Remote<T>) => Eff) =>
  new Eff(() => {
    t.run(new AbortController().signal).then(
      (v) => after(k(Loaded(v))),
      (e) => after(k(Failed(e))),
    );
  });

/** Set by the app loop: perform an effect from async code and schedule a frame. */
let after: (e: Eff) => void = (e) => void e.run();
export function setAsyncPerformer(f: (e: Eff) => void): void {
  after = f;
}
