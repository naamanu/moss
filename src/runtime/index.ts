// Core Moss runtime, imported by every compiled program: the standard
// library's externals plus helpers the generated code uses (lists, equality,
// comparison, integer division, match failure).

import type { Eff } from "./effect.ts";

export * from "./prelude.ts";
export * from "./task.ts";
export { Eff } from "./effect.ts";

/** Run a program's `main : unit effect`. */
export function runMain(main: Eff): void {
  main.run();
}
