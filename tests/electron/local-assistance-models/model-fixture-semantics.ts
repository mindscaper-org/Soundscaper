/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type {
	AssistanceOcrResultV1,
	AssistanceSubjectKindV1,
	AssistanceSubjectResultV1,
} from '../../../src/common/editor/assistance/visual-semantic-results-v1.ts';

export const MODEL_OCR_TEXT_LINES = Object.freeze(['Local', 'Model', 'Test']);
export const MODEL_OCR_FIXTURE = Object.freeze({
	sourceFrame: 0, text: MODEL_OCR_TEXT_LINES.join(' '), maximumCharacterErrorRate: 0.1,
});
export const MODEL_SUBJECT_FIXTURE = Object.freeze([
	Object.freeze({ sourceFrame: 0, kind: 'face' as const, label: 'face', classId: null }),
	Object.freeze({ sourceFrame: 1, kind: 'object' as const, label: 'cat', classId: 15 }),
]);

interface OcrExpectation {
	readonly sourceFrame: number;
	readonly text: string;
	readonly maximumCharacterErrorRate: number;
}

interface SubjectExpectation {
	readonly sourceFrame: number;
	readonly kind: AssistanceSubjectKindV1;
	readonly label: string;
	readonly classId: number | null;
}

interface OcrSummary {
	readonly frames: number;
	readonly regions: number;
	readonly text: {
		readonly sourceFrame: number;
		readonly expectedText: string;
		readonly recognizedText: string;
		readonly recognizedRegions: readonly string[];
		readonly editDistance: number;
		readonly characterErrorRate: number;
		readonly maximumCharacterErrorRate: number;
	};
}

interface SubjectSummary {
	readonly frames: number;
	readonly subjects: number;
	readonly expectedSubjects: readonly (SubjectExpectation & { readonly matchingDetections: number })[];
}

/** Preserve the observed semantic defect in the report even when correctness fails. */
export class ModelFixtureMismatchError<Summary extends object = object> extends Error {
	readonly name = 'ModelFixtureMismatchError';
	readonly summary: Summary;
	constructor(message: string, summary: Summary) {
		super(message);
		this.summary = summary;
	}
}

export function validateOcrFixtureSemantics(
	result: AssistanceOcrResultV1, expected: OcrExpectation | undefined,
): OcrSummary {
	assert.ok(expected && typeof expected.text === 'string' && expected.text.trim(), 'OCR fixture expected text is missing.');
	assert.ok(Number.isFinite(expected.maximumCharacterErrorRate)
		&& expected.maximumCharacterErrorRate >= 0 && expected.maximumCharacterErrorRate <= 0.1,
		'OCR fixture character error tolerance must be at most ten percent.');
	const regions = [...(result.frames.find(frame => frame.sourceFrame === expected.sourceFrame)?.regions ?? [])]
		.sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x);
	const recognizedRegions = regions.map(region => region.text);
	const expectedText = normalizeText(expected.text);
	const recognizedText = normalizeText(recognizedRegions.join(' '));
	const edits = editDistance(expectedText, recognizedText);
	const characterErrorRate = edits / Array.from(expectedText).length;
	const summary = { frames: result.frames.length,
		regions: result.frames.reduce((total, frame) => total + frame.regions.length, 0),
		text: { sourceFrame: expected.sourceFrame, expectedText, recognizedText, recognizedRegions,
			editDistance: edits, characterErrorRate, maximumCharacterErrorRate: expected.maximumCharacterErrorRate } };
	if (characterErrorRate > expected.maximumCharacterErrorRate) throw new ModelFixtureMismatchError(
		`OCR fixture text has ${edits} character edits: expected ${JSON.stringify(expectedText)}, observed ${JSON.stringify(recognizedText)}.`, summary);
	return summary;
}

export function validateSubjectFixtureSemantics(
	result: AssistanceSubjectResultV1, expected: readonly SubjectExpectation[] | undefined,
): SubjectSummary {
	assert.ok(expected?.length, 'Subject fixture expected face and cat identities are missing.');
	const expectedSubjects = expected.map(expectation => ({ ...expectation,
		matchingDetections: (result.frames.find(frame => frame.sourceFrame === expectation.sourceFrame)?.subjects ?? [])
			.filter(subject => subject.kind === expectation.kind && subject.label === expectation.label
				&& subject.classId === expectation.classId).length,
	}));
	const summary = { frames: result.frames.length,
		subjects: result.frames.reduce((total, frame) => total + frame.subjects.length, 0), expectedSubjects };
	const missing = expectedSubjects.filter(subject => !subject.matchingDetections);
	if (missing.length) throw new ModelFixtureMismatchError(`Subject fixture is missing ${missing.map(subject =>
		`${subject.label} on source frame ${subject.sourceFrame}`).join(', ')}.`, summary);
	return summary;
}

function normalizeText(text: string): string {
	return text.normalize('NFKC').toUpperCase().trim().replace(/\s+/gu, ' ');
}

function editDistance(expected: string, observed: string): number {
	const left = Array.from(expected), right = Array.from(observed);
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let row = 1; row <= left.length; row += 1) {
		const current = [row];
		for (let column = 1; column <= right.length; column += 1) {
			current[column] = Math.min(current[column - 1]! + 1, previous[column]! + 1,
				previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1));
		}
		previous = current;
	}
	return previous[right.length]!;
}
