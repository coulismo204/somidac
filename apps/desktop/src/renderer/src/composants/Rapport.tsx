import { ReactNode, useState } from 'react';
import { useSession } from '../contexte';
import { aujourdhuiIso, formaterJour, formaterMontant, formaterNombre } from '../format';
import { Cellule, ColonneExport, creerXlsx } from '../exports/xlsx';
import logo from '../logo-somidac.jpeg';
import { Message } from './communs';
import { ApercuDocument, Entreprise, useEntreprise } from './Documents';

/**
 * Un rapport (§5.7) : le même contenu sert à l'écran, au PDF et au fichier Excel.
 */
export interface DonneesRapport {
  titre: string;
  sousTitre: string;
  nomFichier: string;
  colonnes: (ColonneExport & { detail?: number })[];
  lignes: Cellule[][];
  totaux?: Cellule[];
}

export function formaterCellule(v: Cellule, type: ColonneExport['type']): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    if (type === 'montant') return formaterMontant(v);
    if (type === 'pct') return `${v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
    if (type === 'nombre') return formaterNombre(v);
  }
  if (type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return formaterJour(v.slice(0, 10));
  return String(v);
}

const aDroite = (t: ColonneExport['type']) => t === 'montant' || t === 'nombre' || t === 'pct';

/** Tableau du rapport à l'écran, avec la ligne de totaux. */
function TableauRapport({ r }: { r: DonneesRapport }) {
  return (
    <table className="tableau">
      <thead>
        <tr>{r.colonnes.map((c, i) => <th key={i} className={aDroite(c.type) ? 'nombre' : undefined} style={i === 0 ? { minWidth: 220 } : undefined}>{c.titre}</th>)}</tr>
      </thead>
      <tbody>
        {r.lignes.map((l, n) => (
          <tr key={n}>
            {r.colonnes.map((c, i) => (
              <td key={i} className={aDroite(c.type) ? 'nombre' : undefined}>
                {i === 0 ? <strong>{formaterCellule(l[i], c.type)}</strong> : formaterCellule(l[i], c.type)}
                {c.detail !== undefined && l[c.detail] ? <div className="secondaire">{String(l[c.detail])}</div> : null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {r.totaux && (
        <tfoot>
          <tr className="ligne-total">{r.colonnes.map((c, i) => <td key={i} className={aDroite(c.type) ? 'nombre' : undefined}>{formaterCellule(r.totaux![i], c.type)}</td>)}</tr>
        </tfoot>
      )}
    </table>
  );
}

/** Version imprimable (PDF A4) aux couleurs du logo. */
function DocumentRapport({ r, e, auteur }: { r: DonneesRapport; e: Entreprise; auteur?: string }) {
  return (
    <div className="doc doc-rapport">
      <div className="doc-entete">
        <div className="doc-emetteur">
          <img src={logo} alt="" />
          <div>
            <div className="doc-raison">{e.raisonSociale}</div>
            {e.adresse && <div>{e.adresse}</div>}
          </div>
        </div>
        <div className="doc-titre">
          <div className="doc-type" style={{ fontSize: 14 }}>{r.titre}</div>
          <div>{r.sousTitre}</div>
        </div>
      </div>
      <table className="doc-table">
        <thead>
          <tr>{r.colonnes.map((c, i) => <th key={i} className={aDroite(c.type) ? 'nombre' : undefined}>{c.titre}</th>)}</tr>
        </thead>
        <tbody>
          {r.lignes.map((l, n) => (
            <tr key={n}>
              {r.colonnes.map((c, i) => (
                <td key={i} className={aDroite(c.type) ? 'nombre' : undefined}>
                  {formaterCellule(l[i], c.type)}
                  {c.detail !== undefined && l[c.detail] ? <div className="doc-detail">{String(l[c.detail])}</div> : null}
                </td>
              ))}
            </tr>
          ))}
          {r.totaux && (
            <tr className="doc-ligne-total">
              {r.colonnes.map((c, i) => <td key={i} className={aDroite(c.type) ? 'nombre' : undefined}>{formaterCellule(r.totaux![i], c.type)}</td>)}
            </tr>
          )}
        </tbody>
      </table>
      <div className="doc-pied">
        Édité le {formaterJour(aujourdhuiIso())}
        {auteur ? ` par ${auteur}` : ''} · {e.raisonSociale}
      </div>
    </div>
  );
}

/** Carte d'un rapport : titre, actions d'export, tableau. */
export function CarteRapport({ r, vide, entete }: { r?: DonneesRapport; vide?: string; entete?: ReactNode }) {
  const { profil } = useSession();
  const entreprise = useEntreprise();
  const [apercu, setApercu] = useState(false);
  const [info, setInfo] = useState<string>();
  const [erreur, setErreur] = useState<string>();

  const exporterExcel = async () => {
    if (!r) return;
    setInfo(undefined);
    setErreur(undefined);
    const colonnes = r.colonnes.map(({ titre, type, largeur }) => ({ titre, type, largeur }));
    // Le détail (code, référence) devient une colonne à part dans Excel.
    const avecDetail = r.colonnes.flatMap((c, i) => (c.detail !== undefined ? [{ i, d: c.detail, titre: `${c.titre} (détail)` }] : []));
    const fichier = creerXlsx({
      titre: r.titre,
      sousTitre: `${r.sousTitre} · ${entreprise?.raisonSociale ?? 'SOMIDAC SARL'}`,
      colonnes: [...colonnes, ...avecDetail.map((x) => ({ titre: x.titre, type: 'texte' as const, largeur: 18 }))],
      lignes: r.lignes.map((l) => [...r.colonnes.map((_, i) => l[i]), ...avecDetail.map((x) => l[x.d])]),
      totaux: r.totaux ? [...r.totaux, ...avecDetail.map(() => null)] : undefined,
    });
    const res = await window.somidac.documents.enregistrerFichier(r.nomFichier, 'xlsx', fichier);
    if (!res.ok) setErreur(res.message);
    else if (res.valeur) setInfo(`Fichier Excel enregistré : ${res.valeur}`);
  };

  return (
    <div className="carte">
      <div className="entete-carte">
        <div>
          <h3>{r?.titre ?? 'Rapport'}</h3>
          {r && <div className="secondaire" style={{ color: 'var(--texte-3)', fontSize: 12, marginTop: 2 }}>{r.sousTitre}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {entete}
          <button className="bouton secondaire petit" disabled={!r || !r.lignes.length} onClick={() => void exporterExcel()}>Excel</button>
          <button className="bouton secondaire petit" disabled={!r || !r.lignes.length || !entreprise} onClick={() => setApercu(true)}>PDF</button>
        </div>
      </div>
      {(info || erreur) && (
        <div style={{ padding: '12px 20px 0' }}>
          <Message type="succes">{info}</Message>
          <Message type="erreur">{erreur}</Message>
        </div>
      )}
      {!r ? <div className="vide">Chargement…</div> : r.lignes.length === 0 ? <div className="vide">{vide ?? 'Aucune donnée sur cette période.'}</div> : <TableauRapport r={r} />}
      {apercu && r && entreprise && (
        <ApercuDocument titre={r.titre} nomFichier={r.nomFichier} onFermer={() => setApercu(false)}>
          <DocumentRapport r={r} e={entreprise} auteur={profil?.nomComplet} />
        </ApercuDocument>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ période

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function periodesUsuelles(): [string, string, string][] {
  const auj = new Date();
  const jour = iso(auj);
  const debutMois = `${jour.slice(0, 8)}01`;
  const finMoisPrec = new Date(auj.getFullYear(), auj.getMonth(), 0);
  const debutMoisPrec = new Date(auj.getFullYear(), auj.getMonth() - 1, 1);
  const septJours = new Date(auj);
  septJours.setDate(auj.getDate() - 6);
  return [
    ['Aujourd’hui', jour, jour],
    ['7 derniers jours', iso(septJours), jour],
    ['Ce mois', debutMois, jour],
    ['Mois dernier', iso(debutMoisPrec), iso(finMoisPrec)],
    ['Cette année', `${jour.slice(0, 4)}-01-01`, jour],
  ];
}

export function ChoixPeriode({ du, au, onChange }: { du: string; au: string; onChange: (du: string, au: string) => void }) {
  return (
    <>
      <div className="segments" role="group" aria-label="Période">
        {periodesUsuelles().map(([l, d, a]) => (
          <button key={l} className={du === d && au === a ? 'actif' : ''} onClick={() => onChange(d, a)}>{l}</button>
        ))}
      </div>
      <label className="periode">Du <input type="date" value={du} max={au} onChange={(e) => e.target.value && onChange(e.target.value, au)} /></label>
      <label className="periode">au <input type="date" value={au} min={du} onChange={(e) => e.target.value && onChange(du, e.target.value)} /></label>
    </>
  );
}

export const libellePeriode = (du: string, au: string) => (du === au ? `Le ${formaterJour(du)}` : `Du ${formaterJour(du)} au ${formaterJour(au)}`);
