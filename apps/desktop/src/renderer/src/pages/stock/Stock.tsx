import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Champ, Message, Modale } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterDateHeure, formaterJour, formaterMontant, formaterNombre } from '../../format';
import { Inventaires } from './Inventaires';

interface LotEtat {
  id: string;
  numero: string;
  datePeremption: string | null;
  quantite: number;
  perime: boolean;
  bientotPerime: boolean;
}
interface ProduitEtat {
  id: string;
  code: string;
  designation: string;
  categorie: string;
  suiviLot: boolean;
  stock: number;
  seuilAlerte: number;
  stockBas: boolean;
  lots: LotEtat[];
  cmp?: number;
  valeur?: number;
}
interface Etat {
  produits: ProduitEtat[];
  resume: { nbProduits: number; stockBas: number; lotsBientotPerimes: number; lotsPerimes: number; valeurTotale?: number };
}
interface Mouvement {
  id: string;
  date: string;
  type: string;
  quantite: number;
  motif: string | null;
  lotNumero: string | null;
  lotPeremption: string | null;
  cout?: number;
}

const TYPES: Record<string, string> = {
  achat: 'Achat',
  vente: 'Vente',
  retour_client: 'Retour client',
  retour_fournisseur: 'Retour fournisseur',
  ajustement: 'Ajustement',
  casse: 'Casse',
  peremption: 'Péremption',
  inventaire: 'Inventaire',
};

function Ajustement({ produit, onFermer }: { produit: ProduitEtat; onFermer: (fait: boolean) => void }) {
  const { appeler } = useSession();
  const [f, setF] = useState({ type: 'casse', sens: 'sortie', quantite: 1, lotId: produit.lots[0]?.id ?? '', motif: '', numeroLot: '', datePeremption: '' });
  const [erreur, setErreur] = useState<string>();
  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    const entree = f.type === 'ajustement' && f.sens === 'entree';
    try {
      await appeler('POST', '/stock/ajustements', {
        produitId: produit.id,
        type: f.type,
        quantite: entree ? Number(f.quantite) : -Number(f.quantite),
        lotId: entree && !f.lotId ? null : f.lotId || null,
        motif: f.motif,
        numeroLot: f.numeroLot || null,
        datePeremption: f.datePeremption || null,
      });
      onFermer(true);
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };
  const entree = f.type === 'ajustement' && f.sens === 'entree';
  return (
    <Modale titre={`Ajuster le stock - ${produit.designation}`} onFermer={() => onFermer(false)}>
      <form onSubmit={valider} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="grille-champs">
          <div className="champ">
            <label htmlFor="type">Type</label>
            <select id="type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, sens: e.target.value === 'ajustement' ? f.sens : 'sortie' })}>
              <option value="casse">Casse</option>
              <option value="peremption">Produits périmés</option>
              <option value="ajustement">Correction</option>
            </select>
          </div>
          {f.type === 'ajustement' && (
            <div className="champ">
              <label htmlFor="sens">Sens</label>
              <select id="sens" value={f.sens} onChange={(e) => setF({ ...f, sens: e.target.value, lotId: e.target.value === 'entree' ? '' : produit.lots[0]?.id ?? '' })}>
                <option value="sortie">Pièces en moins</option>
                <option value="entree">Pièces retrouvées</option>
              </select>
            </div>
          )}
          <Champ libelle="Quantité (pièces)" type="number" min={1} value={f.quantite} onChange={(e) => setF({ ...f, quantite: Number(e.target.value) })} required />
          {(produit.suiviLot || !entree) && produit.lots.length > 0 && (
            <div className="champ">
              <label htmlFor="lot">Lot</label>
              <select id="lot" value={f.lotId} onChange={(e) => setF({ ...f, lotId: e.target.value })}>
                {entree && <option value="">Nouveau lot…</option>}
                {produit.lots.map((l) => <option key={l.id} value={l.id}>{l.numero || 'Sans lot'} {l.datePeremption ? `· ${formaterJour(l.datePeremption)}` : ''} · {l.quantite} pc</option>)}
              </select>
            </div>
          )}
          {entree && produit.suiviLot && !f.lotId && (
            <>
              <Champ libelle="N° de lot" value={f.numeroLot} onChange={(e) => setF({ ...f, numeroLot: e.target.value })} required />
              <Champ libelle="Date de péremption" type="date" value={f.datePeremption} onChange={(e) => setF({ ...f, datePeremption: e.target.value })} required />
            </>
          )}
          <Champ className="pleine" libelle="Motif" value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} placeholder="Ex. : carton tombé, produits périmés retirés du rayon" required minLength={3} />
        </div>
        <Message type="erreur">{erreur}</Message>
        <div className="actions">
          <button type="button" className="bouton secondaire" onClick={() => onFermer(false)}>Annuler</button>
          <button className="bouton">Enregistrer</button>
        </div>
      </form>
    </Modale>
  );
}

function Historique({ produit, onFermer }: { produit: ProduitEtat; onFermer: () => void }) {
  const { appeler, peut } = useSession();
  const [mvts, setMvts] = useState<Mouvement[]>();
  useEffect(() => {
    appeler<Mouvement[]>('GET', `/stock/produits/${produit.id}/mouvements`).then(setMvts).catch(() => setMvts([]));
  }, [appeler, produit.id]);
  return (
    <Modale titre={`Mouvements - ${produit.designation}`} onFermer={onFermer} large>
      {!mvts ? (
        <div className="vide">Chargement…</div>
      ) : mvts.length === 0 ? (
        <div className="vide">Aucun mouvement.</div>
      ) : (
        <table className="tableau">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Lot</th>
              <th className="nombre">Quantité</th>
              {peut('couts.voir') && <th className="nombre">Coût pièce</th>}
            </tr>
          </thead>
          <tbody>
            {mvts.map((m) => (
              <tr key={m.id}>
                <td>{formaterDateHeure(m.date)}</td>
                <td>
                  {TYPES[m.type] ?? m.type}
                  {m.motif && <div className="secondaire">{m.motif}</div>}
                </td>
                <td>{m.lotNumero || '-'} {m.lotPeremption ? <span className="secondaire">· {formaterJour(m.lotPeremption)}</span> : null}</td>
                <td className="nombre" style={{ color: m.quantite < 0 ? 'var(--danger)' : 'var(--succes)', fontWeight: 600 }}>{m.quantite > 0 ? `+${m.quantite}` : m.quantite}</td>
                {peut('couts.voir') && <td className="nombre">{formaterMontant(m.cout)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modale>
  );
}

export function Stock() {
  const { appeler, peut } = useSession();
  const [onglet, setOnglet] = useState<'etat' | 'inventaires'>('etat');
  const [etat, setEtat] = useState<Etat>();
  const [recherche, setRecherche] = useState('');
  const [alertes, setAlertes] = useState(false);
  const [ajuste, setAjuste] = useState<ProduitEtat>();
  const [historique, setHistorique] = useState<ProduitEtat>();
  const [erreur, setErreur] = useState<string>();

  const charger = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (recherche.trim()) q.set('recherche', recherche.trim());
      if (alertes) q.set('alertes', '1');
      setEtat(await appeler<Etat>('GET', `/stock?${q}`));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler, recherche, alertes]);
  useEffect(() => {
    const t = window.setTimeout(() => void charger(), 250);
    return () => window.clearTimeout(t);
  }, [charger]);

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Stock</h1>
          <p>Quantités en pièces, par lot. Le lot qui périme en premier sort d'abord.</p>
        </div>
      </div>
      <div className="onglets">
        <button className={onglet === 'etat' ? 'actif' : ''} onClick={() => setOnglet('etat')}>État du stock</button>
        {peut('stock.ajuster') && <button className={onglet === 'inventaires' ? 'actif' : ''} onClick={() => setOnglet('inventaires')}>Inventaires</button>}
      </div>
      {onglet === 'inventaires' ? (
        <Inventaires onChangement={() => void charger()} />
      ) : (
        <>
          {etat && (
            <div className="grille-cartes" style={{ marginBottom: 16 }}>
              {etat.resume.valeurTotale !== undefined && (
                <div className="carte indicateur"><div className="libelle">Valeur du stock</div><div className="valeur">{formaterMontant(etat.resume.valeurTotale)}</div><div className="detail">au coût moyen</div></div>
              )}
              <div className="carte indicateur"><div className="libelle">Stock bas</div><div className="valeur">{etat.resume.stockBas}</div><div className="detail">produit(s) sous le seuil</div></div>
              <div className="carte indicateur"><div className="libelle">À écouler</div><div className="valeur">{etat.resume.lotsBientotPerimes}</div><div className="detail">lot(s) bientôt périmé(s)</div></div>
              <div className="carte indicateur"><div className="libelle">Périmés</div><div className="valeur" style={{ color: etat.resume.lotsPerimes ? 'var(--danger)' : undefined }}>{etat.resume.lotsPerimes}</div><div className="detail">lot(s) à retirer</div></div>
            </div>
          )}
          <div className="barre-outils">
            <input className="recherche" placeholder="Rechercher un produit" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
            <label className="case"><input type="checkbox" checked={alertes} onChange={(e) => setAlertes(e.target.checked)} /> Seulement les alertes</label>
          </div>
          <Message type="erreur">{erreur}</Message>
          <div className="carte">
            {!etat ? (
              <div className="vide">Chargement…</div>
            ) : etat.produits.length === 0 ? (
              <div className="vide">{alertes ? 'Aucune alerte.' : 'Aucun produit.'}</div>
            ) : (
              <table className="tableau">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Lots</th>
                    <th className="nombre">Stock</th>
                    {etat.resume.valeurTotale !== undefined && <th className="nombre">Valeur</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {etat.produits.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.designation}</strong>
                        <div className="secondaire">{p.code} · {p.categorie}</div>
                      </td>
                      <td>
                        {p.lots.length === 0 ? <span className="secondaire">-</span> : p.lots.map((l) => (
                          <div key={l.id} style={{ fontSize: 12 }}>
                            <span className={l.perime ? 'pastille rouge' : l.bientotPerime ? 'pastille orange' : ''} style={l.perime || l.bientotPerime ? { padding: '1px 8px' } : undefined}>
                              {l.numero || 'Sans lot'}{l.datePeremption ? ` · ${formaterJour(l.datePeremption)}` : ''}
                            </span>{' '}
                            <span className="secondaire">{formaterNombre(l.quantite)} pc</span>
                          </div>
                        ))}
                      </td>
                      <td className="nombre">
                        {p.stockBas ? <span className="pastille orange">{formaterNombre(p.stock)}</span> : <strong>{formaterNombre(p.stock)}</strong>}
                        {p.seuilAlerte > 0 && <div className="secondaire">seuil {p.seuilAlerte}</div>}
                      </td>
                      {etat.resume.valeurTotale !== undefined && <td className="nombre">{formaterMontant(p.valeur)}</td>}
                      <td>
                        <div className="actions-ligne">
                          <button className="bouton secondaire petit" onClick={() => setHistorique(p)}>Mouvements</button>
                          {peut('stock.ajuster') && <button className="bouton secondaire petit" onClick={() => setAjuste(p)}>Ajuster</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      {ajuste && <Ajustement produit={ajuste} onFermer={(fait) => { setAjuste(undefined); if (fait) void charger(); }} />}
      {historique && <Historique produit={historique} onFermer={() => setHistorique(undefined)} />}
    </>
  );
}
