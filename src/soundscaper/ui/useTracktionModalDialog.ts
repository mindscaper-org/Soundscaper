/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef } from 'react';

export function useTracktionModalDialog() {
	const ref = useRef<HTMLDialogElement>(null);
	useLayoutEffect(() => {
		const dialog = ref.current;
		dialog?.showModal();
		return () => {
			// Native Close restores the open menu's summary while the modal is still attached.
			if (dialog?.open) dialog.close();
		};
	}, []);
	return ref;
}
