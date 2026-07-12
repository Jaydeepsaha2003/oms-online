' ============================================================
'  OMS - self-healing watchdog (no admin rights needed).
'  A Startup-folder shortcut launches this hidden at every logon, and
'  start.bat also launches it (the duplicate guard below makes that safe).
'  Every 60 seconds it checks the production ports (web 6173 / API 4000):
'    - If stop.bat was used (marker file .oms-stopped exists), it waits -
'      an intentional stop stays stopped until start.bat clears the marker.
'    - If both servers are up, it does nothing.
'    - Otherwise it relaunches them via run-prod-hidden.vbs (no rebuild -
'      uses whatever build is on disk; run restart.bat after code changes).
'  This replaces the Task Scheduler task ("OMS Auto Start"), which this
'  machine's user account is not allowed to create. stop.bat never kills
'  this process (it only kills node/cmd), so healing resumes automatically
'  after the next start.bat.
' ============================================================
Option Explicit
Dim sh, fso, wmi, dir

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
dir     = fso.GetParentFolderName(WScript.ScriptFullName)

' Duplicate guard: if another copy of this watchdog is already running
' (e.g. logon shortcut + start.bat both launched it), exit quietly.
Dim procs, p, count
count = 0
Set procs = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='wscript.exe'")
For Each p In procs
  If InStr(1, p.CommandLine & "", "oms-watchdog.vbs", vbTextCompare) > 0 Then count = count + 1
Next
If count > 1 Then WScript.Quit

' Is this port LISTENING? Runs netstat via sh.Run with window style 0 (fully
' hidden) and reads the result from a temp file. WshShell.Exec is NOT used
' because Exec has no hidden-window option - it flashed a visible console
' window on the user's screen at every check.
Function PortUp(port)
  Dim tmp, f, output
  tmp = sh.ExpandEnvironmentStrings("%TEMP%") & "\oms-portcheck-" & port & ".txt"
  sh.Run "cmd /c netstat -aon | findstr "":" & port & " "" | findstr LISTENING > """ & tmp & """", 0, True
  output = ""
  On Error Resume Next
  Set f = fso.OpenTextFile(tmp, 1)
  If Not f.AtEndOfStream Then output = f.ReadAll
  f.Close
  fso.DeleteFile tmp
  On Error Goto 0
  PortUp = Len(Trim(output)) > 0
End Function

Do While True
  If Not fso.FileExists(dir & "\.oms-stopped") Then
    If (Not PortUp(6173)) Or (Not PortUp(4000)) Then
      sh.Run "wscript.exe " & Chr(34) & dir & "\run-prod-hidden.vbs" & Chr(34), 0, True
      ' Give npm + both servers time to boot before re-checking, so a slow
      ' start is never mistaken for a failure and double-launched.
      WScript.Sleep 120000
    End If
  End If
  WScript.Sleep 60000
Loop
