/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { freeformM4aMetadataFixture } from './helpers/ordinary-tail-m4a-fixture.ts';

test('M4A metadata import keeps reverse-DNS custom credits with their separate namespaces', async () => {
	const file = await freeformM4aMetadataFixture();
	const inspected = await inspectImportedMediaMetadata(file);
	assert.deepEqual(inspected.warnings, []);
	assert.equal(inspected.metadata.raw?.['----:com.apple.iTunes:ENGINEER'], 'Hélène — reviewed credit');
	assert.equal(inspected.metadata.raw?.['----:org.example.archive:ENGINEER'], 'Second namespace credit');
	assert.equal(inspected.metadata.normalized?.title, 'Two retained covers');
	assert.equal(inspected.metadata.normalized?.comment, 'After covers');
	for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
		const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,MP4}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[MP4]});
			try{const raw=(await input.getMetadataTags()).raw;console.log(JSON.stringify(Object.fromEntries(Object.entries(raw).filter(([key])=>key.startsWith('----:')))));}finally{input.dispose();}
		`, bundle, Buffer.from(await file.arrayBuffer()).toString('base64')], { timeout: 10_000 });
		assert.deepEqual(JSON.parse(stdout) as unknown, { '----:com.apple.iTunes:ENGINEER': 'Hélène — reviewed credit',
			'----:org.example.archive:ENGINEER': 'Second namespace credit' }, bundle);
	}

});
