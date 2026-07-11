' ============================================================
'  OMS - launch the production servers hidden (minimised, titled window).
'  start.bat calls this after building. Output is written to a timestamped
'  log file under logs\; view it any time with logs.bat.
'  stop.bat finds these servers by command line and port.
' ============================================================
Option Explicit
Dim sh, fso, dir, logFile, cmdStr

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Run from this script's own folder (the project root).
' Each launch gets its OWN log file: a running instance keeps its log open
' exclusively, so appending to one shared file made any second launch (e.g.
' the watchdog healing a half-crashed instance) die instantly on the
' redirect. logs.bat always tails the newest file.
Dim ts
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ts  = Year(Now) & Right("0" & Month(Now), 2) & Right("0" & Day(Now), 2) & "-" & _
      Right("0" & Hour(Now), 2) & Right("0" & Minute(Now), 2) & Right("0" & Second(Now), 2)
If Not fso.FolderExists(dir & "\logs") Then fso.CreateFolder(dir & "\logs")
logFile = dir & "\logs\oms-prod-" & ts & ".log"
sh.CurrentDirectory = dir

' Build the command: Use cmd /c (NOT cmd /d /c — /d strips AutoRun and
' can lose PATH entries needed by npm). The redirect captures all output
' for logs.bat.
' Window style 0 = fully hidden: no console window, no taskbar button, so
' nobody can accidentally close the servers by closing a "blank cmd window".
' (Windows does NOT suspend hidden console processes - the past mid-day
' deaths were external kills and reboots, verified in the logs/event log.)
' stop.bat doesn't need a window title either: it kills by project path
' and by port. False = return immediately (servers keep running).
cmdStr = "cmd /c cd /d " & Chr(34) & dir & Chr(34) & " && npm run start >> " & Chr(34) & logFile & Chr(34) & " 2>&1"
sh.Run cmdStr, 0, False
