# Registers or removes the identity package (poufnik-menu.msix) that puts Poufnik in the
# Windows 11 top-level Explorer context menu for the GitHub installer. Called by
# desktop/src-tauri/windows/hooks.nsh; installed next to Poufnik.exe.
#
# Exit codes: 0 done, 1 failed, 2 skipped on Windows 10, 3 skipped because the Microsoft Store
# version is installed and brings its own menu. On 1 and 2 the installer writes the classic
# registry menu ("Pokaż więcej opcji") instead; on 3 it adds no menu, so there are not two.
# Unregistering ends with 0 or 1.
param(
  [Parameter(Mandatory = $true)][ValidateSet("register", "unregister")][string]$Mode,
  [string]$InstallDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$packageName = "Poufnik.MenuKontekstowe"
$storePackageName = "KancelariaRadcyPrawnegoMi.Poufnik"

try {
  # Explorer keeps the menu DLL loaded in a COM surrogate (dllhost.exe) for a while.
  # Remove-AppxPackage waits for that process to end, and the installer cannot overwrite the
  # DLL while it runs, so end it first; Explorer starts a new one when the menu is opened.
  $dll = Join-Path $InstallDir "poufnik_shell_menu.dll"
  Get-Process -Name dllhost -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Modules.FileName -contains $dll } catch { $false }
  } | Stop-Process -Force -ErrorAction SilentlyContinue

  # Always start clean: an update registers the package of the new version.
  Get-AppxPackage -Name $packageName | Remove-AppxPackage
  if ($Mode -eq "unregister") {
    exit 0
  }
  if ([Environment]::OSVersion.Version.Build -lt 22000) {
    Write-Output "Windows 10: classic menu only."
    exit 2
  }
  if (Get-AppxPackage -Name $storePackageName) {
    Write-Output "The Microsoft Store version of Poufnik is installed and has its own menu."
    exit 3
  }
  Add-AppxPackage -Path (Join-Path $InstallDir "poufnik-menu.msix") -ExternalLocation $InstallDir
  exit 0
} catch {
  Write-Output $_.Exception.Message
  exit 1
}
