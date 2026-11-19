/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_PIPEWIRE_API_H
#define SOUNDSCAPER_PIPEWIRE_API_H

#if defined(__linux__)
#define SOUNDSCAPER_HAS_PIPEWIRE 1
#include <dlfcn.h>
#include <string.h>
#include <pipewire/pipewire.h>
#include <spa/param/audio/format-utils.h>
#else
#define SOUNDSCAPER_HAS_PIPEWIRE 0
#endif

#if SOUNDSCAPER_HAS_PIPEWIRE

typedef struct {
	void *library;
	void (*init)(int *, char ***);
	void (*deinit)(void);
	struct pw_thread_loop *(*thread_loop_new)(const char *, const struct spa_dict *);
	void (*thread_loop_destroy)(struct pw_thread_loop *);
	int (*thread_loop_start)(struct pw_thread_loop *);
	void (*thread_loop_stop)(struct pw_thread_loop *);
	void (*thread_loop_lock)(struct pw_thread_loop *);
	void (*thread_loop_unlock)(struct pw_thread_loop *);
	struct pw_loop *(*thread_loop_get_loop)(struct pw_thread_loop *);
	struct pw_stream *(*stream_new_simple)(struct pw_loop *, const char *, struct pw_properties *,
		const struct pw_stream_events *, void *);
	void (*stream_destroy)(struct pw_stream *);
	int (*stream_connect)(struct pw_stream *, enum pw_direction, uint32_t, enum pw_stream_flags,
		const struct spa_pod **, uint32_t);
	struct pw_buffer *(*stream_dequeue_buffer)(struct pw_stream *);
	int (*stream_queue_buffer)(struct pw_stream *, struct pw_buffer *);
	struct pw_properties *(*properties_new)(const char *, ...);
	struct pw_context *(*context_new)(struct pw_loop *, struct pw_properties *, size_t);
	void (*context_destroy)(struct pw_context *);
	struct pw_core *(*context_connect)(struct pw_context *, struct pw_properties *, size_t);
	int (*core_disconnect)(struct pw_core *);
} pipewire_api;

static int load_pipewire(pipewire_api *api)
{
	memset(api, 0, sizeof(*api));
	api->library = dlopen("libpipewire-0.3.so.0", RTLD_LAZY | RTLD_LOCAL);
	if (api->library == NULL) api->library = dlopen("libpipewire-0.3.so", RTLD_LAZY | RTLD_LOCAL);
	if (api->library == NULL) return 0;
	#define BIND(field, symbol) \
		do { \
			*(void **)(&api->field) = dlsym(api->library, symbol); \
			if (api->field == NULL) { dlclose(api->library); api->library = NULL; return 0; } \
		} while (0)
	BIND(init, "pw_init");
	BIND(deinit, "pw_deinit");
	BIND(thread_loop_new, "pw_thread_loop_new");
	BIND(thread_loop_destroy, "pw_thread_loop_destroy");
	BIND(thread_loop_start, "pw_thread_loop_start");
	BIND(thread_loop_stop, "pw_thread_loop_stop");
	BIND(thread_loop_lock, "pw_thread_loop_lock");
	BIND(thread_loop_unlock, "pw_thread_loop_unlock");
	BIND(thread_loop_get_loop, "pw_thread_loop_get_loop");
	BIND(stream_new_simple, "pw_stream_new_simple");
	BIND(stream_destroy, "pw_stream_destroy");
	BIND(stream_connect, "pw_stream_connect");
	BIND(stream_dequeue_buffer, "pw_stream_dequeue_buffer");
	BIND(stream_queue_buffer, "pw_stream_queue_buffer");
	BIND(properties_new, "pw_properties_new");
	BIND(context_new, "pw_context_new");
	BIND(context_destroy, "pw_context_destroy");
	BIND(context_connect, "pw_context_connect");
	BIND(core_disconnect, "pw_core_disconnect");
	#undef BIND
	return 1;
}

#endif /* SOUNDSCAPER_HAS_PIPEWIRE */

#endif /* SOUNDSCAPER_PIPEWIRE_API_H */
