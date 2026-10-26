import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { COMPONENT_COPY, type ComponentCopy } from '../component-copy';

const ComponentCopyContext = createContext({ copy: COMPONENT_COPY as ComponentCopy, locale: 'en' });

/** Explicit application copy ownership also follows controls into React portals. */
export function ComponentCopyProvider({ copy, locale = 'en', children }: {
	readonly copy: Partial<ComponentCopy>;
	readonly locale?: string;
	readonly children: ReactNode;
}) {
	const value = useMemo(() => ({ copy: { ...COMPONENT_COPY, ...copy }, locale }), [copy, locale]);
	return <ComponentCopyContext.Provider value={value}>{children}</ComponentCopyContext.Provider>;
}
export function useComponentCopy() { return useContext(ComponentCopyContext); }
