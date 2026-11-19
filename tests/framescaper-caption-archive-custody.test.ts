/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { framescaperCaptionCustody } from './helpers/framescaper-caption-custody.ts';

function imsc(body: string, options: Readonly<{ encoding?: string; language?: string; id?: string; head?: string }> = {}): string {
	return `<?xml version="1.0" encoding="${options.encoding ?? 'UTF-8'}"?>`
		+ '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ `xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:id="${options.id ?? 'captions'}" xml:lang="${options.language ?? 'en'}" xml:space="preserve" `
		+ 'ttp:timeBase="media" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ `${options.head ?? ''}<body><div>${body}</div></body></tt>`;
}

function cue(text: string, attributes = ''): string {
	return `<p xml:id="cue" begin="0t" end="1000t"${attributes}>${text}</p>`;
}

for (const [encoding, marked] of [['UTF-8', false], ['UTF-16BE', true], ['UTF-16BE', false], ['UTF-16LE', false]] as const) {
	test(`caption ${encoding} BOM=${marked} retains exact Unicode and frame clocks through controller and Scape`, async context => {
		const text = imsc(cue('Élodie au café'), { encoding, language: 'fr' });
		const bytes = Buffer.from(text, encoding === 'UTF-8' ? 'utf8' : 'utf16le');
		if (encoding === 'UTF-16BE') bytes.swap16();
		const body = marked ? Buffer.concat([Buffer.from([254, 255]), bytes]) : bytes;
		const custody = await framescaperCaptionCustody(context, new File([Uint8Array.from(body)], 'captions.ttml'));
		assert.deepEqual(custody.losses, []);
		assert.equal(custody.track.language, 'fr');
		assert.deepEqual(custody.track.cues.map(cue => [cue.text, cue.startFrame, cue.endFrame]), [['Élodie au café', 0, 48_000]]);
		const saved = await custody.sidecar('imsc1.1');
		assert.match(saved.text, /Élodie au café/u);
		assert.deepEqual(saved.restored.cues, custody.track.cues);
	});
}

for (const explicit of [false, true]) test(`caption initial/explicit style=${explicit} survives real publication and sidecar delivery`, async context => {
	const head = '<head><styling><style xml:id="spoken" tts:fontSize="75%"'
		+ `${explicit ? ' tts:backgroundColor="#000000cc" tts:textAlign="center"' : ''}/></styling></head>`;
	const custody = await framescaperCaptionCustody(context, new File([imsc(cue('Dialogue', ' style="spoken"'), { head })], 'style.ttml'));
	const style = custody.track.styles[0]; assert.ok(style);
	assert.equal(style.fontSizePercent, 5);
	assert.equal(style.backgroundColor, explicit ? '#000000cc' : '#00000000');
	assert.equal(style.textAlign, explicit ? 'center' : 'start');
	const saved = await custody.sidecar('imsc1.1');
	assert.ok(saved.text.includes(`tts:backgroundColor="${explicit ? '#000000cc' : '#00000000'}"`));
	assert.ok(saved.text.includes(`tts:textAlign="${explicit ? 'center' : 'start'}"`));
	assert.deepEqual(saved.restored.styles, custody.track.styles);
});

for (const format of ['imsc1.1', 'srt'] as const) test(`caption ${format} font units survive controller, archive, and IMSC delivery`, async context => {
	const text = format === 'srt' ? '1\n00:00:00,000 --> 00:00:01,000\n<b>Readable caption</b>\n'
		: imsc(cue('Readable caption', ' style="spoken"'), { head: '<head><styling><style xml:id="spoken" tts:fontSize="75%"/></styling></head>' });
	const custody = await framescaperCaptionCustody(context, new File([text], format === 'srt' ? 'font.srt' : 'font.ttml'));
	assert.equal(custody.track.styles[0]?.fontSizePercent, 5);
	assert.equal(custody.track.cues[0]?.text, 'Readable caption');
	const saved = await custody.sidecar('imsc1.1');
	assert.ok(saved.text.includes('tts:fontSize="75%"'));
	assert.ok(saved.text.includes('Readable caption'));
	assert.equal(saved.restored.styles[0]?.fontSizePercent, 5);
});

test('caption private-use language and imported identity survive archive and file delivery', async context => {
	const custody = await framescaperCaptionCustody(context, new File([imsc(cue('Speech'), { id: 'studio', language: 'x-studio' })], 'studio.ttml'));
	assert.equal(custody.track.id, 'studio');
	assert.equal(custody.track.language, 'x-studio');
	const saved = await custody.sidecar('imsc1.1');
	assert.equal(saved.file.name, 'studio.ttml');
	assert.ok(saved.text.includes('xml:lang="x-studio"'));
	assert.equal(saved.restored.language, 'x-studio');
});

test('caption decimal region geometry survives controller, Scape and repeated file import', async context => {
	const head = '<head><layout><region xml:id="lower" tts:origin="0.0000001% 70%" tts:extent="80% 20%" tts:displayAlign="after"/></layout></head>';
	const custody = await framescaperCaptionCustody(context, new File([imsc(cue('Preserve this caption', ' region="lower"'), { head })], 'decimal.ttml'));
	assert.equal(custody.track.regions[0]?.xPercent, 1e-7);
	assert.equal(custody.track.regions[0]?.yPercent, 70);
	const saved = await custody.sidecar('imsc1.1');
	assert.ok(saved.text.includes('tts:origin="0.0000001% 70%"'));
	assert.deepEqual(saved.restored.regions, custody.track.regions);
	assert.deepEqual(saved.restored.cues, custody.track.cues);
});

for (const literal of [false, true]) test(`caption literal markup=${literal} keeps exact sidecar semantics after archive reopen`, async context => {
	const expected = literal ? '<b>Literal</b>' : 'Ordinary literal';
	const custody = await framescaperCaptionCustody(context, new File([imsc(cue(literal ? '&lt;b&gt;Literal&lt;/b&gt;' : expected))], 'Literal.ttml'));
	assert.equal(custody.track.cues[0]?.text, expected);
	assert.equal(custody.track.cues[0]?.styleId, null);
	if (literal) await assert.rejects(custody.sidecar('srt'), /passive maintained subset/u);
	const saved = await custody.sidecar(literal ? 'webvtt' : 'srt');
	assert.equal(saved.restored.cues[0]?.text, expected);
	assert.equal(saved.restored.cues[0]?.styleId, null);
});
