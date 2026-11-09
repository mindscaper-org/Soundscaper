/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseCartPayload } from '../src/common/editor/cart-metadata.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { readRiffChunks } from './helpers/read-riff-chunks.ts';
import { readWavePcm } from './helpers/read-wave-pcm.ts';

for (const sourceRate of [32_000, 48_000]) test(`CART ${sourceRate}Hz source and delivery clocks survive import and independent Scape reopen`, async context => {
	const expectedPcm = [new Float32Array(sourceRate).fill(.125)];
	const bytes = Uint8Array.from(encodeWav(expectedPcm, { sampleRate: sourceRate, bitDepth: 16, dither: false,
		bext: { description: 'Radio continuity take' },
		cart: { title: 'Radio continuity take', postTimers: [{ usage: 'SEC1', value: sourceRate / 2 }] } }));
	const { project, source, channels } = await importAndReopenAudio(context, new File([bytes], 'Radio.wav', { type: 'audio/wav' }));
	assert.equal(source.sampleRate, sourceRate);
	assert.equal(project.sampleRate, 48_000);
	assertPcmChannelsEqual(channels, expectedPcm);
	const sourceCart = source.opaqueExtensions?.cart;
	assert.ok(sourceCart && typeof sourceCart === 'object' && 'postTimers' in sourceCart);
	assert.deepEqual(sourceCart.postTimers, [{ usage: 'SEC1', value: sourceRate / 2 }]);
	assert.deepEqual(project.metadata.cart?.postTimers, [{ usage: 'SEC1', value: 24_000 }]);
	const plan = createExportPlan(project, { format: 'bwf', sampleRate: 96_000, bitDepth: 16 });
	const delivered = readRiffChunks(encodeWav([new Float32Array(96_000).fill(.125)], {
		sampleRate: plan.sampleRate, bitDepth: 16, dither: false, cart: plan.cart,
	}));
	const cartPayload = delivered.get('cart'); assert.ok(cartPayload);
	const cart = parseCartPayload(cartPayload);
	assert.equal(cart.title, 'Radio continuity take');
	assert.deepEqual(cart.postTimers, [{ usage: 'SEC1', value: 48_000 }]);
	assert.deepEqual(project.metadata.cart?.postTimers, [{ usage: 'SEC1', value: 24_000 }]);
});

for (const [rate, bits, slate] of [[96_000, 24, 48_000], [48_000, 16, 24_000]] as const) {
	test(`recorder iXML survives import and independent Scape reopen before ${rate}Hz ${bits}bit delivery`, async context => {
		const bytes = Buffer.from(readFileSync(new URL('./fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8').trim(), 'base64');
		const originalXml = new TextDecoder().decode(readRiffChunks(bytes).get('iXML'));
		const { project, channels } = await importAndReopenAudio(context, new File([bytes], 'Production.wav', { type: 'audio/wav' }));
		assertPcmChannelsEqual(channels, readWavePcm(bytes).channels);
		assert.equal(project.metadata.bext?.description, 'Production boom take');
		assert.equal(project.metadata.ixml?.rawXml, originalXml);
		const plan = createExportPlan(project, { format: 'bwf', sampleRate: rate, bitDepth: bits });
		const delivered = readRiffChunks(encodeWav([new Float32Array(rate).fill(.125)], {
			sampleRate: plan.sampleRate, bitDepth: bits, dither: false, ixml: plan.ixml,
		}));
		const xml = new TextDecoder().decode(delivered.get('iXML'));
		for (const literal of ['<NOTE>Clean boom take</NOTE>', `<SYNC_POINT_LOW>${slate}</SYNC_POINT_LOW>`,
			`<FILE_SAMPLE_RATE>${rate}</FILE_SAMPLE_RATE>`, `<AUDIO_BIT_DEPTH>${bits}</AUDIO_BIT_DEPTH>`,
			'<DIGITIZER_SAMPLE_RATE>48000</DIGITIZER_SAMPLE_RATE>']) assert.ok(xml.includes(literal), literal);
		if (rate === 48_000) assert.equal(xml, originalXml);
	});
}
