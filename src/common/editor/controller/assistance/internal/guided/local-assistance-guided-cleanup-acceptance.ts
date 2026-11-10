/* SPDX-License-Identifier: AGPL-3.0-only */

/** Atomic publication of an already-reviewed Guided cleanup subset. */

import {
	acceptedProposalRanges,
	type DisfluencyProposal,
} from '../../../../assistance/disfluency.ts';
import {
	reviewAssistanceOwnedAudioCutTransformResultV1,
} from '../../../../assistance/owned-audio-cut-transform-results-v1.ts';
import type {
	AssistanceCleanupProposalsV1,
} from '../../../../assistance/owned-audio-cut-transform-types-v1.ts';
import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../../../../assistance/proposal-session.ts';
import { prepareDisjointRangeDeleteCommand } from '../../../../commands.js';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import type {
	LocalAssistanceTranscriptCleanupAuthority,
} from '../local-assistance-cleanup-acceptance.ts';

import {
	localAssistanceSourceFrameToTimelineFrame,
	normalizeLocalAssistanceAudioAcceptanceAuthority,
	type NormalizedLocalAssistanceAudioAcceptanceAuthority,
} from '../local-assistance-audio-acceptance-authority.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface LocalAssistanceGuidedCleanupAcceptanceDependencies {
	readonly currentAuthority: () => LocalAssistanceTranscriptCleanupAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly commit: (command: AudioEditorCommand) => Awaitable<void>;
}

export interface LocalAssistanceGuidedCleanupAcceptanceRequest {
	readonly selectionFence: AssistanceSelectionFence;
	readonly result: unknown;
	readonly selectedProposalIds: readonly string[];
}

export interface LocalAssistanceGuidedCleanupAcceptance {
	accept(request: LocalAssistanceGuidedCleanupAcceptanceRequest): Promise<void>;
}

interface NormalizedAuthority extends NormalizedLocalAssistanceAudioAcceptanceAuthority {
	readonly project: LocalAssistanceTranscriptCleanupAuthority['project'];
	readonly trackId: string;
}

export function createLocalAssistanceGuidedCleanupAcceptance(
	dependencies: LocalAssistanceGuidedCleanupAcceptanceDependencies,
): Readonly<LocalAssistanceGuidedCleanupAcceptance> {
	validateDependencies(dependencies);
	return Object.freeze({ accept });

	async function accept(request: LocalAssistanceGuidedCleanupAcceptanceRequest): Promise<void> {
		const fence = validateAssistanceSelectionFence(request?.selectionFence);
		const reviewed = (reviewAssistanceOwnedAudioCutTransformResultV1({
			schemaVersion: 1, transformId: 'propose-cleanup',
			outputs: { 'cleanup-proposals': request?.result },
		}) as Readonly<{ readonly outputs: Readonly<{
			readonly 'cleanup-proposals': AssistanceCleanupProposalsV1;
		}> }>).outputs['cleanup-proposals'];
		const selected = selectedIds(request?.selectedProposalIds, reviewed.proposals);
		const initial = normalizeAuthority(dependencies.currentAuthority());
		assertSameFence(fence, initial.fence);
		if (selected.length === 0) return;
		const proposals = reviewed.proposals.map((proposal): DisfluencyProposal => Object.freeze({
			id: proposal.id, kind: proposal.kind,
			startFrame: timelineFrame(proposal.startFrame, initial),
			endFrame: timelineFrame(proposal.endFrame, initial), text: proposal.text,
		}));
		const ranges = acceptedProposalRanges(proposals, selected);
		if (ranges.length === 0) return;
		const token = dependencies.captureProject();
		const current = normalizeAuthority(dependencies.currentAuthority());
		assertSameFence(fence, current.fence);
		if (current.trackId !== initial.trackId) throw new AssistanceProposalStaleError();
		const command = prepareDisjointRangeDeleteCommand(current.project, {
			ranges, trackIds: [current.trackId], rippleMode: 'track',
		}) as AudioEditorCommand;
		dependencies.assertProject(token);
		const final = normalizeAuthority(dependencies.currentAuthority());
		assertSameFence(fence, final.fence);
		if (final.trackId !== current.trackId) throw new AssistanceProposalStaleError();
		await dependencies.commit(command);
	}
}

function selectedIds(
	value: unknown,
	proposals: readonly Readonly<{ readonly id: string }>[],
): readonly string[] {
	if (!Array.isArray(value) || value.length > proposals.length) {
		throw new RangeError('The selected Guided cleanup subset is out of range.');
	}
	const admitted = new Set(proposals.map(({ id }) => id));
	const result = value.map((candidate) => {
		if (typeof candidate !== 'string' || !admitted.has(candidate)) {
			throw new RangeError(`Unknown Guided cleanup proposal ${String(candidate)}.`);
		}
		return candidate;
	});
	if (new Set(result).size !== result.length) {
		throw new TypeError('Selected Guided cleanup proposal IDs must be unique.');
	}
	return Object.freeze(result);
}

function normalizeAuthority(value: LocalAssistanceTranscriptCleanupAuthority): NormalizedAuthority {
	const authority = normalizeLocalAssistanceAudioAcceptanceAuthority(value,
		'Guided cleanup requires selected-media authority.');
	const trackId = stableId(value.track?.id, 'selected cleanup track ID');
	const tracks = value.project.tracks.filter(({ id }) => id === trackId);
	if (tracks.length !== 1 || tracks[0]!.type !== 'audio' || !Array.isArray(tracks[0]!.clipIds)
		|| !tracks[0]!.clipIds.some((id: unknown) => authority.fence.occurrenceIds.includes(String(id)))) {
		throw new AssistanceProposalStaleError();
	}
	return Object.freeze({ ...authority, project: value.project, trackId });
}

function timelineFrame(sourceFrame: number, authority: NormalizedAuthority): number {
	return localAssistanceSourceFrameToTimelineFrame(sourceFrame, authority);
}

function assertSameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): void {
	if (JSON.stringify(left) !== JSON.stringify(right)) throw new AssistanceProposalStaleError();
}

function validateDependencies(value: LocalAssistanceGuidedCleanupAcceptanceDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.commit !== 'function') {
		throw new TypeError('Guided cleanup requires exact controller transaction ports.');
	}
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}
