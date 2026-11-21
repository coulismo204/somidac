; Installation du poste principal : service « SOMIDAC Serveur », dossier de données protégé, pare-feu.
; Inclus par electron-builder (nsis.include).

!include LogicLib.nsh

!define SOMIDAC_SERVICE "SOMIDAC-Serveur"
!define SOMIDAC_PORT "7443"

; Avant de remplacer ou supprimer les fichiers (installation, mise à jour, désinstallation) :
; arrêter le service, qui utilise SOMIDAC.exe, puis vérifier que l'application n'est pas ouverte.
; (Vérification écrite ici car celle d'electron-builder n'est plus disponible dès qu'on la personnalise.)
!macro customCheckAppRunning
  nsExec::Exec 'net stop ${SOMIDAC_SERVICE}'
  Pop $R0
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
  CreateDirectory "$COMMONAPPDATA\SOMIDAC"
  nsExec::ExecToLog 'icacls "$COMMONAPPDATA\SOMIDAC" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-20:(OI)(CI)M /T /C /Q'

  ; Service Windows (démarrage automatique, redémarrage en cas d'échec).
  nsExec::ExecToLog '"$INSTDIR\resources\service\SOMIDAC-Serveur.exe" install'
  nsExec::ExecToLog '"$INSTDIR\resources\service\SOMIDAC-Serveur.exe" start'

  ; Pare-feu : les autres postes du réseau privé (Wi-Fi de l'entreprise) peuvent joindre le serveur.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOMIDAC Serveur"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="SOMIDAC Serveur" dir=in action=allow protocol=TCP localport=${SOMIDAC_PORT} profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$INSTDIR\resources\service\SOMIDAC-Serveur.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\resources\service\SOMIDAC-Serveur.exe" uninstall'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOMIDAC Serveur"'
  ; Les données (C:\ProgramData\SOMIDAC) sont conservées : base, certificats, sauvegardes.
!macroend
