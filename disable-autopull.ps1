# OMS - Remove the Task Scheduler auto-pull task.
#
# Your code and the running servers are left exactly as they are; only the
# automatic checking for new commits stops. Re-enable with enable-autopull.bat.
#
# Unregister-ScheduledTask fails NON-TERMINATING by default, so without
# -ErrorAction Stop a denied removal would print an error and then fall straight
# through to the success message - which is exactly how this script used to
# report "removed" while the task carried on pulling every 5 minutes. The
# removal is therefore both trapped AND verified before anything claims success.
$TaskName = 'OMS Auto Pull'

if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    Write-Host "Task '$TaskName' was not registered - nothing to remove."
    exit 0
}

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
} catch {
    Write-Host ''
    Write-Host "[ERROR] Could not remove '$TaskName': $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'The task is STILL registered and will keep pulling.' -ForegroundColor Red
    Write-Host 'Run disable-autopull.bat again and approve the administrator prompt.'
    exit 1
}

# Trust the system, not the absence of an error: confirm it is really gone.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host ''
    Write-Host "[ERROR] '$TaskName' still exists after the removal call." -ForegroundColor Red
    Write-Host 'Nothing was changed. Check Task Scheduler manually.'
    exit 1
}

Write-Host "Scheduled task '$TaskName' removed - no more automatic pulls."
exit 0
