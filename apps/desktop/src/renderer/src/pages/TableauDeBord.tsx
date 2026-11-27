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
  const [ventes, setVentes] = useState<{ caJour: number; caMois: number; livraisonsJour: number; livraisonsMois: number; bonsAFacturer: number; facturesNonSoldees: number; resteDuClients: number }>();
  const [ventesErreur, setVentesErreur] = useState<string>();

  useEffect(() => {
    appeler<Parametres>('GET', '/parametres').then(setP).catch(() => undefined);
    appeler<{ resume: { stockBas: number; lotsBientotPerimes: number; lotsPerimes: number; valeurTotale?: number } }>('GET', '/stock')
      .then((e) => setStock(e.resume))
      .catch(() => undefined);
    if (peut('tableau_de_bord.complet')) {
      appeler<NonNullable<typeof ventes>>('GET', '/ventes/resume')
        .then(setVentes)
        .catch((e) => setVentesErreur(e?.code === 'MODULE_DESACTIVE' ? 'Module Ventes désactivé' : 'Indisponible'));
    }
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
        <a className="carte indicateur cliquable" href="#/ventes">
          <div className="libelle">Ventes du jour (HT)</div>
          <div className="valeur">{ventes ? formaterMontant(ventes.caJour) : '-'}</div>
          <div className="detail">
            {ventes
              ? `${ventes.livraisonsJour} livraison(s) · mois : ${formaterMontant(ventes.caMois)}`
              : ventesErreur ?? (peut('tableau_de_bord.complet') ? 'Chargement…' : 'Chiffres réservés au gérant et au caissier')}
          </div>
        </a>
        {ventes && (
          <a className="carte indicateur cliquable" href="#/ventes">
            <div className="libelle">À encaisser</div>
            <div className="valeur" style={{ color: ventes.resteDuClients ? 'var(--alerte)' : undefined }}>{formaterMontant(ventes.resteDuClients)}</div>
            <div className="detail">
              {ventes.facturesNonSoldees} facture(s) non soldée(s){ventes.bonsAFacturer ? ` · ${ventes.bonsAFacturer} bon(s) à facturer` : ''}
            </div>
          </a>
        )}
        <a className="carte indicateur" href="#/stock" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="libelle">Stock bas</div>
          <div className="valeur" style={{ color: stock?.stockBas ? 'var(--alerte)' : undefined }}>{stock ? stock.stockBas : '-'}</div>
          <div className="detail">
            {stock ? `${stock.lotsBientotPerimes} lot(s) à écouler, ${stock.lotsPerimes} périmé(s)` : 'Module Stock désactivé'}
            {stock?.valeurTotale !== undefined ? ` · valeur ${formaterMontant(stock.valeurTotale)}` : ''}
          </div>
        </a>
        <div className="carte indicateur">
          <div className="libelle">Trésorerie</div>
          <div className="valeur">-</div>
          <div className="detail">Disponible avec le module Trésorerie (lot 4)</div>
        </div>
        <div className="carte indicateur">
          <div className="libelle">Cet appareil</div>
          <div className="valeur" style={{ fontSize: 17 }}>{poste?.nomAppareil}</div>
          <div className="detail">Clé valable jusqu'au {formaterDate(poste?.certificatExpireLe)}</div>
        </div>
      </div>
      <Message type="info">
        Produits, achats, stock et ventes (bons de livraison, factures, avoirs) sont disponibles. L’encaissement des
        factures et la trésorerie arrivent au lot 4.
      </Message>
    </>
  );
}
