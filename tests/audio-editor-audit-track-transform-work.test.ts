/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createDerivedSourceService } from '../src/common/editor/controller/track-audio/internal/derived-audio/derived-source-service.ts';
import { createTrackTransformService } from '../src/common/editor/controller/track-audio/internal/track-transform-service.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';

test('resampling a many-clip track to its existing rate resolves clip and source inventories once', async () => {
	const count = 1000;
	const admitted = createSoundscaperProject({ id: 'track-transform-work',
		sources: Array.from({ length: count }, (_, index) => ({ id: `s${index}`, storageKey: `s${index}`,
			name: `Source ${index}`, sampleRate: 48_000, channelCount: 1, frameCount: 64 })),
		clips: Array.from({ length: count }, (_, index) => ({ id: `c${index}`, sourceId: `s${index}`,
			sourceStartFrame: 0, sourceDurationFrames: 64, timelineStartFrame: index * 64, durationFrames: 64 })),
		tracks: [{ id: 'track', clipIds: Array.from({ length: count }, (_, index) => `c${index}`) }],
	});
	assert.ok(validateSoundscaperProject(admitted));
	const runtime = projectForRuntimeConsumers(admitted);
	let clipReads = 0;
	let sourceReads = 0;
	const project = { ...runtime,
		clips: runtime.clips.map(clip => ({ ...clip, get id() { clipReads++; return clip.id; } })),
		sources: runtime.sources.map(source => ({ ...source, get id() { sourceReads++; return source.id; } })),
	} as unknown as ControllerProject;
	const unexpected = (): never => assert.fail('An already matching sample rate must not start rendering, storage, or a command.');
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const derivedSources = createDerivedSourceService({ lifetime, getProject: () => project,
		copy: { effectInvalidAudio: 'Invalid audio' }, store: { beginSourceWrite: unexpected, saveAnalysis: unexpected, deleteSource: unexpected },
		sourceBuffers: new Map(), sourcePeaks: new Map(), sourceChunkFrames: 65_536,
		retireSourceChunkProvider: unexpected, captureProject: unexpected, assertProject: unexpected, createId: unexpected,
		projectSampleRate: () => 48_000, getAudioContext: unexpected, createBufferFromChannels: unexpected,
		loadSourceChannels: unexpected, writeBuffer: unexpected, generateWaveformPeaks: unexpected,
		peakCacheKey: unexpected, cacheSourceBuffer: unexpected,
	});
	const transforms = createTrackTransformService({ lifetime, getProject: () => project,
		getSelectedTrackId: () => 'track', editingBlocked: () => false, derivedSources,
		copy: { v2Required: '', audioTrackRequired: '', stereoTrackRequired: '', monoTrackRequired: '',
			compatibleMonoTrackRequired: '', resamplingTrack: '', audacityProcessing: '', rewritingChannels: '',
			done: '', channelsSwapped: '', leftChannel: '', rightChannel: '', stereo: '' },
		captureProject: unexpected, assertProject: unexpected, createId: unexpected, commit: unexpected,
		projectSampleRate: () => 48_000, normalizeProjectSampleRate: Number, audioTrackChannelCount: () => 1,
		preflightStorage: unexpected, setProcessing: unexpected, setStatus: unexpected, publish: unexpected,
		resampleChannels: unexpected, renderDryTrackRange: unexpected,
	});
	assert.equal(await transforms.resampleTrack('track', 48_000), 'track');
	assert.ok(clipReads <= count * 2, `received ${clipReads} clip identity reads`);
	assert.ok(sourceReads <= count * 3, `received ${sourceReads} source identity reads`);
	assert.equal(derivedSources.uniqueClipSources([...project.clips, ...project.clips]).length, count);
});
