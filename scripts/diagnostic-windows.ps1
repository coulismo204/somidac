# Publie en annotations GitHub (lisibles sans authentification) l'état du service SOMIDAC
# et la fin de ses journaux. Usage : pwsh scripts/diagnostic-windows.ps1 "<titre>"
param([string]$Titre = 'Diagnostic Windows')

function Publier([string]$sousTitre, [string]$texte) {
  if (-not $texte) { $texte = '(vide)' }
  if ($texte.Length -gt 5000) { $texte = $texte.Substring($texte.Length - 5000) }
  $texte = $texte.Replace('%', '%25').Replace("`r", '').Replace("`n", '%0A')
  Write-Output "::error title=$Titre - $sousTitre::$texte"
}

$service = Get-Service SOMIDAC-Serveur -ErrorAction SilentlyContinue | Format-List Name, Status, StartType | Out-String
$compte = (Get-CimInstance Win32_Service -Filter "Name='SOMIDAC-Serveur'" -ErrorAction SilentlyContinue | Select-Object StartName, State, ExitCode, PathName | Format-List | Out-String)
Publier 'service' ("$service`n$compte")

$racine = Join-Path $env:ProgramData 'SOMIDAC'
$arbo = Get-ChildItem $racine -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName | Out-String
$acl = (icacls $racine 2>&1 | Out-String)
Publier 'données' ("$arbo`n$acl")

Get-ChildItem (Join-Path $racine 'journaux') -File -ErrorAction SilentlyContinue | ForEach-Object {
  Publier "journal $($_.Name)" ((Get-Content $_.FullName -Tail 60 -ErrorAction SilentlyContinue) -join "`n")
}
$wrapper = Get-ChildItem "$env:ProgramFiles\SOMIDAC\resources\service\*.log" -ErrorAction SilentlyContinue
$wrapper | ForEach-Object { Publier "WinSW $($_.Name)" ((Get-Content $_.FullName -Tail 40) -join "`n") }

$evenements = Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Service Control Manager'; StartTime = (Get-Date).AddMinutes(-30) } -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match 'SOMIDAC' } | Select-Object -First 10 | ForEach-Object { "$($_.TimeCreated) $($_.Message)" }
Publier 'événements Windows' ($evenements -join "`n")
