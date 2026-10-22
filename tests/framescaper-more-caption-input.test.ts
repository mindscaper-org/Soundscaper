/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';

const project = { schemaFamily: 'framescaper', schemaVersion: 1, id: 'p', sampleRate: 48_000,
	primarySequenceId: 'main', sequences: [{ id: 'main' }], videoCaptionTracks: [] };
const root = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
	+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:timeBase="media" '
	+ 'ttp:tickRate="1000000" xml:lang="en" xml:space="preserve">';
function document(body = '<p xml:id="cue" begin="0t" end="1000000t">Hello</p>') {
	return `${root}<body><div>${body}</div></body></tt>`;
}
function imported(text: string) {
	return importFramescaperCaptionSidecar({ project, format: 'imsc1.1', text,
		trackId: 'captions', sequenceId: 'main', trackName: 'Captions', language: 'en' }).result;
}

test('MI01: caption file import admits a normal standalone XML declaration', async () => {
	const file = new File([`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${document()}`], 'captions.ttml');
	const read = await openFramescaperCaptionSidecarFile({ file });
	assert.ok(read);
	assert.equal(imported(read.text).track.cues[0]?.text, 'Hello');
});

test('MI02: UTF-16 TTML sidecars follow their explicit XML encoding without corrupting Unicode', async () => {
	const text = `<?xml version="1.0" encoding="UTF-16"?>${document().replace('Hello', 'Grüße 世界')}`;
	const bytes = new Uint8Array(2 + text.length * 2);
	bytes.set([255, 254]);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < text.length; index++) view.setUint16(2 + index * 2, text.charCodeAt(index), true);
	const read = await openFramescaperCaptionSidecarFile({ file: new File([bytes], 'captions.ttml') });
	assert.ok(read);
	assert.equal(imported(read.text).track.cues[0]?.text, 'Grüße 世界');
});

test('MI03: IMSC word times add their exact cue origin before rounding to project samples', () => {
	const track = imported(document('<p xml:id="cue" begin="10t" end="100t">'
		+ '<span begin="10t" end="50t">word</span></p>')).track;
	assert.equal(track.cues[0]?.startFrame, 0);
	assert.equal(track.cues[0]?.endFrame, 5);
	assert.deepEqual(track.cues[0]?.words, [{ text: 'word', startFrame: 1, endFrame: 3 }]);
});

test('MI04: harmless XML provenance comments cannot be mistaken for active document declarations', () => {
	const text = document().replace('<body>', '<!-- Converter note: source had <?xml and <!DOCTYPE tokens. -->\n<body>');
	assert.equal(imported(text).track.cues[0]?.text, 'Hello');
});

test('MI09: ordinary WebVTT header metadata stays outside the first caption cue', async () => {
	const read = await openFramescaperCaptionSidecarFile({ file: new File([
		'WEBVTT\nKind: captions\nLanguage: en\n\n00:00.000 --> 00:01.000\nHello\n',
	], 'captions.vtt') });
	assert.ok(read);
	const result = importFramescaperCaptionSidecar({ project, format: read.format, text: read.text,
		trackId: 'captions', sequenceId: 'main', trackName: 'Captions', language: 'en' }).result;
	assert.equal(result.track.cues[0]?.text, 'Hello');
});

test('MI13: TTML file import honors the declared XML text encoding', async () => {
	for (const caption of ['Hello', 'Grüße à Montréal']) {
		const text = `<?xml version="1.0" encoding="ISO-8859-1"?>${document().replace('Hello', caption)}`;
		const read = await openFramescaperCaptionSidecarFile({ file: new File([Buffer.from(text, 'latin1')], 'captions.ttml') });
		assert.ok(read);
		assert.equal(imported(read.text).track.cues[0]?.text, caption);
	}
});
