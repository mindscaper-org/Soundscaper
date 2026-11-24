/* SPDX-License-Identifier: AGPL-3.0-only */

#include "pipewire_inventory.h"

#include "pipewire_api.h"

#include <stdatomic.h>
#include <stdlib.h>
#include <time.h>

typedef struct {
	tracktion_pipewire_node *nodes;
	size_t maximum;
	size_t count;
	int sync;
	atomic_int completed;
} inventory;

static int integer_property(const struct spa_dict *props, const char *key, int fallback, int limit)
{
	const char *text = spa_dict_lookup(props, key);
	if (text == NULL) return fallback;
	char *end;
	const long value = strtol(text, &end, 10);
	return end != text && *end == '\0' && value > 0 && value <= limit ? (int)value : fallback;
}

static void on_node(void *data, uint32_t id, uint32_t permissions, const char *type,
                    uint32_t version, const struct spa_dict *props)
{
	(void)id;
	(void)permissions;
	(void)version;
	inventory *list = data;
	if (props == NULL || list->count == list->maximum || strcmp(type, PW_TYPE_INTERFACE_Node) != 0) return;
	const char *kind = spa_dict_lookup(props, PW_KEY_MEDIA_CLASS);
	const char *name = spa_dict_lookup(props, PW_KEY_NODE_NAME);
	if (kind == NULL || name == NULL || name[0] == '\0' || strlen(name) >= sizeof(list->nodes[0].name)) return;
	const int input = strcmp(kind, "Audio/Source") == 0 || strcmp(kind, "Audio/Source/Virtual") == 0;
	if (!input && strcmp(kind, "Audio/Sink") != 0) return;
	tracktion_pipewire_node *node = &list->nodes[list->count++];
	memcpy(node->name, name, strlen(name) + 1);
	node->input = input;
	node->channels = integer_property(props, PW_KEY_AUDIO_CHANNELS, 2, 32);
	node->priority = integer_property(props, PW_KEY_PRIORITY_SESSION, 0, 100000);
}

static void on_done(void *data, uint32_t id, int seq)
{
	inventory *list = data;
	if (id == PW_ID_CORE && seq == list->sync) atomic_store_explicit(&list->completed, 1, memory_order_release);
}

static void on_core_error(void *data, uint32_t id, int seq, int error, const char *message)
{
	(void)seq;
	(void)error;
	(void)message;
	inventory *list = data;
	if (id == PW_ID_CORE) atomic_store_explicit(&list->completed, -1, memory_order_release);
}

size_t tracktion_pipewire_nodes(tracktion_pipewire_node *nodes, size_t maximum)
{
	pipewire_api api;
	if (!load_pipewire(&api)) return 0;
	void (*destroy_proxy)(struct pw_proxy *) = NULL;
	*(void **)&destroy_proxy = dlsym(api.library, "pw_proxy_destroy");

	size_t count = 0;
	api.init(NULL, NULL);
	struct pw_thread_loop *loop = api.thread_loop_new("tracktion-discovery", NULL);
	if (loop != NULL && destroy_proxy != NULL && api.thread_loop_start(loop) >= 0) {
		inventory list = { .nodes = nodes, .maximum = maximum };
		atomic_init(&list.completed, 0);
		const struct pw_registry_events registry_events = {
			.version = PW_VERSION_REGISTRY_EVENTS, .global = on_node,
		};
		const struct pw_core_events core_events = {
			.version = PW_VERSION_CORE_EVENTS, .done = on_done, .error = on_core_error,
		};
		struct spa_hook core_listener, registry_listener;
		api.thread_loop_lock(loop);
		struct pw_context *context = api.context_new(api.thread_loop_get_loop(loop), NULL, 0);
		struct pw_core *core = context == NULL ? NULL : api.context_connect(context, NULL, 0);
		struct pw_registry *registry = core == NULL ? NULL : pw_core_get_registry(core, PW_VERSION_REGISTRY, 0);
		if (registry != NULL) {
			pw_core_add_listener(core, &core_listener, &core_events, &list);
			pw_registry_add_listener(registry, &registry_listener, &registry_events, &list);
			list.sync = pw_core_sync(core, PW_ID_CORE, 0);
			api.thread_loop_unlock(loop);
			const struct timespec delay = { .tv_nsec = 2000000 };
			for (int attempt = 0; attempt < 250 && !atomic_load_explicit(&list.completed, memory_order_acquire); ++attempt)
				nanosleep(&delay, NULL);
			api.thread_loop_lock(loop);
			if (atomic_load_explicit(&list.completed, memory_order_acquire) == 1) count = list.count;
			spa_hook_remove(&registry_listener);
			spa_hook_remove(&core_listener);
			destroy_proxy((struct pw_proxy *)registry);
		}
		if (core != NULL) api.core_disconnect(core);
		if (context != NULL) api.context_destroy(context);
		api.thread_loop_unlock(loop);
		api.thread_loop_stop(loop);
	}
	if (loop != NULL) api.thread_loop_destroy(loop);
	api.deinit();
	dlclose(api.library);
	return count;
}
