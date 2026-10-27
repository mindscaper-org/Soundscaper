/* SPDX-License-Identifier: AGPL-3.0-only */
/* global ObjC, $, Application, delay */
/* Native AX actions are restricted to the launched process; keyboard events target its AX application. */
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('ApplicationServices');
function run(argv) {
	if (argv.length !== 1) throw Error('Expected one private chooser request.');
	const data = $.NSData.dataWithContentsOfFile(argv[0]);
	if (!data || data.length > 32768) throw Error('Missing or oversized native chooser request.');
	const request = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
	const grant = request.choose, owner = grant && grant.owner;
	if (request.schemaVersion !== 1 || request.action !== 'choose' || !owner || owner.platform !== 'darwin') throw Error('Invalid native chooser contract.');
	const choices = {
		'authored-save': ['Save Motionscaper project', 'save', 'saved.mscape'],
		'authored-export': ['Export ProRes 4444', 'save', 'output.mov'],
		'authored-cancel-export': ['Export ProRes 4444', 'cancel', 'output.mov'],
		'scene-open': ['Open Motionscaper project', 'open', 'saved.mscape'],
		'scene-export': ['Export ProRes 4444', 'save', 'output.mov'],
		'successor-open': ['Connect saved Motionscaper composition', 'open', 'saved.mscape'],
		'successor-export': ['Export Frame sequence as ProRes 4444', 'save', 'output.mov']
	};
	const choice = choices[grant.kind];
	if (!choice || grant.caption !== choice[0] || grant.action !== choice[1]) throw Error('Unadmitted native chooser action.');
	const normalized = value => ObjC.unwrap($(value).stringByStandardizingPath);
	if (!grant.directory.startsWith('/') || normalized(grant.directory) !== grant.directory
		|| grant.path !== grant.directory + '/' + choice[2] || normalized(grant.path) !== grant.path) throw Error('Native chooser path escapes its owned directory.');
	const observer = grant.directory + '/motion-qualification-process-darwin';
	if (request.processObserver !== observer) throw Error('Unexpected native birth observer.');
	if (!$.AXIsProcessTrusted()) throw Error('Native chooser requires already-authorized Accessibility automation.');
	function inspect() {
		const task = $.NSTask.alloc.init, output = $.NSPipe.pipe;
		task.launchPath = observer; task.arguments = ['inspect', String(owner.pid)]; task.standardOutput = output;
		task.launch; task.waitUntilExit;
		if (task.terminationStatus !== 0) throw Error('Cannot authenticate the native application birth.');
		const bytes = output.fileHandleForReading.readDataToEndOfFile;
		const actual = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
		if (!actual || actual.pid !== owner.pid || actual.birth !== owner.birth || actual.executable !== owner.executable) throw Error('Owned native process identity changed.');
		return actual;
	}
	inspect();
	const events = Application('System Events'), processes = events.processes.whose({ unixId: owner.pid })();
	if (processes.length !== 1) throw Error('Owned native Accessibility process is unavailable.');
	const process = processes[0], application = $.NSRunningApplication.runningApplicationWithProcessIdentifier(owner.pid);
	inspect(); if (!application.activateWithOptions($.NSApplicationActivateIgnoringOtherApps)) throw Error('Owned native application activation failed.');
	const appElement = $.AXUIElementCreateApplication(owner.pid);
	function property(element, name) { try { return element[name](); } catch (_) { return ''; } }
	function children(element) { try { return element.uiElements(); } catch (_) { return []; } }
	function descendants(element) {
		const pending = [element], result = [];
		while (pending.length) {
			if (result.length > 4096) throw Error('Native dialog element limit exceeded.');
			const next = pending.shift(); result.push(next); pending.push.apply(pending, children(next));
		}
		return result;
	}
	function panels() {
		inspect();
		return descendants(process).filter(element => {
			const role = property(element, 'role');
			const captionMatches = child => [property(child, 'name'), property(child, 'description'), property(child, 'value')].some(value => value === grant.caption);
			if (role === 'AXWindow') return ['AXDialog', 'AXSystemDialog', 'AXStandardWindow'].includes(property(element, 'subrole')) && captionMatches(element);
			if (role !== 'AXSheet' && role !== 'AXDialog') return false;
			return descendants(element).some(captionMatches);
		});
	}
	function wait(operation, seconds) {
		const end = Date.now() + seconds * 1000;
		for (;;) { const value = operation(); if (value) return value; if (Date.now() >= end) throw Error('Owned native dialog deadline exceeded.'); delay(0.05); }
	}
	const panel = wait(() => { const values = panels(); if (values.length > 1) throw Error('Ambiguous owned native dialogs.'); return values[0]; }, 15);
	function button(element, names) {
		const values = descendants(element).filter(child => property(child, 'role') === 'AXButton' && names.includes(property(child, 'name')));
		if (values.length !== 1) throw Error('Expected one native dialog button.');
		return values[0];
	}
	function recheckPanel() {
		const values = panels();
		if (values.length !== 1 || String(values[0]) !== String(panel)) throw Error('Owned native dialog changed or became ambiguous.');
		inspect();
	}
	function click(element) { recheckPanel(); element.click(); inspect(); }
	function key(code, down) {
		recheckPanel();
		if ($.AXUIElementPostKeyboardEvent(appElement, 0, code, down) !== 0) throw Error('PID-scoped native keyboard event was refused.');
	}
	if (grant.action === 'cancel') click(button(panel, ['Cancel']));
	else {
		// Go to Folder uses only this application's AX element, never a system-wide key sender.
		key(55, true); key(56, true); key(5, true); key(5, false); key(56, false); key(55, false);
		const folderSheet = wait(() => {
			const sheets = children(panel).filter(child => property(child, 'role') === 'AXSheet');
			if (sheets.length > 1) throw Error('Ambiguous owned Go to Folder sheets.');
			return sheets[0];
		}, 5);
		const folderFields = descendants(folderSheet).filter(child => property(child, 'role') === 'AXTextField' || property(child, 'role') === 'AXComboBox');
		if (folderFields.length !== 1) throw Error('Native Go to Folder field is unavailable.');
		recheckPanel(); folderFields[0].value = grant.action === 'open' ? grant.path : grant.directory;
		click(button(folderSheet, ['Go']));
		if (grant.action === 'save') {
			const fields = descendants(panel).filter(child => property(child, 'role') === 'AXTextField' && ['Save As:', 'Save As', 'File name:', 'File name'].includes(property(child, 'description') || property(child, 'name')));
			if (fields.length !== 1) throw Error('Native Save As field is unavailable.');
			recheckPanel(); fields[0].value = choice[2]; click(button(panel, ['Save']));
		} else {
			const remaining = panels();
			if (remaining.length > 1) throw Error('Ambiguous owned Open dialog after folder navigation.');
			if (remaining.length) { recheckPanel(); click(button(remaining[0], ['Open'])); }
		}
	}
	wait(() => panels().length === 0, 5);
	inspect();
	return JSON.stringify({ schemaVersion: 1, selected: true, dialogClosed: true, owner, kind: grant.kind, path: grant.path,
		caption: grant.caption, action: grant.action, nativeAutomation: 'macOS owned AX application and PID-scoped keyboard events' });
}


void run;
