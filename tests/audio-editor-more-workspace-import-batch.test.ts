/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { createLabelService } from '../src/common/editor/controller/edit/internal/label-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { isWebFileLimitFailure } from '../src/common/editor/web-file-limit-failure.ts';

test('an unreadable project leaves later projects in the same file batch available to open', async () => {
	const attempted: string[] = [];
	const corrupted = new Error('Malformed project');
	await assert.rejects(importWorkspaceRoutedFiles({
		controller: { actions: { project: { importFiles() {} }, labels: { importFile() {} } } },
		files: ['first.sscape', 'broken.sscape', 'last.sscape'].map(name => new File(['project'], name)),
		importOptions: {}, projectBinVisible: false, requestCueImport() {},
		openProjectFile(file) {
			attempted.push(file.name);
			if (file.name === 'broken.sscape') throw corrupted;
		},
	}), (error: unknown) => error === corrupted);
	assert.deepEqual(attempted, ['first.sscape', 'broken.sscape', 'last.sscape']);
});

test('an unreadable archive does not prevent importing its accompanying recording', async () => {
	const recording = new File(['media'], 'interview.wav');
	const attempted: File[] = [];
	const corrupted = new Error('Malformed project');
	await assert.rejects(importWorkspaceRoutedFiles({
		controller: { actions: {
			project: { importFiles(files) { attempted.push(...files); } }, labels: { importFile() {} },
		} },
		files: [new File(['broken'], 'unreadable.sscape'), recording],
		importOptions: {}, projectBinVisible: false, requestCueImport() {},
		openProjectFile() { throw corrupted; },
	}), (error: unknown) => error === corrupted);
	assert.deepEqual(attempted, [recording]);
});

test('media accompanying an opened archive keeps its drop time without inheriting the outgoing track', async () => {
	let project = { id: 'outgoing', sampleRate: 48_000 };
	const placements: Readonly<Record<string, unknown>>[] = [];
	await importWorkspaceRoutedFiles({
		controller: { get project() { return project; }, actions: {
			project: { importFiles(_files, options) { placements.push(options); } }, labels: { importFile() {} },
		} },
		files: [new File(['archive'], 'open.sscape'), new File(['recording'], 'take.wav')],
		importOptions: { destination: 'timeline', trackId: 'outgoing-track', trackIndex: 3, timelineStartFrame: 48_000 },
		projectBinVisible: false, requestCueImport() {},
		openProjectFile() { project = { id: 'incoming', sampleRate: 44_100 }; },
	});
	assert.deepEqual(placements, [{ destination: 'timeline', projectBinVisible: false, timelineStartFrame: 44_100 }]);
});

test('cancelling a Scape conflict stops the batch before it opens another tab or imports sidecars', async () => {
	const attempted: string[] = [];
	const count = await importWorkspaceRoutedFiles({
		controller: { actions: {
			project: { importFiles: () => { attempted.push('media'); } },
			labels: { importFile: () => { attempted.push('labels'); } },
		} },
		files: ['conflict.sscape', 'another.sscape', 'take.wav', 'sidecar.txt'].map(name => new File(['file'], name)),
		importOptions: {}, projectBinVisible: false, requestCueImport() {},
		openProjectFile(file) { attempted.push(file.name); return { cancelled: true }; },
	});
	assert.equal(count, 0);
	assert.deepEqual(attempted, ['conflict.sscape']);
});

for (const destination of ['another tab', 'reopened tab'] as const) {
	test(`a media import finishing after activation of ${destination} cannot attach its sidecar there`, async () => {
		let project = { id: 'original' };
		const generation = new EditorProjectGeneration();
		generation.activate(project.id);
		const attempted: string[] = [];
		let resolveImport!: () => void;
		const mediaFinished = new Promise<void>(resolve => { resolveImport = resolve; });
		const pending = importWorkspaceRoutedFiles({
			controller: {
				get project() { return project; },
				captureProjectGeneration: id => generation.capture(id),
				actions: { project: { importFiles: () => mediaFinished }, labels: { importFile: file => { attempted.push(file.name); } } },
			},
			files: ['take.wav', 'sidecar.txt'].map(name => new File(['file'], name)),
			importOptions: {}, projectBinVisible: false, requestCueImport() {}, openProjectFile() {},
		});
		project = { id: destination === 'another tab' ? 'replacement' : project.id };
		generation.activate(project.id);
		resolveImport();
		await assert.rejects(pending, { name: 'AbortError' });
		assert.deepEqual(attempted, []);
	});
}

test('a malformed label file does not discard later healthy files from the same import gesture', async () => {
	let project = createCurrentAudioEditorProject({ id: 'batch', sampleRate: 48_000 });
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration(); projectGeneration.activate(project.id);
	let id = 0;
	const service = createLabelService({ lifetime, projectGeneration, getProject: () => project,
		state: { importing: false, selectedTrackId: null }, editingBlocked: () => false,
		createId: prefix => `${prefix}-${++id}`,
		commit: command => { project = applyEditorCommand(project, command); },
		publish() {}, setStatus() {}, saveExport() {},
		copy: { labels: 'Labels', labelsImporting: '', labelsImported: '', labelsImportEmpty: '',
			labelTrackMissing: '', labelsExported: '', panelMarkers: 'Markers' },
	});
	const controller = { get project() { return project; }, actions: {
		project: { importFiles() {} }, labels: { importFile: (file: File) => service.importLabelFile(file) },
	} };
	await assert.rejects(importWorkspaceRoutedFiles({ controller,
		files: [new File(['0\t1\tFirst\n'], 'first.txt'), new File(['invalid'], 'broken.txt'),
			new File(['2\t3\tLast\n'], 'last.txt')],
		importOptions: {}, openProjectFile() {}, projectBinVisible: false, requestCueImport() {},
	}), { name: 'AudioEditorLabelIoError' });
	assert.deepEqual(project.tracks.flatMap((track: { type: string; labels?: readonly { title?: string }[] }) =>
		track.type === 'label' ? track.labels?.map(label => label.title) ?? [] : []), ['First', 'Last']);
});

test('batch import still stops on cancellation before attempting another file', async () => {
	const attempted: string[] = [];
	await assert.rejects(importWorkspaceRoutedFiles({ controller: { actions: {
		project: { importFiles() {} }, labels: { importFile(file: File) {
			attempted.push(file.name); throw new DOMException('Cancelled', 'AbortError');
		} },
	} }, files: [new File([''], 'cancel.txt'), new File([''], 'later.txt')],
	importOptions: {}, openProjectFile() {}, projectBinVisible: false, requestCueImport() {},
	}), { name: 'AbortError' });
	assert.deepEqual(attempted, ['cancel.txt']);
});

test('cancelling the first CUE destination stops the other prompts in the same project import', async () => {
	const prompted: string[] = [];
	const count = await importWorkspaceRoutedFiles({
		controller: { actions: { project: { importFiles() {} }, labels: { importFile() {} } } },
		files: ['project.sscape', 'first.cue', 'second.cue'].map(name => new File(['file'], name)),
		importOptions: {}, openProjectFile() {}, projectBinVisible: false,
		requestCueImport(file) { prompted.push(file.name); return null; },
	});
	assert.deepEqual(prompted, ['first.cue']);
	assert.equal(count, 0);
});

test('a project switch during a failed file stops the gesture before importing into another document', async () => {
	let project = { id: 'original' };
	const attempted: string[] = [];
	await assert.rejects(importWorkspaceRoutedFiles({ controller: { get project() { return project; }, actions: {
		project: { importFiles() {} }, labels: { importFile(file: File) {
			attempted.push(file.name); project = { id: 'replacement' }; throw new Error('Malformed labels');
		} },
	} }, files: [new File([''], 'bad.txt'), new File([''], 'later.txt')],
	importOptions: {}, openProjectFile() {}, projectBinVisible: false, requestCueImport() {},
	}), { name: 'AbortError' });
	assert.deepEqual(attempted, ['bad.txt']);
});

test('multiple independent file failures retain quota context after the remaining files are attempted', async () => {
	const attempted: string[] = [];
	let caught: unknown;
	try {
		await importWorkspaceRoutedFiles({ controller: { actions: {
			project: { importFiles() {} }, labels: { importFile(file: File) {
				attempted.push(file.name);
				if (file.name === 'quota.txt') throw new DOMException('Quota full', 'QuotaExceededError');
				if (file.name === 'broken.txt') throw new Error('Malformed labels');
			} },
		} }, files: [new File([''], 'quota.txt'), new File([''], 'broken.txt'), new File([''], 'last.txt')],
		importOptions: {}, openProjectFile() {}, projectBinVisible: false, requestCueImport() {},
		});
	} catch (error) { caught = error; }
	assert.deepEqual(attempted, ['quota.txt', 'broken.txt', 'last.txt']);
	assert.equal(isWebFileLimitFailure(caught), true);
	assert.equal((caught as Error).name, 'WebFileLoadLimitError');
});
