$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskTarget = [IO.Path]::GetFullPath((Join-Path $taskRoot ('evidence/install-smoke-' + [guid]::NewGuid().ToString())))
if (-not $taskTarget.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Install target escaped workspace' }
if (Test-Path -LiteralPath $taskTarget) { throw 'Test target already exists' }
$taskDesktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Фокус — Заказы.lnk'
$taskMenuLink = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs/Фокус — Заказы.lnk'
if ((Test-Path -LiteralPath $taskDesktopLink) -or (Test-Path -LiteralPath $taskMenuLink)) { throw 'Existing shortcut: test installation skipped to preserve it' }
$taskExisting = Get-ItemProperty -Path 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Фокус — Заказы' }
if ($taskExisting) { throw 'Existing user installation: test installation skipped' }
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskInstaller = Join-Path $taskRoot ('release/Focus-Orders-Setup-' + $taskVersion + '.exe')
$taskReport = [ordered]@{ target=$taskTarget; result='FAIL'; install=$false; desktopShortcut=$false; startMenuShortcut=$false; packaged=$false; cleanup=$false }
try {
 $taskProcess = Start-Process -FilePath $taskInstaller -ArgumentList @('/S', "/D=$taskTarget") -WindowStyle Hidden -Wait -PassThru
 if ($taskProcess.ExitCode -ne 0) { throw ('Installer exit ' + $taskProcess.ExitCode) }
 $taskExe = Join-Path $taskTarget 'Фокус — Заказы.exe'
 if (-not (Test-Path -LiteralPath $taskExe)) { throw 'Installed executable missing' }
 $taskReport.install = $true
 $taskWsh = New-Object -ComObject WScript.Shell
 foreach ($taskLink in @($taskDesktopLink, $taskMenuLink)) {
  if (-not (Test-Path -LiteralPath $taskLink)) { throw ('Shortcut missing: ' + $taskLink) }
  if ($taskWsh.CreateShortcut($taskLink).TargetPath -ne $taskExe) { throw ('Wrong shortcut target: ' + $taskLink) }
 }
 $taskReport.desktopShortcut=$true; $taskReport.startMenuShortcut=$true
 $env:FOCUS_EXECUTABLE=$taskExe
 & node (Join-Path $PSScriptRoot 'test-packaged.cjs')
 if ($LASTEXITCODE -ne 0) { throw 'Installed packaged test failed' }
 $taskReport.packaged=$true; $taskReport.result='PASS'
} finally {
 $taskUninstaller = Join-Path $taskTarget 'Uninstall Фокус — Заказы.exe'
 if (Test-Path -LiteralPath $taskUninstaller) {
  if (-not $taskTarget.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Uninstall target escaped workspace' }
  $taskRemoval=Start-Process -FilePath $taskUninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  $taskReport.cleanup=($taskRemoval.ExitCode -eq 0 -and -not (Test-Path -LiteralPath $taskDesktopLink) -and -not (Test-Path -LiteralPath $taskMenuLink))
 }
 $taskReport | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'evidence/installer-validation.json') -Encoding utf8
 if ($taskReport.install -and -not $taskReport.cleanup) { throw 'Test installer cleanup not confirmed' }
}
