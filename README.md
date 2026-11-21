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

Prérequis : Node.js ≥ 22, PostgreSQL (binaires) installé localement.

```bash
npm install
npm run dev:db          # base PostgreSQL de développement propre au projet (port 5433)
npm run build -w @somidac/shared
cp apps/server/.env.example apps/server/.env
npm run dev:server      # https://127.0.0.1:7443/api/v1/sante
npm run dev:desktop     # application de bureau (dans un autre terminal)
npm test                # tests de bout en bout (TLS mutuel réel)
```

Au premier lancement, choisir **Poste principal** : l'assistant crée le compte gérant et la clé du poste.
Les autres postes s'enregistrent avec un code créé dans **Administration → Appareils**.

Sous Linux sans trousseau de clés (développement uniquement), lancer Electron avec
`--password-store=basic` ; sous Windows, la clé de l'appareil est protégée par DPAPI.
Si VS Code exporte `ELECTRON_RUN_AS_NODE=1`, le retirer avant de lancer l'application.

Nouvelle migration après modification du schéma : `npm run db:generate -w @somidac/server`.
