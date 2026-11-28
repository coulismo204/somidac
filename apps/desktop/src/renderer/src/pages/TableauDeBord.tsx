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
  const [tresorerie, setTresorerie] = useState<{ parType: Record<string, number | null>; total: number | null; encaissementsJour: number; depensesMois: number; dettesFournisseurs: number; cloturesAValider: number; derniereCloture: { jour: string; ecart: number | null } | null }>();

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
    if (peut('tableau_de_bord.complet')) {
      appeler<NonNullable<typeof tresorerie>>('GET', '/tresorerie/resume').then(setTresorerie).catch(() => undefined);
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
      {tresorerie && tresorerie.cloturesAValider > 0 && peut('caisse.valider') && (
        <div style={{ marginBottom: 12 }}>
          <Message type="attention">
            {tresorerie.cloturesAValider} clôture(s) de caisse à valider. <a href="#/tresorerie">Ouvrir la trésorerie</a>
          </Message>
        </div>
      )}
      {tresorerie?.derniereCloture?.ecart ? (
        <div style={{ marginBottom: 12 }}>
          <Message type="attention">Écart de {formaterMontant(tresorerie.derniereCloture.ecart)} à la dernière clôture de caisse ({formaterDate(tresorerie.derniereCloture.jour)}).</Message>
        </div>
      ) : null}
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
        <a className="carte indicateur cliquable" href="#/tresorerie">
          <div className="libelle">{tresorerie && tresorerie.total == null ? 'Trésorerie hors caisse' : 'Trésorerie'}</div>
          <div className="valeur">{tresorerie ? (tresorerie.total != null ? formaterMontant(tresorerie.total) : formaterMontant((tresorerie.parType.mobile_money ?? 0) + (tresorerie.parType.banque ?? 0))) : '-'}</div>
          <div className="detail">
            {tresorerie
              ? [
                  tresorerie.parType.caisse != null ? `Caisse ${formaterMontant(tresorerie.parType.caisse)}` : 'Caisse : visible du gérant',
                  `Mobile Money ${formaterMontant(tresorerie.parType.mobile_money ?? 0)}`,
                  `Banque ${formaterMontant(tresorerie.parType.banque ?? 0)}`,
                ].join(' · ')
              : 'Chiffres réservés au gérant et au caissier'}
          </div>
        </a>
        {tresorerie && (
          <a className="carte indicateur cliquable" href="#/tresorerie">
            <div className="libelle">Dettes fournisseurs</div>
            <div className="valeur" style={{ color: tresorerie.dettesFournisseurs ? 'var(--alerte)' : undefined }}>{formaterMontant(tresorerie.dettesFournisseurs)}</div>
            <div className="detail">Dépenses du mois : {formaterMontant(tresorerie.depensesMois)}</div>
          </a>
        )}
        <div className="carte indicateur">
          <div className="libelle">Cet appareil</div>
          <div className="valeur" style={{ fontSize: 17 }}>{poste?.nomAppareil}</div>
          <div className="detail">Clé valable jusqu'au {formaterDate(poste?.certificatExpireLe)}</div>
        </div>
      </div>
      <Message type="info">
        Produits, achats, stock, ventes et trésorerie sont disponibles. Les rapports (ventes, marges, résultat du mois)
        arrivent au lot 5.
      </Message>
    </>
  );
}
