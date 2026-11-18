/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSubprojectGraphAcyclic, resolveSubprojectGraph } from '../src/common/editor/controller/document/internal/subprojects/subproject-graph.ts';
import type { SubprojectDocument } from '../src/common/editor/controller/document/subproject-actions.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

function fixture(id: string): SubprojectDocument { return createSoundscaperProject({ id }) as SubprojectDocument; }
function nest(parent: SubprojectDocument, child: string, libraryId = 'library'): SubprojectDocument {
	const id = `proxy-${child}`;
	return applySoundscaperProjectCommand(parent, { type: 'subproject/install', expected: null,
		source: { id, kind: 'audio', name: child, sampleRate: 48000, channelCount: 1, frameCount: 4, storageKey: id },
		link: { id: `link-${child}`, projectId: child, libraryId, title: child, sourceId: id, followLatest: true,
			revision: 0, contentDigest: 'a'.repeat(64), sampleRate: 48000, channelCount: 1, frameCount: 4 },
	}) as SubprojectDocument;
}

test('dependency resolution detects indirect cycles and bounds depth before rendering', async () => {
	const documents = new Map([['child', nest(fixture('child'), 'grandchild')], ['grandchild', nest(fixture('grandchild'), 'parent')]]);
	await assert.rejects(resolveSubprojectGraph('child', 'library', id => Promise.resolve(documents.get(id) ?? null), ['parent']), /cycle/iu);
	for (let index = 0; index < 10; index++) documents.set(`level-${index}`, nest(fixture(`level-${index}`), `level-${index + 1}`));
	await assert.rejects(resolveSubprojectGraph('level-0', 'library', id => Promise.resolve(documents.get(id) ?? null)), /depth/iu);
});

test('grandchild output invalidates a saved ancestor even without an ancestor revision change', async () => {
	const child = nest(fixture('child'), 'grandchild');
	const documents = new Map([['child', child], ['grandchild', fixture('grandchild')]]);
	const load = (id: string) => Promise.resolve(documents.get(id) ?? null);
	const before = await resolveSubprojectGraph('child', 'library', load);
	documents.set('grandchild', { ...fixture('grandchild'), master: { gain: 0.25 } });
	const after = await resolveSubprojectGraph('child', 'library', load);
	assert.equal(before.project.revision, after.project.revision);
	assert.notEqual(before.digest, after.digest);
	assert.notEqual(before.children[0]!.node?.digest, after.children[0]!.node?.digest);
});

test('pinned and foreign-library links retain their installed audio without reading another project', async () => {
	let child = nest(fixture('child'), 'pinned');
	const metadata = child.metadata as { subprojects: { followLatest: boolean }[] };
	metadata.subprojects[0]!.followLatest = false;
	child = nest(child, 'foreign', 'other-library');
	const node = await resolveSubprojectGraph('child', 'library', id => {
		assert.equal(id, 'child'); return Promise.resolve(child);
	});
	assert.deepEqual(node.children.map(entry => entry.node), [null, null]);
});

test('a pinned dependency cannot hide an indirect cycle during link admission', async () => {
	const child = nest(fixture('child'), 'grandchild');
	(child.metadata as { subprojects: { followLatest: boolean }[] }).subprojects[0]!.followLatest = false;
	const documents = new Map([['child', child], ['grandchild', nest(fixture('grandchild'), 'parent')]]);
	await assert.rejects(assertSubprojectGraphAcyclic('child', 'library', id => Promise.resolve(documents.get(id) ?? null), ['parent']), /cycle/iu);
});

test('a deleted nested edit falls back to its saved proxy so a sibling’s new mix can publish', async () => {
	const middle = nest(nest(fixture('middle'), 'removed'), 'sibling');
	const documents = new Map([['middle', middle], ['removed', fixture('removed')], ['sibling', fixture('sibling')]]);
	const load = (id: string) => Promise.resolve(documents.get(id) ?? null);
	const before = await resolveSubprojectGraph('middle', 'library', load);
	documents.delete('removed');
	documents.set('sibling', { ...fixture('sibling'), master: { gain: 0.25 } });

	const after = await resolveSubprojectGraph('middle', 'library', load);

	assert.equal(after.children[0]?.node, null);
	assert.equal(after.children[0]?.link.sourceId, 'proxy-removed');
	assert.notEqual(after.children[1]?.node?.digest, before.children[1]?.node?.digest);
});
