/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TranscriptGenerationTarget } from '../../transcript-editing.ts';

export interface TranscriptGenerationSession {
	getSnapshot(): Readonly<{ phase: string; error: string | null; unavailableReason?: string | null;
		canReview: boolean; review: { choices: readonly { id: string; enabled: boolean }[] } | null }>;
	run(): Promise<void>;
	review(): Promise<void>;
	setReviewChoiceSelected(id: string, selected: boolean): void;
	accept(): Promise<void>;
	dispose(): Promise<void>;
}

interface Options {
	getProject(): Readonly<{ id: string; revision: number }> | null;
	readonly targets: readonly TranscriptGenerationTarget[];
	selectTarget(target: TranscriptGenerationTarget): void;
	createSession(): TranscriptGenerationSession;
	readonly signal: AbortSignal;
	onProgress(completed: number, total: number): void;
}

/** Each publication keeps the ordinary native claim, review and source fences. */
export async function generateProjectTranscripts(options: Options): Promise<void> {
	const initial = options.getProject();
	if (!initial) throw new Error('Open a project before generating a transcript.');
	const projectId = initial.id;
	let revision = initial.revision;
	const assertCurrent = () => {
		options.signal.throwIfAborted();
		const current = options.getProject();
		if (current?.id !== projectId || current.revision !== revision) {
			throw new Error('The project changed while transcripts were being generated.');
		}
	};
	for (const [index, target] of options.targets.entries()) {
		assertCurrent();
		options.onProgress(index, options.targets.length);
		options.selectTarget(target);
		const selectedProject = options.getProject();
		if (selectedProject?.id !== projectId) throw new Error('The project changed before transcript generation.');
		revision = selectedProject.revision;
		const session = options.createSession();
		const cancel = () => { void session.dispose().catch(() => undefined); };
		options.signal.addEventListener('abort', cancel, { once: true });
		try {
			await session.run();
			assertCurrent();
			const result = session.getSnapshot();
			if (!result.canReview) throw new Error(result.error ?? result.unavailableReason
				?? (result.phase === 'cancelled' ? 'Transcript generation was cancelled.' : 'No transcript was produced.'));
			await session.review();
			assertCurrent();
			const reviewed = session.getSnapshot();
			if (reviewed.phase !== 'review-ready' || !reviewed.review) {
				throw new Error(reviewed.error ?? 'The generated transcript could not be verified.');
			}
			const choices = reviewed.review.choices.filter(choice => choice.enabled);
			if (choices.length) {
				for (const choice of choices) session.setReviewChoiceSelected(choice.id, true);
				await session.accept();
				if (session.getSnapshot().phase !== 'accepted' || session.getSnapshot().error) {
					throw new Error(session.getSnapshot().error ?? 'The transcript could not be saved.');
				}
				revision += 1;
				assertCurrent();
			}
		} finally {
			options.signal.removeEventListener('abort', cancel);
			await session.dispose();
		}
		options.onProgress(index + 1, options.targets.length);
	}
}
