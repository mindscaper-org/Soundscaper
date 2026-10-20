/* SPDX-License-Identifier: AGPL-3.0-only */

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

#define MAXIMUM_GRANTS 64u
#define MAXIMUM_ARGUMENTS 128u
#define MAXIMUM_POLICY_BYTES 4096u
#define MAXIMUM_DURATION_MS 86400000ULL
#define MAXIMUM_RSS_BYTES 1073741824ULL
#define CHILD_FAILURE 125
#define FILTER_STMT(code, value) ((struct sock_filter)BPF_STMT(code, value))
#define FILTER_JUMP(code, value, yes, no) ((struct sock_filter)BPF_JUMP(code, value, yes, no))

static const char expected_profile[] = "{\"schemaVersion\":1,\"id\":\"lightscaper-photo-linux-post-loader-isolation-v1\",\"namespaces\":[\"user\",\"mount\",\"pid\",\"network\",\"ipc\",\"uts\"],\"filesystem\":\"landlock-zero-source-grants-retained-image-only\",\"network\":\"namespace-and-seccomp-denied\",\"childProcesses\":\"seccomp-thread-only\",\"dynamicCode\":\"no-ungranted-file-execute\",\"resourceCeilings\":\"outer-pid-duration-rss-v1\",\"enforcementHandshake\":\"peer-post-loader-before-parser-enforcement-pipe-v1\"}\n";
static const char expected_broker[] = "{\"schemaVersion\":1,\"id\":\"milestone5-native-child-broker-v1\",\"maximumGrants\":64,\"readOnly\":\"no-follow-fd\",\"readExecute\":\"no-follow-fd\",\"writeOnly\":\"no-follow-fd\",\"inheritedDescriptors\":\"closed\",\"environment\":\"fixed-empty\"}\n";
static const char enforcement_frame[] = "M5_NATIVE_ISOLATION_ENFORCED_V1\n";
enum grant_access { GRANT_READ_ONLY, GRANT_READ_EXECUTE, GRANT_WRITE_ONLY };
struct grant { int fd; enum grant_access access; };
struct launch_request { int executable_fd; struct grant grants[MAXIMUM_GRANTS]; size_t grant_count; };

static bool exact_file(int fd, const char *expected)
{
 struct stat metadata; const size_t length = strlen(expected);
 if (fstat(fd, &metadata) != 0 || !S_ISREG(metadata.st_mode) || length > MAXIMUM_POLICY_BYTES || metadata.st_size != (off_t)length) return false;
 char bytes[MAXIMUM_POLICY_BYTES]; return pread(fd, bytes, length, 0) == (ssize_t)length && memcmp(bytes, expected, length) == 0;
}
static uint64_t handled_filesystem_access(void)
{
	return LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_READ_FILE
		| LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE
		| LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG
		| LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK
		| LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER | LANDLOCK_ACCESS_FS_TRUNCATE;
}

static uint64_t allowed_access(int fd, enum grant_access access)
{
	struct stat metadata;
	if (fstat(fd, &metadata) != 0) return 0u;
	const bool directory = S_ISDIR(metadata.st_mode);
	if (access == GRANT_READ_ONLY) return LANDLOCK_ACCESS_FS_READ_FILE
		| (directory ? LANDLOCK_ACCESS_FS_READ_DIR : 0u);
	if (access == GRANT_READ_EXECUTE) return LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE
		| (directory ? LANDLOCK_ACCESS_FS_READ_DIR : 0u);
	return LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE
		| (directory ? LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE
			| LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK
			| LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER : 0u);
}

static bool add_landlock_rule(int ruleset, int fd, enum grant_access access)
{
	const struct landlock_path_beneath_attr rule = {
		.allowed_access = allowed_access(fd, access), .parent_fd = fd,
	};
	return rule.allowed_access != 0u
		&& syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0u) == 0;
}

static bool restrict_filesystem(const struct launch_request *request)
{
	const int abi = (int)syscall(SYS_landlock_create_ruleset, NULL, 0u, LANDLOCK_CREATE_RULESET_VERSION);
	if (abi < 3) return false;
	const struct landlock_ruleset_attr rules = { .handled_access_fs = handled_filesystem_access() };
	const int ruleset = (int)syscall(SYS_landlock_create_ruleset, &rules, sizeof(rules), 0u);
	if (ruleset < 0 || !add_landlock_rule(ruleset, request->executable_fd, GRANT_READ_EXECUTE)) {
		if (ruleset >= 0) close(ruleset);
		return false;
	}
	for (size_t index = 0u; index < request->grant_count; ++index) {
		if (!add_landlock_rule(ruleset, request->grants[index].fd, request->grants[index].access)) {
			close(ruleset);
			return false;
		}
	}
	const bool restricted = prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == 0
		&& syscall(SYS_landlock_restrict_self, ruleset, 0u) == 0;
	close(ruleset);
	return restricted;
}

static void append_filter(struct sock_filter *filters, size_t *count, struct sock_filter value)
{
	filters[(*count)++] = value;
}

static void deny_syscall(struct sock_filter *filters, size_t *count, int syscall_number, int error_number)
{
	append_filter(filters, count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K,
		(uint32_t)syscall_number, 0u, 1u));
	append_filter(filters, count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (uint32_t)error_number));
}

static bool install_seccomp(void)
{
	struct sock_filter filters[128];
	size_t count = 0u;
#if defined(__x86_64__)
	const uint32_t architecture = AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
	const uint32_t architecture = AUDIT_ARCH_AARCH64;
#else
	return false;
#endif
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, architecture, 1u, 0u));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_socketpair, 0u, 3u));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS,
		offsetof(struct seccomp_data, args[0])));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_UNIX, 1u, 0u));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
#define DENY(number) deny_syscall(filters, &count, number, EPERM)
	DENY(SYS_socket); DENY(SYS_connect); DENY(SYS_bind); DENY(SYS_listen);
	DENY(SYS_accept); DENY(SYS_accept4); DENY(SYS_sendto); DENY(SYS_recvfrom); DENY(SYS_sendmsg);
	DENY(SYS_recvmsg); DENY(SYS_shutdown); DENY(SYS_setsockopt); DENY(SYS_getsockopt);
#ifdef SYS_fork
	DENY(SYS_fork);
#endif
#ifdef SYS_vfork
	DENY(SYS_vfork);
#endif
#ifdef SYS_clone3
	deny_syscall(filters, &count, SYS_clone3, ENOSYS);
#endif
	DENY(SYS_unshare); DENY(SYS_setns); DENY(SYS_mount); DENY(SYS_umount2); DENY(SYS_pivot_root);
	DENY(SYS_chroot); DENY(SYS_ptrace); DENY(SYS_process_vm_readv); DENY(SYS_process_vm_writev);
	DENY(SYS_bpf); DENY(SYS_perf_event_open); DENY(SYS_keyctl); DENY(SYS_add_key); DENY(SYS_request_key);
	DENY(SYS_userfaultfd); DENY(SYS_open_by_handle_at); DENY(SYS_name_to_handle_at);
#undef DENY
	const uint32_t required = CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND | CLONE_THREAD;
	const uint32_t allowed = required | CLONE_SYSVSEM | CLONE_SETTLS | CLONE_PARENT_SETTID
		| CLONE_CHILD_CLEARTID | CLONE_CHILD_SETTID;
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0u, 11u));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS,
		offsetof(struct seccomp_data, args[0])));
	append_filter(filters, &count, FILTER_STMT(BPF_ALU | BPF_AND | BPF_K, required));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, required, 1u, 0u));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS,
		offsetof(struct seccomp_data, args[0])));
	append_filter(filters, &count, FILTER_STMT(BPF_ALU | BPF_AND | BPF_K, ~allowed));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0u, 1u, 0u));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM));
	append_filter(filters, &count, FILTER_STMT(BPF_LD | BPF_W | BPF_ABS,
		offsetof(struct seccomp_data, args[0]) + sizeof(uint32_t)));
	append_filter(filters, &count, FILTER_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0u, 1u, 0u));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
	append_filter(filters, &count, FILTER_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
	const struct sock_fprog program = { .len = (unsigned short)count, .filter = filters };
	return prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) == 0;
}


/* Extracted M5 enforcement, executed by the exact fd-selected Photo peer after
 * system loader startup and before any protocol/body/parser operation. */
int lightscaper_photo_linux_bootstrap(void)
{
 int death = 0; struct stat metadata;
 if (getpid() != 1 || prctl(PR_GET_PDEATHSIG, &death) != 0 || death != SIGKILL
  || prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0 || !exact_file(4, expected_profile) || !exact_file(5, expected_broker)
  || fstat(6, &metadata) != 0 || !S_ISREG(metadata.st_mode)) return 0;
 const struct launch_request request = { .executable_fd = 6, .grant_count = 0u };
 if (!restrict_filesystem(&request) || !install_seccomp()) return 0;
 for (int descriptor = 4; descriptor < 4096; ++descriptor) if (close(descriptor) != 0 && errno != EBADF) return 0;
 const size_t length = sizeof(enforcement_frame) - 1u;
 if (write(3, enforcement_frame, length) != (ssize_t)length || close(3) != 0) return 0;
 return 1;
}
