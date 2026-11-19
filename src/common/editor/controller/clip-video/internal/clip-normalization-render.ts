/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipTimePitchPlaybackProjection } from '../../../clip-time-pitch-playback-projection.ts';
import { rackEffectChannelCount } from '../../../rack-effect-channel-width.ts';
import { createAudioPreviewProject } from '../../../engine/audio-preview-project.ts';
import type { EnginePublicApi } from '../../../engine/public-api.ts';
import { clipSourcePreviewWarpMap, type ClipSourceTimingProject } from '../../../clip-source-timing.ts';
import { audioBufferChannels, type AudioBufferLike } from '../../source/source-audio.ts';
import type { ClipSourcePreviewResources } from './clip-source-preview-service.ts';
import type { ClipTransformClip, ClipTransformProject } from './clip/clip-domain-types.ts';
import { clipNormalizationControlProject } from './clip-normalization-controls.ts';

/** Measure the authored clip at unity gain, independently of its track and master. */
export async function renderClipNormalizationAudio(
	resources: Pick<ClipSourcePreviewResources, 'createEngine' | 'sourceChunkProviders' | 'prepare'> & Partial<Pick<ClipSourcePreviewResources, 'sourceBuffers'>>,
	project: ClipTransformProject,
	clip: ClipTransformClip,
	buffer: AudioBufferLike | null,
	signal: AbortSignal,
): Promise<AudioBufferLike> {
	signal.throwIfAborted();
	const source = project.sources.find(value => value.id === clip.sourceId);
	if (!source) throw new Error('Clip normalization requires its source.');
	const playbackClip = clipTimePitchPlaybackProjection(project, clip, source);
	const channelCount = buffer?.numberOfChannels ?? Number(source.channelCount);
	if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 32) throw new RangeError('Clip normalization requires a supported source channel count.');
	await resources.prepare(project, signal, { clipIds: [clip.id] });
	signal.throwIfAborted();
	const outputChannels = rackEffectChannelCount(project, 'clip', clip.id);
	const preview = { ...createAudioPreviewProject({ sampleRate: project.sampleRate, masterChannels: outputChannels,
		sources: [source], tracks: [{ id: 'clip-normalization', type: 'audio', name: 'Clip', channelCount, clipIds: [clip.id] }],
		clips: [{ ...playbackClip, anchor: 'sample', musicalStartBeat: null, musicalDurationBeats: null, musicalExtent: 'fixedSamples',
			timelineStartFrame: 0, gain: 1, groupId: null, avLinkId: null, binItemId: null,
			warpMap: clipSourcePreviewWarpMap(project as unknown as ClipSourceTimingProject, clip,
				{ sampleRate: Number(source.sampleRate), frameCount: Number(source.frameCount) }),
		}],
	}), tempoMap: (project as unknown as ClipSourceTimingProject).tempoMap };
	const controlled = clipNormalizationControlProject(project, clip, preview, outputChannels);
	if (controlled) await resources.prepare(project, signal, { clipIds: controlled.clipIds });
	signal.throwIfAborted();
	const engine = resources.createEngine({ onState: () => {} });
	try {
		if (!('renderMix' in engine) || typeof engine.renderMix !== 'function') throw new Error('Clip normalization requires an offline audio engine.');
		let nativeBuffer = buffer as AudioBuffer | null;
		const isNativeBuffer = typeof globalThis.AudioBuffer === 'function' && buffer instanceof globalThis.AudioBuffer;
		if (buffer && !isNativeBuffer && 'getAudioContext' in engine && typeof engine.getAudioContext === 'function') {
			const audioEngine = engine as typeof engine & Pick<EnginePublicApi, 'getAudioContext'>;
			const context = await audioEngine.getAudioContext({ resume: false });
			signal.throwIfAborted();
			nativeBuffer = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
			for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) nativeBuffer.getChannelData(channel).set(buffer.getChannelData(channel));
		}
		const buffers = new Map(controlled && resources.sourceBuffers
			? resources.sourceBuffers instanceof Map ? resources.sourceBuffers : Object.entries(resources.sourceBuffers) : []);
		if (nativeBuffer) buffers.set(clip.sourceId, nativeBuffer);
		engine.loadProject(controlled?.project ?? preview, buffers, { chunkSources: resources.sourceChunkProviders });
		const renderEngine = engine as typeof engine & Pick<EnginePublicApi, 'renderMix'>;
		const startFrame = controlled ? playbackClip.timelineStartFrame : 0;
		const output = await renderEngine.renderMix({ startFrame, endFrame: startFrame + playbackClip.durationFrames,
			includeTail: false, includeMaster: false, includeTrackPan: false, preRollFrames: 0, signal });
		signal.throwIfAborted();
		if ('getChannelData' in output) return output;
		const channels = audioBufferChannels(output);
		return { length: channels[0]!.length, numberOfChannels: channels.length, sampleRate: project.sampleRate,
			getChannelData: channel => channels[channel]!,
		};
	} finally { await engine.dispose(); }
}
