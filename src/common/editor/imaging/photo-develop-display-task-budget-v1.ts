/* SPDX-License-Identifier: AGPL-3.0-only */

/** Cheap display copies use the existing byte-kernel/histogram 256 KiB span.
 * The repair solver keeps its own smaller operation budget. Real timer tasks
 * preserve cancellation; avoiding excessive nested timers also avoids their
 * minimum-delay accumulation: https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers */
export class PhotoDevelopDisplayTaskBudgetV1 {
	#pixels = 0;
	constructor(readonly check: () => void) {}
	visit(): boolean {
		this.#pixels++;
		if (this.#pixels < 65_536) return false;
		this.#pixels = 0; return true;
	}
	async yield(): Promise<void> {
		this.check(); await new Promise<void>(resolve => { setTimeout(resolve, 0); }); this.check();
	}
}
