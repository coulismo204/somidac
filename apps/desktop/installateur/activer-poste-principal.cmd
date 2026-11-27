@echo off
rem Fait de ce PC le poste principal SOMIDAC (lancé avec l'autorisation administrateur) :
rem  - démarrage automatique du service « SOMIDAC Serveur » ;
rem  - pare-feu ouvert aux autres postes du réseau privé (serveur TCP 7443, découverte UDP 7444) ;
rem  - marque « poste principal », pour que les mises à jour le réactivent d'elles-mêmes.
sc.exe config SOMIDAC-Serveur start= delayed-auto >nul
netsh advfirewall firewall delete rule name="SOMIDAC Serveur" >nul 2>&1
netsh advfirewall firewall add rule name="SOMIDAC Serveur" dir=in action=allow protocol=TCP localport=7443 profile=private,domain >nul
netsh advfirewall firewall delete rule name="SOMIDAC Decouverte" >nul 2>&1
netsh advfirewall firewall add rule name="SOMIDAC Decouverte" dir=in action=allow protocol=UDP localport=7444 profile=private,domain >nul
if not exist "%ProgramData%\SOMIDAC" mkdir "%ProgramData%\SOMIDAC"
echo principal> "%ProgramData%\SOMIDAC\poste-principal"
sc.exe start SOMIDAC-Serveur >nul
exit /b 0
