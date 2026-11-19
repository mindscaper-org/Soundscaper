/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { digestBytes } from '../src/common/media/bytes.ts';
import { createNativeAepImportService } from '../src/common/editor/controller/import/native-aep-import.ts';
import { readNativeAep } from '../src/common/editor/aep-project-reader.ts';
import { readAepText } from '../src/common/editor/aep-text-reader.ts';
import { convertNativeAep } from '../src/common/editor/aep-motion-conversion.ts';
const fixtures = [
	['aepx-pair.aep', 'da8ba17d095ddb1576db658ad28a3966d7231244cf0391f77d71d7aa68c6e085'],
	['aepx-pair.aepx', '59e79c1621de108a4960d2bb6b14bc54e39df658f459af777b50fa95f2b7b32b'],
] as const;
test('pinned AE 2026 binary/XML pair imports the same native identities, text and solid geometry', async () => {
	const documents = [];
	for (const [name, sha] of fixtures) {
		const bytes = await readFile(new URL(`./fixtures/native-aep/${name}`, import.meta.url)); assert.equal(digestBytes(bytes), sha);
		const document = readNativeAep(bytes); documents.push(document.compositions.map(({ id, name, width, height, frameRate, durationFrames, layers }) => ({ id, name, width, height, frameRate, durationFrames, layers: layers.map(({ id, kind, sourceId, parentId }) => ({ id, kind, sourceId, parentId })) })));
		assert.equal(document.compositions.length, 6); assert.equal(document.compositions.reduce((sum, comp) => sum + comp.layers.length, 0), 7);
		const text = document.compositions.flatMap(comp => comp.layers).find(layer => layer.kind === 3)!;
		assert.equal(readAepText(text)?.runs[0]?.text, 'A'); assert.equal(readAepText(text)?.runs[0]?.font, 'TimesNewRomanPSMT');
		let id = 0; const service = createNativeAepImportService({ begin() { throw new Error('Review must not publish.'); }, allocateId: () => `corpus-${String(++id)}` });
		const prepared = await service.prepare({ file: new Blob([bytes]), name });
		assert.deepEqual(prepared.fonts, ['TimesNewRomanPSMT']); assert.equal(prepared.project.compositions[0]!.width, 1920);
		assert.equal(prepared.project.compositions.flatMap(comp => comp.layers).filter(layer => layer.kind === 'solid').length, 5);
	}
	assert.deepEqual(documents[0], documents[1]);
});
test('native text maps authored characters to an explicit retained font and reports layout differences', async () => {
	const bytes = await readFile(new URL('./fixtures/native-aep/aepx-pair.aep', import.meta.url)); const sha256 = digestBytes(bytes); let index = 0;
	const project = convertNativeAep(readNativeAep(bytes), { projectId: 'text-project', title: 'Text', allocateId: () => `text-${String(++index)}`, media: [],
		source: { kind: 'attachment', id: 'original', name: 'Source.aep', mimeType: 'application/vnd.adobe.aftereffects.project', byteLength: bytes.length, sha256, storageKey: `motion-sha256:${sha256}` },
		fonts: [{ postScriptName: 'TimesNewRomanPSMT', asset: { kind: 'font', id: 'font', name: 'Explicit choice', family: 'Fixture', style: 'Regular', mimeType: 'font/ttf', byteLength: 12, sha256: '0'.repeat(64), storageKey: `motion-sha256:${'0'.repeat(64)}` } }] });
	const layer = project.compositions.flatMap(comp => comp.layers).find(layer => layer.kind === 'text'); assert.ok(layer); if (layer.kind !== 'text') return;
	assert.equal(layer.document.runs[0]!.text, 'A'); assert.equal(layer.document.runs[0]!.fontAssetId, 'font'); assert.equal(layer.document.runs[0]!.fontSize.value, 100);
	assert.ok(project.nativeImport!.report.some(row => row.code === 'text-layout')); assert.ok(project.nativeImport!.report.some(row => row.code === 'editable-text'));
});
