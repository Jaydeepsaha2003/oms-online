# OMS - Create a Startup-folder shortcut that silently launches
# autostart-oms.vbs whenever this Windows user logs in.
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Startup = [Environment]::GetFolderPath('Startup')
$ShortcutPath = Join-Path $Startup 'OMS Auto Start.lnk'

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = 'wscript.exe'
$Shortcut.Arguments = "`"$ProjectDir\autostart-oms.vbs`""
$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.Description = 'Silently starts the OMS production server on Windows login'
$Shortcut.Save()

Write-Host "Created: $ShortcutPath"
