/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioPreviewProject } from '../../../engine/audio-preview-project.ts';
import { EDITOR_PROJECT_TASK_SCOPE, type EditorControllerLifetime } from '../../shared/lifecycle.ts';
import type { TakeCompPreviewEngine } from './take-comp/take-comp-preview-service.ts';

export function createDialogueAlignmentPreview(lifetime: EditorControllerLifetime,
	createEngine: (options: { onState(state: string): void }) => TakeCompPreviewEngine, stopPlayback: () => Promise<void>,
	createBuffer: (audio: { sampleRate: number; channels: Float32Array[] }) => Promise<AudioBuffer>) {
	let engine: TakeCompPreviewEngine | null = null, generation = 0;
	let release: (() => void) | null = null;
	return { play, stop };
	async function stop(): Promise<void> {
		generation++;
		const previous = engine; engine = null;
		previous?.stop?.(); release?.(); release = null;
		await previous?.dispose?.();
	}
	async function play(audio: { sampleRate: number; channels: Float32Array[] }, assertCurrent: () => void): Promise<void> {
		await stop();
		const request = ++generation;
		const task = lifetime.startTask('dialogue-alignment-preview', { scope: EDITOR_PROJECT_TASK_SCOPE });
		const abort = (): void => { if (generation === request) engine?.stop?.(); };
		task.signal.addEventListener('abort', abort, { once: true });
		release = () => { task.signal.removeEventListener('abort', abort); task.finish(); };
		try {
			await stopPlayback(); task.assertCurrent(); assertCurrent();
			if (generation !== request) throw new DOMException('Preview cancelled.', 'AbortError');
			let started = false;
			engine = createEngine({ onState: state => {
				if (state === 'playing') started = true;
				if (state === 'stopped' && started && generation === request) release?.();
			} });
			const length = audio.channels[0]!.length;
			const project = createAudioPreviewProject({ sampleRate: audio.sampleRate, sources: [{ id: 'preview-source', storageKey: 'preview-source',
				name: 'Dialogue preview', sampleRate: audio.sampleRate, channelCount: audio.channels.length, frameCount: length }],
				clips: [{ id: 'preview-clip', sourceId: 'preview-source', timelineStartFrame: 0, durationFrames: length, sourceStartFrame: 0, sourceDurationFrames: length }],
				tracks: [{ id: 'preview-track', clipIds: ['preview-clip'] }] });
			const buffer = await createBuffer(audio); task.assertCurrent(); assertCurrent();
			engine.loadProject(project, new Map([['preview-source', buffer]]));
			engine.setPlayRange?.({ startFrame: 0, endFrame: length });
			await engine.play(); task.assertCurrent(); assertCurrent();
		} catch (cause) { if (generation === request) await stop(); throw cause; }
	}
}
