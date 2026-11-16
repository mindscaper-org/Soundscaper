/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { normalizeAssistanceAssetReferencesV1 } from '../../../assistance/assistance-asset-reference-v1.ts';
import { createAssistanceTranscript, type TranscriptDraft } from '../../../assistance/transcript.ts';
import { prepareDisjointRangeDeleteCommand } from '../../../commands/range-runtime.js';
import { createEditorCommandMutationTransaction } from '../../../commands/mutation-transaction.ts';
import { projectForCommandConsumers } from '../../../project-current-runtime.ts';
import { selectAudioEditorControllerEditBlock } from '../../../edit-blocking.ts';
import { projectTranscriptWords, transcriptEditingProject, transcriptTextSelection, transcriptGenerationTargets,
	transcriptEditingGeometryKey,
	type TranscriptEditingBody } from '../../../transcript-editing.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { TranscriptEditingDependencies, TranscriptEditingDocument } from '../transcript-editing-actions.ts';

export function createTranscriptEditingActions(dependencies: TranscriptEditingDependencies) {
	function current(projectId: string, revision?: number) {
		const project = transcriptEditingProject(dependencies.getProject());
		if (project.id !== projectId || revision !== undefined && project.revision !== revision) {
			throw new Error('The transcript no longer matches the current project.');
		}
		return project;
	}

	async function read(projectId: string): Promise<TranscriptEditingDocument> {
		const project = current(projectId);
		const geometry = transcriptEditingGeometryKey(project);
		const assertGeometry = () => {
			const latest = current(projectId);
			if (transcriptEditingGeometryKey(latest) !== geometry) throw new Error('The transcript audio changed while it was loading.');
			return latest;
		};
		const trackAssets = new Set(project.tracks.flatMap(track => {
			const extensions = track.opaqueExtensions as Readonly<Record<string, unknown>> | undefined;
			const transcript = extensions?.['org.soundscaper.assistance-transcript-v1'] as { assetId?: unknown } | undefined;
			return track.type === 'label' && typeof transcript?.assetId === 'string' ? [transcript.assetId] : [];
		}));
		const references = normalizeAssistanceAssetReferencesV1(project.assistanceAssets ?? []);
		const sources = new Map((project.sources as readonly { id: string; contentSha256?: string }[] ?? []).map(source => [source.id, source]));
		const bodies: TranscriptEditingBody[] = [];
		for (const reference of [...references].reverse()) {
			if (reference.kind !== 'transcript-v1' || !trackAssets.has(reference.id)) continue;
			const source = sources.get(reference.sourceId);
			if (!source || source.contentSha256 !== reference.sourceSha256) continue;
			const stored = await dependencies.store.loadMediaAsset(reference.body.storageKey);
			assertGeometry();
			if (stored === null || stored === undefined) continue;
			const bytes = stored instanceof Blob ? new Uint8Array(await stored.arrayBuffer())
				: stored instanceof Uint8Array ? stored : stored instanceof ArrayBuffer ? new Uint8Array(stored) : null;
			if (!bytes || bytes.byteLength !== reference.body.byteLength || bytesToHex(sha256(bytes)) !== reference.body.sha256) {
				throw new Error('The stored transcript failed its integrity check.');
			}
			const transcript = createAssistanceTranscript(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as TranscriptDraft);
			if (transcript.sourceId !== reference.sourceId || transcript.segments.some(segment =>
				segment.startFrame < reference.sourceStartFrame || segment.endFrame > reference.sourceEndFrame)) {
				throw new Error('The stored transcript does not match its audio source.');
			}
			bodies.push({ assetId: reference.id, transcript });
		}
		const latest = assertGeometry();
		return { projectId, revision: latest.revision, words: projectTranscriptWords(project, bodies),
			targets: transcriptGenerationTargets(project, dependencies.state.missingSourceIds) };
	}

	async function remove(projectId: string, revision: number, wordIds: readonly string[]): Promise<void> {
		current(projectId, revision);
		const document = await read(projectId);
		const project = current(projectId, revision);
		if (selectAudioEditorControllerEditBlock(dependencies.state).blocked) {
			throw new Error('Transcript editing is unavailable while the project is busy or read-only.');
		}
		const ids = new Set(wordIds), selected = document.words.filter(word => ids.has(word.id));
		if (!selected.length || selected.length !== ids.size || selected.some(word => word.locked)) {
			throw new Error('The transcript selection is unavailable or locked.');
		}
		const selection = transcriptTextSelection(selected)!;
		const working = structuredClone(projectForCommandConsumers(project));
		const transaction = createEditorCommandMutationTransaction(project, working);
		const commands: AudioEditorCommand[] = [];
		for (const trackId of selection.trackIds) {
			const range = transcriptTextSelection(selected.filter(word => word.trackId === trackId))!;
			const command = prepareDisjointRangeDeleteCommand(working, { ranges: [range],
				trackIds: [trackId], rippleMode: 'track' }) as AudioEditorCommand;
			transaction.mutate(working, command);
			commands.push(command);
		}
		current(projectId, revision);
		dependencies.commit({ type: 'batch', commands: [...commands, { type: 'selection/set',
			startFrame: selection.startFrame, endFrame: selection.startFrame, trackIds: selection.trackIds,
			clipIds: [], frequencyRange: null }] });
	}
	return Object.freeze({ read, remove });
}
