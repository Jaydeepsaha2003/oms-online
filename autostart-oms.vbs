' ============================================================
'  OMS - Auto-start on Windows login.
'  A shortcut to this file lives in the Startup folder (installed by
'  enable-autostart.bat / removed by disable-autostart.bat). It runs
'  silently every time you log into Windows:
'    - If the production server is already running (e.g. the PC only
'      slept and the server survived), it does nothing.
'    - Otherwise it launches it exactly like start.bat's hidden launch
'      (run-prod-hidden.vbs), using whatever build is already on disk -
'      no rebuild, so login stays fast. Run restart.bat afterwards if
'      you've pulled new code and want it picked up.
' ============================================================
Option Explicit
Dim sh, fso, dir, exec, output

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir     = fso.GetParentFolderName(WScript.ScriptFullName)

' Ask whether port 6173 (production web) is already LISTENING.
Set exec = sh.Exec("cmd /d /c netstat -aon | findstr "":6173 "" | findstr LISTENING")
Do While exec.Status = 0
  WScript.Sleep 50
Loop
output = ""
On Error Resume Next
output = exec.StdOut.ReadAll
On Error Goto 0

If Len(Trim(output)) = 0 Then
  sh.Run "wscript.exe " & Chr(34) & dir & "\run-prod-hidden.vbs" & Chr(34), 0, True
End If
