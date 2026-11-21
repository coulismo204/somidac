import { LIBELLES_PERMISSIONS, PERMISSIONS, ROLES_PAR_DEFAUT } from '@somidac/shared';
import { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useSession } from '../contexte';
import { initiales } from '../format';
import logo from '../logo-somidac.jpeg';
import { Icone } from './communs';

/** Modules métier : ils apparaissent au fil des lots (cahier des charges §11). */
const MODULES_METIER = [
  { chemin: '/produits', libelle: 'Produits', icone: 'produits', lot: 2 },
  { chemin: '/stock', libelle: 'Stock', icone: 'stock', lot: 2 },
  { chemin: '/achats', libelle: 'Achats', icone: 'achats', lot: 2 },
  { chemin: '/ventes', libelle: 'Ventes', icone: 'ventes', lot: 3 },
  { chemin: '/tresorerie', libelle: 'Trésorerie', icone: 'tresorerie', lot: 4 },
  { chemin: '/rapports', libelle: 'Rapports', icone: 'rapports', lot: 5 },
];

function libelleRole(permissions: string[]): string {
  const role = ROLES_PAR_DEFAUT.find((r) => r.permissions.length === permissions.length && r.permissions.every((p) => permissions.includes(p)));
  return role?.libelle ?? `${permissions.length} droit${permissions.length > 1 ? 's' : ''}`;
}

export function Coquille({ children }: { children: ReactNode }) {
  const { profil, poste, peut, deconnecter, verrouiller } = useSession();
  const admin = [
    { chemin: '/utilisateurs', libelle: 'Utilisateurs', icone: 'utilisateurs', permission: PERMISSIONS.ADMIN_UTILISATEURS },
    { chemin: '/appareils', libelle: 'Appareils', icone: 'appareils', permission: PERMISSIONS.ADMIN_APPAREILS },
    { chemin: '/parametres', libelle: 'Paramètres', icone: 'parametres', permission: PERMISSIONS.ADMIN_PARAMETRES },
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
          {MODULES_METIER.map((m) => (
            <NavLink key={m.chemin} to={m.chemin}>
              <Icone nom={m.icone} /> {m.libelle}
              <span className="badge-lot">lot {m.lot}</span>
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
            <div className="avatar">{initiales(profil?.nomComplet ?? '?')}</div>
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
    </div>
  );
}
