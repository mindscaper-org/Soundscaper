/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingAudioContext,
	RecordingMediaStream,
} from '../../recording-transaction-types.ts';
import { observeMediaInputInterruption, MediaInputLostError } from '../../../shared/media-input-interruption.ts';
import { RecordingInputLossError } from '../../../../recording-input-events.ts';

interface ObservedSource {
	readonly sourceKey: string;
	readonly kind: 'device' | 'display';
	readonly stream: RecordingMediaStream;
}

export function takeCycleRecorderInterruptionError(state: string, sourceKey: string): Error {
	const message = `Take cycle routed recorder ${sourceKey} ${state} unexpectedly.`;
	return state === 'failed' ? new Error(message) : new MediaInputLostError(message);
}

export function handleTakeCycleRecorderFailure(
	error: unknown,
	onInputLost: (loss: MediaInputLostError) => void,
	onFailure: (failure: unknown) => void,
): void {
	if (error instanceof RecordingInputLossError) onInputLost(new MediaInputLostError(error.message, { cause: error }));
	else onFailure(error);
}

/** Own every browser lifetime signal that can invalidate continuous cycle PCM. */
export function observeTakeCycleRoutedCaptureLifetime<Source extends ObservedSource>(options: Readonly<{
	readonly context: RecordingAudioContext;
	readonly sources: readonly Source[];
	isLive(stream: RecordingMediaStream, kind: ObservedSource['kind']): boolean;
	onInterrupted(error: Error, source: Source | null): void;
}>): () => void {
	const removers: Array<() => void> = [];
	let interrupted = false;
	let disposed = false;
	const interrupt = (error: Error, source: Source | null) => {
		if (interrupted || disposed) return;
		interrupted = true;
		try { options.onInterrupted(error, source); }
		catch { /* Failure observers cannot escape the browser lifetime event. */ }
	};
	for (const source of options.sources) {
		removers.push(observeMediaInputInterruption({
			tracks: source.stream.getTracks?.() ?? source.stream.getAudioTracks(),
			onInterrupted: error => interrupt(error, source),
		}));
		if (!options.isLive(source.stream, source.kind)) interrupt(
			new MediaInputLostError(`Take cycle routed input ${source.sourceKey} is disconnected.`), source,
		);
	}
	removers.push(observeMediaInputInterruption({
		context: options.context, onInterrupted: error => interrupt(error, null),
	}));
	return () => {
		if (disposed) return;
		disposed = true;
		for (const remove of removers.splice(0)) remove();
	};
}
