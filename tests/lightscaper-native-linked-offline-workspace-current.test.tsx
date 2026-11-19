/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import React, { act } from 'react';
import Workspace from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import { capturePhotoLibraryDevelopPortCurrentV1 as capture } from '../src/common/editor/ui/lightscaper/photo-library-workflow-develop-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 as renderRuntime } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { offlineLinkedDevelopFixtureCurrentV1 as fixture, holdOfflineDevelopInspectionCurrentV1 as hold, options } from './helpers/lightscaper-native-linked-offline-develop-fixture-current.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle, waitFor } from './helpers/async-test-control.ts';

void test('Actual Current workspace automatically declares offline preview, withholds Original/full admission while query is pending, and needs no manual opt-in', options, async context => fixture(context, async f => {
	await rename(f.file.file, join(f.rootPath, 'Disconnected UI.DNG'));
	const gate = hold(context), retirees = new Set<() => Promise<void>>(); let originalCalls = 0;
	const execute: ExecutePhotoDevelopCurrentV1 = async (run, signal) => { await run({ signal: signal ?? context.signal, acquire: async () => capture(f.session.develop, signal, execute), isCurrent: () => true, refresh: async () => undefined }); };
	let mounted: Awaited<ReturnType<typeof mountPhotoImportUi>> | undefined;
	try { mounted = await mountPhotoImportUi(() => <Workspace generation={f.session} locale="en" photoId={f.photoId} label="Actual disconnected linked Photo" execute={execute}
		readPreview={f.session.readPreview.bind(f.session)} withOriginalFrame={async (...args) => { originalCalls++; const source = f.session.develop.original; assert.ok(source); return source.withFrame(...args); }}
		loadProxy={async () => renderRuntime({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource })} beforePresent={Promise.resolve()}
		registerRetirement={retire => { retirees.add(retire); return () => undefined; }} onClose={() => undefined} />);
		await gate.entered; assert.equal(gate.observed, true); assert.equal(originalCalls, 0);
		const full = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === photoDevelopCopy('en').fullResolution);
		assert.ok(full); assert.equal(reactProps(full).disabled, true);
		gate.release(); const actual = mounted; await waitFor(async () => { await act(async () => { await settle(); }); return actual.dom.find('[data-photo-develop-input-quality-notice]') !== null; }, 'automatic offline Develop quality notice');
		const preview = mounted.dom.one('[data-photo-develop-preview]'); assert.equal(preview.getAttribute('data-input-quality'), 'preview-derivative'); assert.equal(originalCalls, 0);
		assert.match(mounted.dom.one('[data-photo-develop-input-quality-notice]').textContent, /8-bit.*preview|preview.*8-bit/iu);
		const updatedFull = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === photoDevelopCopy('en').fullResolution);
		assert.ok(updatedFull); assert.equal(reactProps(updatedFull).disabled, true);
	} finally { gate.release(); if (mounted) await mounted.dispose(); await Promise.allSettled([...retirees].map(retire => retire())); gate.restore(); }
}));
