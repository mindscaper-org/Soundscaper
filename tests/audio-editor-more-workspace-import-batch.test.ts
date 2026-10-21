/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { createLabelService } from '../src/common/editor/controller/edit/internal/label-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { isWebFileLimitFailure } from '../src/common/editor/web-file-limit-failure.ts';

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
	assert.deepEqual(project.tracks.flatMap((track: { type: string; labels?: readonly { title: string }[] }) =>
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
