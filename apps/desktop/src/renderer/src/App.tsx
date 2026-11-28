import { PERMISSIONS } from '@somidac/shared';
import { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { Coquille } from './composants/Coquille';
import { useSession } from './contexte';
import { Appareils } from './pages/admin/Appareils';
import { Journal } from './pages/admin/Journal';
import { Parametres } from './pages/admin/Parametres';
import { Sauvegardes } from './pages/admin/Sauvegardes';
import { Utilisateurs } from './pages/admin/Utilisateurs';
import { AppareilRevoque } from './pages/AppareilRevoque';
import { ChangementMotDePasse } from './pages/ChangementMotDePasse';
import { Configuration } from './pages/configuration/Configuration';
import { Connexion } from './pages/Connexion';
import { Achats } from './pages/achats/Achats';
import { Produits } from './pages/produits/Produits';
import { Stock } from './pages/stock/Stock';
import { TableauDeBord } from './pages/TableauDeBord';
import { Ventes } from './pages/ventes/Ventes';
import { Tresorerie } from './pages/tresorerie/Tresorerie';
import { Rapports } from './pages/rapports/Rapports';
import { Verrouillage } from './pages/Verrouillage';

/** Il suffit d'une des permissions données. */
function Autorise({ permission, children }: { permission: string | string[]; children: ReactNode }) {
  const { peut } = useSession();
  return (Array.isArray(permission) ? permission : [permission]).some((p) => peut(p)) ? <>{children}</> : <Navigate to="/" replace />;
}

function ErreurDemarrage() {
  const { erreurDemarrage, demarrer } = useSession();
  return (
    <div className="chargement">
      <div className="carte" style={{ maxWidth: 460, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2>Démarrage impossible</h2>
        <div className="message erreur">{erreurDemarrage}</div>
        <button className="bouton" onClick={() => void demarrer()}>
          Réessayer
        </button>
      </div>
    </div>
  );
}

export function App() {
  const { phase, profil, verrouille } = useSession();

  switch (phase) {
    case 'chargement':
      return <div className="chargement">Démarrage…</div>;
    case 'erreur-demarrage':
      return <ErreurDemarrage />;
    case 'configuration':
      return <Configuration />;
    case 'revoque':
      return <AppareilRevoque />;
    case 'connexion':
      return <Connexion />;
  }
  if (profil?.doitChangerMotDePasse) return <ChangementMotDePasse />;

  return (
    <HashRouter>
      <Coquille>
        <Routes>
          <Route path="/" element={<TableauDeBord />} />
          <Route path="/produits" element={<Produits />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/achats" element={<Autorise permission={PERMISSIONS.ACHATS_SAISIR}><Achats /></Autorise>} />
          <Route path="/ventes" element={<Autorise permission={PERMISSIONS.VENTES_SAISIR}><Ventes /></Autorise>} />
          <Route path="/tresorerie" element={<Autorise permission={PERMISSIONS.TRESORERIE_ENCAISSER}><Tresorerie /></Autorise>} />
          <Route path="/rapports" element={<Autorise permission={[PERMISSIONS.RAPPORTS_TOUS, PERMISSIONS.RAPPORTS_STOCK, PERMISSIONS.RAPPORTS_SES_VENTES, PERMISSIONS.AUDIT_VOIR]}><Rapports /></Autorise>} />
          <Route path="/utilisateurs" element={<Autorise permission={PERMISSIONS.ADMIN_UTILISATEURS}><Utilisateurs /></Autorise>} />
          <Route path="/appareils" element={<Autorise permission={PERMISSIONS.ADMIN_APPAREILS}><Appareils /></Autorise>} />
          <Route path="/parametres" element={<Autorise permission={PERMISSIONS.ADMIN_PARAMETRES}><Parametres /></Autorise>} />
          <Route path="/sauvegardes" element={<Autorise permission={PERMISSIONS.ADMIN_SAUVEGARDES}><Sauvegardes /></Autorise>} />
          <Route path="/journal" element={<Autorise permission={PERMISSIONS.AUDIT_VOIR}><Journal /></Autorise>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Coquille>
      {verrouille && <Verrouillage />}
    </HashRouter>
  );
}
