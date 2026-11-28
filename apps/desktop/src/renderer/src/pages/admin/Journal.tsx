import { useCallback, useEffect, useState } from 'react';
import { Icone, Message } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterDateHeure } from '../../format';

interface Entree {
  id: number;
  horodatage: string;
  utilisateurId: string | null;
  appareilId: string | null;
  action: string;
  entite: string | null;
  entiteId: string | null;
  details: unknown;
}

const LIBELLES: Record<string, string> = {
  initialisation: 'Mise en route du poste principal',
  'connexion.reussie': 'Connexion',
  'connexion.echec': 'Échec de connexion',
  'connexion.echec_identifiant_inconnu': 'Échec de connexion (identifiant inconnu)',
  'connexion.refusee_compte_bloque': 'Connexion refusée (compte bloqué)',
  'compte.bloque': 'Compte bloqué après 5 échecs',
  deconnexion: 'Déconnexion',
  'session.verrouillee': 'Session verrouillée',
  'session.deverrouillee': 'Session déverrouillée',
  'appareil.poste_principal_reenregistre': 'Poste principal réenregistré',
  'deverrouillage.echec': 'Échec de déverrouillage',
  'mot_de_passe.change': 'Mot de passe changé',
  'mot_de_passe.echec_changement': 'Échec de changement de mot de passe',
  'utilisateur.cree': 'Utilisateur créé',
  'utilisateur.modifie': 'Utilisateur modifié',
  'utilisateur.desactive': 'Utilisateur désactivé',
  'utilisateur.mot_de_passe_reinitialise': 'Mot de passe réinitialisé',
  'role.permissions_modifiees': "Droits d'un rôle modifiés",
  'appareil.cree': 'Appareil créé (code émis)',
  'appareil.nouveau_code': "Nouveau code d'activation",
  'appareil.enregistre': 'Appareil enregistré',
  'appareil.enregistrement_refuse': 'Enregistrement refusé (mauvais code)',
  'appareil.code_annule_trop_d_essais': 'Code annulé après trop d’essais',
  'appareil.revoque': 'Appareil révoqué',
  'appareil.certificat_renouvele': 'Clé d’appareil renouvelée',
  'parametres.modifier': 'Paramètres modifiés',
  'categorie.creee': 'Catégorie créée',
  'categorie.modifiee': 'Catégorie modifiée',
  'marque.creee': 'Marque créée',
  'produit.cree': 'Produit créé',
  'produit.modifie': 'Produit modifié',
  'produit.prix_modifies': 'Prix de vente modifiés',
  'fournisseur.cree': 'Fournisseur créé',
  'fournisseur.modifie': 'Fournisseur modifié',
  'achat.valide': 'Achat validé (entrée en stock)',
  'stock.ajustement': 'Stock corrigé',
  'stock.casse': 'Casse',
  'stock.peremption': 'Produits périmés retirés',
  'inventaire.ouvert': 'Inventaire ouvert',
  'inventaire.valide': 'Inventaire validé',
  'inventaire.annule': 'Inventaire annulé',
  'sauvegarde.configuree': 'Sauvegardes activées',
  'sauvegarde.mot_de_passe_change': 'Mot de passe de restauration changé',
  'sauvegarde.reglages_modifies': 'Réglages de sauvegarde modifiés',
  'sauvegarde.faite': 'Sauvegarde faite',
  'sauvegarde.echouee': 'Sauvegarde échouée',
  'sauvegarde.restauree': 'Sauvegarde restaurée',
};

const SENSIBLES = /echec|refuse|bloque|revoque|annule|restauree/;

interface Nom {
  id: string;
  nom?: string;
  nomComplet?: string;
}

export function Journal() {
  const { appeler, peut } = useSession();
  const [entrees, setEntrees] = useState<Entree[]>();
  const [noms, setNoms] = useState<Record<string, string>>({});
  const [verification, setVerification] = useState<{ valide: boolean; nbEntrees: number; premiereRuptureId: number | null }>();
  const [erreur, setErreur] = useState<string>();

  const charger = useCallback(async () => {
    try {
      setEntrees(await appeler<Entree[]>('GET', '/audit?limite=200'));
      const dict: Record<string, string> = {};
      if (peut('admin.utilisateurs')) (await appeler<Nom[]>('GET', '/utilisateurs')).forEach((u) => (dict[u.id] = u.nomComplet ?? ''));
      if (peut('admin.appareils')) (await appeler<Nom[]>('GET', '/appareils')).forEach((a) => (dict[a.id] = a.nom ?? ''));
      setNoms(dict);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler, peut]);
  useEffect(() => {
    void charger();
  }, [charger]);

  const verifier = async () => {
    try {
      setVerification(await appeler('GET', '/audit/verification'));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Journal d'audit</h1>
        </div>
        <button className="bouton secondaire" onClick={() => void verifier()}>
          <Icone nom="bouclier" /> Vérifier l'intégrité
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        <Message type="erreur">{erreur}</Message>
        {verification &&
          (verification.valide ? (
            <Message type="succes">Journal intact : {verification.nbEntrees} entrées vérifiées.</Message>
          ) : (
            <Message type="erreur">
              Journal altéré : la chaîne est rompue à l'entrée n° {verification.premiereRuptureId}. Prévenez le gérant.
            </Message>
          ))}
      </div>
      <div className="carte">
        {!entrees ? (
          <div className="vide">Chargement…</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th style={{ width: 70 }}>N°</th>
                <th style={{ width: 150 }}>Date</th>
                <th>Action</th>
                <th>Utilisateur</th>
                <th>Appareil</th>
              </tr>
            </thead>
            <tbody>
              {entrees.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.id}</td>
                  <td>{formaterDateHeure(e.horodatage)}</td>
                  <td>
                    <span style={SENSIBLES.test(e.action) ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{LIBELLES[e.action] ?? e.action}</span>
                    {e.entite && <div className="secondaire">{e.entiteId ? noms[e.entiteId] ?? e.entite : e.entite}</div>}
                  </td>
                  <td>{e.utilisateurId ? noms[e.utilisateurId] ?? '-' : '-'}</td>
                  <td>{e.appareilId ? noms[e.appareilId] ?? '-' : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
