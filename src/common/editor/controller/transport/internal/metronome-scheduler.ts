/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EngineAudioContext, EngineCutPreviewSegment } from '../../../engine/public-api.ts';
import type { ControllerTransportState } from '../transport-state.ts';
import type { AudioEditorMetronomeSchedule } from '../transport-model.ts';

interface Pulse { readonly when: number; readonly accent: string }

/** A cut joins separate timeline intervals; lookahead must never schedule through its omitted span. */
export function createCutPreviewMetronome() {
	let signature: string | null = null;
	let cursor = 0;
	return Object.freeze({ reset, plan });
	function reset(): boolean {
		const changed = signature !== null;
		signature = null; cursor = 0;
		return changed;
	}
	function plan(segments: readonly EngineCutPreviewSegment[], sampleRate: number, now: number, lookahead: number,
		scheduleAt: (frame: number) => Readonly<AudioEditorMetronomeSchedule>) {
		const key = JSON.stringify(segments);
		const changed = signature !== key;
		if (changed) { signature = key; cursor = segments[0]?.startFrame ?? 0; }
		const pulses: Pulse[] = [];
		let remaining = 64;
		for (const segment of segments) {
			cursor = Math.max(cursor, segment.startFrame,
				segment.startFrame + Math.floor(Math.max(0, now - segment.contextStartTime) * sampleRate));
			while (cursor < segment.endFrame && remaining-- > 0) {
				const pulse = scheduleAt(cursor);
				const frame = Math.round(cursor + pulse.delaySeconds * sampleRate);
				if (frame >= segment.endFrame) { cursor = segment.endFrame; break; }
				const when = segment.contextStartTime + (frame - segment.startFrame) / sampleRate;
				if (when > now + lookahead) return { changed, pulses };
				if (when >= now) pulses.push({ when, accent: pulse.accent ?? (pulse.beatIndex % 4 === 0 ? 'bar' : 'beat') });
				cursor = frame + 1;
			}
		}
		return { changed, pulses };
	}
}

type PendingClicks = Pick<ControllerTransportState, 'metronomePending'>;

export function stopPendingMetronomeClicks(state: PendingClicks): void {
	for (const oscillator of state.metronomePending ?? []) {
		try { oscillator.stop(); } catch { /* Already stopped or never started. */ }
	}
	state.metronomePending = [];
}

/** Click voices share the editor's listening gain and remain cancelable while queued. */
export function emitMetronomeClick(context: EngineAudioContext, destination: AudioNode, state: PendingClicks, when: number, accent: string): void {
	const oscillator = context.createOscillator();
	const gain = context.createGain();
	state.metronomePending = [...(state.metronomePending ?? []), oscillator];
	oscillator.frequency.setValueAtTime(accent === 'bar' ? 1320 : accent === 'group' ? 1100 : 880, when);
	gain.gain.setValueAtTime(0.0001, when);
	gain.gain.exponentialRampToValueAtTime(0.12, when + 0.002);
	gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
	oscillator.connect(gain); gain.connect(destination);
	oscillator.start(when); oscillator.stop(when + 0.04);
	oscillator.onended = () => {
		state.metronomePending = (state.metronomePending ?? []).filter(pending => pending !== oscillator);
		try { oscillator.disconnect(); } catch { /* Already disconnected. */ }
		try { gain.disconnect(); } catch { /* Already disconnected. */ }
	};
}
