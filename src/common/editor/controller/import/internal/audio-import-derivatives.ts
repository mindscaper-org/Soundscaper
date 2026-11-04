/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorControllerLifetime, EditorProjectToken } from '../../shared/lifecycle.ts';
import type { generateStoredWaveformPeaks, WaveformPeaks } from '../../source/waveform-analysis.ts';

type StoredWaveformSource = Parameters<typeof generateStoredWaveformPeaks>[1];

interface AudioDerivativeSource {
	readonly id: string;
	readonly storageKey?: string;
	readonly contentSha256?: string;
}

export interface AudioImportDerivativeRequest {
	readonly source: AudioDerivativeSource;
	readonly projectToken: EditorProjectToken;
	readonly channels?: Float32Array[];
	readonly storedSource?: StoredWaveformSource;
	readonly peaks?: WaveformPeaks;
}

interface AudioImportDerivativeOptions {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly getProject: () => Readonly<{ sources?: readonly AudioDerivativeSource[] }> | null;
	readonly protectedSourceIds: Set<string>;
	readonly sourcePeaks: Pick<Map<string, unknown>, 'set'>;
	readonly peakCacheKey: (id: string) => string;
	readonly generatePeaks: (channels: Float32Array[], signal: AbortSignal) => Promise<WaveformPeaks>;
	readonly generateStoredPeaks?: (source: StoredWaveformSource, signal: AbortSignal) => Promise<WaveformPeaks>;
	readonly store: Readonly<{ saveAnalysis(key: string, peaks: WaveformPeaks): PromiseLike<unknown> }>;
	readonly publish: () => void;
}

/** Analysis never holds an import busy claim or mutates its committed history. */
export function createAudioImportDerivativeScheduler(options: AudioImportDerivativeOptions) {
	const pending = new Set<Promise<void>>();
	let tail = Promise.resolve();
	return { schedule, whenIdle: async () => { await Promise.all([...pending]); } };

	function schedule(request: AudioImportDerivativeRequest): void {
		const task = options.lifetime.startTask(`audio-import-derivatives:${request.source.id}`, { scope: 'project' });
		const assertCurrent = (): void => {
			task.assertCurrent();
			options.assertProject(request.projectToken);
			const source = options.getProject()?.sources?.find(value => value.id === request.source.id);
			if (!source || source.contentSha256 !== request.source.contentSha256
				|| (source.storageKey || source.id) !== (request.source.storageKey || request.source.id)) {
				throw new DOMException('The imported audio source is no longer current.', 'AbortError');
			}
		};
		options.protectedSourceIds.add(request.source.id);
		const operation = tail.then(async () => {
			try {
				await new Promise<void>(resolve => { setTimeout(resolve, 0); });
				assertCurrent();
				const peaks = request.peaks ?? (request.channels
					? await options.generatePeaks(request.channels, task.signal)
					: request.storedSource && options.generateStoredPeaks
						? await options.generateStoredPeaks(request.storedSource, task.signal) : null);
				assertCurrent();
				if (!peaks) return;
				options.sourcePeaks.set(request.source.id, peaks);
				options.publish();
				await options.store.saveAnalysis(options.peakCacheKey(request.source.id), peaks);
			} catch { /* Retired sources and optional analysis failures preserve the playable import. */ }
			finally { options.protectedSourceIds.delete(request.source.id); task.finish(); }
		});
		tail = operation;
		pending.add(operation);
		void operation.finally(() => { pending.delete(operation); });
	}
}
