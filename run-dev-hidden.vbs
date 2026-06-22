' ============================================================
'  OMS - launch the dev servers with NO visible window.
'  start.bat calls this. Output is written to oms-dev.log in
'  this folder; view it any time with logs.bat.
' ============================================================
Option Explicit
Dim sh, fso, dir
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Run from this script's own folder (the project root).
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

' 0 = hidden window, False = return immediately (servers keep running).
sh.Run "cmd /c npm run dev > " & Chr(34) & "oms-dev.log" & Chr(34) & " 2>&1", 0, False
