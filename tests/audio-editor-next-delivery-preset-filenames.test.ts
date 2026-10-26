/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDeliveryPresetService } from '../src/common/editor/controller/export/delivery-preset-service.ts';
import { importDeliveryPresets } from '../src/common/editor/delivery-preset-store.ts';

test('exporting different non-Latin delivery preset names does not collapse them onto one filename', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-next-preset-files-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const names: string[] = [];
	let id = 0;
	const service = createDeliveryPresetService({
		state: {}, persistSetting: () => undefined, createId: () => `preset-${String(++id)}`,
		fileService: { saveFile: async request => {
			assert.equal(request.purpose, 'preset');
			assert.equal(request.mimeType, 'application/json');
			assert.ok(typeof request.suggestedName === 'string');
			assert.ok(typeof request.text === 'string');
			names.push(request.suggestedName);
			await writeFile(join(directory, request.suggestedName), request.text);
		} },
	});
	const labels = ['ラジオ', '音楽'];
	for (const label of labels) {
		const preset = await service.save({ label, kind: 'audio', format: 'wav', settings: { sampleRate: 48_000 } });
		await service.saveToFile(preset.id);
	}
	assert.equal(new Set(names).size, labels.length, 'the two preset downloads must not share the same default name');
	assert.deepEqual(names, labels.map(label => `${label}.json`));
	for (const label of labels) {
		const text = await readFile(join(directory, `${label}.json`), 'utf8');
		assert.equal(importDeliveryPresets({}, text).presets[0]?.label, label);
	}
});
