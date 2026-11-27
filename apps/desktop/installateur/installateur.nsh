; Installateur unique (tous les PC) : bibliothèques Visual C++, dossier de données protégé, service
; « SOMIDAC Serveur » installé à l'arrêt. Seul le PC qui devient poste principal le démarre
; (activer-poste-principal.cmd, lancé depuis l'application avec l'autorisation administrateur).
; Inclus par electron-builder (nsis.include).

!include LogicLib.nsh

!define SOMIDAC_SERVICE "SOMIDAC-Serveur"

; Avant de remplacer ou supprimer les fichiers (installation, mise à jour, désinstallation) :
; arrêter le service, qui utilise SOMIDAC.exe, puis vérifier que l'application n'est pas ouverte.
; (Vérification écrite ici car celle d'electron-builder n'est plus disponible dès qu'on la personnalise.)
!macro customCheckAppRunning
  ; $CmdPath et $PowerShellPath sont préparées par electron-builder (CHECK_APP_RUNNING).
  nsExec::Exec '"$CmdPath" /c net stop ${SOMIDAC_SERVICE}'
  Pop $R0
  StrCpy $R1 "$PowerShellPath"
  Sleep 1500
  ${Do}
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 != 0
      ${Break}
    ${EndIf}
    ${IfNot} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "SOMIDAC est ouvert sur ce poste.$\r$\nFermez l'application, puis cliquez sur Réessayer." /SD IDCANCEL IDRETRY`
      Quit
    ${EndIf}
  ${Loop}
!macroend

!macro customInstall
  ; Données : C:\ProgramData\SOMIDAC, accessibles seulement au système, aux administrateurs
  ; et au compte du service (NetworkService). Les autres utilisateurs n'y ont pas accès.
  ReadEnvStr $R2 PROGRAMDATA
  CreateDirectory "$R2\SOMIDAC"
  nsExec::ExecToLog 'icacls "$R2\SOMIDAC" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-20:(OI)(CI)M /T /C /Q'

  ; Bibliothèques Visual C++ de Microsoft, indispensables à PostgreSQL (souvent absentes d'un Windows de bureau).
  ; Codes de retour acceptés : 0 (installé), 1638 (version plus récente déjà présente), 3010 (redémarrage conseillé).
  DetailPrint "Installation des bibliothèques Visual C++ (Microsoft)…"
  nsExec::ExecToLog '"$INSTDIR\resources\vcredist\VC_redist.x64.exe" /install /quiet /norestart'
  Pop $R3
  DetailPrint "Visual C++ : code $R3"

  ; Service Windows, installé à l'arrêt (démarrage manuel) sur chaque PC.
  nsExec::ExecToLog '"$INSTDIR\resources\service\SOMIDAC-Serveur.exe" install'

  ; Mise à jour du poste principal : il est réactivé tout seul (service, pare-feu).
  ${If} ${FileExists} "$R2\SOMIDAC\poste-principal"
    DetailPrint "Poste principal : réactivation du serveur SOMIDAC…"
    nsExec::ExecToLog '"$INSTDIR\resources\service\activer-poste-principal.cmd"'
  ${EndIf}
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$INSTDIR\resources\service\SOMIDAC-Serveur.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\resources\service\SOMIDAC-Serveur.exe" uninstall'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOMIDAC Serveur"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOMIDAC Decouverte"'
  ; Les données (C:\ProgramData\SOMIDAC) sont conservées : base, certificats, sauvegardes.
!macroend
