/* SPDX-License-Identifier: AGPL-3.0-only */

let takeOffer: (() => Event | null) | null = null;

/** Hold a browser offer while the application workspace is still loading. */
export function listenForEarlyApplicationInstallPrompt(): void {
	if (takeOffer) return;
	let offer: Event | null = null;
	const capture = (event: Event) => { event.preventDefault(); offer = event; };
	const clear = () => { offer = null; };
	window.addEventListener('beforeinstallprompt', capture);
	window.addEventListener('appinstalled', clear);
	takeOffer = () => {
		window.removeEventListener('beforeinstallprompt', capture);
		window.removeEventListener('appinstalled', clear);
		takeOffer = null;
		return offer;
	};
}

export function takeEarlyApplicationInstallPrompt(): Event | undefined {
	return takeOffer?.() ?? undefined;
}
