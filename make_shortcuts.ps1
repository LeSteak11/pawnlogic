# Creates "Chess Lab" shortcuts (Desktop + Start menu) that start the app with no console window.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pyw = Join-Path $root ".venv\Scripts\pythonw.exe"
$icon = Join-Path $root "app\static\icons\favicon.ico"
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "Chess Lab.lnk"),
  (Join-Path ([Environment]::GetFolderPath("Programs")) "Chess Lab.lnk")
)
foreach ($path in $targets) {
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $pyw
  $lnk.Arguments = "run.py"
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = "Chess Lab"
  $lnk.Save()
  Write-Output "Created $path"
}
