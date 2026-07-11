' ============================================================
'  OMS - launch the production servers hidden (minimised, titled window).
'  start.bat calls this after building. Output is written to oms-dev.log
'  in this folder; view it any time with logs.bat.
'  The window title "OMS Server" lets stop.bat close it.
' ============================================================
Option Explicit
Dim sh, fso, dir, logFile, cmdStr
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Run from this script's own folder (the project root).
dir     = fso.GetParentFolderName(WScript.ScriptFullName)
logFile = dir & "\oms-dev.log"
sh.CurrentDirectory = dir

' Build the command using Chr(34) for double-quotes (avoids VBS escape confusion).
' Window style 0 = fully hidden - no console window, no taskbar button (on
' Windows 11 the old "minimised" style popped up as a blank cmd window, since
' all output goes to the log). stop.bat finds these servers by port and by
' command line, so no visible window is needed.
' False = return immediately (servers keep running in background).
cmdStr = "cmd /d /c title OMS Server && npm run start >> " & Chr(34) & logFile & Chr(34) & " 2>&1"
sh.Run cmdStr, 0, False
