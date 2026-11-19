/* SPDX-License-Identifier: AGPL-3.0-only */

export function lightscaperPhotoBackendCopyCurrentV1(locale: string) {
	return locale.toLowerCase().split('-')[0] === 'de'
		? { photoBackendTitle: 'Fotospeicher', photoBackendWeb: 'Web Core (Browser)', photoBackendNative: 'Desktop (nativ)',
			photoBackendExplanation: 'Browser und Desktop verwenden getrennte Bibliotheken. Ein Wechsel überträgt keine Fotos.',
			photoBackendFailed: 'Der bisherige Fotoarbeitsbereich konnte nicht vollständig geschlossen werden. Der Speicher wurde nicht gewechselt.',
			photoBackendUnavailable: 'Schließe zuerst Fotodialoge und beende laufende Vorgänge.' }
		: { photoBackendTitle: 'Photo storage', photoBackendWeb: 'Web Core (browser)', photoBackendNative: 'Desktop (native)',
			photoBackendExplanation: 'Browser and desktop use separate libraries. Switching does not transfer photos.',
			photoBackendFailed: 'The current photo workspace could not finish closing. Photo storage was not switched.',
			photoBackendUnavailable: 'Close photo dialogs and finish pending operations first.' };
}
