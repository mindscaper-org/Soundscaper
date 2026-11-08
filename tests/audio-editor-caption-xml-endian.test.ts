/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { importVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';

function document(encoding: string): string {
	return `<?xml version="1.0" encoding="${encoding}"?>`
		+ '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xml:id="captions" xml:lang="fr" xml:space="preserve" ttp:timeBase="media" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000"><body><div><p xml:id="cue" begin="0t" end="1000t">Élodie au café</p></div></body></tt>';
}
function encoded(text: string, encoding: 'utf8' | 'utf16le' | 'utf16be', marked = false): Uint8Array<ArrayBuffer> {
	const bytes = Buffer.from(text, encoding === 'utf8' ? 'utf8' : 'utf16le');
	if (encoding === 'utf16be') bytes.swap16();
	const marker = !marked ? [] : encoding === 'utf16be' ? [254, 255] : encoding === 'utf16le' ? [255, 254] : [239, 187, 191];
	return Uint8Array.from([...marker, ...bytes]);
}
const options = { format: 'imsc1.1' as const, sampleRate: 48_000, trackId: 'captions', sequenceId: 'main', trackName: 'Dialogue', language: 'fr' };

for (const [label, encoding] of [['UTF-8', 'utf8'], ['UTF-16LE', 'utf16le'], ['UTF-16BE', 'utf16be']] as const) {
	for (const marked of [false, true]) test(`caption file decoding preserves declared ${label}: BOM=${marked}`, async () => {
		const source = document(label);
		const file = new File([encoded(source, encoding, marked)], 'dialogue.ttml');
		const opened = await openFramescaperCaptionSidecarFile({ file }); assert.ok(opened);
		assert.equal(opened.text, source);
		const imported = importVideoCaptionTrackV1(opened.text, options);
		assert.equal(imported.track.cues[0]?.text, 'Élodie au café'); assert.deepEqual(imported.losses, []);
	});
}

test('desktop caption file capabilities share the unmarked UTF-16 decoder', async () => {
	const file = new File([encoded(document('UTF-16BE'), 'utf16be')], 'dialogue.ttml');
	const opened = await openFramescaperCaptionSidecarFile({ fileService: {
		isDesktop: true, chooseFiles: () => [{ id: 'picked' }], openReadDescriptor: () => file,
	} }); assert.ok(opened);
	assert.equal(importVideoCaptionTrackV1(opened.text, options).track.cues[0]?.text, 'Élodie au café');
});

for (const order of ['utf16le', 'utf16be'] as const) test(`unmarked ${order} still refuses malformed or contradictory declarations and payloads`, async () => {
	for (const source of [document('UTF-8'), document('UTF-16'), document(order === 'utf16be' ? 'UTF-16LE' : 'UTF-16BE'),
		document('UTF-16BE').replace(/ encoding="[^"]+"/u, '')]) {
		await assert.rejects(openFramescaperCaptionSidecarFile({ file: new File([encoded(source, order)], 'invalid.ttml') }));
	}
	const bytes = encoded(document(order === 'utf16be' ? 'UTF-16BE' : 'UTF-16LE'), order);
	await assert.rejects(openFramescaperCaptionSidecarFile({ file: new File([bytes.slice(0, -1)], 'truncated.ttml') }));
});

test('UTF-16 detection does not relax the owning IMSC DTD, entity, or processing-instruction refusals', async () => {
	for (const injected of ['<!DOCTYPE tt>', '<!DOCTYPE tt [<!ENTITY injected "text">]>', '<?unsafe payload?>']) {
		const source = document('UTF-16BE').replace('?><tt', `?>${injected}<tt`);
		const opened = await openFramescaperCaptionSidecarFile({ file: new File([encoded(source, 'utf16be')], 'unsafe.ttml') }); assert.ok(opened);
		assert.throws(() => importVideoCaptionTrackV1(opened.text, options), /declaration|entity|processing|DTD/iu);
	}
});
