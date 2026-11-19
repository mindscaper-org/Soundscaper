/* SPDX-License-Identifier: AGPL-3.0-only */

import { yieldPixelFrameTaskV1 } from './pixel-frame-task-yield-v1.ts';
/** Cheap display copies use the existing byte-kernel/histogram 256 KiB span.
 * The repair solver keeps its own smaller operation budget. Host tasks retain
 * cancellation; native scheduler continuations avoid nested timer delay.
 * Unsupported hosts retain the real timer fallback. */
export class PhotoDevelopDisplayTaskBudgetV1 {
	#pixels = 0;
	constructor(readonly check: () => void) {}
	visit(): boolean {
		this.#pixels++;
		if (this.#pixels < 65_536) return false;
		this.#pixels = 0; return true;
	}
	async yield(): Promise<void> {
		this.check(); await yieldPixelFrameTaskV1(); this.check();
	}
}
