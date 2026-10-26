/** English defaults for application-supplied component chrome. */
export const COMPONENT_COPY = Object.freeze({
	close: 'Close',
	minimize: 'Minimize',
	maximize: 'Maximize',
	restore: 'Restore',
	resize: 'Resize: {title}',
	value: 'Value',
	apply: 'Apply',
	cancel: 'Cancel',
	enterValue: 'Enter value',
	resetValue: 'Reset to {value}',
	defaultValue: 'default',
	increaseValue: 'Increase value',
	decreaseValue: 'Decrease value',
	toolToolbar: 'Tools and view',
	selectionToolbar: 'Selection toolbar',
	selection: 'Time selection',
	duration: 'Selection duration',
});
export type ComponentCopy = Readonly<Record<keyof typeof COMPONENT_COPY, string>>;
export function componentCopyTemplate(template: string, values: Readonly<Record<string, string | number>>): string {
	return template.replace(/\{(\w+)\}/gu, (token, key: string) => Object.hasOwn(values, key) ? String(values[key]) : token);
}
