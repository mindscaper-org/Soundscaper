/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAepxContainer } from '../src/common/editor/aepx-container.ts';
const xml = (body: string) => new TextEncoder().encode(`<?xml version="1.0"?><AfterEffectsProject xmlns="http://www.adobe.com/products/aftereffects" majorVersion="1" minorVersion="0">${body}</AfterEffectsProject>`);
test('native AEPX maps XML chunks, escaped text, hex and file references without path access', () => {
	const chunks = parseAepxContainer(xml('<Fold><Item><string>A &amp; B</string><idta bdata="0004"/></Item></Fold><Pin><Als2><fileReference fullpath="C:\\private\\file.png" target_is_folder="0"/></Als2></Pin><btdk bdata="010203"/>'));
	assert.equal(chunks[0]!.type, 'Fold'); assert.equal(new TextDecoder().decode(chunks[0]!.children![0]!.children![0]!.data), 'A & B');
	assert.deepEqual(chunks[0]!.children![0]!.children![1]!.data, new Uint8Array([0, 4]));
	assert.equal(chunks[1]!.type, 'Pin '); assert.equal(chunks[2]!.type, 'btdk'); assert.equal(chunks[2]!.children, null);
	assert.equal(JSON.parse(new TextDecoder().decode(chunks[1]!.children![0]!.children![0]!.data)).fullpath, 'C:\\private\\file.png');
});
test('native AEPX refuses malformed XML, DTDs, entities, odd hex and mixed data', () => {
	for (const body of ['<Fold>', '<Fold bdata="0"/>', '<Fold bdata="gg"/>', '<Fold bdata="00"><Item/></Fold>', '<string>&external;</string>']) assert.throws(() => parseAepxContainer(xml(body)));
	assert.throws(() => parseAepxContainer(new TextEncoder().encode('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///secret">]><AfterEffectsProject/>')), /DTD|DOCTYPE/iu);
	assert.throws(() => parseAepxContainer(new TextEncoder().encode('<Other/>')), /AEPX/iu);
	assert.throws(() => parseAepxContainer(new TextEncoder().encode('<AfterEffectsProject majorVersion="2" minorVersion="0"/>')), /version/iu);
});
