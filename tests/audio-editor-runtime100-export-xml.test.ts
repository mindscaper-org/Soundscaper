/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeXml, serializeXmlDocument, XML_DECLARATION, xmlElement } from '../src/common/editor/dawproject-xml.ts';

test('R16 XML escaping scans once while preserving nested entities and Unicode', () => {
	const replace = String.prototype.replace;
	const replaceAll = String.prototype.replaceAll;
	let scans = 0;
	String.prototype.replace = new Proxy(replace, { apply(target, receiver, args) { scans++; return Reflect.apply(target, receiver, args) as string; } });
	String.prototype.replaceAll = new Proxy(replaceAll, { apply(target, receiver, args) { scans++; return Reflect.apply(target, receiver, args) as string; } });
	try {
		assert.equal(escapeXml('&amp;<tag>"\r\t\n😀\ud800x\udfff\u0000\ufffe\uffff\u000b\u000c\u001f\u007f\u0085'), '&amp;amp;&lt;tag&gt;&quot;&#13;\t\n😀x\u007f\u0085');
		assert.equal(scans, 1);
	} finally { String.prototype.replace = replace; String.prototype.replaceAll = replaceAll; }
	const document = xmlElement('root', { text: '&amp;\t\n\r😀\ud800' }, [], '<text>\r😀');
	assert.equal(serializeXmlDocument(document), `${XML_DECLARATION}\n<root text="&amp;amp;&#9;&#10;&#13;😀">&lt;text&gt;&#13;😀</root>\n`);
});

test('R17 XML indentation is prepared once per used bounded depth', () => {
	const root = xmlElement('root', {}, Array.from({ length: 1000 }, (_, index) => xmlElement('item', { id: index })));
	const repeat = String.prototype.repeat;
	let repeats = 0;
	String.prototype.repeat = new Proxy(repeat, { apply(target, receiver, args) { repeats++; return Reflect.apply(target, receiver, args) as string; } });
	let result: string;
	try { result = serializeXmlDocument(root); } finally { String.prototype.repeat = repeat; }
	assert.equal(result, `${XML_DECLARATION}\n<root>\n${Array.from({ length: 1000 }, (_, index) => `  <item id="${index}"/>`).join('\n')}\n</root>\n`);
	assert.ok(repeats <= 2, `indent repeat calls: ${repeats}`);
	let deep = xmlElement('leaf');
	for (let index = 0; index < 70; index++) deep = xmlElement('branch', {}, [deep]);
	const serialized = serializeXmlDocument(deep);
	assert.ok(serialized.includes(`${'  '.repeat(70)}<leaf/>`));
	assert.equal(serializeXmlDocument(xmlElement('empty')), `${XML_DECLARATION}\n<empty/>\n`);
});
