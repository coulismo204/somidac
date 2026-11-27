import { ReactNode } from 'react';
import logo from '../logo-somidac.jpeg';

/** Mise en page des écrans hors application : marque à gauche, formulaire à droite. */
export function EcranAccueil({ children }: { children: ReactNode }) {
  return (
    <div className="ecran-accueil">
      <aside className="marque">
        <div>
          <img className="logo" src={logo} alt="SOMIDAC SARL" />
          <h1>Gestion SOMIDAC</h1>
          <div className="devise">Distribution cosmétiques &amp; divers produits</div>
        </div>
        <div className="pied">
          Achats · Stock · Ventes · Trésorerie
          <div className="realise-par">Réalisé par Wéllé Labs</div>
        </div>
      </aside>
      <main className="contenu">
        <div className="carte-accueil">{children}</div>
      </main>
    </div>
  );
}
