/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared selected-audio currency and geometry admission for legacy acceptance paths. */

import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../../../assistance/proposal-session.ts';
import { scaleSampleFrame } from '../../../timeline-time.ts';

type DataRecord = Readonly<Record<string, unknown>>;

interface AuthorityCandidate {
	readonly project?: unknown;
	readonly fence?: unknown;
	readonly startFrame?: unknown;
	readonly endFrame?: unknown;
	readonly sourceStartFrame?: unknown;
	readonly sourceEndFrame?: unknown;
	readonly source?: unknown;
	readonly clip?: unknown;
}

export interface NormalizedLocalAssistanceAudioAcceptanceAuthority {
	readonly fence: AssistanceSelectionFence;
	readonly sampleRate: number;
	readonly sourceSampleRate: number;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly tracks: readonly DataRecord[];
}

export function normalizeLocalAssistanceAudioAcceptanceAuthority(
	value: unknown,
	missingAuthorityMessage: string,
): NormalizedLocalAssistanceAudioAcceptanceAuthority {
	const authority = value as AuthorityCandidate | null;
	if (!authority || !authority.project || typeof authority.project !== 'object') {
		throw new TypeError(missingAuthorityMessage);
	}
	const project = authority.project as DataRecord;
	const fence = validateAssistanceSelectionFence(authority.fence);
	if (project.id !== fence.projectId || project.schemaFamily !== fence.schemaFamily
		|| project.schemaVersion !== fence.schemaVersion
		|| project.revision !== fence.revision || !Array.isArray(project.tracks)) {
		throw new AssistanceProposalStaleError();
	}
	const sampleRate = integer(project.sampleRate, 1, 'project sample rate');
	const timelineStartFrame = integer(authority.startFrame, 0, 'timeline start');
	const timelineEndFrame = integer(authority.endFrame, 1, 'timeline end');
	const sourceStartFrame = integer(authority.sourceStartFrame, 0, 'source start');
	const sourceEndFrame = integer(authority.sourceEndFrame, 1, 'source end');
	const source = sourceRecord(authority.source);
	const stored = Array.isArray(project.sources)
		? (project.sources as unknown[]).map(sourceRecord).filter(candidate => candidate?.id === fence.sourceId) : [];
	if (Array.isArray(project.sources) && stored.length !== 1
		|| source && source.id !== fence.sourceId) throw new AssistanceProposalStaleError();
	const selectedSource = source ?? stored[0];
	const sourceSampleRate = integer(selectedSource?.sampleRate ?? sampleRate, 1, 'source sample rate');
	if (selectedSource?.contentSha256 !== undefined && selectedSource.contentSha256 !== fence.sourceSha256
		|| stored[0] && (stored[0].sampleRate !== selectedSource?.sampleRate
			|| stored[0].contentSha256 !== selectedSource?.contentSha256)) throw new AssistanceProposalStaleError();
	const clip = sourceRecord(authority.clip);
	const expectedExtent = Number(scaleSampleFrame(timelineEndFrame - timelineStartFrame,
		sampleRate, sourceSampleRate, 'point'));
	if (timelineEndFrame <= timelineStartFrame || sourceEndFrame <= sourceStartFrame
		|| selectedSource?.frameCount !== undefined && sourceEndFrame > Number(selectedSource.frameCount)
		|| Math.abs(sourceEndFrame - sourceStartFrame - expectedExtent) > (sourceSampleRate === sampleRate ? 0 : 1)
		|| sourceStartFrame !== fence.sourceStartFrame || sourceEndFrame !== fence.sourceEndFrame) {
		throw new AssistanceProposalStaleError();
	}
	if (clip?.timelineStartFrame !== undefined && clip.sourceStartFrame !== undefined) {
		const timelineStart = integer(clip.timelineStartFrame, 0, 'clip timeline start');
		const sourceStart = integer(clip.sourceStartFrame, 0, 'clip source start');
		if (sourceStartFrame !== sourceStart + Number(scaleSampleFrame(timelineStartFrame - timelineStart,
			sampleRate, sourceSampleRate, 'point'))
			|| sourceEndFrame !== sourceStart + Number(scaleSampleFrame(timelineEndFrame - timelineStart,
				sampleRate, sourceSampleRate, 'point'))) throw new AssistanceProposalStaleError();
	}
	return Object.freeze({
		fence,
		sampleRate,
		sourceSampleRate,
		timelineStartFrame,
		timelineEndFrame,
		sourceStartFrame,
		sourceEndFrame,
		tracks: Object.freeze([...project.tracks]) as readonly DataRecord[],
	});
}

/** Source metadata and transcript/cleanup rows retain their native sample clock. */
export function localAssistanceSourceFrameToTimelineFrame(
	sourceFrame: number,
	authority: Pick<NormalizedLocalAssistanceAudioAcceptanceAuthority,
		'sampleRate' | 'sourceSampleRate' | 'sourceStartFrame' | 'sourceEndFrame' | 'timelineStartFrame' | 'timelineEndFrame'>,
	purpose: 'point' | 'enclosingStart' | 'enclosingEnd' = 'point',
): number {
	if (!Number.isSafeInteger(sourceFrame) || sourceFrame < authority.sourceStartFrame
		|| sourceFrame > authority.sourceEndFrame) throw new RangeError('An assistance source row exceeds its selected occurrence.');
	if (sourceFrame === authority.sourceStartFrame) return authority.timelineStartFrame;
	if (sourceFrame === authority.sourceEndFrame) return authority.timelineEndFrame;
	const result = authority.timelineStartFrame + Number(scaleSampleFrame(
		sourceFrame - authority.sourceStartFrame, authority.sourceSampleRate, authority.sampleRate, purpose));
	if (!Number.isSafeInteger(result)) throw new RangeError('An assistance timeline row exceeds safe timing.');
	return Math.min(authority.timelineEndFrame, Math.max(authority.timelineStartFrame, result));
}

function sourceRecord(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}
