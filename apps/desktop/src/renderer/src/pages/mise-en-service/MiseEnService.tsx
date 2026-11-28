import { ErreurImport, FEUILLES_IMPORT, ResultatImport } from '@somidac/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Message } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { lireClasseur } from '../../exports/lecture-xlsx';
import { formaterMontant, formaterNombre } from '../../format';
import { creerModele, Lecture, lireFichierDepart, normaliserNom } from './modele';

interface Etape {
  cle: string;
  titre: string;
  fait: boolean;
  detail: string;
  lien: string;
  facultative?: boolean;
}
interface Etat {
  etapes: Etape[];
  faites: number;
  total: number;
  termine: boolean;
}

function ListeErreurs({ titre, liste, type }: { titre: string; liste: ErreurImport[]; type: 'erreur' | 'attention' }) {
  if (!liste.length) return null;
  return (
    <div className="carte" style={{ marginTop: 12 }}>
      <div className="entete-carte">
        <h3 style={{ color: type === 'erreur' ? 'var(--danger)' : 'var(--alerte)' }}>{titre} ({liste.length})</h3>
      </div>
      <table className="tableau">
        <thead>
          <tr><th style={{ width: 170 }}>Feuille</th><th style={{ width: 80 }} className="nombre">Ligne</th><th>Problème</th></tr>
        </thead>
        <tbody>
          {liste.slice(0, 200).map((e, i) => (
            <tr key={i}>
              <td>{FEUILLES_IMPORT[e.feuille]}</td>
              <td className="nombre">{e.ligne}</td>
              <td>{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {liste.length > 200 && <div className="vide">… et {liste.length - 200} autre(s)</div>}
    </div>
  );
}

/** Import du fichier Excel de départ : modèle, vérification, puis import tout ou rien. */
function Import({ onImporte }: { onImporte: () => void }) {
  const { appeler } = useSession();
  const champ = useRef<HTMLInputElement>(null);
  const [nomFichier, setNomFichier] = useState<string>();
  const [lecture, setLecture] = useState<Lecture>();
  const [resultat, setResultat] = useState<ResultatImport>();
  const [erreur, setErreur] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [envoi, setEnvoi] = useState(false);

  const telechargerModele = async () => {
    setInfo(undefined);
    const r = await window.somidac.documents.enregistrerFichier('SOMIDAC-fichier-de-depart', 'xlsx', creerModele());
    if (!r.ok) setErreur(r.message);
    else if (r.valeur) setInfo(`Modèle enregistré : ${r.valeur}. Remplissez-le dans Excel, puis choisissez-le ci-dessous.`);
  };

  const choisir = async (fichier?: File) => {
    if (!fichier) return;
    setErreur(undefined);
    setInfo(undefined);
    setResultat(undefined);
    setLecture(undefined);
    setNomFichier(fichier.name);
    setEnvoi(true);
    try {
      const feuilles = await lireClasseur(await fichier.arrayBuffer());
      const categories = await appeler<{ nom: string; type: string }[]>('GET', '/categories');
      const l = lireFichierDepart(feuilles, new Map(categories.map((c) => [normaliserNom(c.nom), c.type])));
      setLecture(l);
      if (!l.feuillesTrouvees.length) throw new Error('Aucune feuille reconnue : utilisez le modèle SOMIDAC (feuilles Produits, Fournisseurs, Clients, Stock d’ouverture).');
      // Le serveur vérifie aussi les lignes lisibles : toutes les erreurs apparaissent d'un coup.
      const r = await appeler<ResultatImport>('POST', '/mise-en-service/import', { ...l.dto, verifierSeulement: true });
      // Un produit écarté pour une erreur de saisie ferait apparaître ses lignes de stock comme « introuvables ».
      const ecartes = new Set(l.erreurs.filter((e) => e.feuille === 'produits').map((e) => e.ligne));
      const nomsEcartes = feuilles
        .find((f) => normaliserNom(f.nom) === 'produits')
        ?.lignes.filter((x) => ecartes.has(x.numero))
        .map((x) => String(x.cellules[0] ?? ''));
      setResultat({ ...r, erreurs: r.erreurs.filter((e) => !(e.feuille === 'stock' && nomsEcartes?.some((n) => n && e.message.includes(`« ${n} »`)))) });
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  const importer = async () => {
    if (!lecture) return;
    setEnvoi(true);
    setErreur(undefined);
    try {
      const r = await appeler<ResultatImport>('POST', '/mise-en-service/import', { ...lecture.dto, verifierSeulement: false });
      setResultat(r);
      if (r.enregistre) {
        setInfo('Import terminé : les données sont enregistrées.');
        onImporte();
      }
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  const c = resultat?.compte;
  return (
    <div className="carte">
      <div className="entete-carte">
        <div>
          <h3>Fichier Excel de départ</h3>
          <div className="secondaire" style={{ color: 'var(--texte-3)', fontSize: 12, marginTop: 2 }}>Produits, fournisseurs, clients et stock d’ouverture en une seule fois</div>
        </div>
      </div>
      <div className="corps" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ol className="etapes-import">
          <li>
            <strong>Téléchargez le modèle</strong> et remplissez-le dans Excel (des exemples montrent le format attendu).
            <button className="bouton secondaire petit" style={{ marginLeft: 10 }} onClick={() => void telechargerModele()}>Télécharger le modèle Excel</button>
          </li>
          <li>
            <strong>Choisissez le fichier rempli</strong> : tout est vérifié, rien n’est encore enregistré.
            <button className="bouton secondaire petit" style={{ marginLeft: 10 }} disabled={envoi} onClick={() => champ.current?.click()}>Choisir le fichier…</button>
            <input ref={champ} type="file" accept=".xlsx" hidden onChange={(e) => { void choisir(e.target.files?.[0]); e.target.value = ''; }} />
            {nomFichier && <span className="secondaire" style={{ marginLeft: 10, color: 'var(--texte-2)' }}>{nomFichier}</span>}
          </li>
          <li><strong>Importez</strong> quand il n’y a plus d’erreur : tout est enregistré d’un coup, ou rien.</li>
        </ol>
        <Message type="erreur">{erreur}</Message>
        <Message type="succes">{info}</Message>
        {envoi && <div className="vide" style={{ padding: 12 }}>Vérification en cours…</div>}
        {c && (
          <div className="grille-cartes">
            <div className="carte indicateur"><div className="libelle">Produits</div><div className="valeur">{formaterNombre(c.produits)}</div><div className="detail">{c.categories} catégorie(s), {c.marques} marque(s) nouvelles</div></div>
            <div className="carte indicateur"><div className="libelle">Fournisseurs et clients</div><div className="valeur">{c.fournisseurs} + {c.clients}</div></div>
            <div className="carte indicateur"><div className="libelle">Stock d’ouverture</div><div className="valeur">{formaterNombre(c.piecesStock)} pièces</div><div className="detail">{c.lignesStock} ligne(s) · valeur {formaterMontant(c.valeurStock)}</div></div>
          </div>
        )}
        {resultat && !resultat.enregistre && resultat.valide && !lecture?.erreurs.length && (
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <Message type="info">Le fichier est correct{resultat.avertissements.length ? ` (${resultat.avertissements.length} remarque(s) ci-dessous)` : ''}. Rien n’est encore enregistré.</Message>
            <button className="bouton" disabled={envoi} onClick={() => void importer()}>Importer maintenant</button>
          </div>
        )}
        {resultat && (!resultat.valide || !!lecture?.erreurs.length) && <Message type="erreur">Le fichier contient des erreurs : corrigez-les dans Excel, enregistrez, puis choisissez à nouveau le fichier. Rien n’a été enregistré.</Message>}
      </div>
      {lecture && <div style={{ padding: '0 20px 20px' }}><ListeErreurs titre="Erreurs de saisie" liste={lecture.erreurs} type="erreur" /></div>}
      {resultat && (
        <div style={{ padding: '0 20px 20px' }}>
          <ListeErreurs titre="Erreurs" liste={resultat.erreurs} type="erreur" />
          <ListeErreurs titre="Remarques" liste={resultat.avertissements} type="attention" />
        </div>
      )}
    </div>
  );
}

/** Mise en service chez SOMIDAC (lot 6) : liste de contrôle et import du fichier de départ. */
export function MiseEnService() {
  const { appeler } = useSession();
  const [etat, setEtat] = useState<Etat>();
  const [erreur, setErreur] = useState<string>();
  const charger = useCallback(() => {
    appeler<Etat>('GET', '/mise-en-service').then(setEtat).catch((e) => setErreur(messageErreur(e)));
  }, [appeler]);
  useEffect(charger, [charger]);

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Mise en service</h1>
          <p>Les étapes pour démarrer avec SOMIDAC. Elles se cochent toutes seules quand c’est fait.</p>
        </div>
        {etat && (
          <div className="avancement">
            <span>{etat.faites} / {etat.total}</span>
            <div className="barre-progression" style={{ width: 160 }}><div style={{ width: `${(etat.faites / etat.total) * 100}%` }} /></div>
          </div>
        )}
      </div>
      <Message type="erreur">{erreur}</Message>
      {etat?.termine && <div style={{ marginBottom: 16 }}><Message type="succes">Mise en service terminée : SOMIDAC est prêt pour le travail quotidien.</Message></div>}
      <div className="liste-etapes">
        {etat?.etapes.map((e, i) => (
          <a key={e.cle} className={`etape ${e.fait ? 'faite' : ''}`} href={e.lien}>
            <span className="pastille-etape">{e.fait ? '✓' : i + 1}</span>
            <span>
              <strong>{e.titre}</strong>
              {e.facultative && <span className="secondaire"> (facultatif)</span>}
              <span className="detail-etape">{e.detail}</span>
            </span>
          </a>
        ))}
      </div>
      <div style={{ height: 16 }} />
      <Import onImporte={charger} />
    </>
  );
}
