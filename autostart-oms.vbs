' ============================================================
'  OMS - Auto-start / self-healing watchdog.
'  The "OMS Auto Start" scheduled task (installed by enable-autostart.bat /
'  removed by disable-autostart.bat) runs this silently at Windows boot AND
'  every few minutes after that:
'    - If stop.bat was used (marker file .oms-stopped exists), it does
'      nothing - an intentional stop stays stopped until start.bat runs.
'    - If the production web server is already running, it does nothing.
'    - Otherwise it (re)launches the servers exactly like start.bat's hidden
'      launch (run-prod-hidden.vbs), using whatever build is already on disk -
'      no rebuild. Run restart.bat yourself after pulling new code.
'  This is what keeps port 6173 up even if the server ever crashes.
' ============================================================
Option Explicit
Dim sh, fso, dir

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir     = fso.GetParentFolderName(WScript.ScriptFullName)

' Respect an intentional stop: stop.bat drops this marker, start.bat clears it.
If fso.FileExists(dir & "\.oms-stopped") Then
  WScript.Quit
End If

' Is this port LISTENING? Uses netstat since Get-NetTCPConnection
' is not available from a SYSTEM cmd/wscript context. Runs it via sh.Run with
' window style 0 (fully hidden) + a temp file instead of WshShell.Exec -
' Exec has no hidden-window option and flashes a console window when this
' script ever runs in a logged-in user's session.
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

' Relaunch when EITHER server is down (web 6173 / API 4000). The launcher
' runs both; whichever is still alive just fails its port bind harmlessly
' and keeps serving, while the dead one comes back.
If (Not PortUp(6173)) Or (Not PortUp(4000)) Then
  sh.Run "wscript.exe " & Chr(34) & dir & "\run-prod-hidden.vbs" & Chr(34), 0, True
End If
