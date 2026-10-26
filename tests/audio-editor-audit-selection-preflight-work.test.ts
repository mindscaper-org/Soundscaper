/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applyAudacityItemNavigationAction } from '../src/common/editor/audacity-shortcut-actions/item-navigation.ts';
import { prepareSplitRangeIntoNewTrackCommand } from '../src/common/editor/controller/track-audio/split-into-new-track-plan.ts';
import { createAddTrackCommand } from '../src/common/editor/commands/factories.ts';
import { prepareLinkedSplitCommand } from '../src/common/editor/commands/clip-link-runtime.js';
import { renderSimpleDryTrackPcm } from '../src/common/editor/controller/effects/internal/direct-dry-track-pcm.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

function fixture() {
	const count = 500;
	const ids = Array.from({ length: count }, (_, index) => `c${index}`);
	const admitted = createSoundscaperProject({ id: 'selection-preflight',
		sources: Array.from({ length: count }, (_, index) => ({ id: `s${index}`, storageKey: `s${index}`,
			sampleRate: 48_000, channelCount: 2, frameCount: 64 })),
		tracks: [{ id: 'track', clipIds: ids }],
		clips: ids.map((id, index) => ({ id, sourceId: `s${index}`, sourceStartFrame: 0,
			sourceDurationFrames: 32, durationFrames: 32, timelineStartFrame: index * 64 })),
		selection: { startFrame: 0, endFrame: 32, trackIds: ['track'], clipIds: ids },
	});
	assert.ok(validateSoundscaperProject(admitted));
	let clipReads = 0;
	let sourceReads = 0;
	const project = { ...admitted,
		clips: admitted.clips.map(clip => ({ ...clip, get id() { clipReads++; return clip.id; } })),
		sources: admitted.sources.map(source => ({ ...source, get id() { sourceReads++; return source.id; } })),
	};
	return { count, project, get reads() { return clipReads + sourceReads; } };
}

test('keyboard boundary adjustment resolves only the first selected interaction clip', () => {
	const state = fixture();
	const trimmed: string[] = [];
	const unexpected = (): never => assert.fail('This boundary adjustment must only trim its first selected clip.');
	const controller: Parameters<typeof applyAudacityItemNavigationAction>[1] = {
		getSnapshot: () => ({ project: state.project as unknown as ControllerProject, selectedClipId: null,
			selectedTrackId: 'track', timeline: { pixelsPerSecond: 100 } }),
		actions: { clip: { move: unexpected, trim: id => { trimmed.push(id); return 'edited'; } },
			edit: { commit: unexpected }, labels: { update: unexpected }, timeline: { setSelection: unexpected },
			track: { moveUp: unexpected, moveDown: unexpected }, transport: { seek: unexpected } },
	};
	assert.equal(applyAudacityItemNavigationAction('track-view-item-extend-right', controller, null), 'edited');
	assert.deepEqual(trimmed, ['c0']);
	assert.ok(state.reads <= state.count * 3, `received ${state.reads} media identity reads`);
});

test('Split into New Track resolves all selected memberships through one invocation-owned index', () => {
	const state = fixture();
	let sequence = 0;
	const plan = prepareSplitRangeIntoNewTrackCommand({ getProject: () => state.project,
		createStableId: (prefix = 'id') => `${prefix}-${sequence++}`, createAddTrackCommand, prepareLinkedSplitCommand,
	}, { startFrame: 0, endFrame: state.count * 64, trackIds: ['track'] });
	assert.ok(plan);
	assert.equal(plan.command.commands.filter((command: { type: string }) => command.type === 'clip/move').length, state.count);
	assert.ok(state.reads <= state.count * 6, `received ${state.reads} media identity reads`);
});

test('a tiny dry preview prepares wider-route admission with linear inventory work and identical PCM', async () => {
	const state = fixture();
	const samples = new Float32Array(64).fill(0.125);
	const input = [samples, samples.slice()];
	const buffer: AudioBuffer = { sampleRate: 48_000, numberOfChannels: 2, length: 64, duration: 64 / 48_000,
		getChannelData: channel => input[channel]!,
		copyFromChannel: (target, channel, start = 0) => { target.set(input[channel]!.subarray(start, start + target.length)); },
		copyToChannel: () => assert.fail('Dry preview must leave its source buffer untouched.'),
	};
	const channels = await renderSimpleDryTrackPcm(state.project, new Map([['s0', buffer]]), 'track', 0, 16, 2);
	assert.ok(channels);
	assert.deepEqual(channels, [samples.slice(0, 16), samples.slice(0, 16)]);
	assert.ok(state.reads <= state.count * 5, `received ${state.reads} media identity reads`);
});
