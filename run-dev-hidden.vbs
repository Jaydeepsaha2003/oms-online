' ============================================================
'  OMS - launch the dev servers hidden (minimised, titled window).
'  start.bat calls this. Output is written to oms-dev.log in
'  this folder; view it any time with logs.bat.
'  The window title "OMS Dev Server" lets stop.bat close it.
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
' Window style 6 = minimised (keeps a taskbar button so stop.bat can find the title).
' False = return immediately (servers keep running in background).
cmdStr = "cmd /d /c title OMS Dev Server && npm run dev >> " & Chr(34) & logFile & Chr(34) & " 2>&1"
sh.Run cmdStr, 6, False
