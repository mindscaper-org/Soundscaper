import assert from 'node:assert/strict';
import test from 'node:test';

import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForCommand } from '../src/common/editor/command-project-view.ts';
import { createClipPropertyService } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const COUNT = 500;
const PERSISTED = createSoundscaperProject({ id: 'bulk-pitch-work',
	sources: Array.from({ length: COUNT }, (_, index) => ({ id: `source-${index}`, storageKey: `source-${index}`, frameCount: 64, sampleRate: 48_000, channelCount: 1 })),
	tracks: [{ id: 'audio', clipIds: Array.from({ length: COUNT }, (_, index) => `clip-${index}`) }],
	clips: Array.from({ length: COUNT }, (_, index) => ({ id: `clip-${index}`, sourceId: `source-${index}`, timelineStartFrame: index * 64,
		sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64 })) });
const PROJECT = projectForCommand(PERSISTED) as unknown as ClipTransformProject;

function harness() {
	const commands: AudioEditorCommand[] = [];
	return { commands, service: createClipPropertyService({ lifetime: new EditorControllerLifetime(),
		copy: { audioClipNotFound: 'Missing audio', clipPitchRange: 'Pitch range', clipSpeedPositive: 'Speed range', timelineFramesFinite: 'Finite frames' },
		sourceBuffers: new Map(), getProject: () => PROJECT, getSelectedClipId: () => 'clip-0', editingBlocked: () => false,
		captureProject: () => ({ generation: 1, projectId: PROJECT.id }), assertProject() {},
		analyzeChannels: () => assert.fail('No PCM analysis is needed'), createId: prefix => prefix,
		commit: command => { commands.push(command); },
	}) };
}

test('bulk pitch changes prepare clip, ownership and source catalogs once for the selected set', () => {
	const { commands, service } = harness();
	const selected = PROJECT.clips.map(clip => clip.id);
	const members = PROJECT.tracks[0]!.clipIds;
	let clips = 0, owners = 0, sources = 0;
	const original = Array.prototype[Symbol.iterator];
	Array.prototype[Symbol.iterator] = function<T>(this: T[]): ArrayIterator<T> {
		const iterator = Reflect.apply(original, this, []) as ArrayIterator<T>;
		if (this === PROJECT.clips || this === members || this === PROJECT.sources) {
			const next = iterator.next.bind(iterator);
			iterator.next = (...args) => {
				const result = next(...args);
				if (!result.done) { if (this === PROJECT.clips) clips++; else if (this === members) owners++; else sources++; }
				return result;
			};
		}
		return iterator;
	};
	try {
		service.setClipsTimePitch([...selected, selected[0]!], { pitchCents: 100 });
		assert.ok(clips <= COUNT * 3, `${clips} clip index visits`);
		assert.ok(owners <= COUNT * 3, `${owners} ownership index visits`);
		assert.ok(sources <= COUNT * 3, `${sources} source index visits`);
	} finally { Array.prototype[Symbol.iterator] = original; }
	assert.equal(commands.length, 1);
	const command = commands[0];
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected one prepared transform');
	assert.deepEqual(command.transforms.map(transform => transform.clipId), selected);
	assert.ok(command.transforms.every(transform => transform.changes.pitchCents === 100 && transform.changes.speedRatio === 1 && transform.changes.durationFrames === 64));
	const applied = applySoundscaperProjectCommand(PERSISTED, command);
	assert.equal(applied.clips.length, COUNT);
	assert.ok(applied.clips.every(clip => clip.pitchCents === 100 && clip.durationFrames === 64));
	assert.ok(PERSISTED.clips.every(clip => clip.pitchCents === 0));
});

test('bulk pitch preparation retains complete refusal atomicity for a stale selected clip', () => {
	const { commands, service } = harness();
	assert.throws(() => service.setClipsTimePitch(['clip-0', 'missing'], { pitchCents: 100 }), /Missing audio/u);
	assert.deepEqual(commands, []);
	assert.equal(service.setClipsTimePitch([], { pitchCents: 100 }), null);
});
