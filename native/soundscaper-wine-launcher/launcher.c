/* SPDX-License-Identifier: AGPL-3.0-only */
/* Trusted Wine plugins share their prefix's normal wineserver. Supervision
 * bounds the plugin tree; it does not sandbox account or shared-server access. */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;
static volatile sig_atomic_t stopping = 0;
struct process { pid_t pid, parent, group; bool owned, server; };
static struct process processes[16384];
static struct stat server_identity;
static struct stat service_identities[16];
static size_t service_count = 0;
static bool has_server = false;
static void stop_handler(int signal_number) { (void)signal_number; stopping = 1; }

static bool number(const char *value, uint64_t maximum, uint64_t *result)
{
	if (!value || value[0] < '1' || value[0] > '9') return false;
	char *end = NULL; errno = 0;
	const unsigned long long parsed = strtoull(value, &end, 10);
	if (errno || *end || parsed > maximum) return false;
	*result = (uint64_t)parsed;
	return true;
}

static uint64_t elapsed(const struct timespec *start)
{
	struct timespec now;
	if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return UINT64_MAX;
	const int64_t value = ((int64_t)now.tv_sec - start->tv_sec) * 1000
		+ ((int64_t)now.tv_nsec - start->tv_nsec) / 1000000;
	return value > 0 ? (uint64_t)value : 0;
}

static bool is_shared_service(pid_t pid)
{
	char path[64]; struct stat executable;
	if (snprintf(path, sizeof(path), "/proc/%ld/exe", (long)pid) < 1) return false;
	if (has_server && stat(path, &executable) == 0 && executable.st_dev == server_identity.st_dev
		&& executable.st_ino == server_identity.st_ino) return true;
	if (!service_count || snprintf(path, sizeof(path), "/proc/%ld/maps", (long)pid) < 1) return false;
	FILE *stream = fopen(path, "re");
	if (!stream) return false;
	char line[4096]; bool found = false;
	while (fgets(line, sizeof(line), stream)) {
		unsigned device_major, device_minor; unsigned long long inode;
		if (sscanf(line, "%*s %*s %*s %x:%x %llu", &device_major, &device_minor, &inode) != 3) continue;
		for (size_t index = 0; index < service_count; ++index) {
			if (service_identities[index].st_dev == makedev(device_major, device_minor)
				&& (unsigned long long)service_identities[index].st_ino == inode) { found = true; break; }
		}
		if (found) break;
	}
	(void)fclose(stream);
	return found;
}

/* The subreaper adopts detached descendants after their parents exit. The
 * authenticated external wineserver and mapped Wine builtin service images
 * remain shared across sessions, including after the last peer exits. */
static bool sample(pid_t peer, uint64_t *rss, unsigned *count, size_t *length)
{
	DIR *directory = opendir("/proc");
	if (!directory) return false;
	struct dirent *entry; *length = 0; *rss = 0; *count = 0;
	while ((entry = readdir(directory)) != NULL) {
		if (entry->d_name[0] < '0' || entry->d_name[0] > '9') continue;
		if (*length >= sizeof(processes) / sizeof(processes[0])) { closedir(directory); return false; }
		char path[300], text[4096];
		if (snprintf(path, sizeof(path), "/proc/%s/stat", entry->d_name) < 1) continue;
		FILE *stream = fopen(path, "re");
		if (!stream) continue;
		const bool read = fgets(text, sizeof(text), stream) != NULL;
		(void)fclose(stream);
		char *end = read ? strrchr(text, ')') : NULL; char state;
		struct process row = { .pid = (pid_t)strtol(entry->d_name, NULL, 10) };
		if (!end || sscanf(end + 1, " %c %d %d", &state, &row.parent, &row.group) != 3) continue;
		row.server = row.pid != peer && (row.parent == getpid() || row.group == peer) && is_shared_service(row.pid);
		row.owned = !row.server && (row.pid == peer || row.parent == getpid() || row.group == peer);
		processes[(*length)++] = row;
	}
	(void)closedir(directory);
	for (unsigned depth = 0; depth < 64; ++depth) {
		bool changed = false;
		for (size_t index = 0; index < *length; ++index) {
			if (processes[index].owned || processes[index].server) continue;
			for (size_t parent = 0; parent < *length; ++parent) {
				if (processes[parent].owned && processes[index].parent == processes[parent].pid) {
					processes[index].server = is_shared_service(processes[index].pid);
					processes[index].owned = !processes[index].server; changed = true; break;
				}
			}
		}
		if (!changed) break;
	}
	/* A shared service may launch licensing or other prefix-wide services. Their
	 * lifetime belongs to Wine, even if they inherited the peer's process group. */
	for (unsigned depth = 0; depth < 64; ++depth) {
		bool changed = false;
		for (size_t index = 0; index < *length; ++index) {
			if (processes[index].server || processes[index].pid == peer) continue;
			for (size_t parent = 0; parent < *length; ++parent) {
				if (processes[parent].server && processes[index].parent == processes[parent].pid) {
					processes[index].server = true; processes[index].owned = false; changed = true; break;
				}
			}
		}
		if (!changed) break;
	}
	const long page_size = sysconf(_SC_PAGESIZE);
	if (page_size < 1) return false;
	for (size_t index = 0; index < *length; ++index) {
		if (!processes[index].owned) continue;
		++*count;
		char path[64];
		if (snprintf(path, sizeof(path), "/proc/%ld/statm", (long)processes[index].pid) < 1) return false;
		FILE *stream = fopen(path, "re");
		if (!stream) { if (errno == ENOENT || errno == ESRCH) continue; return false; }
		unsigned long long ignored = 0, resident = 0;
		const int fields = fscanf(stream, "%llu %llu", &ignored, &resident);
		(void)fclose(stream);
		if (fields != 2 || resident > UINT64_MAX / (uint64_t)page_size
			|| *rss > UINT64_MAX - resident * (uint64_t)page_size) return false;
		*rss += resident * (uint64_t)page_size;
	}
	return true;
}

static void terminate_tree(pid_t peer)
{
	/* Repeat after signalling parents so newly adopted detached children cannot
	 * escape the final snapshot. Never signal a user's shared wineserver. */
	for (unsigned attempt = 0; attempt < 50; ++attempt) {
		uint64_t rss; unsigned count; size_t length;
		if (!sample(peer, &rss, &count, &length)) { (void)kill(peer, SIGKILL); return; }
		for (size_t index = 0; index < length; ++index) if (processes[index].owned) (void)kill(processes[index].pid, SIGKILL);
		while (waitpid(-1, NULL, WNOHANG) > 0) {}
		if (count == 0) return;
		const struct timespec interval = { 0, 10000000 }; (void)nanosleep(&interval, NULL);
	}
}

static int status_code(int status)
{
	return WIFEXITED(status) ? WEXITSTATUS(status) : WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 125;
}

static int supervise(int parent_fd, uint64_t duration, uint64_t memory, char **arguments)
{
	struct sigaction action = { .sa_handler = stop_handler };
	sigemptyset(&action.sa_mask);
	if (sigaction(SIGTERM, &action, NULL) != 0 || sigaction(SIGINT, &action, NULL) != 0
		|| prctl(PR_SET_PDEATHSIG, SIGTERM) != 0 || prctl(PR_SET_CHILD_SUBREAPER, 1) != 0
		|| prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return 125;
	struct pollfd parent = { .fd = parent_fd, .events = POLLIN };
	if (poll(&parent, 1, 0) != 0) return 125;
	(void)close(parent_fd);
	struct timespec start;
	if (clock_gettime(CLOCK_MONOTONIC, &start) != 0) return 125;
	const pid_t child = fork();
	if (child < 0) return 125;
	if (child == 0) {
		const struct rlimit core = { 0, 0 }, files = { 1024, 1024 };
		const char ready[] = "M5_WINE_PLUGIN_PROCESS_SUPERVISED_V1\n";
		if (setpgid(0, 0) != 0 || prctl(PR_SET_PDEATHSIG, SIGKILL) != 0
			|| setrlimit(RLIMIT_CORE, &core) != 0 || setrlimit(RLIMIT_NOFILE, &files) != 0
			|| write(3, ready, sizeof(ready) - 1) != (ssize_t)(sizeof(ready) - 1)
			|| close(3) != 0 || fcntl(4, F_SETFD, FD_CLOEXEC) != 0) _exit(125);
		for (int fd = 3; fd < 4096; ++fd) if (fd != 4) (void)close(fd);
		syscall(SYS_execveat, 4, "", arguments, environ, AT_EMPTY_PATH);
		_exit(125);
	}
	(void)close(3); (void)close(4); (void)close(5);
	(void)close(STDIN_FILENO); (void)close(STDOUT_FILENO);
	int status = 0, result = 125;
	for (;;) {
		const pid_t waited = waitpid(child, &status, WNOHANG);
		if (waited == child) { result = status_code(status); break; }
		if (stopping || (waited < 0 && errno != EINTR)) break;
		uint64_t rss; unsigned count; size_t length;
		if (elapsed(&start) > duration || !sample(child, &rss, &count, &length) || rss > memory || count > 64) break;
		const struct timespec interval = { 0, 50000000 }; (void)nanosleep(&interval, NULL);
	}
	terminate_tree(child);
	return result;
}

int main(int argc, char **argv)
{
	const pid_t owner = getppid();
	if (owner <= 1 || prctl(PR_SET_PDEATHSIG, SIGKILL) != 0 || getppid() != owner) return 125;
	uint64_t duration, memory;
	if (argc < 5 || !number(argv[1], 86400000, &duration) || !number(argv[2], 1073741824, &memory)
		|| strcmp(argv[3], "--") != 0) return 125;
	struct stat executable;
	if (fstat(4, &executable) != 0 || !S_ISREG(executable.st_mode)) return 125;
	has_server = fstat(5, &server_identity) == 0 && S_ISREG(server_identity.st_mode);
	for (int fd = 6; fd < 22; ++fd) {
		if (fstat(fd, &service_identities[service_count]) != 0 || !S_ISREG(service_identities[service_count].st_mode)) break;
		++service_count;
	}
	const int parent_fd = (int)syscall(SYS_pidfd_open, getpid(), 0);
	if (parent_fd < 0) return 125;
	const pid_t monitor = fork();
	if (monitor < 0) return 125;
	if (monitor == 0) _exit(supervise(parent_fd, duration, memory, &argv[4]));
	(void)close(parent_fd); (void)close(3); (void)close(4); (void)close(5);
	(void)close(STDIN_FILENO); (void)close(STDOUT_FILENO);
	int status;
	while (waitpid(monitor, &status, 0) < 0) if (errno != EINTR) return 125;
	return status_code(status);
}
