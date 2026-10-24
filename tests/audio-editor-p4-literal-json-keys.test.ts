/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeScapeProjectDocument, parseScapeProjectDocument, sameSerializedScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { evaluateProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import { projectHasScapeLiteralKeys } from '../src/common/editor/scape-literal-json-keys.ts';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createAup4ExportPlan } from '../src/common/editor/aup4-export.js';
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js';
import { decodeAup4ProjectTree } from '../src/common/editor/aup4-conversion.js';

const BINARY = '$soundscaperOpaqueBinary';
const ESCAPE = '$soundscaperLiteralKey:';
const FEATURE = 'org.soundscaper.capability.literal-json-keys';
const parse = (text: string): unknown => parseScapeProjectDocument(text, { currentProjectSchemaFamily: 'soundscaper' });

test('literal reserved keys and descriptor-shaped ordinary data roundtrip alongside real binary', () => {
	const opaqueExtensions = Object.fromEntries([[BINARY, 'Reviewed credit'], ['ordinary', {
		[BINARY]: { schemaVersion: 1, id: 1, type: 'Uint8Array', byteLength: 1, base64: 'AQ==' },
	}], [ESCAPE + BINARY, { bytes: Uint8Array.of(7, 11), [ESCAPE + ESCAPE]: 3 }], ['__proto__', 'Own data']]);
	const project = createSoundscaperProject({ id: 'literal-keys', opaqueExtensions });
	const text = serializeScapeProjectDocument(project);
	const encoded: unknown = JSON.parse(text);
	assert.ok(encoded && typeof encoded === 'object' && 'opaqueExtensions' in encoded);
	assert.ok(encoded.opaqueExtensions && typeof encoded.opaqueExtensions === 'object');
	assert.ok(Object.hasOwn(encoded.opaqueExtensions, ESCAPE + BINARY));
	assert.ok(Object.hasOwn(encoded.opaqueExtensions, ESCAPE + ESCAPE + BINARY));
	assert.deepEqual(parse(text), project);
	assert.equal(sameSerializedScapeProjectDocument(project, structuredClone(project)), true);
	assert.equal(sameSerializedScapeProjectDocument(project, { ...project, opaqueExtensions: {} }), false);
});

test('literal-key documents declare incompatibility for readers without key decoding', () => {
	const ordinary = createSoundscaperProject({ id: 'ordinary' });
	assert.equal(ordinary.featureRequirements.requirements.some(row => row.featureId === FEATURE), false);
	const project = createSoundscaperProject({ id: 'literal-keys', metadata: { tags: { [BINARY]: 'Credit' } } });
	const requirement = project.featureRequirements.requirements.find(row => row.featureId === FEATURE);
	assert.ok(requirement); assert.equal(requirement.disposition, 'bypass');
	const olderReader = evaluateProjectFeatureRequirements(project.featureRequirements, { knownFeatureIds: new Set(), availableFeatureIds: new Set() });
	assert.equal(olderReader.compatible, false);
	assert.equal(olderReader.items.find(row => row.featureId === FEATURE)?.availability, 'unknown');
});

test('literal escaping rejects noncanonical aliases and decoded-key collisions', () => {
	const featureRequirements = { schemaVersion: 2, requirements: [{ id: 'literal', featureId: FEATURE, displayName: 'Literal keys', disposition: 'bypass', fallback: null }] };
	for (const opaqueExtensions of [{ [ESCAPE + 'ordinary']: 1 }, { [BINARY]: 'forged descriptor' },
		{ [ESCAPE + BINARY]: 1, [BINARY]: { schemaVersion: 1, id: 1, type: 'Uint8Array', byteLength: 1, base64: 'AQ==' } }]) {
		assert.throws(() => parse(JSON.stringify({ schemaFamily: 'soundscaper', schemaVersion: 1, featureRequirements, opaqueExtensions })));
	}
});

test('older documents retain prefix-shaped keys without opting into literal key decoding', () => {
	const project = createSoundscaperProject({ id: 'old-prefix', metadata: { tags: { [ESCAPE + 'ordinary']: 'Credit', [ESCAPE + BINARY]: 'Other credit' } } });
	assert.equal(project.featureRequirements.requirements.some(row => row.featureId === FEATURE), false);
	const oldText = JSON.stringify(project);
	assert.deepEqual(parse(oldText), project);
	assert.equal(serializeScapeProjectDocument(project), oldText);
});

test('capability inspection refuses oversized sparse arrays before enumerating holes or invoking metadata getters', () => {
	const huge: unknown[] = []; huge.length = 0xffff_ffff;
	assert.throws(() => projectHasScapeLiteralKeys({ opaqueExtensions: huge }), RangeError);
	let reads = 0;
	const metadata = Object.defineProperty({}, 'tag', { enumerable: true, get() { reads++; return 1; } });
	assert.equal(projectHasScapeLiteralKeys({ metadata }), false);
	assert.equal(reads, 0);
});

test('Framescaper derives the same codec declaration and retains its own native family', () => {
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { metadata: { tags: { [BINARY]: 'Credit' } } });
	assert.ok(project.featureRequirements.requirements.some(row => row.featureId === FEATURE));
	const reopened = parseScapeProjectDocument(serializeScapeProjectDocument(project), { currentProjectSchemaFamily: 'framescaper' });
	assert.ok(validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, reopened));
	assert.equal(reopened.metadata.tags[BINARY], 'Credit');
});


test('Audacity metadata uses its own binary XML and needs no native JSON key escape', async () => {
	const project = createSoundscaperProject({ id: 'literal-aup4', metadata: { tags: { [BINARY]: 'Reviewed credit' } } });
	const before = structuredClone(project);
	const plan = createAup4ExportPlan(project);
	const tree = createAup4ProjectTree(plan.project);
	const reopened = await decodeAup4ProjectTree(tree, () => { throw new Error('No audio blocks are required.'); });
	assert.equal(reopened.project.metadata.tags[BINARY.toUpperCase()], 'Reviewed credit');
	assert.deepEqual(project, before);
});
