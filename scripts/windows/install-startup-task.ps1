# Registers a Windows scheduled task that starts the tracker (hidden) every time you log on,
# and starts it now. Run once:  powershell -File scripts\windows\install-startup-task.ps1
# Remove with:                  Unregister-ScheduledTask -TaskName 'LLM Usage Tracker' -Confirm:$false

$name = 'LLM Usage Tracker'
$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'

$action   = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Starts the LLM usage tracker proxy and dashboard (http://localhost:4141) at logon.' -Force | Out-Null

# Task Scheduler stops tasks after 72 hours by default; PT0S means "no limit".
$task = Get-ScheduledTask -TaskName $name
$task.Settings.ExecutionTimeLimit = 'PT0S'
Set-ScheduledTask -InputObject $task | Out-Null

Start-ScheduledTask -TaskName $name
Write-Host "Registered and started '$name'. Dashboard: http://localhost:4141"
