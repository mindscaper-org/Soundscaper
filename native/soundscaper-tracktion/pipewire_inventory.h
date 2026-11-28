/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
	char name[256];
	int input;
	int channels;
	int priority;
} tracktion_pipewire_node;

/* Returns a bounded snapshot of audio endpoints on the current PipeWire graph. */
size_t tracktion_pipewire_nodes(tracktion_pipewire_node *nodes, size_t maximum);

#ifdef __cplusplus
}
#endif
