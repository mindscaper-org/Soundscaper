/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import PhotoCatalogRestoreDialog from '../src/common/editor/ui/lightscaper/PhotoCatalogRestoreDialog.tsx';
import { lightscaperRestoreCopy } from '../src/common/i18n/lightscaper-restore-copy.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

test('Lightscaper OS-selected backup stays unmodified until explicit Restore confirmation', async () => {
	const file = new File(['native backup'], 'Selected library.liscape'), calls: File[] = [];
	const base = { locale: 'en', copy: lightscaperRestoreCopy('en'), ready: true, busy: false, cancelling: false,
		cancelled: false, receipt: null, error: null, onRestore: async (value: File) => { calls.push(value); return null; },
		onCancel: async () => undefined, onClose: () => undefined };
	const m = await mountPhotoImportUi(() => <PhotoCatalogRestoreDialog {...base} selectedFile={file} />);
	try {
		assert.equal(m.dom.one('[data-photo-restore-selected-file]').textContent, file.name);
		assert.equal(reactProps(m.dom.one('[data-photo-restore-start]')).disabled, false);
		assert.deepEqual(calls, []);
		await m.event('[data-photo-restore-start]', 'onClick'); assert.deepEqual(calls, [file]);
		await m.render(() => <PhotoCatalogRestoreDialog {...base} selectedFile={null} />);
		assert.equal(m.dom.find('[data-photo-restore-selected-file]'), null);
		assert.equal(reactProps(m.dom.one('[data-photo-restore-start]')).disabled, true);
	} finally { await m.dispose(); }
});

test('Lightscaper Restore keeps native file selection through a remount and permits explicit replacement', async () => {
	const selected = new File(['first'], 'First.liscape'), replacement = new File(['second'], 'Second.fscape');
	const calls: File[] = [];
	const base = { locale: 'de', copy: lightscaperRestoreCopy('de'), ready: true, busy: false, cancelling: false,
		cancelled: false, receipt: null, error: null, onRestore: async (value: File) => { calls.push(value); return null; },
		onCancel: async () => undefined, onClose: () => undefined };
	const m = await mountPhotoImportUi(() => <PhotoCatalogRestoreDialog {...base} selectedFile={selected} />);
	try {
		await m.render(() => <PhotoCatalogRestoreDialog key="new-session" {...base} selectedFile={selected} />);
		assert.equal(m.dom.one('[data-photo-restore-selected-file]').textContent, selected.name);
		await m.event('[data-photo-restore-file]', 'onChange', { currentTarget: { files: [replacement] } });
		await m.event('[data-photo-restore-start]', 'onClick'); assert.deepEqual(calls, [replacement]);
		await m.render(() => <PhotoCatalogRestoreDialog key="new-session" {...base} busy selectedFile={selected} />);
		assert.equal(reactProps(m.dom.one('[data-photo-restore-start]')).disabled, true);
		assert.equal(reactProps(m.dom.one('[data-photo-restore-file]')).accept, '.liscape,.sscape,.fscape,.scape');
	} finally { await m.dispose(); }
});
