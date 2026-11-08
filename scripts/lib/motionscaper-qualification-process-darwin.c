/* SPDX-License-Identifier: AGPL-3.0-only */
/* Target-native controller. libproc birth + audit-token PID version protect individual signals.
 * Interface authority: apple-oss-distributions/xnu libsyscall/wrappers/libproc/libproc.c. */
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <signal.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <dlfcn.h>

#define LIMIT 65536
#define ZOMBIE 5
/* Versioned kernel flavor 17. Missing/incompatible capability fails before launch. */
struct unique_info { uint8_t uuid[16]; uint64_t unique,parent_unique; int32_t version; uint32_t reserved; uint64_t reserve3,reserve4; };
typedef int (*token_signal_fn)(audit_token_t *,int);
static token_signal_fn token_signal;
static void quoted(FILE *out,const char *value) {
 fputc('"',out);
 for(const unsigned char *p=(const unsigned char *)value;*p;p++) {
  if(*p=='"'||*p=='\\'){fputc('\\',out);fputc(*p,out);}
  else if(*p<32)fprintf(out,"\\u%04x",*p);else fputc(*p,out);
 }
 fputc('"',out);
}
static int info(pid_t pid,struct proc_bsdinfo *value,char *path) {
 errno=0;int size=proc_pidinfo(pid,PROC_PIDTBSDINFO,0,value,sizeof(*value));
 if(size!=(int)sizeof(*value))return errno==ESRCH||errno==ENOENT||errno==0?0:-1;
 path[0]=0;
 if(proc_pidpath(pid,path,PROC_PIDPATHINFO_MAXSIZE)<=0&&value->pbi_status!=ZOMBIE)return -1;
 return 1;
}
static void identity(FILE *out,const struct proc_bsdinfo *value,const char *path) {
 fprintf(out,"{\"platform\":\"darwin\",\"pid\":%u,\"parent\":%u,\"birth\":\"%llu.%06llu\",\"executable\":",
  value->pbi_pid,value->pbi_ppid,(unsigned long long)value->pbi_start_tvsec,(unsigned long long)value->pbi_start_tvusec);
 quoted(out,path);
 fprintf(out,",\"group\":%u,\"session\":%d,\"state\":\"%s\"}",value->pbi_pgid,getsid((pid_t)value->pbi_pid),value->pbi_status==ZOMBIE?"zombie":"running");
}
static FILE *exclusive(const char *path) {
 int fd=open(path,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0){perror("exclusive receipt");exit(125);}
 FILE *out=fdopen(fd,"w");if(!out){close(fd);exit(125);}return out;
}
static double monotonic(void) {
 struct timespec value;if(clock_gettime(CLOCK_MONOTONIC,&value))exit(125);
 return (double)value.tv_sec+(double)value.tv_nsec/1000000000.0;
}
static int positive(const char *text) {
 char *end=NULL;long value=strtol(text,&end,10);
 if(!end||*end||value<1||value>2147483647L)exit(125);
 return (int)value;
}
static void birth_text(const struct proc_bsdinfo *value,char *text,size_t size) {
 snprintf(text,size,"%llu.%06llu",(unsigned long long)value->pbi_start_tvsec,(unsigned long long)value->pbi_start_tvusec);
}
static int authenticated_signal(pid_t pid,const char *birth,const char *executable,int selected) {
 struct proc_bsdinfo before,after;char path[PROC_PIDPATHINFO_MAXSIZE],actual[80];struct unique_info unique;
 int found=info(pid,&before,path);if(found<=0)return found;
 birth_text(&before,actual,sizeof(actual));
 if(strcmp(actual,birth)||strcmp(path,executable))return -1;
 if(before.pbi_status==ZOMBIE)return 0;
 if(!token_signal||proc_pidinfo(pid,17,0,&unique,sizeof(unique))!=(int)sizeof(unique))return -1;
 if(info(pid,&after,path)!=1||before.pbi_start_tvsec!=after.pbi_start_tvsec||before.pbi_start_tvusec!=after.pbi_start_tvusec||strcmp(path,executable))return -1;
 audit_token_t token={{0}};token.val[1]=after.pbi_uid;token.val[2]=after.pbi_gid;token.val[3]=after.pbi_ruid;token.val[4]=after.pbi_rgid;token.val[5]=(uint32_t)pid;token.val[7]=(uint32_t)unique.version;
 int status=token_signal(&token,selected);
 return status==0||status==ESRCH?0:-1; /* Kernel atomically compares the PID version; no PID-only kill fallback. */
}
static int process_census(pid_t *pids) {
 /* libproc returns zero on syscall failure too; a live caller cannot have an empty census. */
 errno=0;int count=proc_listallpids(pids,LIMIT*(int)sizeof(pid_t));
 if(count<=0||count>=LIMIT){if(!errno)errno=count>=LIMIT?EOVERFLOW:EIO;return -1;}
 return count;
}
static int session_members(pid_t anchor,pid_t *pids) {
 int count=process_census(pids);if(count<0)return -1;
 int selected=0;
 for(int n=0;n<count;n++)if(pids[n]>0&&pids[n]!=anchor&&getsid(pids[n])==anchor)pids[selected++]=pids[n];
 return selected;
}
static int signal_session_members(pid_t anchor,pid_t *pids,int selected) {
 int count=session_members(anchor,pids);if(count<0)return -1;
 for(int n=0;n<count;n++) {
  struct proc_bsdinfo value;char path[PROC_PIDPATHINFO_MAXSIZE],birth[80];
  int found=info(pids[n],&value,path);if(found<0)return -1;
  if(found==1&&value.pbi_status!=ZOMBIE&&getsid(pids[n])==anchor) {
   birth_text(&value,birth,sizeof(birth));
   if(authenticated_signal(pids[n],birth,path,selected)<0)return -1;
  }
 }
 return count;
}
struct forward_state { char bytes[8192];size_t size,offset;int ended; };
static int forward(int fd,int destination,size_t *bytes,int maximum,struct forward_state *state) {
 /* At most one buffer per turn. EAGAIN retains pending bytes while the controller checks EOF/deadlines. */
 if(state->offset==state->size&&!state->ended) {
  ssize_t count=read(fd,state->bytes,sizeof(state->bytes));
  if(count==0){state->ended=1;return 0;}
  if(count<0)return errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR?0:-1;
  *bytes+=(size_t)count;if(*bytes>(size_t)maximum)return -1;
  state->size=(size_t)count;state->offset=0;
 }
 while(state->offset<state->size) {
  ssize_t count=write(destination,state->bytes+state->offset,state->size-state->offset);
  if(count<0)return errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR?0:-1;
  if(count==0)return -1;
  state->offset+=(size_t)count;
 }
 return 0;
}
static int caller_closed(void) {
 char byte;ssize_t count=read(STDIN_FILENO,&byte,1);
 return count==0||count>0||(count<0&&errno!=EAGAIN&&errno!=EWOULDBLOCK&&errno!=EINTR);
}
static int run(int argc,char **argv) {
 /* run executable cwd ownerFile closureFile timeoutMs maximumOutputBytes controlId -- args... */
 if(argc<10||strcmp(argv[9],"--"))return 125;
 const char *executable=argv[2],*cwd=argv[3],*ownerFile=argv[4],*closureFile=argv[5],*controlId=argv[8];
 int timeout=positive(argv[6]),maximum=positive(argv[7]);if(timeout>600000||maximum>2097152)return 125;
 struct stat input;if(fstat(STDIN_FILENO,&input)||(!S_ISFIFO(input.st_mode)&&!S_ISSOCK(input.st_mode)))return 125;
 struct unique_info self_unique;if(!token_signal||proc_pidinfo(getpid(),17,0,&self_unique,sizeof(self_unique))!=(int)sizeof(self_unique))return 125;
 if(setsid()<0)return 125;
 pid_t anchor=getpid();
 int output_pipe[2],error_pipe[2];if(pipe(output_pipe)||pipe(error_pipe))return 125;
 if(fcntl(STDIN_FILENO,F_SETFL,O_NONBLOCK)<0||fcntl(STDOUT_FILENO,F_SETFL,fcntl(STDOUT_FILENO,F_GETFL)|O_NONBLOCK)<0||fcntl(STDERR_FILENO,F_SETFL,fcntl(STDERR_FILENO,F_GETFL)|O_NONBLOCK)<0)return 125;
 signal(SIGPIPE,SIG_IGN);
 char **childArgs=calloc((size_t)argc,sizeof(char *));if(!childArgs)return 125;childArgs[0]=(char *)executable;
 for(int n=10;n<argc;n++)childArgs[n-9]=argv[n];
 pid_t *pids=calloc(LIMIT,sizeof(pid_t));if(!pids){free(childArgs);return 125;}
 char pendingOwner[PROC_PIDPATHINFO_MAXSIZE];if(snprintf(pendingOwner,sizeof(pendingOwner),"%s.pending",ownerFile)>=(int)sizeof(pendingOwner)){free(pids);free(childArgs);return 125;}
 FILE *ownerOut=exclusive(pendingOwner),*closureOut=exclusive(closureFile);
 const double started=monotonic();pid_t child=fork();
 if(child<0){free(childArgs);free(pids);fclose(ownerOut);fclose(closureOut);return 125;}
 if(child==0) {
  close(output_pipe[0]);close(error_pipe[0]);if(dup2(output_pipe[1],STDOUT_FILENO)<0||dup2(error_pipe[1],STDERR_FILENO)<0)_exit(126);
  close(output_pipe[1]);close(error_pipe[1]);close(STDIN_FILENO);if(open("/dev/null",O_RDONLY)!=STDIN_FILENO||chdir(cwd))_exit(126);
  signal(SIGPIPE,SIG_DFL);execv(executable,childArgs);_exit(127);
 }
 free(childArgs);close(output_pipe[1]);close(error_pipe[1]);
 fcntl(output_pipe[0],F_SETFL,O_NONBLOCK);fcntl(error_pipe[0],F_SETFL,O_NONBLOCK);
 struct proc_bsdinfo owner={0},controller;char ownerPath[PROC_PIDPATHINFO_MAXSIZE],controllerPath[PROC_PIDPATHINFO_MAXSIZE];int admitted=0;
 for(int n=0;n<1000;n++) {
  int found=info(child,&owner,ownerPath);
  if(found==1&&owner.pbi_pgid==(uint32_t)anchor&&getsid(child)==anchor&&(!strcmp(ownerPath,executable)||owner.pbi_status==ZOMBIE)){admitted=1;break;}
  if(found<0)break;
  usleep(1000);
 }
 const char *failure=NULL;int status=0,closed=0,timedOut=0;struct forward_state outputState={0},errorState={0};size_t bytes=0;double failedAt=0,closedAt=0;
 if(!admitted)failure="owned application birth/session admission failed";
 if(admitted&&info(anchor,&controller,controllerPath)==1) {
  if(!ownerPath[0])snprintf(ownerPath,sizeof(ownerPath),"%s",executable);
  FILE *out=ownerOut;fputs("{\"owner\":",out);identity(out,&owner,ownerPath);fputs(",\"controller\":",out);identity(out,&controller,controllerPath);
  fputs(",\"custody\":{\"platform\":\"darwin\",\"controlId\":",out);quoted(out,controlId);fprintf(out,",\"group\":%d,\"session\":%d}}\n",anchor,anchor);if(fflush(out)||fsync(fileno(out)))failure="owned identity publication failed";fclose(out);ownerOut=NULL;
  if(link(pendingOwner,ownerFile)||unlink(pendingOwner))failure="exclusive atomic owner publication failed";
 } else failure="owned controller identity unavailable";
 if(ownerOut){fclose(ownerOut);ownerOut=NULL;}
 int remaining=1;
 for(;;) {
  if(!closed) {pid_t result=waitpid(child,&status,WNOHANG);if(result==child){closed=1;closedAt=monotonic();}else if(result<0)failure="owned waitpid failed";}
  if(caller_closed()&&!failure)failure="caller control pipe closed or received unadmitted input";
  if(forward(output_pipe[0],STDOUT_FILENO,&bytes,maximum,&outputState)<0||forward(error_pipe[0],STDERR_FILENO,&bytes,maximum,&errorState)<0)failure="owned output bound or caller stream failed";
  remaining=session_members(anchor,pids);if(remaining<0)failure="owned session observation failed";
  if(!failure&&monotonic()-started>(double)timeout/1000.0){failure="owned command deadline exceeded";timedOut=1;}
  if(!failure&&closed&&remaining>0&&monotonic()-closedAt>5)failure="owned descendants survived application exit";
  if(failure) {
   if(!failedAt)failedAt=monotonic();
   if(!admitted&&!closed)kill(child,SIGKILL); /* Direct unreaped fork child cannot be PID-reused. */
   if(signal_session_members(anchor,pids,monotonic()-failedAt>1?SIGKILL:SIGTERM)<0)failure="owned audit-token signal refused; custody unresolved";
  }
  if(closed&&remaining==0&&outputState.ended&&errorState.ended)break;
  if(failure&&monotonic()-failedAt>15)break;
  usleep(10000);
 }
 close(output_pipe[0]);close(error_pipe[0]);free(pids);
 int code=closed?(WIFEXITED(status)?WEXITSTATUS(status):128+WTERMSIG(status)):125;
 FILE *out=closureOut;
 fprintf(out,"{\"physicalClosed\":%s,\"exitCode\":%d,\"signal\":%d,\"timedOut\":%s,\"failure\":",remaining==0&&closed&&outputState.ended&&errorState.ended?"true":"false",code,closed&&WIFSIGNALED(status)?WTERMSIG(status):0,timedOut?"true":"false");
 if(failure)quoted(out,failure);else fputs("null",out);
 fprintf(out,",\"remainingOwned\":%d,\"maximumOutputBytes\":%d,\"outputBytes\":%zu,\"scope\":\"Controller-held isolated session, libproc births and atomic audit-token PID-version signals; no inherited/global group signal.\"}\n",remaining,maximum,bytes);fclose(out);
 return failure?(timedOut?124:125):code;
}
int main(int argc,char **argv) {
 token_signal=(token_signal_fn)dlsym(RTLD_DEFAULT,"proc_signal_with_audittoken");
 if(argc<2)return 125;
 if(!strcmp(argv[1],"run"))return run(argc,argv);
 if(!strcmp(argv[1],"inspect")&&argc==3) {
  struct proc_bsdinfo value;char path[PROC_PIDPATHINFO_MAXSIZE];int result=info(positive(argv[2]),&value,path);
  if(result<0)return 125;
  if(result==0)puts("null");else{identity(stdout,&value,path);puts("");}return 0;
 }
 if(!strcmp(argv[1],"snapshot")&&argc==2) {
  pid_t *pids=calloc(LIMIT,sizeof(pid_t));if(!pids)return 125;
  int count=process_census(pids);if(count<0){perror("owned process census");free(pids);return 125;}
  int first=1,gaps=0;fputs("{\"processes\":[",stdout);
  for(int n=0;n<count;n++){if(pids[n]<=0)continue;struct proc_bsdinfo value;char path[PROC_PIDPATHINFO_MAXSIZE];int result=info(pids[n],&value,path);
   if(result<0){gaps++;continue;}if(result==1){if(!first)fputc(',',stdout);identity(stdout,&value,path);first=0;}
  }
  fprintf(stdout,"],\"visibilityGaps\":%d}\n",gaps);free(pids);return 0;
 }
 if(!strcmp(argv[1],"signal")&&argc==6) {
  int selected=!strcmp(argv[5],"TERM")?SIGTERM:!strcmp(argv[5],"KILL")?SIGKILL:0;
  if(!selected||authenticated_signal(positive(argv[2]),argv[3],argv[4],selected)<0)return 125;
  puts("{\"authenticated\":true}");return 0;
 }
 return 125;
}
