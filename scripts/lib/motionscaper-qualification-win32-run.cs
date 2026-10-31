// SPDX-License-Identifier: AGPL-3.0-only
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Soundscaper.Qualification.Win32 {
 public sealed class RunResult {
  public int schemaVersion { get; set; }
  public string platform { get; set; }
  public string id { get; set; }
  public Identity owner { get; set; }
  public Identity controller { get; set; }
  public Custody custody { get; set; }
  public string outcome { get; set; }
  public uint? childExitCode { get; set; }
  public int controllerExitCode { get; set; }
  public bool naturalClosure { get; set; }
  public bool timedOut { get; set; }
  public bool ownershipResolved { get; set; }
  public bool stdoutClosed { get; set; }
  public bool stderrClosed { get; set; }
  public long stdoutBytes { get; set; }
  public long stderrBytes { get; set; }
  public Identity[] survivorsBeforeCleanup { get; set; }
  public Identity[] survivorsAfterCleanup { get; set; }
  public string[] errors { get; set; }
  public bool parentControlPipeOpenAtClosure { get; set; }
  public long maximumOutputBytes { get; set; }
  public long timeoutMs { get; set; }
  public long elapsedMs { get; set; }
  public Native.Accounting accounting { get; set; }
 }
 internal sealed class OutputBudget { internal long Bytes; internal long Maximum; }
 internal sealed class ControlWatch {
  internal volatile string Failure;
  internal ControlWatch() {
   if(Native.GetFileType(Native.GetStdHandle(-10))!=3) throw new InvalidOperationException("The owner controller requires a retained stdin control pipe.");
   Task.Run(delegate { try { int value=Console.OpenStandardInput().ReadByte();Failure=value<0?"Parent control pipe reached EOF.":"Unexpected bytes on parent control pipe."; } catch(Exception error) { Failure="Parent control pipe failed: "+error.Message; } });
  }
 }
 internal sealed class PipePump {
  internal readonly ManualResetEvent Finished=new ManualResetEvent(false);
  internal volatile string Failure;
  internal long Bytes;
  internal bool Eof;
  internal PipePump(IntPtr pipe,Stream destination,OutputBudget budget) {
   SafeFileHandle safe=new SafeFileHandle(pipe,true);
   Task.Run(delegate {
    try {
     using(FileStream source=new FileStream(safe,FileAccess.Read,8192,false)) {
      byte[] buffer=new byte[8192];int count;
      while((count=source.Read(buffer,0,buffer.Length))>0) {
       Interlocked.Add(ref Bytes,count);long total=Interlocked.Add(ref budget.Bytes,count);
       if(total>budget.Maximum) throw new IOException("Owned child output exceeded its byte limit.");
       destination.Write(buffer,0,count);destination.Flush();
      }
      Eof=true;
     }
    } catch(Exception error) { Failure=error.Message; }
    finally { Finished.Set(); }
   });
  }
 }
 public static class ProcessHost {
  private const long MaximumOutputLimit=2097152;
  private static Identity[] Members(IntPtr job,List<string> errors) {
   List<Identity> result=new List<Identity>();
   foreach(uint pid in Native.JobPids(job)) {
    try { Identity identity=Native.Inspect(pid);if(identity!=null) result.Add(identity); }
    catch(Exception error) { errors.Add("Owned member "+pid+": "+error.Message); }
   }
   return result.ToArray();
  }
  private static bool DrainJob(IntPtr job,int milliseconds) {
   Stopwatch clock=Stopwatch.StartNew();
   do { if(Native.JobAccounting(job).activeProcesses==0) return true;Thread.Sleep(20); } while(clock.ElapsedMilliseconds<milliseconds);
   return Native.JobAccounting(job).activeProcesses==0;
  }
  public static RunResult Run(string executable,string[] arguments,string cwd,string directory,string id,long timeoutMs,string ownerFile,string closureFile,long maximumOutputBytes) {
   Native.Architecture();directory=Native.CanonicalDirectory(directory);
   string expectedOwner=Native.CustodyFile(directory,id,".owner.json"),expectedClosure=Native.CustodyFile(directory,id,".closure.json");
   if(!String.Equals(Path.GetFullPath(ownerFile),expectedOwner,StringComparison.OrdinalIgnoreCase)||!String.Equals(Path.GetFullPath(closureFile),expectedClosure,StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Owner/closure files must use their exact custody names.");
   if(File.Exists(ownerFile)||File.Exists(closureFile)) throw new IOException("Owner/closure receipts already exist.");
   if(maximumOutputBytes<1||maximumOutputBytes>MaximumOutputLimit) throw new ArgumentOutOfRangeException("maximumOutputBytes");
   if(timeoutMs<1||timeoutMs>21600000) throw new ArgumentOutOfRangeException("timeoutMs");
   executable=Native.FullLocalPath(executable);cwd=Native.FullLocalPath(cwd);
   if(!File.Exists(executable)||!Directory.Exists(cwd)) throw new ArgumentException("Existing absolute executable/cwd required.");
   if(arguments==null||arguments.Length>1024) throw new ArgumentException("Bounded argument array required.");
   StringBuilder command=new StringBuilder(Native.Quote(Path.GetFullPath(executable)));
   foreach(string value in arguments) command.Append(' ').Append(Native.Quote(value));
   if(command.Length>32766) throw new ArgumentException("Windows command line exceeds its bound.");
   Custody custody=new Custody { directory=directory,id=id,controlId=Guid.NewGuid().ToString("N") };custody.jobName="Local\\SoundscaperQualification-"+custody.controlId;
   RunResult result=new RunResult { schemaVersion=1,platform="win32",id=id,custody=custody,outcome="launch-failure",controllerExitCode=125,naturalClosure=false,ownershipResolved=false,survivorsBeforeCleanup=new Identity[0],survivorsAfterCleanup=new Identity[0] };
   result.controller=Native.Inspect(Native.GetCurrentProcessId());
   List<string> errors=new List<string>();IntPtr job=IntPtr.Zero,outRead=IntPtr.Zero,outWrite=IntPtr.Zero,errRead=IntPtr.Zero,errWrite=IntPtr.Zero,input=IntPtr.Zero,attributes=IntPtr.Zero,handleList=IntPtr.Zero;
   Native.ProcessInfo child=new Native.ProcessInfo();PipePump stdout=null,stderr=null;ControlWatch control=null;OutputBudget budget=new OutputBudget { Maximum=maximumOutputBytes };result.maximumOutputBytes=maximumOutputBytes;bool assigned=false,resumed=false,rootExited=false,jobEmpty=false,attributesInitialized=false;uint code=0;Stopwatch clock=Stopwatch.StartNew();result.timeoutMs=timeoutMs;
   try {
    control=new ControlWatch();
    if(control.Failure!=null) throw new IOException(control.Failure);
    job=Native.CreateJobObject(IntPtr.Zero,custody.jobName);
    if(job==IntPtr.Zero) throw Native.Error("CreateJobObject");
    if(Marshal.GetLastWin32Error()==183) throw new IOException("Owned job name unexpectedly exists.");
    Native.ExtendedLimits limits=new Native.ExtendedLimits();limits.basic.flags=0x2000;
    if(!Native.SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Native.ExtendedLimits)))) throw Native.Error("Set kill-on-close job policy");
    Native.SecurityAttributes security=new Native.SecurityAttributes { length=Marshal.SizeOf(typeof(Native.SecurityAttributes)),inherit=true,descriptor=IntPtr.Zero };
    if(!Native.CreatePipe(out outRead,out outWrite,ref security,0)||!Native.CreatePipe(out errRead,out errWrite,ref security,0)) throw Native.Error("Create bounded-output pipes");
    if(!Native.SetHandleInformation(outRead,1,0)||!Native.SetHandleInformation(errRead,1,0)) throw Native.Error("Protect output pipe reads");
    input=Native.CreateFile("NUL",0x80000000,3,ref security,3,0,IntPtr.Zero);if(input==new IntPtr(-1)) throw Native.Error("Open NUL stdin");
    IntPtr bytes=IntPtr.Zero;Native.InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref bytes);if(bytes==IntPtr.Zero) throw Native.Error("Measure handle-list attributes");
    attributes=Marshal.AllocHGlobal(bytes);if(!Native.InitializeProcThreadAttributeList(attributes,1,0,ref bytes)) throw Native.Error("Initialize handle-list attributes");attributesInitialized=true;
    handleList=Marshal.AllocHGlobal(3*IntPtr.Size);Marshal.WriteIntPtr(handleList,0,input);Marshal.WriteIntPtr(handleList,IntPtr.Size,outWrite);Marshal.WriteIntPtr(handleList,2*IntPtr.Size,errWrite);
    if(!Native.UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handleList,new IntPtr(3*IntPtr.Size),IntPtr.Zero,IntPtr.Zero)) throw Native.Error("Restrict inherited handles");
    Native.StartupInfoEx startup=new Native.StartupInfoEx();startup.startup.cb=Marshal.SizeOf(typeof(Native.StartupInfoEx));startup.startup.flags=0x100;startup.startup.input=input;startup.startup.output=outWrite;startup.startup.error=errWrite;startup.attributes=attributes;
    uint flags=Native.CreateSuspended|Native.CreateUnicodeEnvironment|Native.CreateNewProcessGroup|Native.ExtendedStartup;
    if(!Native.CreateProcess(Path.GetFullPath(executable),command,IntPtr.Zero,IntPtr.Zero,true,flags,IntPtr.Zero,Path.GetFullPath(cwd),ref startup,out child)) throw Native.Error("CreateProcess suspended");
    if(!Native.AssignProcessToJobObject(job,child.process)) throw Native.Error("Assign suspended child to owned Job");assigned=true;
    result.owner=Native.ReadIdentity(child.process,child.pid);if(result.owner==null) throw new IOException("Suspended owner has no retained identity.");
    Native.WriteExclusive(ownerFile,Native.OwnerJson(result.owner,custody,result.controller));
    Native.Close(ref outWrite);Native.Close(ref errWrite);Native.Close(ref input);
    stdout=new PipePump(outRead,Console.OpenStandardOutput(),budget);outRead=IntPtr.Zero;
    stderr=new PipePump(errRead,Console.OpenStandardError(),budget);errRead=IntPtr.Zero;
    if(control.Failure!=null) throw new IOException(control.Failure);
    if(clock.ElapsedMilliseconds>=timeoutMs) { result.timedOut=true;throw new TimeoutException("Owner deadline elapsed before resume."); }
    if(Native.ResumeThread(child.thread)==0xffffffff) throw Native.Error("Resume owned child");resumed=true;Native.Close(ref child.thread);
    result.outcome="natural";
    while(true) {
     if(control.Failure!=null) { result.outcome="parent-eof";errors.Add(control.Failure);break; }
     uint wait=Native.WaitForSingleObject(child.process,20);
     if(wait==0) { rootExited=true;if(clock.ElapsedMilliseconds>=timeoutMs) { result.outcome="timeout";result.timedOut=true; }break; }
     if(wait!=Native.WaitTimeout) throw Native.Error("Wait retained owner HANDLE");
     if(stdout.Failure!=null||stderr.Failure!=null) { result.outcome="output-failure";break; }
     if(clock.ElapsedMilliseconds>=timeoutMs) { result.outcome="timeout";result.timedOut=true;break; }
    }
    if(rootExited) {
     if(!Native.GetExitCodeProcess(child.process,out code)) throw Native.Error("Retained child exit code");result.childExitCode=code;
     jobEmpty=DrainJob(job,2000);
     if(!jobEmpty) { result.outcome="survivors";result.survivorsBeforeCleanup=Members(job,errors); }
    }
    if(!rootExited||!jobEmpty) {
     if(!Native.TerminateJobObject(job,137)) errors.Add(Native.Error("Terminate owned job during failed cleanup").Message);
     jobEmpty=DrainJob(job,2000);
    }
    if(!rootExited && Native.WaitForSingleObject(child.process,2000)==0) {
     rootExited=true;if(Native.GetExitCodeProcess(child.process,out code)) result.childExitCode=code;else errors.Add(Native.Error("Child cleanup exit code").Message);
    }
   } catch(Exception error) {
    errors.Add(error.Message);result.outcome=result.timedOut?"timeout":(resumed?"controller-failure":"launch-failure");
   } finally {
    if(child.process!=IntPtr.Zero && !rootExited) {
     if(assigned) { if(!Native.TerminateJobObject(job,137)) errors.Add(Native.Error("Final owned-job cleanup").Message); }
     else if(!Native.TerminateProcess(child.process,137)) errors.Add(Native.Error("Unassigned suspended-child cleanup").Message);
     rootExited=Native.WaitForSingleObject(child.process,2000)==0;if(!rootExited) errors.Add("Retained child HANDLE did not retire.");
    }
    if(job!=IntPtr.Zero) {
     try {
      jobEmpty=DrainJob(job,2000);
      if(!jobEmpty) { result.survivorsAfterCleanup=Members(job,errors);errors.Add("Owned job retained active processes after bounded cleanup."); }
      result.accounting=Native.JobAccounting(job);
     } catch(Exception error) { errors.Add(error.Message);jobEmpty=false; }
    }
    if(stdout!=null) {
     result.stdoutClosed=stdout.Finished.WaitOne(2000)&&stdout.Eof&&stdout.Failure==null;result.stdoutBytes=Interlocked.Read(ref stdout.Bytes);
     if(!result.stdoutClosed) errors.Add(stdout.Failure??"Stdout pump did not reach bounded EOF.");
    }
    if(stderr!=null) {
     result.stderrClosed=stderr.Finished.WaitOne(2000)&&stderr.Eof&&stderr.Failure==null;result.stderrBytes=Interlocked.Read(ref stderr.Bytes);
     if(!result.stderrClosed) errors.Add(stderr.Failure??"Stderr pump did not reach bounded EOF.");
    }
    result.ownershipResolved=rootExited&&jobEmpty;
    result.parentControlPipeOpenAtClosure=control!=null&&control.Failure==null;
    if(!result.parentControlPipeOpenAtClosure) { errors.Add(control==null?"Parent control pipe was not admitted.":control.Failure);if(result.outcome=="natural") result.outcome="parent-eof"; }
    result.naturalClosure=result.outcome=="natural"&&result.ownershipResolved&&result.stdoutClosed&&result.stderrClosed&&errors.Count==0;
    result.controllerExitCode=result.naturalClosure?unchecked((int)code):(result.outcome=="timeout"&&result.ownershipResolved?124:125);
    result.errors=errors.ToArray();result.elapsedMs=clock.ElapsedMilliseconds;
    Native.Close(ref outRead);Native.Close(ref outWrite);Native.Close(ref errRead);Native.Close(ref errWrite);Native.Close(ref input);Native.Close(ref child.thread);Native.Close(ref child.process);
    if(attributes!=IntPtr.Zero) { if(attributesInitialized) Native.DeleteProcThreadAttributeList(attributes);Marshal.FreeHGlobal(attributes); }
    if(handleList!=IntPtr.Zero) Marshal.FreeHGlobal(handleList);
    // Closing the retained Job is a last-resort containment barrier, never evidence of a natural pass.
    Native.Close(ref job);
   }
   return result;
  }
 }
}
