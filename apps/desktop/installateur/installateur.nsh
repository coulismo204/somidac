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
  ; Les droits sont posés sur le dossier seul ; tout son contenu en hérite. Les fichiers existants
  ; (mise à jour) sont remis à l'héritage : ne jamais réappliquer des droits fichier par fichier,
  ; ce qui peut retirer au service l'accès à sa base et à ses journaux.
  ReadEnvStr $R2 PROGRAMDATA
  CreateDirectory "$R2\SOMIDAC"
  CreateDirectory "$R2\SOMIDAC\journaux"
  ; Réparation : les administrateurs reprennent d'abord la propriété de tout le contenu (sinon Windows
  ; refuse de corriger les droits d'un fichier qui ne leur laisse aucun accès), puis tout est remis à
  ; l'héritage du dossier. /setowner utilise le privilège de restauration des administrateurs.
  nsExec::ExecToLog 'icacls "$R2\SOMIDAC" /setowner *S-1-5-32-544 /T /C /Q'
  nsExec::ExecToLog 'icacls "$R2\SOMIDAC" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-20:(OI)(CI)M /C /Q'
  nsExec::ExecToLog 'icacls "$R2\SOMIDAC\*" /reset /T /C /Q'
  ; Journaux lisibles par les utilisateurs du PC (aucun secret dedans) : l'application peut
  ; afficher la raison d'un arrêt du serveur.
  nsExec::ExecToLog 'icacls "$R2\SOMIDAC\journaux" /grant *S-1-5-32-545:(OI)(CI)RX /C /Q'

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
