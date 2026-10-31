// SPDX-License-Identifier: AGPL-3.0-only
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

namespace Soundscaper.Qualification.Win32 {
 public sealed class ChooserResult {
  public int schemaVersion { get; set; }
  public string platform { get; set; }
  public string action { get; set; }
  public bool selected { get; set; }
  public string kind { get; set; }
  public string path { get; set; }
  public Identity owner { get; set; }
  public long dialogHandle { get; set; }
  public int[] dialogRuntimeId { get; set; }
  public bool invoked { get; set; }
  public bool dialogClosed { get; set; }
 }
 public static class OwnedUi {
  [DllImport("user32.dll",SetLastError=true)] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  private sealed class Dialog {
   internal AutomationElement Element;
   internal IntPtr Handle;
   internal int[] RuntimeId;
  }
  private static bool Equal(int[] left,int[] right) {
   if(left==null||right==null||left.Length!=right.Length) return false;
   for(int i=0;i<left.Length;i++) if(left[i]!=right[i]) return false;return true;
  }
  private static void VerifyWindow(Grant grant,Dialog dialog) {
   grant.Verify();uint pid;if(GetWindowThreadProcessId(dialog.Handle,out pid)==0||pid!=grant.Owner.pid) throw new InvalidOperationException("Dialog window identity changed.");
   AutomationElement actual=AutomationElement.FromHandle(dialog.Handle);
   if(actual==null||actual.Current.ProcessId!=grant.Owner.pid||!Equal(actual.GetRuntimeId(),dialog.RuntimeId)||!Equal(dialog.Element.GetRuntimeId(),dialog.RuntimeId)) throw new InvalidOperationException("UIAutomation dialog lease changed.");
  }
  private static AutomationElementCollection Windows(Grant grant) {
   grant.Verify();return AutomationElement.RootElement.FindAll(TreeScope.Children,new PropertyCondition(AutomationElement.ProcessIdProperty,checked((int)grant.Owner.pid)));
  }
  private static List<Dialog> Dialogs(Grant grant,string caption) {
   List<Dialog> result=new List<Dialog>();AutomationElementCollection windows=Windows(grant);
   if(windows.Count>128) throw new InvalidOperationException("Owned top-level window count exceeds its bound.");
   foreach(AutomationElement element in windows) {
    if(element.Current.IsOffscreen||element.Current.NativeWindowHandle==0) continue;
    object pattern;bool modal=element.TryGetCurrentPattern(WindowPattern.Pattern,out pattern)&&((WindowPattern)pattern).Current.IsModal;
    if(element.Current.ClassName!="#32770"&&!modal) continue;
    if(caption!=null&&!String.Equals(element.Current.Name,caption,StringComparison.Ordinal)) continue;
    Dialog dialog=new Dialog { Element=element,Handle=new IntPtr(element.Current.NativeWindowHandle),RuntimeId=element.GetRuntimeId() };VerifyWindow(grant,dialog);result.Add(dialog);
   }
   return result;
  }
  private static bool InDialog(AutomationElement element,Dialog dialog) {
   AutomationElement current=element;
   for(int i=0;i<128&&current!=null;i++) { if(Equal(current.GetRuntimeId(),dialog.RuntimeId)) return true;current=TreeWalker.ControlViewWalker.GetParent(current); }
   return false;
  }
  private static void VerifyInput(Grant grant,Dialog dialog,AutomationElement element) {
   VerifyWindow(grant,dialog);
   if(element.Current.ProcessId!=grant.Owner.pid||!element.Current.IsEnabled||!InDialog(element,dialog)) throw new InvalidOperationException("Input control is outside the granted dialog.");
  }
  private static bool FilenameControl(AutomationElement element,Dialog dialog) {
   if(element.Current.AutomationId=="1148") return true;
   AutomationElement current=element;
   for(int i=0;i<8&&current!=null&&!Equal(current.GetRuntimeId(),dialog.RuntimeId);i++) {
    string id=current.Current.AutomationId;
    if(id=="FileNameControlHost"||id=="1148") return true;
    current=TreeWalker.ControlViewWalker.GetParent(current);
   }
   return false;
  }
  private static AutomationElement FilenameEdit(Grant grant,Dialog dialog) {
   VerifyWindow(grant,dialog);AutomationElementCollection edits=dialog.Element.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit));
   if(edits.Count>128) throw new InvalidOperationException("Dialog edit control count exceeds its bound.");List<AutomationElement> candidates=new List<AutomationElement>();
   foreach(AutomationElement edit in edits) {
    object value;
    if(edit.Current.IsEnabled&&FilenameControl(edit,dialog)&&edit.TryGetCurrentPattern(ValuePattern.Pattern,out value)&&!((ValuePattern)value).Current.IsReadOnly) candidates.Add(edit);
   }
   if(candidates.Count!=1) throw new InvalidOperationException("A unique UIAutomation filename ValuePattern is required.");return candidates[0];
  }
  private static AutomationElement Button(Grant grant,Dialog dialog,string id) {
   Stopwatch clock=Stopwatch.StartNew();
   while(true) {
    VerifyWindow(grant,dialog);AutomationElementCollection buttons=dialog.Element.FindAll(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),new PropertyCondition(AutomationElement.AutomationIdProperty,id)));
    if(buttons.Count>1) throw new InvalidOperationException("More than one standard dialog command button is present.");
    object invoke;
    if(buttons.Count==1&&buttons[0].Current.IsEnabled&&buttons[0].TryGetCurrentPattern(InvokePattern.Pattern,out invoke)) return buttons[0];
    if(clock.ElapsedMilliseconds>=5000) throw new InvalidOperationException("A unique enabled standard dialog command button with InvokePattern did not become ready.");
    Thread.Sleep(25);
   }
  }
  private static bool Retired(Grant grant,Dialog dialog) {
   grant.Verify();
   foreach(Dialog current in Dialogs(grant,null)) if(Equal(current.RuntimeId,dialog.RuntimeId)) return false;
   return true;
  }
  public static ChooserResult Choose(Grant grant,string kind,string path,string directory,string caption,string action) {
   if(!Environment.UserInteractive) throw new InvalidOperationException("An interactive owned desktop is required for UIAutomation.");
   string expectedCaption,expectedAction,expectedName;
   switch(kind) {
    case "authored-save": expectedCaption="Save Motionscaper project";expectedAction="save";expectedName="saved.mscape";break;
    case "authored-export": expectedCaption="Export ProRes 4444";expectedAction="save";expectedName="output.mov";break;
    case "authored-cancel-export": expectedCaption="Export ProRes 4444";expectedAction="cancel";expectedName="output.mov";break;
    case "scene-open": expectedCaption="Open Motionscaper project";expectedAction="open";expectedName="saved.mscape";break;
    case "scene-export": expectedCaption="Export ProRes 4444";expectedAction="save";expectedName="output.mov";break;
    case "successor-open": expectedCaption="Connect saved Motionscaper composition";expectedAction="open";expectedName="saved.mscape";break;
    case "successor-export": expectedCaption="Export Frame sequence as ProRes 4444";expectedAction="save";expectedName="output.mov";break;
    default: throw new ArgumentException("Unknown chooser grant kind.");
   }
   if(caption!=expectedCaption||action!=expectedAction) throw new ArgumentException("Chooser caption/action differs from its closed grant kind.");
   string grantedPath=path;path=Native.FullLocalPath(path);directory=Native.FullLocalPath(directory);
   if(Path.GetFileName(path)!=expectedName) throw new ArgumentException("Chooser requires its exact granted file.");
   if(!String.Equals(Path.GetDirectoryName(Path.GetFullPath(path)),Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar),StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Chooser file is outside its granted parent.");
   if(action!="open"&&action!="save"&&action!="cancel") throw new ArgumentException("Invalid chooser action.");
   if(caption!=null&&(caption.Length==0||caption.Length>512)) throw new ArgumentException("Invalid exact dialog caption.");
   string full=null;
   if(action!="cancel") {
    if(String.IsNullOrEmpty(path)||!Path.IsPathRooted(path)||String.IsNullOrEmpty(directory)||!Path.IsPathRooted(directory)) throw new ArgumentException("An absolute granted file and directory are required.");
    full=Path.GetFullPath(path);
    if(!String.Equals(Path.GetDirectoryName(full),Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar),StringComparison.OrdinalIgnoreCase)||!Directory.Exists(directory)) throw new ArgumentException("File lies outside its granted directory.");
    if(action=="open"&&!File.Exists(full)) throw new FileNotFoundException("Granted input file is absent.",full);
    if(action=="save"&&File.Exists(full)) throw new IOException("Overwriting an existing chooser destination is not granted.");
   }
   Stopwatch clock=Stopwatch.StartNew();Dialog dialog=null;
   while(clock.ElapsedMilliseconds<5000) {
    List<Dialog> matches=Dialogs(grant,caption);
    if(matches.Count>1) throw new InvalidOperationException("More than one matching owned dialog is visible.");
    if(matches.Count==1) { dialog=matches[0];break; }Thread.Sleep(25);
   }
   if(dialog==null) throw new InvalidOperationException("No matching owned native dialog appeared.");
   if(action!="cancel") {
    AutomationElement edit=FilenameEdit(grant,dialog);VerifyInput(grant,dialog,edit);object value;
    if(!edit.TryGetCurrentPattern(ValuePattern.Pattern,out value)||((ValuePattern)value).Current.IsReadOnly) throw new InvalidOperationException("Filename ValuePattern changed.");
    ((ValuePattern)value).SetValue(full);
    VerifyInput(grant,dialog,edit);if(((ValuePattern)value).Current.Value!=full) throw new InvalidOperationException("Filename control did not retain the granted path.");
   }
   AutomationElement button=Button(grant,dialog,action=="cancel"?"2":"1");VerifyInput(grant,dialog,button);object invoke;
   if(!button.TryGetCurrentPattern(InvokePattern.Pattern,out invoke)) throw new InvalidOperationException("Dialog InvokePattern changed.");((InvokePattern)invoke).Invoke();
   clock.Restart();bool closed=false;
   while(clock.ElapsedMilliseconds<5000) { if(Retired(grant,dialog)) { closed=true;break; }Thread.Sleep(25); }
   if(!closed) throw new InvalidOperationException("The invoked dialog did not close within its bound.");
   return new ChooserResult { schemaVersion=1,platform="win32",action=action,selected=true,kind=kind,path=grantedPath,owner=grant.Owner,dialogHandle=dialog.Handle.ToInt64(),dialogRuntimeId=dialog.RuntimeId,invoked=true,dialogClosed=true };
  }
  public static int CloseOwnedWindows(Grant grant) {
   if(!Environment.UserInteractive) throw new InvalidOperationException("Owned UIAutomation TERM is unavailable without an interactive desktop.");
   AutomationElementCollection windows=Windows(grant);if(windows.Count>128) throw new InvalidOperationException("Owned window count exceeds its bound.");int count=0;
   foreach(AutomationElement window in windows) {
    if(window.Current.IsOffscreen||window.Current.NativeWindowHandle==0) continue;
    Dialog lease=new Dialog { Element=window,Handle=new IntPtr(window.Current.NativeWindowHandle),RuntimeId=window.GetRuntimeId() };VerifyWindow(grant,lease);object pattern;
    if(!window.TryGetCurrentPattern(WindowPattern.Pattern,out pattern)) throw new InvalidOperationException("Owned top-level window lacks WindowPattern for TERM.");
    VerifyWindow(grant,lease);((WindowPattern)pattern).Close();count++;
   }
   if(count==0) throw new InvalidOperationException("No owned UIAutomation window supports TERM; explicit owned-job KILL is required.");return count;
  }
 }
}
