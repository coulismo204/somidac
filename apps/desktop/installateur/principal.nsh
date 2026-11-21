; Installation du poste principal : service « SOMIDAC Serveur », dossier de données protégé, pare-feu.
; Inclus par electron-builder (nsis.include).

!define SOMIDAC_SERVICE "SOMIDAC-Serveur"
!define SOMIDAC_PORT "7443"

; Avant de remplacer les fichiers (installation ou mise à jour) : arrêter le service,
; qui utilise SOMIDAC.exe, puis faire la vérification habituelle « application ouverte ».
!macro customCheckAppRunning
  nsExec::Exec 'net stop ${SOMIDAC_SERVICE}'
  Sleep 2000
  !insertmacro _CHECK_APP_RUNNING
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
