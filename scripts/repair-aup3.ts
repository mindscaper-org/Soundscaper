/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, writeFileSync } from 'node:fs';
import { repairAudacityProjectFile } from '../desktop/audacity-project-file-repair.ts';

const args = process.argv.slice(2);
if (args.length !== 2 || args.some(arg => arg.startsWith('--'))) {
	console.error('Usage: npm run repair:aup3 -- <damaged.aup3> <new-recovered.aup3>');
	console.error('Close Audacity first. The output and its .recovery.json report must not already exist.');
	process.exitCode = args.includes('--help') ? 0 : 1;
} else {
	const [source, output] = args as [string, string];
	const reportPath = output + '.recovery.json';
	try {
		if (existsSync(reportPath)) throw new Error('The recovery report already exists. Choose a new output name.');
		const report = repairAudacityProjectFile(source, output, (completed, total) => {
			if (completed % 100 === 0 || completed === total) console.error(`Rebuilt ${completed}/${total} audio blocks`);
		});
		writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
		console.log(`Recovered: ${output}\nReport: ${reportPath}\nSQLite integrity: ${report.integrityCheck}; journal mode: ${report.journalMode}`);
		console.log(`${report.losses.length} audio blocks contain substituted silence. Review the report and listen to the recovered project.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
