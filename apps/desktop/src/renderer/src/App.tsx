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
import { ModuleAVenir } from './pages/ModuleAVenir';
import { TableauDeBord } from './pages/TableauDeBord';
import { Verrouillage } from './pages/Verrouillage';

function Autorise({ permission, children }: { permission: string; children: ReactNode }) {
  const { peut } = useSession();
  return peut(permission) ? <>{children}</> : <Navigate to="/" replace />;
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
          <Route path="/produits" element={<ModuleAVenir titre="Produits" lot={2} description="Catalogue, codes-barres, conditionnements et prix par client." />} />
          <Route path="/stock" element={<ModuleAVenir titre="Stock" lot={2} description="Mouvements, lots, dates de péremption et inventaires." />} />
          <Route path="/achats" element={<ModuleAVenir titre="Achats" lot={2} description="Fournisseurs, achats et frais d'approche." />} />
          <Route path="/ventes" element={<ModuleAVenir titre="Ventes" lot={3} description="Clients, bons de livraison, factures et avoirs." />} />
          <Route path="/tresorerie" element={<ModuleAVenir titre="Trésorerie" lot={4} description="Encaissements, dépenses et clôture de caisse." />} />
          <Route path="/rapports" element={<ModuleAVenir titre="Rapports" lot={5} description="Ventes, marges, stock valorisé et résultat du mois." />} />
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
