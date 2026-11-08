/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState } from 'react';

interface Submission<Owner> { readonly owner: Owner }

/** The dialog owns admission while its exporter is still loading or preparing. */
export function useExportDialogSubmission<Owner>(owner: Owner, onFailure: (cause: unknown) => void) {
	const currentOwner = useRef(owner);
	currentOwner.current = owner;
	const active = useRef<Submission<Owner> | null>(null);
	const [pending, setPending] = useState<Submission<Owner> | null>(null);
	useEffect(() => () => {
		if (active.current?.owner === owner) active.current = null;
	}, [owner]);
	const owns = (submission: Submission<Owner>) => active.current === submission
		&& currentOwner.current === submission.owner;
	return {
		pending: pending !== null && pending.owner === owner && active.current === pending,
		start(operation: () => unknown): void {
			if (currentOwner.current !== owner || active.current?.owner === owner) return;
			const submission = { owner };
			active.current = submission;
			setPending(submission);
			const finish = (failure?: { readonly cause: unknown }): void => {
				if (!owns(submission)) return;
				active.current = null;
				setPending(null);
				if (failure) onFailure(failure.cause);
			};
			try {
				void Promise.resolve(operation()).then(() => finish(), (cause: unknown) => finish({ cause }));
			} catch (cause) { finish({ cause }); }
		},
		cancel(): boolean {
			const submission = active.current;
			if (!submission || !owns(submission) || submission.owner !== owner) return false;
			active.current = null;
			setPending(null);
			return true;
		},
	};
}
