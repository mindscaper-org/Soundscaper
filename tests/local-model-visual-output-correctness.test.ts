/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, prepareModelInput } from './electron/local-assistance-models/model-inputs.js';
import { validateModelOutput } from './electron/local-assistance-models/model-output-validation.js';

const box = { x: 0.1, y: 0.1, width: 0.4, height: 0.1 };
const authority = { width: 512, height: 512, timescale: 30,
	frames: [0, 1].map(sourceFrame => ({ sourceFrame, presentationTick: String(sourceFrame) })) };
const ocrInput = { bytes: Buffer.from('source'), authority: { ...authority, frames: authority.frames.slice(0, 1) },
	expectedOcr: { sourceFrame: 0, text: 'LOCAL MODEL TEST', maximumCharacterErrorRate: 0.1 } };
const ocr = (lines: readonly string[]) => Buffer.from(JSON.stringify({ schemaVersion: 1,
	...ocrInput.authority, frames: [{ sourceFrame: 0, presentationTick: '0',
		regions: lines.map((text, index) => ({ text, confidence: 0.95, box: { ...box, y: 0.3 + index * 0.2 } })) }] }));

test('OCR correctness rejects arbitrary readable output, missing text, and the observed spelling defects', () => {
	for (const lines of [['RANDOM WORDS'], ['LOCAL MODEL'], ['LOCAL MODEI', 'TSET']]) {
		assert.throws(() => validateModelOutput('ocr', ocr(lines), ocrInput), /OCR.*(text|character)/u);
	}
});

test('OCR correctness permits only the declared small character error budget and reports every observed edit', () => {
	const exact = validateModelOutput('ocr', ocr(['local model', 'test']), ocrInput) as {
		text: { expectedText: string; recognizedText: string; editDistance: number; characterErrorRate: number };
	};
	assert.equal(exact.text.expectedText, 'LOCAL MODEL TEST');
	assert.equal(exact.text.recognizedText, 'LOCAL MODEL TEST');
	assert.equal(exact.text.editDistance, 0);
	const typo = validateModelOutput('ocr', ocr(['LOCAL MODEI', 'TEST']), ocrInput) as typeof exact;
	assert.equal(typo.text.editDistance, 1);
	assert.equal(typo.text.characterErrorRate, 1 / 16);
	assert.throws(() => validateModelOutput('ocr', ocr(['LOCAL MODEI', 'TSET']), ocrInput), (error: unknown) => {
		const failure = error as Error & { summary: { text: typeof exact.text } };
		assert.equal(failure.summary.text.recognizedText, 'LOCAL MODEI TSET');
		assert.equal(failure.summary.text.editDistance, 3);
		assert.equal(failure.summary.text.characterErrorRate, 3 / 16);
		return true;
	});
});

const expectedSubjects = [
	{ sourceFrame: 0, kind: 'face', label: 'face', classId: null },
	{ sourceFrame: 1, kind: 'object', label: 'cat', classId: 15 },
];
const subjectInput = { bytes: Buffer.from('source'), authority, expectedSubjects };
const face = { kind: 'face', label: 'face', classId: null, confidence: 0.94, box };
const cat = { kind: 'object', label: 'cat', classId: 15, confidence: 0.72, box };
const subjects = (rows: readonly (readonly object[])[]) => Buffer.from(JSON.stringify({
	schemaVersion: 1, ...authority, frames: authority.frames.map((frame, index) => ({ ...frame, subjects: rows[index] })),
}));

test('subject correctness binds the face and cat to their known fixture frames', () => {
	assert.doesNotThrow(() => validateModelOutput('subject-detections', subjects([[face], [cat]]), subjectInput));
	for (const rows of [
		[[face], [{ ...cat, label: 'dog', classId: 16 }]],
		[[cat], [face]],
		[[face, cat], []],
		[[face], [{ ...cat, classId: 16 }]],
	]) assert.throws(() => validateModelOutput('subject-detections', subjects(rows), subjectInput), /fixture.*(face|cat)/u);
});

test('visual fixture metadata binds the actual rendered text and photo order to correctness checks', async () => {
	type OcrRendering = { fontFamily: string; fontWeight: string; fontSizePixels: number;
		textAlign: string; textBaseline: string; lineX: number; lineYs: readonly number[] };
	const rendering: { textLines?: readonly string[]; ocrFontBase64?: string | null; ocrRendering?: OcrRendering }[] = [];
	const page = { evaluate: (_render: unknown, options: { sources: readonly unknown[]; width: number; height: number;
		textLines: readonly string[]; ocrFontBase64: string | null; ocrRendering: OcrRendering }) => {
		rendering.push(options);
		return Promise.resolve(options.sources.map(() => new Uint8Array(options.width * options.height * 4)));
	} };
	const text = await prepareModelInput('visual-text-frames', page);
	assert.ok('expectedOcr' in text, 'The text fixture must carry its rendered-text expectation.');
	assert.deepEqual(text.expectedOcr, { sourceFrame: 0, text: 'Local Model Test', maximumCharacterErrorRate: 0.1 });
	assert.deepEqual(rendering[0].textLines, ['Local', 'Model', 'Test']);
	assert.equal(digest(Buffer.from(rendering[0].ocrFontBase64 ?? '', 'base64')),
		'6f56409fd3d64bb85f7d070bce20749db2d66b6d63cec586cc22d1c761be2491');
	assert.deepEqual(rendering[0].ocrRendering, {
		fontFamily: 'Soundscaper OCR Fixture', fontWeight: '700', fontSizePixels: 96,
		textAlign: 'center', textBaseline: 'middle', lineX: 256, lineYs: [128, 256, 384],
	});
	const photos = await prepareModelInput('visual-subject-frames', page);
	assert.ok('expectedSubjects' in photos, 'The photo fixture must carry its expected frame subjects.');
	assert.deepEqual(photos.expectedSubjects, expectedSubjects);
});
