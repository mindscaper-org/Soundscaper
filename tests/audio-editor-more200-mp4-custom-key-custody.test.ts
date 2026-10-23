/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { normalizeMediaMetadata } from '../src/common/editor/media-metadata.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { exportDialogMetadata } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';
import { exportDialogMetadataFields } from '../src/common/editor/ui/export-dialog-metadata-fields.ts';
import { appMetadataM4aFixture } from './helpers/ordinary-tail-m4a-fixture.ts';

const custom = Object.freeze(Object.fromEntries([['constructor', 'Reviewed engineer'], ['toString', 'Reviewed producer'], ['__proto__', 'Reviewed source owner'], ['ordinary', 'Control']]));

test('AAC dialog metadata survives mdta writing, importing and provenance normalization with every own key', async () => {
	const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), format: 'aac-m4a', metadataCustom: JSON.stringify(custom) };
	const request = createExportDialogRequest(settings, { metadata: exportDialogMetadata(settings.format, false,
		exportDialogMetadataFields(settings, custom)) });
	const metadata = normalizeMediaMetadata(request.metadata);
	for (const [key, value] of Object.entries(custom)) assert.equal(Object.getOwnPropertyDescriptor(metadata, key)?.value, value);
	const inspected = await inspectImportedMediaMetadata(await appMetadataM4aFixture(metadata));
	assert.deepEqual(inspected.warnings, []);
	for (const [key, value] of Object.entries(custom)) assert.equal(Object.getOwnPropertyDescriptor(inspected.metadata.raw, key)?.value, value);
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} retains custom MP4 own keys`, async () => {
	const file = await appMetadataM4aFixture(custom);
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,MP4}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP4]});
		try{console.log(JSON.stringify((await input.getMetadataTags()).raw));}finally{input.dispose();}
	`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
	const raw: unknown = JSON.parse(stdout);
	assert.ok(raw && typeof raw === 'object');
	assert.equal(Object.getPrototypeOf(raw), Object.prototype);
	for (const [key, value] of Object.entries(custom)) assert.equal(Object.getOwnPropertyDescriptor(raw, key)?.value, value);
});
