/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand, type SoundscaperProjectHistory } from '../../src/soundscaper/editor-project-history.ts';
import type { AudioEditorCommand } from '../../src/common/editor/commands/protocol.ts';
import { resolveLocalAssistanceSelectedMediaAuthority } from '../../src/common/editor/controller/assistance/internal/local-assistance-selected-media.ts';
import { projectForCommand } from '../../src/common/editor/project-command-projection.ts';

const NOW = '2026-11-10T12:00:00.000Z';
export const DIGEST = 'ab'.repeat(32);

export class MixedRateAssistanceFixture {
	readonly sourceRate: number;
	readonly projectRate: number;
	history: SoundscaperProjectHistory;
	commits = 0;
	constructor(sourceRate = 44_100, projectRate = 48_000) {
		this.sourceRate = sourceRate;
		this.projectRate = projectRate;
		const source = createAudioSource({ id: 'voice-source', storageKey: 'voice-source', name: 'Voice',
			sampleRate: sourceRate, frameCount: sourceRate * 6, channelCount: 1, contentSha256: DIGEST });
		const clip = createAudioClip({ id: 'voice-clip', sourceId: source.id, title: 'Voice',
			timelineStartFrame: projectRate, durationFrames: projectRate * 4,
			sourceStartFrame: sourceRate / 2, sourceDurationFrames: sourceRate * 4 });
		const track = createAudioTrack({ id: 'voice-track', name: 'Voice', clipIds: [clip.id] });
		this.history = createSoundscaperProjectHistory(createSoundscaperProject({ id: 'mixed-rate', title: 'Mixed rate',
			now: NOW, sampleRate: projectRate, sources: [source], clips: [clip], tracks: [track],
			sequences: [{ id: 'main', trackIds: [track.id] }], primarySequenceId: 'main',
			selection: { startFrame: projectRate * 1.5, endFrame: projectRate * 3.5,
				clipIds: [clip.id], trackIds: [track.id] },
		})) as typeof this.history;
	}
	currentAuthority = () => {
		const authority = resolveLocalAssistanceSelectedMediaAuthority({
		getProject: () => ({ ...projectForCommand(this.history.present), schemaFamily: 'soundscaper', schemaVersion: 1 }),
		getSelectedClipId: () => 'voice-clip', captureProject: () => this.history.present,
		assertProject: this.assertProject, renderDryTrackRange: async () => [new Float32Array(1)],
		});
		return { ...authority, project: { ...authority.project, tempoMap: projectForCommand(this.history.present).tempoMap } };
	};
	assertProject = (token: unknown): void => { assert.strictEqual(token, this.history.present); };
	commit = (command: Readonly<Record<string, unknown>> | AudioEditorCommand): void => {
		this.history = executeSoundscaperProjectCommand(this.history, command as AudioEditorCommand, { now: NOW }) as typeof this.history;
		this.commits += 1;
	};
	dependencies() {
		return { currentAuthority: this.currentAuthority, captureProject: () => this.history.present,
			assertProject: this.assertProject, commit: this.commit };
	}
	undo(): void { this.history = undoSoundscaperProjectCommand(this.history, { now: NOW }) as typeof this.history; }
	labels(name: string) {
		const track = this.history.present.tracks.find(track => track.name === name);
		return track?.type === 'label' ? track.labels.map(({ title, startFrame, endFrame }) => ({ title, startFrame, endFrame })) : [];
	}
}

export function assistanceModel(task: string, modelId: string, version = '1.0.0', sha256 = DIGEST) {
	return { modelId, version, task, artifactSha256s: [sha256] };
}

export function assistanceClaim(role: string) {
	return { claimVersion: 1, claimId: 'a'.repeat(40), jobId: 'b'.repeat(40), role,
		mediaType: `application/vnd.soundscaper.${role}+json`, byteLength: 256, sha256: DIGEST };
}
