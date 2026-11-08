/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ClipSourceClockRewrite, StageClipSourceClockRewrite } from '../../../clip-source-timing.ts';

/** The native selection and immutable PCM clock publish in the same synchronous turn. */
export function commitSourceFormatRewrite<Result>(stage: StageClipSourceClockRewrite | undefined,
	rewrites: readonly ClipSourceClockRewrite[], commit: () => Result): Result {
	const rollbacks: Array<() => void> = [];
	try {
		if (stage) for (const rewrite of rewrites) rollbacks.push(stage(rewrite));
		return commit();
	} catch (error) {
		for (const rollback of rollbacks.reverse()) rollback();
		throw error;
	}
}
