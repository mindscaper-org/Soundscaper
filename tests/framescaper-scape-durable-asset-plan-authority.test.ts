/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	collectFramescaperDurableScapeAssetReferences,
	planFramescaperDurableScapeExportAssets,
} from '../src/framescaper/editor-scape-durable-asset-plan-core.ts';

const SHA256 = 'ab'.repeat(32);

test('durable asset core preserves base and finishing error identities', async () => {
	const references = collectFramescaperDurableScapeAssetReferences({
		sources: [{
			kind: 'still', id: 'still-source', mimeType: 'image/png',
			contentSha256: SHA256, storageKey: 'still-body',
		}],
		freezeRenderedSourceIds: new Set(),
		luts: () => [],
		processorStacks: () => [],
		motionAnalyses: () => [],
	}, 'Framescaper');
	assert.equal(references[0]?.archiveId, 'framescaper:still:still-source');

	for (const label of ['Framescaper', 'finishing'] as const) {
		await assert.rejects(planFramescaperDurableScapeExportAssets(
			references,
			{ getMediaAssetMetadata: () => ({ size: 1, sha256: 'cd'.repeat(32) }) },
			label,
		), { message: `${label} still body still-body is missing or stale.` });
	}
});

test('base and finishing planners share the durable core while timeline images retain their container', () => {
	const directory = new URL('../src/framescaper/', import.meta.url);
	for (const file of ['editor-scape-asset-plan.ts', 'editor-scape-asset-plan-finishing.ts']) {
		const source = readFileSync(new URL(file, directory), 'utf8');
		assert.match(source, /collectFramescaperDurableScapeAssetReferences/u, file);
		assert.match(source, /planFramescaperDurableScapeExportAssets/u, file);
	}
	const timelineImage = readFileSync(new URL('editor-scape-asset-plan-timeline-image.ts', directory), 'utf8');
	assert.doesNotMatch(timelineImage, /editor-scape-durable-asset-plan-core/u);
	assert.match(timelineImage, /openFramescaperImageFramePackV1/u);
});
