/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { TranslationContribution } from '../../../i18n/community-translations.ts';

export interface CommunityTranslationContributorHandle {
	getDraft(): TranslationContribution;
	flush(): Promise<void>;
}
interface Props {
	readonly draft: TranslationContribution;
	readonly label: string;
	readonly onSave: (draft: TranslationContribution) => Promise<void>;
	readonly onFailure: (error: unknown) => void;
	readonly handleRef: Ref<CommunityTranslationContributorHandle>;
}

/** Contributor metadata does not change entry validation or the live preview. */
export function CommunityTranslationContributor({ draft, label, onSave, onFailure, handleRef }: Props) {
	const [text, setText] = useState(draft.contributor ?? '');
	const current = useRef({ draft, text, onSave, onFailure });
	current.current = { draft, text, onSave, onFailure };
	const scheduled = useRef<{ draft: TranslationContribution; text: string; result: Promise<void> } | null>(null);
	const publishedContributor = useRef(draft.contributor ?? '');
	useEffect(() => {
		const previous = publishedContributor.current;
		const next = draft.contributor ?? '';
		publishedContributor.current = next;
		if (current.current.text === previous) setText(next);
	}, [draft.contributor]);
	function getDraft(): TranslationContribution {
		const latest = current.current;
		return latest.text === (latest.draft.contributor ?? '') ? latest.draft : { ...latest.draft, contributor: latest.text };
	}
	function flush(): Promise<void> {
		const latest = current.current;
		if (latest.text === (latest.draft.contributor ?? '')) return Promise.resolve();
		if (scheduled.current?.draft === latest.draft && scheduled.current.text === latest.text) return scheduled.current.result;
		const result = latest.onSave(getDraft());
		const operation = { draft: latest.draft, text: latest.text, result };
		scheduled.current = operation;
		void result.catch(() => { if (scheduled.current === operation) scheduled.current = null; });
		return result;
	}
	const cleanup = useRef(() => undefined);
	cleanup.current = () => { void flush().catch(current.current.onFailure); };
	useEffect(() => () => cleanup.current(), []);
	useImperativeHandle(handleRef, () => ({ getDraft, flush }));
	return <label>{label}<input value={text} onChange={event => setText(event.target.value)}
		onBlur={() => { void flush().catch(onFailure); }} /></label>;
}
