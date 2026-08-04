' ============================================================
'  OMS - launch ONE production server hidden (api or web).
'
'  run-prod-hidden.vbs starts both under a single `concurrently` parent, which
'  is right for a cold start but means neither can be bounced on its own. This
'  launcher exists for restart.bat's scoped path: a backend-only change bounces
'  just the API (~3s) while the web server - and whatever page the user has
'  open - carries on untouched.
'
'  Usage:  wscript run-server-hidden.vbs api
'          wscript run-server-hidden.vbs web
'
'  Output goes to its own timestamped log under logs\, same as the combined
'  launcher; logs.bat always tails the newest. stop.bat finds these by port.
' ============================================================
Option Explicit
Dim sh, fso, dir, logFile, cmdStr, target, script, ts

If WScript.Arguments.Count < 1 Then
  WScript.Echo "Usage: run-server-hidden.vbs [api|web]"
  WScript.Quit 1
End If

target = LCase(WScript.Arguments(0))
If target = "api" Then
  script = "start:api"
ElseIf target = "web" Then
  script = "start:web"
Else
  WScript.Echo "Unknown target '" & target & "' - expected api or web."
  WScript.Quit 1
End If

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
ts  = Year(Now) & Right("0" & Month(Now), 2) & Right("0" & Day(Now), 2) & "-" & _
      Right("0" & Hour(Now), 2) & Right("0" & Minute(Now), 2) & Right("0" & Second(Now), 2)
If Not fso.FolderExists(dir & "\logs") Then fso.CreateFolder(dir & "\logs")
logFile = dir & "\logs\oms-" & target & "-" & ts & ".log"
sh.CurrentDirectory = dir

' Same shape as run-prod-hidden.vbs: cmd /c (not /d - that strips AutoRun and
' can lose PATH entries npm needs), fully hidden (0), and non-blocking (False)
' so the server keeps running after this script exits.
cmdStr = "cmd /c cd /d " & Chr(34) & dir & Chr(34) & " && npm run " & script & " >> " & Chr(34) & logFile & Chr(34) & " 2>&1"
sh.Run cmdStr, 0, False
