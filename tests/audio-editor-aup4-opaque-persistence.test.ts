/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
import { decodeAup4ProjectTree } from '../src/common/editor/aup4-conversion.js';
import {
	cloneAup4OpaqueProjectValue,
	rehydrateAup4OpaqueInt64Attribute,
} from '../src/common/editor/aup4-opaque-persistence.ts';
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js';
import { publishProjectView } from '../src/common/editor/controller/document/document-snapshot.ts';
import { parseScapeProjectDocument, serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';

const xmlChildren = audacityXmlChildren as unknown as (node: unknown, name: string) => unknown[];

test('opaque AUP4 int64 values persist as exact JSON-safe decimals and rehydrate for export', () => {
	const imported = {
		kind: 'attribute', name: 'revision', type: 'long-long', value: 9_007_199_254_740_993n,
	};
	const persisted = cloneAup4OpaqueProjectValue(imported) as Readonly<Record<string, unknown>>;
	assert.equal(persisted.value, '9007199254740993');
	assert.doesNotThrow(() => JSON.stringify(persisted));
	assert.deepEqual(rehydrateAup4OpaqueInt64Attribute(persisted), imported);
});

test('opaque AUP4 int64 rehydration rejects noncanonical and out-of-range decimals', () => {
	const attribute = { kind: 'attribute', name: 'revision', type: 'long-long' };
	for (const value of ['-0', '+1', '01', '9223372036854775808', '-9223372036854775809']) {
		assert.equal(rehydrateAup4OpaqueInt64Attribute({ ...attribute, value }), null);
	}
	assert.deepEqual(
		rehydrateAup4OpaqueInt64Attribute({ ...attribute, value: '-9223372036854775808' }),
		{ ...attribute, value: -9_223_372_036_854_775_808n },
	);
	assert.deepEqual(
		rehydrateAup4OpaqueInt64Attribute({ ...attribute, value: '9223372036854775807' }),
		{ ...attribute, value: 9_223_372_036_854_775_807n },
	);
});

test('AUP4 conversion persists nested int64 attributes safely and re-exports exact values', async () => {
	const integer = 9_007_199_254_740_993n;
	const opaqueNode = createAudacityXmlNode('plugin-state', [
		{ kind: 'attribute', name: 'revision', type: 'long-long', value: integer },
	]);
	const root = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
		{ kind: 'attribute', name: 'audacityversion', type: 'string', value: '4.0.0' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000 },
	], [{ kind: 'node', node: opaqueNode }]);
	const { project } = await decodeAup4ProjectTree(root, async () => null);

	assert.doesNotThrow(() => JSON.stringify(project));
	const rewritten = createAup4ProjectTree(project);
	assert.equal(
		audacityXmlAttribute(xmlChildren(rewritten, 'plugin-state')[0], 'revision'),
		integer,
	);
});

test('imported Audacity plug-in bytes survive immutable publication, Scape reopen, and native export', async () => {
	const bytes = Uint8Array.of(0, 1, 128, 255);
	const nativeEffect = createAudacityXmlNode('effect', [
		{ kind: 'attribute', name: 'id', type: 'string', value: 'Effect_VST3_Acme_PlugIn_Path' },
	], [{ kind: 'blob', name: 'state', value: bytes }]);
	const rack = createAudacityXmlNode('effects', [], [{ kind: 'node', node: nativeEffect }]);
	const native = encodeAudacityBinaryXml(createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
		{ kind: 'attribute', name: 'audacityversion', type: 'string', value: '4.0.0' },
	], [{ kind: 'node', node: rack }]));
	const decoded = await decodeAup4ProjectTree(decodeAudacityBinaryXml(native.dictionary, native.document).root, async () => null);
	const imported = importSoundscaperAudacityProject(decoded.project);
	const published = publishProjectView(imported);
	assert.strictEqual(publishProjectView(imported), published);
	assert.ok(validateSoundscaperProject(published));
	const effect = published.master.effects[0];
	assert.ok(effect);
	assert.equal(effect.type, 'missing');
	const opaque = effect.opaqueAudacityNode as { node: { content: { value: unknown }[] } };
	const state = opaque.node.content.at(-1);
	assert.ok(state?.value instanceof Uint8Array);
	assert.ok(Object.isFrozen(state));
	assert.deepEqual(state.value, bytes);
	state.value.fill(42);
	assert.deepEqual(state.value, bytes);

	const serialized = serializeScapeProjectDocument(published);
	assert.equal(serialized, serializeScapeProjectDocument(imported));
	const reopened = parseScapeProjectDocument(serialized);
	assert.ok(validateSoundscaperProject(reopened));
	const rewritten = createAup4ProjectTree(reopened);
	const exported = encodeAudacityBinaryXml(rewritten);
	const reparsed = decodeAudacityBinaryXml(exported.dictionary, exported.document).root;
	const effects = xmlChildren(xmlChildren(reparsed, 'effects').at(-1), 'effect');
	assert.deepEqual(effects[0], nativeEffect);
});
