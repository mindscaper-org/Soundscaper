/* SPDX-License-Identifier: AGPL-3.0-only */
import type { RecordingRecoveryJournal } from '../../../storage/recording-recovery-journal-repository.ts';

export interface RecordingRecoverySourceValidationPort {
	getMetadata(sourceId: string): PromiseLike<Readonly<Record<string, unknown>> | null>;
	chunks(sourceId: string, options?: Readonly<{ expectedSource?: Readonly<Record<string, unknown>> }>): AsyncIterable<Readonly<{ frames: number; channels: readonly Float32Array[] }>>;
}
class RecordingCheckpointUnavailableError extends Error {
	constructor() { super('A saved recording checkpoint is missing, truncated or has invalid metadata.'); this.name = 'RecordingCheckpointUnavailableError'; }
}

/** Validate checkpoint bodies before building a target; only the final checkpoint may be lost. */
export async function validateOrdinaryRecordingRecoveryPrefix(journal: RecordingRecoveryJournal, sources: RecordingRecoverySourceValidationPort) {
	let lostCheckpointCount = 0;
	const lanes = [];
	for (const lane of journal.lanes) {
		const segments = [];
		for (const [index, segment] of lane.segments.entries()) {
			// Storage admission errors remain fatal even when the final source is absent.
			const metadata = await sources.getMetadata(segment.sourceId);
			try {
				if (!metadata || metadata.frameCount !== segment.frameCount || metadata.sampleRate !== lane.destination.sampleRate
					|| !Number.isSafeInteger(metadata.channelCount) || Number(metadata.channelCount) < 1) throw new RecordingCheckpointUnavailableError();
				let frames = 0;
				for await (const chunk of sources.chunks(segment.sourceId, { expectedSource: metadata })) {
					if (!Number.isSafeInteger(chunk.frames) || chunk.frames < 1 || chunk.channels.length !== metadata.channelCount
						|| chunk.channels.some((channel) => channel.length !== chunk.frames)) throw new RecordingCheckpointUnavailableError();
					frames += chunk.frames;
					if (frames > segment.frameCount) throw new RecordingCheckpointUnavailableError();
				}
				if (frames !== segment.frameCount) throw new RecordingCheckpointUnavailableError();
				segments.push(segment);
			} catch (error) {
				if (index !== lane.segments.length - 1 || !isFinalCheckpointCorruption(error)) throw error;
				lostCheckpointCount += 1;
			}
		}
		lanes.push({ ...lane, segments });
	}
	return Object.freeze({ journal: Object.freeze({ ...journal, lanes: Object.freeze(lanes) }), lostCheckpointCount });
}
function isFinalCheckpointCorruption(error: unknown): boolean {
	if (!(error instanceof Error) || error instanceof AggregateError) return false;
	if (error.name === 'RecordingCheckpointUnavailableError' || error.name === 'PcmStorageCorruptionError' || error.name === 'NotFoundError') return true;
	return /^(?:The requested (?:local )?audio source could not be found\.|The requested local audio source is missing\.|The local audio source is truncated\.|The local audio source contains an invalid chunk\.|Source storage chunk \d+ (?:is missing|does not exist)\.)$/u.test(error.message);
}
