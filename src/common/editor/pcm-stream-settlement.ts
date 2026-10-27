/* SPDX-License-Identifier: AGPL-3.0-only */

/** Retire completed sink acknowledgements while retaining the first refusal. */
export function createPcmStreamSettlement(): {
	track(write: PromiseLike<void>): void;
	settled(): Promise<void>;
} {
	const pending = new Set<Promise<void>>();
	let failed = false;
	let reason: unknown;
	return {
		track(write) {
			const receipt = Promise.resolve(write);
			pending.add(receipt);
			void receipt.then(() => { pending.delete(receipt); }, (error: unknown) => {
				if (!failed) { failed = true; reason = error; }
				pending.delete(receipt);
			});
		},
		async settled() {
			if (failed) throw reason;
			await Promise.all(pending);
			if (failed) throw reason;
		},
	};
}
