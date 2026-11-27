import { useEffect, useState } from 'react';
import { Message } from '../composants/communs';
import { useSession } from '../contexte';
import { formaterDate, formaterMontant } from '../format';

interface Parametres {
  raisonSociale: string;
  devise: string;
  modulesActifs: string[];
  tvaActive: boolean;
}

export function TableauDeBord() {
  const { profil, poste, appeler, peut } = useSession();
  const [p, setP] = useState<Parametres>();
  const [alertesSauvegarde, setAlertesSauvegarde] = useState<string[]>([]);
  const [stock, setStock] = useState<{ stockBas: number; lotsBientotPerimes: number; lotsPerimes: number; valeurTotale?: number }>();

  useEffect(() => {
    appeler<Parametres>('GET', '/parametres').then(setP).catch(() => undefined);
    appeler<{ resume: { stockBas: number; lotsBientotPerimes: number; lotsPerimes: number; valeurTotale?: number } }>('GET', '/stock')
      .then((e) => setStock(e.resume))
      .catch(() => undefined);
    if (peut('admin.sauvegardes')) {
      appeler<{ alertes: string[] }>('GET', '/sauvegardes').then((e) => setAlertesSauvegarde(e.alertes)).catch(() => undefined);
    }
  }, [appeler, peut]);

  const heure = new Date().getHours();
  const salut = heure < 18 ? 'Bonjour' : 'Bonsoir';

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>
            {salut}, {profil?.nomComplet.split(' ')[0]}
          </h1>
          <p>{p?.raisonSociale ?? 'SOMIDAC SARL'} · {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(new Date())}</p>
        </div>
      </div>
      {alertesSauvegarde.map((a) => (
        <div key={a} style={{ marginBottom: 12 }}>
          <Message type="attention">
            {a} <a href="#/sauvegardes">Ouvrir les sauvegardes</a>
          </Message>
        </div>
      ))}
      <div className="grille-cartes" style={{ marginBottom: 20 }}>
        <div className="carte indicateur">
          <div className="libelle">Ventes du jour</div>
          <div className="valeur">—</div>
          <div className="detail">Disponible avec le module Ventes (lot 3)</div>
        </div>
        <a className="carte indicateur" href="#/stock" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="libelle">Stock bas</div>
          <div className="valeur" style={{ color: stock?.stockBas ? 'var(--alerte)' : undefined }}>{stock ? stock.stockBas : '—'}</div>
          <div className="detail">
            {stock ? `${stock.lotsBientotPerimes} lot(s) à écouler, ${stock.lotsPerimes} périmé(s)` : 'Module Stock désactivé'}
            {stock?.valeurTotale !== undefined ? ` · valeur ${formaterMontant(stock.valeurTotale)}` : ''}
          </div>
        </a>
        <div className="carte indicateur">
          <div className="libelle">Trésorerie</div>
          <div className="valeur">—</div>
          <div className="detail">Disponible avec le module Trésorerie (lot 4)</div>
        </div>
        <div className="carte indicateur">
          <div className="libelle">Cet appareil</div>
          <div className="valeur" style={{ fontSize: 17 }}>{poste?.nomAppareil}</div>
          <div className="detail">Clé valable jusqu'au {formaterDate(poste?.certificatExpireLe)}</div>
        </div>
      </div>
      <Message type="info">
        Produits, achats et stock sont disponibles. Les ventes (bons de livraison et factures) arrivent au lot 3, la
        trésorerie au lot 4.
      </Message>
    </>
  );
}
