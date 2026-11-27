# SOMIDAC — Application de gestion

Application de gestion Windows pour **SOMIDAC SARL** (distribution cosmétiques & divers produits) :
achats, stock (lots et péremption), ventes, trésorerie et rapports, sur 2 à 3 postes reliés en Wi-Fi.

## Architecture

Client–serveur et modulaire dès le premier jour :

```
apps/
  server/    Serveur SOMIDAC (API) — NestJS + PostgreSQL, HTTPS avec TLS mutuel
  desktop/   Application SOMIDAC (écrans) — Electron + React
packages/
  shared/    Contrats partagés : permissions, rôles, modules, schémas de validation
```

- Les écrans ne touchent jamais la base : tout passe par l'API, qui applique les règles de gestion.
- **Noyau** (`apps/server/src/noyau`) : appareils, connexion, permissions, audit, numérotation, paramètres.
- **Modules métier** (`apps/server/src/modules`) : produits, stock, achats, ventes, trésorerie, rapports —
  chacun avec ses tables, activable dans les paramètres.

## Sécurité (cahier des charges §10)

- Chaque appareil possède sa **propre clé** ; il est enregistré avec un code d'activation à usage unique
  (15 min) délivré par le gérant. Le secret du code ne circule jamais : l'appareil envoie une preuve HMAC
  et vérifie celle du serveur.
- Toute connexion est en **TLS mutuel** : un appareil inconnu ou révoqué est refusé avant l'écran de connexion.
- Mots de passe Argon2id, blocage 15 min après 5 échecs, verrouillage après 15 min d'inactivité.
- Journal d'audit **chaîné** (empreintes SHA-256) et protégé contre toute modification en base.

## Développement

Prérequis : Node.js ≥ 22, PostgreSQL (binaires) installé localement. Toutes les commandes se lancent
**depuis la racine du projet**.

```bash
npm install
npm run dev:db                              # base PostgreSQL de développement (port 5433)
npm run build -w @somidac/shared
cp apps/server/.env.example apps/server/.env
npm run dev:server                          # terminal 1 : https://127.0.0.1:7443/api/v1/sante
npm run dev:desktop                         # terminal 2 : application de bureau
npm test -w @somidac/server                 # tests de bout en bout (TLS mutuel réel)
npm test -w @somidac/desktop
```

Au premier lancement, choisir **Poste principal** : l'assistant crée le compte gérant et la clé du poste.
Les autres postes s'enregistrent avec un code créé dans **Administration → Appareils**.

`npm run dev:desktop` s'occupe des particularités de Linux en développement : variable
`ELECTRON_RUN_AS_NODE` exportée par VS Code, absence de trousseau de clés, bac à sable de Chromium non
configuré (la commande pour le configurer est affichée). Sous Windows, la clé de l'appareil est protégée par DPAPI.

Repartir d'une base vide : `bash scripts/dev-db.sh reset && rm -rf .dev/serveur`.

Nouvelle migration après modification du schéma : `npm run db:generate -w @somidac/server`.

## Installateur Windows

Un **seul installateur** pour tous les PC : `SOMIDAC-<version>-Setup.exe` (application, serveur, PostgreSQL,
bibliothèques Visual C++ et service Windows installé à l'arrêt). Fabrication : `npm run installateur -w @somidac/desktop`
(sous Linux, Wine est nécessaire), ou par la CI (onglet **Actions → Intégration continue → Artifacts**).

Au premier lancement, l'application cherche le poste principal sur le Wi-Fi (diffusion UDP, port 7444) :
- **aucun trouvé** : « Faire de ce PC le poste principal » démarre le serveur (autorisation administrateur
  demandée une fois) et ouvre le pare-feu au réseau privé (TCP 7443, UDP 7444) ; le gérant crée son compte ;
- **trouvé** : le PC le rejoint avec le code d'activation donné par le gérant (Administration → Appareils).

Les mises à jour réactivent d'elles-mêmes le serveur du poste principal. La CI installe réellement l'application
sur Windows et vérifie : service à l'arrêt après installation, activation, découverte réseau, chiffrement DPAPI,
écoute locale de la base, redémarrage, mise à jour et désinstallation.
