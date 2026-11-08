/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import type { BrowserFileSaveServiceOptions } from '../src/common/editor/browser-file-save-service.ts';
import { createContributionSnapshot, createTranslationDraft, updateTranslationDraft } from '../src/common/i18n/community-translations.ts';

const noticeUrl = new URL('../src/common/i18n/translations/NOTICE.md?raw', import.meta.url);
const licenseUrl = new URL('../src/common/i18n/translations/LICENSE.txt?raw', import.meta.url);
const rawText = registerHooks({ load(url, context, nextLoad) {
	if (url === noticeUrl.href || url === licenseUrl.href) return {
		format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true,
	};
	return nextLoad(url, context);
} });
const { exportCommunityTranslationJson, exportCommunityTranslationPo } = await import(
	'../src/common/editor/ui/community-translations/community-translation-files.ts'
).finally(() => { rawText.deregister(); });

for (const format of ['json', 'zip'] as const) test(`community ${format} export reaches the composed browser download owner`, async () => {
	const blobs: Blob[] = [];
	const names: string[] = [];
	const revoked: string[] = [];
	const timers: (() => void)[] = [];
	const anchors: { href: string; download: string; hidden: boolean }[] = [];
	const options: BrowserFileSaveServiceOptions = { scope: {}, document: {
		createElement() {
			const anchor = { href: '', download: '', hidden: false, click() { names.push(this.download); }, remove() {} };
			anchors.push(anchor); return anchor;
		}, body: { append() {} },
	}, urlApi: {
		createObjectURL(blob) { blobs.push(blob); return `blob:translation-${blobs.length}`; },
		revokeObjectURL(url) { revoked.push(url); },
	}, setTimeout(callback, delay) { assert.equal(delay, 30_000); timers.push(callback); } };
	const service = createAudioEditorFileService({ ...options, bridge: null });
	const snapshot = createContributionSnapshot('de', { play: 'Play' }, { play: 'Wiedergabe' });
	const draft = updateTranslationDraft(createTranslationDraft(snapshot), snapshot, 'play', 'Probe play');
	if (format === 'json') await exportCommunityTranslationJson(service, draft);
	else await exportCommunityTranslationPo(service, snapshot, 'Return this kit with its notices.', draft);
	assert.deepEqual(names, [`soundscaper-translations-de.${format}`]);
	assert.equal(blobs.length, 1); assert.equal(anchors.length, 1);
	assert.equal(anchors[0]!.hidden, true); assert.equal(anchors[0]!.href, 'blob:translation-1');
	const blob = blobs[0]!;
	assert.equal(blob.type, format === 'json' ? 'application/json' : 'application/zip');
	if (format === 'json') assert.deepEqual(JSON.parse(await blob.text()), draft);
	else {
		const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
		assert.deepEqual(Object.keys(files).sort(), ['LICENSE.txt', 'NOTICE.md', 'README.txt', 'manifest.json', 'messages.po', 'messages.pot']);
		assert.equal(JSON.parse(strFromU8(files['manifest.json']!)).snapshotId, snapshot.snapshotId);
		assert.match(strFromU8(files['messages.po']!), /msgstr "Probe play"/u);
		assert.match(strFromU8(files['messages.pot']!), /msgid "Play"/u);
		assert.equal(strFromU8(files['README.txt']!), 'Return this kit with its notices.\n');
		assert.equal(strFromU8(files['NOTICE.md']!), readFileSync(noticeUrl, 'utf8'));
		assert.equal(strFromU8(files['LICENSE.txt']!), readFileSync(licenseUrl, 'utf8'));
	}
	assert.deepEqual(revoked, []); assert.equal(timers.length, 1); timers[0]!();
	assert.deepEqual(revoked, ['blob:translation-1']);
	await assert.rejects(service.saveFile({ purpose: 'unknown', text: 'refused' }), /Unsupported file purpose: unknown/u);
	assert.equal(blobs.length, 1); assert.equal(anchors.length, 1);
});
