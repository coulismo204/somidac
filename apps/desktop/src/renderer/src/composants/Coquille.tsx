import { LIBELLES_PERMISSIONS, PERMISSIONS, ROLES_PAR_DEFAUT } from '@somidac/shared';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { useSession } from '../contexte';
import { initiales } from '../format';
import logo from '../logo-somidac.jpeg';
import { messageErreur } from '../contexte';
import { Champ, Icone, Message, Modale } from './communs';

/** Modules métier : ils apparaissent au fil des lots (cahier des charges §11). */
const MODULES_METIER: { chemin: string; libelle: string; icone: string; module: string; lot?: number; permission?: string | string[] }[] = [
  { chemin: '/produits', libelle: 'Produits', icone: 'produits', module: 'produits' },
  { chemin: '/stock', libelle: 'Stock', icone: 'stock', module: 'stock' },
  { chemin: '/achats', libelle: 'Achats', icone: 'achats', module: 'achats', permission: 'achats.saisir' },
  { chemin: '/ventes', libelle: 'Ventes', icone: 'ventes', module: 'ventes', permission: 'ventes.saisir' },
  { chemin: '/tresorerie', libelle: 'Trésorerie', icone: 'tresorerie', module: 'tresorerie', permission: 'tresorerie.encaisser' },
  { chemin: '/rapports', libelle: 'Rapports', icone: 'rapports', module: 'rapports', permission: ['rapports.tous', 'rapports.stock', 'rapports.ses_ventes', 'audit.voir'] },
];

function libelleRole(permissions: string[]): string {
  const role = ROLES_PAR_DEFAUT.find((r) => r.permissions.length === permissions.length && r.permissions.every((p) => permissions.includes(p)));
  return role?.libelle ?? `${permissions.length} droit${permissions.length > 1 ? 's' : ''}`;
}

/** « Mon mot de passe » : chaque utilisateur peut changer le sien. */
function MonMotDePasse({ onFermer }: { onFermer: () => void }) {
  const { appeler } = useSession();
  const [f, setF] = useState({ ancien: '', nouveau: '', confirmation: '' });
  const [erreur, setErreur] = useState<string>();
  const [fait, setFait] = useState(false);
  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    if (f.nouveau.length < 8) return setErreur('Au moins 8 caractères.');
    if (f.nouveau !== f.confirmation) return setErreur('Les deux mots de passe ne correspondent pas.');
    try {
      await appeler('POST', '/auth/mot-de-passe', { ancienMotDePasse: f.ancien, nouveauMotDePasse: f.nouveau });
      setFait(true);
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };
  return (
    <Modale titre="Mon mot de passe" onFermer={onFermer}>
      {fait ? (
        <>
          <Message type="succes">Mot de passe changé. Vos sessions sur les autres postes ont été fermées.</Message>
          <div className="actions">
            <button className="bouton" onClick={onFermer}>
              Fermer
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={valider} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Champ libelle="Mot de passe actuel" type="password" value={f.ancien} onChange={(e) => setF({ ...f, ancien: e.target.value })} required autoFocus />
          <Champ libelle="Nouveau mot de passe" aide="Au moins 8 caractères" type="password" value={f.nouveau} onChange={(e) => setF({ ...f, nouveau: e.target.value })} required />
          <Champ libelle="Confirmation" type="password" value={f.confirmation} onChange={(e) => setF({ ...f, confirmation: e.target.value })} required />
          <Message type="erreur">{erreur}</Message>
          <div className="actions">
            <button type="button" className="bouton secondaire" onClick={onFermer}>
              Annuler
            </button>
            <button className="bouton">Changer</button>
          </div>
        </form>
      )}
    </Modale>
  );
}

export function Coquille({ children }: { children: ReactNode }) {
  const { profil, poste, peut, deconnecter, verrouiller } = useSession();
  const [monMotDePasse, setMonMotDePasse] = useState(false);
  const { appeler } = useSession();
  const [modulesActifs, setModulesActifs] = useState<string[]>();
  useEffect(() => {
    appeler<{ modulesActifs: string[] }>('GET', '/parametres').then((p) => setModulesActifs(p.modulesActifs)).catch(() => undefined);
  }, [appeler]);
  const modulesVisibles = MODULES_METIER.filter((m) => (!modulesActifs || modulesActifs.includes(m.module)) && (!m.permission || (Array.isArray(m.permission) ? m.permission : [m.permission]).some((x) => peut(x))));
  const admin = [
    { chemin: '/utilisateurs', libelle: 'Utilisateurs', icone: 'utilisateurs', permission: PERMISSIONS.ADMIN_UTILISATEURS },
    { chemin: '/appareils', libelle: 'Appareils', icone: 'appareils', permission: PERMISSIONS.ADMIN_APPAREILS },
    { chemin: '/parametres', libelle: 'Paramètres', icone: 'parametres', permission: PERMISSIONS.ADMIN_PARAMETRES },
    { chemin: '/sauvegardes', libelle: 'Sauvegardes', icone: 'sauvegarde', permission: PERMISSIONS.ADMIN_SAUVEGARDES },
    { chemin: '/journal', libelle: "Journal d'audit", icone: 'journal', permission: PERMISSIONS.AUDIT_VOIR },
  ].filter((l) => peut(l.permission));

  return (
    <div className="coquille">
      <aside className="barre-laterale">
        <div className="marque-mini">
          <img src={logo} alt="" />
          <div>
            <strong>SOMIDAC</strong>
            <small>Gestion</small>
          </div>
        </div>
        <nav aria-label="Navigation principale">
          <NavLink to="/" end>
            <Icone nom="tableau" /> Tableau de bord
          </NavLink>
          <div className="titre-groupe">Activité</div>
          {modulesVisibles.map((m) => (
            <NavLink key={m.chemin} to={m.chemin}>
              <Icone nom={m.icone} /> {m.libelle}
              {m.lot && <span className="badge-lot">lot {m.lot}</span>}
            </NavLink>
          ))}
          {admin.length > 0 && <div className="titre-groupe">Administration</div>}
          {admin.map((m) => (
            <NavLink key={m.chemin} to={m.chemin}>
              <Icone nom={m.icone} /> {m.libelle}
            </NavLink>
          ))}
        </nav>
        <div className="poste-info">
          <strong>{poste?.nomAppareil}</strong>
          {poste?.mode === 'principal' ? 'Héberge le serveur' : `Connecté au serveur ${poste?.serveur?.hote ?? ''}`}
          <div className="realise-par">Réalisé par Wéllé Labs</div>
        </div>
      </aside>
      <div className="principal">
        <header className="barre-haute">
          <div />
          <div className="utilisateur">
            <div style={{ textAlign: 'right' }}>
              <div className="nom">{profil?.nomComplet}</div>
              <div className="role" title={profil?.permissions.map((p) => LIBELLES_PERMISSIONS[p as keyof typeof LIBELLES_PERMISSIONS] ?? p).join('\n')}>
                {libelleRole(profil?.permissions ?? [])}
              </div>
            </div>
            <button className="bouton discret" title="Mon mot de passe" onClick={() => setMonMotDePasse(true)} style={{ padding: 0 }}>
              <div className="avatar">{initiales(profil?.nomComplet ?? '?')}</div>
            </button>
            <button className="bouton discret" title="Verrouiller la session" onClick={verrouiller}>
              <Icone nom="verrou" />
            </button>
            <button className="bouton discret" title="Se déconnecter" onClick={() => void deconnecter()}>
              <Icone nom="sortie" />
            </button>
          </div>
        </header>
        <div className="page">{children}</div>
      </div>
      {monMotDePasse && <MonMotDePasse onFermer={() => setMonMotDePasse(false)} />}
    </div>
  );
}
