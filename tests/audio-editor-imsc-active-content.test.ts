/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';

const XML = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter"'
	+ ' xml:space="preserve" ttp:timeBase="media" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text"'
	+ ' ttp:tickRate="48000"><body><div><p xml:id="c1" begin="0t" end="1t">safe</p></div></body></tt>';
const OPTIONS = { format: 'imsc1.1', sampleRate: 48_000, trackId: 't1', sequenceId: 's1', trackName: 'Test', language: 'en' } as const;

test('IMSC parses the original XML and permits harmless comments and the XML declaration', () => {
	const result = importVideoCaptionTrackV1('<?xml version="1.0"?><!-- harmless -->' + XML, OPTIONS);
	assert.equal(result.track.cues[0]?.text, 'safe');
});

test('IMSC rejects active XML and malformed nested comments without rewriting the document', () => {
	for (const input of [
		'<!DOCTYPE tt SYSTEM "https://example.invalid/caption.dtd">' + XML,
		'<!DOCTYPE tt [<!ENTITY exfil SYSTEM "file:///etc/passwd">]>' + XML.replace('safe', '&exfil;'),
		'<?xml-stylesheet href="https://example.invalid/style.css"?>' + XML,
		XML.replace('safe', '<![CDATA[x]]>'),
		XML.replace('safe', '<script>x</script>'),
		'<!--a<!--b-->-->' + XML,
	]) assert.throws(() => importVideoCaptionTrackV1(input, OPTIONS));
});
