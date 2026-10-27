/* SPDX-License-Identifier: AGPL-3.0-only */

export interface CheckTask {
	id: string;
	args: readonly string[];
	dependsOn: readonly string[];
	env?: Record<string, string>;
	browser?: boolean;
}

export type CheckState = 'pending' | 'running' | 'passed' | 'failed' | 'blocked';

/** One queue bounds concurrency across static checks, Node tests and browsers. */
export async function runCheckTasks(
	tasks: readonly CheckTask[],
	execute: (task: CheckTask) => Promise<number>,
	options: {
		signal?: AbortSignal;
		onChange?: (states: ReadonlyMap<string, CheckState>) => void;
		onError?: (task: CheckTask, error: unknown) => void;
	} = {},
): Promise<ReadonlyMap<string, CheckState>> {
	validateTasks(tasks);
	const states = new Map<string, CheckState>(tasks.map(task => [task.id, 'pending']));
	const running = new Map<string, Promise<void>>();
	while ([...states.values()].some(state => state === 'pending') || running.size > 0) {
		for (const task of tasks) {
			if (states.get(task.id) !== 'pending') continue;
			if (options.signal?.aborted || task.dependsOn.some(id => ['failed', 'blocked'].includes(states.get(id)!))) {
				states.set(task.id, 'blocked');
				continue;
			}
			if (running.size >= 4 || task.dependsOn.some(id => states.get(id) !== 'passed')) continue;
			states.set(task.id, 'running');
			// Defer the call so even a synchronous throw releases its slot.
			const completion = Promise.resolve().then(() => {
				if (options.signal?.aborted) return 1;
				return execute(task);
			}).then(code => {
				states.set(task.id, code === 0 ? 'passed' : 'failed');
			}, (error: unknown) => {
				states.set(task.id, 'failed');
				options.onError?.(task, error);
			}).finally(() => {
				running.delete(task.id);
				options.onChange?.(states);
			});
			running.set(task.id, completion);
		}
		options.onChange?.(states);
		if (running.size > 0) await Promise.race(running.values());
	}
	return states;
}

function validateTasks(tasks: readonly CheckTask[]): void {
	const byId = new Map(tasks.map(task => [task.id, task]));
	if (byId.size !== tasks.length) throw new Error('Duplicate check-all task id.');
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const visit = (id: string): void => {
		if (visited.has(id)) return;
		const task = byId.get(id);
		if (!task) throw new Error(`Unknown check-all dependency: ${id}.`);
		if (visiting.has(id)) throw new Error(`Cyclic check-all dependency: ${id}.`);
		visiting.add(id);
		for (const dependency of task.dependsOn) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const task of tasks) visit(task.id);
}
