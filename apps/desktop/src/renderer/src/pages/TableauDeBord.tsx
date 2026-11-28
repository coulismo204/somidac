import { ReactNode, useEffect, useState } from 'react';
import { Message } from '../composants/communs';
import { useSession } from '../contexte';
import { formaterDate, formaterJour, formaterMontant, formaterNombre } from '../format';

interface Tableau {
  jour: string;
  ventes?: {
    sesVentesSeulement: boolean;
    caJour: number;
    caMois: number;
    margeMois: number | null;
    tauxMargeMois: number | null;
    livraisonsJour: number;
    livraisonsMois: number;
    top: { libelle: string; code: string | null; pieces: number; ca: number }[];
    facturesEnRetard?: { nombre: number; montant: number };
    aEncaisser?: { nombre: number; montant: number };
    bonsAFacturer?: number;
  };
  stock?: {
    delaiPeremptionJours: number;
    stockBas: { id: string; designation: string; code: string; stock: number; seuil: number }[];
    nbStockBas: number;
    lots: { produit: string; numero: string; peremption: string; quantite: number; perime: boolean }[];
    nbLotsAEcouler: number;
    nbLotsPerimes: number;
    valeur?: number;
  };
  tresorerie?: {
    parType: Record<'caisse' | 'mobile_money' | 'banque', number | null>;
    dettesFournisseurs: number;
    depensesMois: number;
    cloturesAValider: number;
  };
  alertes?: {
    seuil: number;
    ecartsCaisse: { jour: string; compte: string; ecart: number }[];
    ecartsInventaire: { id: string; libelle: string; valeur: number }[];
    horsHeures: number;
    sensiblesAujourdhui: number;
  };
}

function Indicateur({ libelle, valeur, detail, lien, couleur }: { libelle: string; valeur: ReactNode; detail?: ReactNode; lien?: string; couleur?: string }) {
  const contenu = (
    <>
      <div className="libelle">{libelle}</div>
      <div className="valeur" style={{ color: couleur }}>{valeur}</div>
      {detail && <div className="detail">{detail}</div>}
    </>
  );
  return lien ? <a className="carte indicateur cliquable" href={lien}>{contenu}</a> : <div className="carte indicateur">{contenu}</div>;
}

/** Tableau de bord (§5.1) : chiffres du jour et du mois, soldes, produits les plus vendus, alertes. */
export function TableauDeBord() {
  const { profil, poste, appeler, peut } = useSession();
  const [t, setT] = useState<Tableau>();
  const [raisonSociale, setRaisonSociale] = useState('SOMIDAC SARL');
  const [alertesSauvegarde, setAlertesSauvegarde] = useState<string[]>([]);
  const [miseEnService, setMiseEnService] = useState<{ faites: number; total: number; termine: boolean }>();

  useEffect(() => {
    appeler<Tableau>('GET', '/tableau-de-bord').then(setT).catch(() => undefined);
    appeler<{ raisonSociale: string }>('GET', '/parametres').then((p) => setRaisonSociale(p.raisonSociale)).catch(() => undefined);
    if (peut('admin.parametres')) {
      appeler<{ faites: number; total: number; termine: boolean }>('GET', '/mise-en-service').then(setMiseEnService).catch(() => undefined);
    }
    if (peut('admin.sauvegardes')) {
      appeler<{ alertes: string[] }>('GET', '/sauvegardes').then((e) => setAlertesSauvegarde(e.alertes)).catch(() => undefined);
    }
  }, [appeler, peut]);

  const salut = new Date().getHours() < 18 ? 'Bonjour' : 'Bonsoir';
  const v = t?.ventes;
  const s = t?.stock;
  const tr = t?.tresorerie;
  const a = t?.alertes;
  const maxTop = Math.max(1, ...(v?.top ?? []).map((x) => x.ca));

  const alertes: { type: 'attention' | 'erreur'; texte: ReactNode }[] = [];
  if (miseEnService && !miseEnService.termine) {
    alertes.push({ type: 'attention', texte: <>Mise en service : {miseEnService.faites} étape(s) sur {miseEnService.total} terminée(s). <a href="#/mise-en-service">Continuer</a></> });
  }
  for (const x of alertesSauvegarde) alertes.push({ type: 'attention', texte: <>{x} <a href="#/sauvegardes">Ouvrir les sauvegardes</a></> });
  if (tr && tr.cloturesAValider > 0 && peut('caisse.valider')) alertes.push({ type: 'attention', texte: <>{tr.cloturesAValider} clôture(s) de caisse à valider. <a href="#/tresorerie">Ouvrir la trésorerie</a></> });
  for (const e of a?.ecartsCaisse ?? []) alertes.push({ type: 'erreur', texte: `Écart de caisse de ${formaterMontant(e.ecart)} le ${formaterJour(e.jour)} (${e.compte}).` });
  for (const e of a?.ecartsInventaire ?? []) alertes.push({ type: 'erreur', texte: `Écart d’inventaire de ${formaterMontant(e.valeur)} (« ${e.libelle} »).` });
  if (a?.horsHeures) alertes.push({ type: 'attention', texte: <>{a.horsHeures} opération(s) hors des heures d’ouverture ces 7 derniers jours. <a href="#/rapports">Voir les actions sensibles</a></> });
  if (v?.facturesEnRetard?.nombre) alertes.push({ type: 'attention', texte: <>{v.facturesEnRetard.nombre} facture(s) en retard de paiement : {formaterMontant(v.facturesEnRetard.montant)}. <a href="#/ventes">Voir les factures</a></> });

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>{salut}, {profil?.nomComplet.split(' ')[0]}</h1>
          <p>{raisonSociale} · {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(new Date())}</p>
        </div>
        {a && <a className="bouton secondaire" href="#/rapports">Actions sensibles du jour : {a.sensiblesAujourdhui}</a>}
      </div>

      {alertes.map((x, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <Message type={x.type}>{x.texte}</Message>
        </div>
      ))}

      {v && (
        <div className="grille-cartes" style={{ marginBottom: 16 }}>
          <Indicateur libelle={v.sesVentesSeulement ? 'Mes ventes du jour (HT)' : 'Ventes du jour (HT)'} valeur={formaterMontant(v.caJour)} detail={`${v.livraisonsJour} livraison(s)`} lien="#/ventes" />
          <Indicateur libelle={v.sesVentesSeulement ? 'Mes ventes du mois (HT)' : 'Ventes du mois (HT)'} valeur={formaterMontant(v.caMois)} detail={`${v.livraisonsMois} livraison(s)`} lien="#/rapports" />
          {v.margeMois != null && <Indicateur libelle="Marge brute du mois" valeur={formaterMontant(v.margeMois)} detail={v.tauxMargeMois != null ? `${v.tauxMargeMois.toLocaleString('fr-FR')} % des ventes` : undefined} lien="#/rapports" />}
          {v.aEncaisser && (
            <Indicateur
              libelle="À encaisser"
              valeur={formaterMontant(v.aEncaisser.montant)}
              couleur={v.aEncaisser.montant ? 'var(--alerte)' : undefined}
              detail={`${v.aEncaisser.nombre} facture(s)${v.bonsAFacturer ? ` · ${v.bonsAFacturer} bon(s) à facturer` : ''}`}
              lien="#/ventes"
            />
          )}
        </div>
      )}

      {tr && (
        <div className="grille-cartes" style={{ marginBottom: 16 }}>
          <Indicateur libelle="Caisse espèces" valeur={tr.parType.caisse != null ? formaterMontant(tr.parType.caisse) : '•••••'} detail={tr.parType.caisse == null ? 'Visible du gérant (clôture à l’aveugle)' : undefined} lien="#/tresorerie" />
          <Indicateur libelle="Mobile Money" valeur={formaterMontant(tr.parType.mobile_money ?? 0)} lien="#/tresorerie" />
          <Indicateur libelle="Banque" valeur={formaterMontant(tr.parType.banque ?? 0)} lien="#/tresorerie" />
          <Indicateur libelle="Dettes fournisseurs" valeur={formaterMontant(tr.dettesFournisseurs)} couleur={tr.dettesFournisseurs ? 'var(--alerte)' : undefined} detail={`Dépenses du mois : ${formaterMontant(tr.depensesMois)}`} lien="#/tresorerie" />
        </div>
      )}

      <div className="grille-tableau-de-bord">
        {v && (
          <div className="carte">
            <div className="entete-carte"><h3>{v.sesVentesSeulement ? 'Mes 5 produits les plus vendus du mois' : 'Les 5 produits les plus vendus du mois'}</h3></div>
            {v.top.length === 0 ? (
              <div className="vide">Aucune vente ce mois-ci.</div>
            ) : (
              <div className="corps" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {v.top.map((p, i) => (
                  <div key={p.libelle} className="top-produit">
                    <div className="top-ligne">
                      <span><strong>{i + 1}. {p.libelle}</strong> <span className="secondaire">{formaterNombre(p.pieces)} pièces</span></span>
                      <span className="nombre">{formaterMontant(p.ca)}</span>
                    </div>
                    <div className="barre-progression"><div style={{ width: `${Math.max(4, (p.ca / maxTop) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {s && (
          <div className="carte">
            <div className="entete-carte">
              <h3>Alertes de stock</h3>
              {s.valeur !== undefined && <span className="secondaire" style={{ color: 'var(--texte-2)' }}>Valeur du stock : {formaterMontant(s.valeur)}</span>}
            </div>
            {s.nbStockBas === 0 && s.lots.length === 0 ? (
              <div className="vide">Aucune alerte de stock.</div>
            ) : (
              <table className="tableau">
                <tbody>
                  {s.stockBas.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.designation}</strong><div className="secondaire">{p.code} · sous le seuil de {p.seuil}</div></td>
                      <td className="nombre"><span className="pastille orange">{formaterNombre(p.stock)} pc</span></td>
                    </tr>
                  ))}
                  {s.lots.map((l, i) => (
                    <tr key={`l${i}`}>
                      <td><strong>{l.produit}</strong><div className="secondaire">Lot {l.numero || 'sans numéro'} · {formaterNombre(l.quantite)} pièces</div></td>
                      <td className="nombre"><span className={`pastille ${l.perime ? 'rouge' : 'orange'}`}>{l.perime ? 'Périmé' : 'Exp.'} {formaterJour(l.peremption)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(s.nbStockBas > s.stockBas.length || s.nbLotsAEcouler + s.nbLotsPerimes > s.lots.length) && (
              <div className="corps" style={{ paddingTop: 10 }}><a href="#/stock">Voir toutes les alertes ({s.nbStockBas} sous le seuil, {s.nbLotsAEcouler + s.nbLotsPerimes} lot(s))</a></div>
            )}
          </div>
        )}
      </div>

      <p className="secondaire" style={{ color: 'var(--texte-3)', fontSize: 12, marginTop: 16 }}>
        {poste?.nomAppareil} · clé valable jusqu’au {formaterDate(poste?.certificatExpireLe)}
      </p>
    </>
  );
}
