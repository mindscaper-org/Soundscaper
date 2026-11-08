/* SPDX-License-Identifier: AGPL-3.0-only */
/* Test-only declarations: these are not a macOS SDK or native-platform evidence. */
#ifndef MOTION_TEST_LIBPROC_H
#define MOTION_TEST_LIBPROC_H
#include <stdint.h>
typedef struct { uint32_t val[8]; } audit_token_t;
int proc_listallpids(void *buffer, int size);
int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int size);
int proc_pidpath(int pid, void *buffer, uint32_t size);
#endif
