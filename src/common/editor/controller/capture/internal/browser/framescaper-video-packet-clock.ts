/* SPDX-License-Identifier: AGPL-3.0-only */

/** BlobEvent zero belongs to the first event, after its first chunk was captured. */
export function createFramescaperVideoPacketClock(timesliceMs: number, receiptTime: () => number) {
	let originUs = 0, startedAtMs = 0, previousEndUs = 0, excludedPauseUs = 0;
	let relativeOriginUs: number | null = null;
	return Object.freeze({
		start(value: number): void {
			originUs = integer(value, 'Capture video presentation origin');
			startedAtMs = receipt();
		},
		resume(value: number): void {
			excludedPauseUs = sum(excludedPauseUs, integer(value, 'Capture video excluded pause duration'));
		},
		next(timecode: number | undefined) {
			const receiptTimeMs = receipt();
			let reportedEndUs: number;
			if (typeof timecode === 'number' && Number.isFinite(timecode) && timecode >= 0) {
				const nativeUs = microseconds(timecode);
				if (relativeOriginUs === null) relativeOriginUs = nativeUs === 0
					? Math.max(1, microseconds(Math.max(0, receiptTimeMs - startedAtMs))) : 0;
				reportedEndUs = sum(nativeUs, relativeOriginUs);
			} else reportedEndUs = sum(sum(previousEndUs, excludedPauseUs), timesliceMs * 1000);
			const activeEndUs = Math.max(0, reportedEndUs - excludedPauseUs);
			const endUs = activeEndUs > previousEndUs ? activeEndUs : sum(previousEndUs, timesliceMs * 1000);
			const result = { presentationTimeUs: sum(originUs, previousEndUs), durationUs: endUs - previousEndUs, receiptTimeMs };
			previousEndUs = endUs;
			return result;
		},
	});
	function receipt(): number {
		const value = receiptTime();
		if (!Number.isFinite(value) || value < 0) throw new RangeError('Capture receipt time must be finite and non-negative.');
		return value;
	}
}
function integer(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer.`);
	return value;
}
function sum(left: number, right: number): number {
	return integer(left + right, 'Capture video time');
}
function microseconds(value: number): number {
	return integer(Math.round(value * 1000), 'Capture video time');
}
