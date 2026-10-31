/* SPDX-License-Identifier: AGPL-3.0-only */

export function lightscaperDesktopCloseCopy(locale: string) {
	return locale.toLowerCase().split('-')[0] === 'de'
		? { busy: 'Warte, bis der Fotovorgang abgeschlossen ist, oder brich ihn ab, bevor du Lightscaper schließt.',
			openSurface: 'Schließe zuerst die geöffneten Fotodialoge. Speichere oder verwerfe deine Änderungen dort.' }
		: { busy: 'Wait for the photo operation to finish, or cancel it, before closing Lightscaper.',
			openSurface: 'Close the open photo dialogs first. Save or discard your changes there.' };
}
