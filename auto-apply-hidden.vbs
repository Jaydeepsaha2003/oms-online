' OMS - runs scripts\auto-apply.ps1 with no window at all. The "OMS Auto Apply"
' task starts this instead of powershell.exe directly: even with -WindowStyle
' Hidden, powershell flashes an empty console window every minute.
Dim sh, dir
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir & "\scripts\auto-apply.ps1""", 0, True
