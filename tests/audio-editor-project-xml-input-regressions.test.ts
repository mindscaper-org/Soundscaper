/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import {
	DAWPROJECT_XML_LIMITS, numberAttribute, parseXmlDocument, serializeXmlDocument, xmlElement,
} from '../src/common/editor/dawproject-xml.ts';

test('DAWproject CDATA metadata survives import', () => {
	const document = parseDawprojectDocument('<Project/>', '<MetaData><Title><![CDATA[Room & tone]]></Title></MetaData>');
	assert.equal(document.metadata.title, 'Room & tone');
});

test('project XML document limits measure encoded UTF-8 bytes', () => {
	assert.throws(() => parseXmlDocument('<x>ééé</x>', { ...DAWPROJECT_XML_LIMITS, maximumBytes: 11 }), /byte limit/u);
});

test('project XML element text limits measure encoded UTF-8 bytes', () => {
	assert.throws(() => parseXmlDocument('<x>ééé</x>', { ...DAWPROJECT_XML_LIMITS, maximumTextBytes: 5 }), /bytes of text/u);
});

test('CDATA consumes the same bounded element text budget as ordinary text', () => {
	assert.throws(() => parseXmlDocument('<x><![CDATA[abcdef]]></x>', { ...DAWPROJECT_XML_LIMITS, maximumTextBytes: 5 }), /bytes of text/u);
});

test('exported clip names retain tabs and newlines when XML is read again', () => {
	const name = 'First\tsecond\nthird\rfourth';
	const xml = serializeXmlDocument(xmlElement('Clip', { name }));
	assert.equal(parseXmlDocument(xml).attributes.name, name);
});

test('export removes lone UTF-16 surrogates while preserving supplementary characters', () => {
	const xml = serializeXmlDocument(xmlElement('Title', {}, [], 'A\ud800B\udc00C🎵'));
	assert.equal(parseXmlDocument(xml).text, 'ABC🎵');
});

test('XML-schema negative infinity imports as a silent decibel fader', () => {
	assert.equal(numberAttribute(parseXmlDocument('<Volume value="-INF"/>'), 'value'), Number.NEGATIVE_INFINITY);
});

test('JavaScript hexadecimal literals are refused as project XML numbers', () => {
	assert.throws(() => numberAttribute(parseXmlDocument('<Clip time="0x10"/>'), 'time'), /not a number/u);
});
