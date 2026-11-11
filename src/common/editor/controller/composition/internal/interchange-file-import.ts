/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTimelineInterchangeFile } from '../../../timeline-interchange-file.ts';
import type { createMidiActionGroup } from '../midi-action-group.ts';
import type { EditorActionFunctions } from '../editor-action-functions.ts';
import type { NativeProjectFile } from '../../document/native-project-types.ts';

type ImportFiles = ReturnType<typeof createMidiActionGroup>['importFiles'];

/** All import entry points, including timeline and bin drops, open edit documents. */
export function createInterchangeFileImport(importMedia: ImportFiles, openInterchange: EditorActionFunctions['openInterchange']): ImportFiles {
	return async (fileList, options = {}) => {
		const files = [...fileList ?? []], documents = files.filter(file => isTimelineInterchangeFile(file.name));
		if (!documents.length) return importMedia(fileList, options);
		const companions = files.filter((file): file is File => !isTimelineInterchangeFile(file.name) && file instanceof File);
		let result: unknown;
		for (const file of documents) {
			options.signal?.throwIfAborted();
			if (!(file instanceof Blob) || typeof file.name !== 'string') throw new TypeError('An interchange document must be a named file.');
			result = await openInterchange(file as NativeProjectFile, { mediaFiles: companions });
		}
		return result;
	};
}
