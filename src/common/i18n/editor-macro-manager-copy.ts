/* SPDX-License-Identifier: AGPL-3.0-only */

const ENGLISH = Object.freeze({
	run: 'Run',
	editMacro: 'Edit macro',
	macroOptions: 'Macro options',
	paletteOptions: 'Macros palette options',
	cancelRun: 'Cancel run',
	runCancelled: 'Macro cancelled.',
	newProgram: 'New program',
	program: 'Program',
	programName: 'Program name',
	runProgram: 'Run program',
	programApplied: 'Program applied.',
	sandboxNotice: 'A program runs in a sandbox with no network, no general file access and no access to your other projects. It may use reference audio files you explicitly choose. '
		+ 'Inside this project it can do anything you can, including deleting audio; one undo reverses the whole run.',
	tabHint: 'Tab inserts two spaces. Press Escape and then Tab to leave the program.',
	failure: 'The program failed:',
	failureAtLine: 'The program failed on line {line}:',
	importProgram: 'Import program',
	exportProgram: 'Export program',
	deleteProgram: 'Delete program',
	programImported: 'Imported. This macro is a program — review it before running it.',
	programImportFailed: 'The program could not be imported: {message}',
	reviewHeading: 'Review this program before running it',
	reviewOrigin: 'This program came from {origin} and has not been run.',
	reviewUnknownOrigin: 'This program came from a file and has not been run.',
	reviewRisk: 'It was written by whoever sent it to you. It runs in a sandbox with no network, '
		+ 'no general file access and no access to your other projects. It may use reference audio files you explicitly choose. Inside this project it can do anything '
		+ 'you can, including deleting audio. Only enable programs from people you trust.',
	reviewAcknowledge: 'I have read this program and want to run it.',
	enableProgram: 'Enable this program',
	notTrusted: 'This program has not been reviewed yet.',
	programs: 'Programs',
});

export const MACRO_MANAGER_COPY_BY_LOCALE = Object.freeze({ en: ENGLISH });
