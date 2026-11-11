/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { labelFileProject, labelFilePoints } from './helpers/label-file-profile-custody.ts';
import { addLabelThroughEdit } from './helpers/label-routing-archive-custody.tsx';

import { partitionWorkspaceFiles } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { labelExportFileName } from '../src/common/editor/controller/shared/app-helpers.ts';
import {
	serializeSubRipLabels, parseSubRipLabels, serializeWebVttLabels, parseWebVttLabels,
	parseAudacityLabelsTxt, serializeAudacityLabelsTxt,
} from '../src/common/editor/label-io.js';
import {
	dialogSettingsFromDeliveryTarget, dialogSettingsFromPreset, presetSettingsFromDialog,
} from '../src/common/editor/ui/export-preset-model.ts';
import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { normalizeExportDialogAudioSettings, exportDialogOutputChannelCount } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';

test('Audacity extended label imports retain undefined spectral bounds in TXT roundtrips', async context => {
	const text = '0\t0.5\tBelow 1000 Hz\n\\\t-1\t1000\n1\t1.5\tAbove 2000 Hz\n\\\t2000\t-1\n';
	const imported = parseAudacityLabelsTxt(text, { sampleRate: 48_000 });
	assert.deepEqual(imported.labels.map(({ opaqueExtensions }) => opaqueExtensions.frequencyRange), [
		{ minimumFrequency: -1, maximumFrequency: 1000 },
		{ minimumFrequency: 2000, maximumFrequency: -1 },
	]);
	assert.equal(serializeAudacityLabelsTxt(imported.labels, { sampleRate: 48_000 }), text);
	for (const range of ['-2\t1000', '2000\t-2', '2000\t1000']) {
		assert.throws(() => parseAudacityLabelsTxt(`0\t0.5\tRange\n\\\t${range}\n`), /frequency continuation is malformed/u);
	}
	const fixture = await deliveredLabelProfile(context), { controller } = fixture;
	const before = structuredClone(labelFileProject(controller.project)), entries = controller.getSnapshot().history.undoEntries.length;
	await fixture.import(new File([text], 'audacity-spectral-labels.txt', { type: 'text/plain' }));
	const published = labelFileProject(controller.project);
	assert.deepEqual(labelFilePoints(published), [{ title: 'Below 1000 Hz', startFrame: 0, endFrame: 24_000 },
		{ title: 'Above 2000 Hz', startFrame: 48_000, endFrame: 72_000 }]);
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks, published.tracks);
	const recipient = await fixture.reopen();
	const labels = recipient.project.tracks.flatMap(track => {
		if (track.type !== 'label') return []; assert.ok(Array.isArray(track.labels)); return track.labels;
	});
	assert.deepEqual(labels.map((label: unknown) => {
		assert.ok(label && typeof label === 'object'); const opaque: unknown = Reflect.get(label, 'opaqueExtensions');
		assert.ok(opaque && typeof opaque === 'object'); return Reflect.get(opaque, 'frequencyRange');
	}), [{ minimumFrequency: -1, maximumFrequency: 1000 }, { minimumFrequency: 2000, maximumFrequency: -1 }]);
	const current = structuredClone(recipient.project), history = structuredClone(recipient.controller.getSnapshot().history);
	const result = await recipient.controller.actions.labels.export();
	assert.equal(result.labelCount, 2); assert.equal(result.format, 'txt');
	assert.equal(fixture.saved.length, 1); assert.equal(await fixture.saved[0]!.text(), text);
	assert.equal(fixture.saved[0]?.type, 'text/plain;charset=utf-8');
	assert.deepEqual(recipient.controller.project, current); assert.deepEqual(recipient.controller.getSnapshot().history, history);
});

test('timed label exports give points and submillisecond ranges the minimum cue duration', () => {
	const labels = [
		{ id: 'point', title: 'At the playhead', startFrame: 48_000, endFrame: 48_000 },
		{ id: 'short', title: 'A very short selection', startFrame: 96_000, endFrame: 96_001 },
	];
	for (const [serialize, parse] of [
		[serializeSubRipLabels, parseSubRipLabels],
		[serializeWebVttLabels, parseWebVttLabels],
	] as const) {
		const parsed = parse(serialize(labels, { sampleRate: 48_000 }), { sampleRate: 48_000 });
		assert.deepEqual(parsed.labels.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [
			[48_000, 48_048], [96_000, 96_048],
		]);
	}
	assert.deepEqual(labels.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [
		[48_000, 48_000], [96_000, 96_001],
	], 'serialization must leave the original point and range untouched');
});

test('the explicit letterbox choice overrides a vertical delivery target crop', () => {
	const settings = {
		...createExportDialogInitialSettings({}),
		...dialogSettingsFromDeliveryTarget('web-vertical-1080'),
		deliveryTarget: 'web-vertical-1080',
	};
	assert.equal(settings.canvasFit, 'cover');
	const request = createExportDialogRequest({ ...settings, canvasFit: 'contain' });
	assert.equal((request.canvas as { fit: string }).fit, 'contain');
});

test('importing an ordinary legacy Audacity project reaches the project opener', () => {
	const project = { name: 'Album.AUP', type: 'application/x-audacity-project' };
	assert.deepEqual(partitionWorkspaceFiles([project]), {
		projects: [project], media: [], labels: [], cues: [],
	});
});

test('export metadata keeps a title cleared in Project properties empty', () => {
	assert.equal(createExportDialogInitialSettings({
		title: 'Session name', metadata: { title: '' },
	}).metadataTitle, '');
});

test('label exports preserve periods in a project title and replace label file suffixes', async context => {
	assert.equal(labelExportFileName('Episode 1.2', 'srt'), 'Episode 1.2.srt');
	assert.equal(labelExportFileName('Captions.VTT', 'srt'), 'Captions.srt');
	const fixture = await deliveredLabelProfile(context);
	await fixture.import(new File(['1\n00:00:00,250 --> 00:00:01,500\nIntro caption\n\n2\n00:00:02,000 --> 00:00:03,250\nOutro caption\n'],
		'browser-captions.srt', { type: 'application/x-subrip' }));
	await fixture.controller.actions.project.rename('Episode 1.2');
	const recipient = await fixture.reopen(); assert.equal(recipient.project.title, 'Episode 1.2');
	const before = structuredClone(recipient.project), history = structuredClone(recipient.controller.getSnapshot().history);
	const result = await recipient.controller.actions.labels.export();
	assert.equal(result.labelCount, 2); assert.equal(result.fileName, 'Episode 1.2.txt');
	assert.equal(fixture.saved.length, 1); assert.equal(fixture.saved[0]?.name, 'Episode 1.2.txt');
	assert.equal(await fixture.saved[0]!.text(), '0.25\t1.5\tIntro caption\n2\t3.25\tOutro caption\n');
	assert.deepEqual(recipient.controller.project, before); assert.deepEqual(recipient.controller.getSnapshot().history, history);
});

test('a label containing an ordinary arrow can be exported and reopened as SRT', async context => {
	const text = serializeSubRipLabels([{ title: 'Intro --> Verse', startFrame: 0, endFrame: 48_000 }]);
	assert.equal(parseSubRipLabels(text).labels[0]?.title, 'Intro --> Verse');
	const fixture = await deliveredLabelProfile(context), { controller } = fixture;
	const before = structuredClone(labelFileProject(controller.project)), entries = controller.getSnapshot().history.undoEntries.length;
	addLabelThroughEdit(controller);
	const track = labelFileProject(controller.project).tracks.find(candidate => candidate.type === 'label');
	assert.ok(track?.type === 'label'); assert.ok(Array.isArray(track.labels));
	const label: unknown = track.labels[0]; assert.ok(label && typeof label === 'object');
	const id: unknown = Reflect.get(label, 'id'); assert.ok(typeof id === 'string');
	await controller.actions.labels.update(track.id, id, { title: 'Intro --> Verse' });
	assert.deepEqual(labelFilePoints(labelFileProject(controller.project)), [{ title: 'Intro --> Verse', startFrame: 0, endFrame: 0 }]);
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 2);
	controller.actions.edit.undo(); controller.actions.edit.undo(); assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo(); controller.actions.edit.redo();
	const recipient = await fixture.reopen(), current = structuredClone(recipient.project), history = structuredClone(recipient.controller.getSnapshot().history);
	const result = await recipient.controller.actions.labels.export({ format: 'srt' });
	assert.equal(result.format, 'srt'); assert.equal(result.labelCount, 1); assert.equal(fixture.saved.length, 1);
	assert.equal(fixture.saved[0]?.type, 'application/x-subrip;charset=utf-8');
	assert.equal(await fixture.saved[0]!.text(), '1\n00:00:00,000 --> 00:00:00,001\nIntro --> Verse\n');
	assert.deepEqual(recipient.controller.project, current); assert.deepEqual(recipient.controller.getSnapshot().history, history);
});

test('WebVTT exports encode literal label punctuation and import it as visible text', () => {
	const title = '5 < 10 & 20 > 15 --> conclusion';
	const text = serializeWebVttLabels([{ title, startFrame: 0, endFrame: 48_000 }]);
	assert.ok(text.includes('5 &lt; 10 &amp; 20 &gt; 15 --&gt; conclusion'));
	assert.equal(parseWebVttLabels(text).labels[0]?.title, title);
});

test('saving custom channel routing stores the matrix instead of the dialog sentinel', () => {
	const matrix = { channels: [{ inputs: [{ channel: 1, gain: 1 }] }] };
	const settings = presetSettingsFromDialog({
		channelMapping: 'custom', channelMatrix: JSON.stringify(matrix),
	}, 'audio');
	assert.deepEqual(settings.channelMapping, matrix);
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'routing', label: 'Right to mono', kind: 'audio', format: 'wav', settings,
	});
	const restored = dialogSettingsFromPreset(preset);
	assert.equal(restored.channelMapping, 'custom');
	assert.deepEqual(JSON.parse(String(restored.channelMatrix)), matrix);
});

test('marker chapter presets retain their source when applied in a new export dialog', () => {
	const settings = presetSettingsFromDialog({ mode: 'chapters', chapterSource: 'markers' }, 'audio');
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'markers', label: 'Marker chapters', kind: 'audio', format: 'wav', settings,
	});
	assert.equal(dialogSettingsFromPreset(preset).chapterSource, 'markers');
});

test('delivery presets retain and reset the embedded label chapter option', () => {
	const stored = presetSettingsFromDialog({ embedLabelChapters: true }, 'audio');
	assert.equal(stored.embedLabelChapters, true);
	assert.equal(dialogSettingsFromPreset(validateDeliveryPreset({
		schemaVersion: 1, id: 'single-file-chapters', label: 'Single-file chapters',
		kind: 'audio', format: 'mp3', settings: stored,
	})).embedLabelChapters, true);
	assert.equal(dialogSettingsFromPreset(validateDeliveryPreset({
		schemaVersion: 1, id: 'ordinary-mp3', label: 'Ordinary MP3',
		kind: 'audio', format: 'mp3', settings: {},
	})).embedLabelChapters, false);
});

test('applying a saved video preset clears a previously chosen platform delivery target', () => {
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'mp4', label: 'My MP4', kind: 'video', format: 'mp4', settings: {},
	});
	assert.equal(dialogSettingsFromPreset(preset).deliveryTarget, '');
});

test('chapter and stem requests omit the mix rendering options hidden by their output selection', () => {
	const mix = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), loudnessNormalization: 'streaming-14', binaural: true };
	assert.equal(createExportDialogRequest(mix).loudnessNormalization, 'streaming-14');
	assert.equal(createExportDialogRequest(mix).binaural, true);
	for (const mode of ['chapters', 'stems']) {
		assert.equal(createExportDialogRequest({ ...mix, mode }).loudnessNormalization, undefined);
		assert.equal(createExportDialogRequest({ ...mix, mode }).binaural, undefined);
		for (const desktop of [false, true]) {
			const split = normalizeExportDialogAudioSettings({ ...mix, mode }, desktop, 6);
			assert.equal(split.binaural, false);
			assert.equal(split.loudnessNormalization, '');
			assert.equal(exportDialogOutputChannelCount(split, 6), 6);
		}
	}
});


test('video submission and preset saving refuse an incomplete or nonpositive stated canvas', () => {
	const defaults = { ...createExportDialogInitialSettings({}), format: 'video-mp4' };
	for (const [canvasWidth, canvasHeight] of [['0', '96'], ['54', '0'], ['-2', '96'], ['54', ''], ['', '96']]) {
		const settings = { ...defaults, canvasWidth, canvasHeight };
		assert.throws(() => createExportDialogRequest(settings), /canvas.*width.*height/iu);
		assert.throws(() => presetSettingsFromDialog(settings, 'video'), /canvas.*width.*height/iu);
	}
	assert.equal(createExportDialogRequest({ ...defaults, canvasWidth: '', canvasHeight: '' }).canvas, undefined);
	assert.deepEqual(createExportDialogRequest({ ...defaults, canvasWidth: '54', canvasHeight: '96' }).canvas,
		{ size: { width: 54, height: 96 } });
});

/** Real label save service; the anchor click is only the output transport. */
async function deliveredLabelProfile(context: TestContext) {
	const saved: File[] = [], urls = new Map<string, Blob>();
	let nextUrl = 0;
	const fileService = createAudioEditorFileService({ bridge: null, scope: {},
		urlApi: { createObjectURL(blob: Blob) { const url = `blob:label-output-${++nextUrl}`; urls.set(url, blob); return url; },
			revokeObjectURL(url: string) { urls.delete(url); } },
		document: { body: { append() {} }, createElement(tag: string) {
			assert.equal(tag, 'a');
			return { href: '', download: '', hidden: false, remove() {}, click() {
				const blob = urls.get(this.href); assert.ok(blob);
				saved.push(new File([blob], this.download, { type: blob.type }));
			} };
		} },
	});
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const engine = { ...createMemoryEngine(), decodeAudioData: async () => assert.fail('Labels cannot substitute decoded audio') };
	const ffmpeg = { ...createMemoryFfmpeg(), decode: async () => assert.fail('Labels cannot substitute codec output'),
		encode: async () => assert.fail('Labels cannot encode substitute PCM') };
	const native = createSoundscaperScapeNativeRuntime();
	const options = { fileService, copy: ENGLISH_COPY, scapeProjectRuntime: native, engine: engine as unknown as Options['engine'],
		ffmpeg: ffmpeg as unknown as Options['ffmpeg'], engineFactory: () => assert.fail('Label data must not render PCM') };
	const sender = await controllerSession(context, options);
	context.after(() => { assert.equal(urls.size, 0, 'completed download transports must release their URLs'); });
	return { ...sender, saved, async import(file: File) {
		assert.equal(await importWorkspaceRoutedFiles({ controller: sender.controller, files: [file], importOptions: {}, projectBinVisible: false,
			openProjectFile: () => assert.fail('Label data must reach the label importer'),
			requestCueImport: () => assert.fail('These files are not CUE choices'),
		}), 1);
	}, async reopen() {
		await sender.controller.actions.project.flush();
		const project = labelFileProject(sender.controller.project); assert.equal(project.sources.length, 0);
		assert.deepEqual(await sender.store.loadProject(project.id), project);
		const archive = await native.exportScapeProject(project, sender.store); assert.ok(archive.blob);
		const recipient = await controllerSession(context, options);
		await recipient.controller.actions.project.openScapeFile(new File([archive.blob], 'Label-profile.sscape'), () => 'copy');
		const restored = labelFileProject(recipient.controller.project);
		assert.deepEqual(restored, project); assert.deepEqual(await recipient.store.loadProject(project.id), project);
		return { ...recipient, project: restored };
	} };
}
