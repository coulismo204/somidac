import { PERMISSIONS, TYPES_COMPTES, TYPES_OPERATIONS_TRESORERIE, TypeCompte } from '@somidac/shared';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Champ, Icone, Message, Modale } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { aujourdhuiIso, formaterJour, formaterMontant } from '../../format';
import { Cloture } from './Cloture';
import { Depenses, Encaissements, Fournisseurs } from './Operations';
import { ChoixCompte, Compte } from './Paiements';

interface Operation {
  id: string;
  date: string;
  type: keyof typeof TYPES_OPERATIONS_TRESORERIE;
  libelle: string;
  montant: number;
  soldeApres: number | null;
  utilisateur: string | null;
}

const debutMois = () => `${aujourdhuiIso().slice(0, 8)}01`;

function FicheCompte({ compte, onFermer }: { compte?: Compte; onFermer: (fait: boolean) => void }) {
  const { appeler } = useSession();
  const [f, setF] = useState({ nom: compte?.nom ?? '', type: compte?.type ?? ('mobile_money' as TypeCompte), reference: compte?.reference ?? '', soldeInitial: compte?.soldeInitial ?? 0, actif: compte?.actif ?? true });
  const [erreur, setErreur] = useState<string>();
  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    try {
      const corps = { ...f, reference: f.reference || null, soldeInitial: Number(f.soldeInitial) || 0 };
      if (compte) await appeler('PUT', `/tresorerie/comptes/${compte.id}`, corps);
      else await appeler('POST', '/tresorerie/comptes', corps);
      onFermer(true);
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };
  return (
    <Modale titre={compte ? compte.nom : 'Nouveau compte'} onFermer={() => onFermer(false)}>
      <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="grille-champs">
          <Champ className="pleine" libelle="Nom" value={f.nom} placeholder="Orange Money, Wave, Banque XYZ…" onChange={(e) => setF({ ...f, nom: e.target.value })} required autoFocus />
          <div className="champ">
            <label htmlFor="type-compte">Type</label>
            <select id="type-compte" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as TypeCompte })}>
              {(Object.keys(TYPES_COMPTES) as TypeCompte[]).map((t) => <option key={t} value={t}>{TYPES_COMPTES[t]}</option>)}
            </select>
          </div>
          <Champ libelle={f.type === 'banque' ? 'N° de compte' : f.type === 'mobile_money' ? 'Numéro' : 'Référence'} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          <Champ libelle="Solde d’ouverture (FCFA)" aide="Modifiable tant que le compte n’a servi à aucune opération." type="number" min={0} value={f.soldeInitial} onChange={(e) => setF({ ...f, soldeInitial: Number(e.target.value) })} />
          {compte && (
            <label className="case">
              <input type="checkbox" checked={f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} /> Compte utilisé
            </label>
          )}
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

/** Soldes des comptes et journal de chacun (§5.6, §5.7 « journal de caisse et de chaque compte »). */
function Comptes() {
  const { appeler, peut } = useSession();
  const [comptes, setComptes] = useState<Compte[]>();
  const [choisi, setChoisi] = useState<string>();
  // Par défaut, le premier compte dont le journal est visible.
  const [du, setDu] = useState(debutMois());
  const [au, setAu] = useState(aujourdhuiIso());
  const [journal, setJournal] = useState<{ operations: Operation[]; entrees: number; sorties: number }>();
  const [edition, setEdition] = useState<Compte | 'nouveau'>();
  const [erreur, setErreur] = useState<string>();

  const charger = useCallback(async () => {
    try {
      const c = await appeler<Compte[]>('GET', '/tresorerie/comptes?inactifs=1');
      setComptes(c);
      setChoisi((x) => x ?? (c.find((y) => y.actif && !y.soldeMasque) ?? c[0])?.id);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler]);
  useEffect(() => void charger(), [charger]);
  useEffect(() => {
    setJournal(undefined);
    if (!choisi || comptes?.find((c) => c.id === choisi)?.soldeMasque) return;
    appeler<{ operations: Operation[]; entrees: number; sorties: number }>('GET', `/tresorerie/comptes/${choisi}/journal?du=${du}&au=${au}`).then(setJournal).catch((e) => setErreur(messageErreur(e)));
  }, [appeler, choisi, du, au, comptes]);

  const compte = comptes?.find((c) => c.id === choisi);
  return (
    <>
      <Message type="erreur">{erreur}</Message>
      {peut(PERMISSIONS.ADMIN_PARAMETRES) && (
        <div className="barre-outils" style={{ justifyContent: 'flex-end', marginTop: -6 }}>
          <button className="bouton secondaire petit" onClick={() => setEdition('nouveau')}><Icone nom="plus" taille={14} /> Ajouter un compte (Mobile Money, banque)</button>
        </div>
      )}
      <div className="grille-cartes" style={{ marginBottom: 16 }}>
        {(comptes ?? []).filter((c) => c.actif).map((c) => (
          <button key={c.id} className={`carte indicateur compte-carte ${c.id === choisi ? 'actif' : ''}`} onClick={() => setChoisi(c.id)}>
            <div className="libelle">{c.nom}</div>
            <div className="valeur">{c.solde == null ? '•••••' : formaterMontant(c.solde)}</div>
            <div className="detail">
              {c.soldeMasque ? 'Visible du gérant (clôture à l’aveugle)' : [c.type !== 'caisse' || c.nom !== TYPES_COMPTES.caisse ? TYPES_COMPTES[c.type] : null, c.reference].filter(Boolean).join(' · ') || 'Espèces'}
            </div>
          </button>
        ))}
      </div>

      {compte?.soldeMasque && (
        <Message type="info">Le journal de la caisse est réservé au gérant : le montant attendu reste inconnu jusqu’à la clôture. Choisissez un autre compte pour voir son journal.</Message>
      )}
      {compte && !compte.soldeMasque && (
        <div className="carte">
          <div className="entete-carte">
            <h3>Journal : {compte.nom}</h3>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <label className="periode">Du <input type="date" value={du} max={au} onChange={(e) => e.target.value && setDu(e.target.value)} /></label>
              <label className="periode">au <input type="date" value={au} min={du} onChange={(e) => e.target.value && setAu(e.target.value)} /></label>
              {peut(PERMISSIONS.ADMIN_PARAMETRES) && <button className="bouton secondaire petit" onClick={() => setEdition(compte)}>Modifier le compte</button>}
            </div>
          </div>
          {journal && (
            <div className="totaux" style={{ justifyContent: 'start', gridTemplateColumns: 'auto auto auto auto', borderBottom: '1px solid var(--bord)' }}>
              <span>Entrées</span><span className="nombre montant-entree">+ {formaterMontant(journal.entrees)}</span>
              <span style={{ marginLeft: 24 }}>Sorties</span><span className="nombre montant-sortie">- {formaterMontant(journal.sorties)}</span>
            </div>
          )}
          {!journal ? (
            <div className="vide">Chargement…</div>
          ) : journal.operations.length === 0 ? (
            <div className="vide">Aucune opération sur cette période.</div>
          ) : (
            <table className="tableau">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Date</th>
                  <th>Opération</th>
                  <th className="nombre">Entrée</th>
                  <th className="nombre">Sortie</th>
                  {!compte.soldeMasque && <th className="nombre">Solde</th>}
                  <th>Par</th>
                </tr>
              </thead>
              <tbody>
                {journal.operations.map((o) => (
                  <tr key={o.id}>
                    <td className="sans-retour">
                      {new Date(o.date).toLocaleDateString('fr-FR')}
                      <div className="secondaire">{new Date(o.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td>
                      {o.libelle}
                      <div className="secondaire">{TYPES_OPERATIONS_TRESORERIE[o.type]}</div>
                    </td>
                    <td className="nombre montant-entree">{o.montant > 0 ? formaterMontant(o.montant) : ''}</td>
                    <td className="nombre montant-sortie">{o.montant < 0 ? formaterMontant(-o.montant) : ''}</td>
                    {!compte.soldeMasque && <td className="nombre">{formaterMontant(o.soldeApres)}</td>}
                    <td className="sans-retour">{o.utilisateur ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {edition && <FicheCompte compte={edition === 'nouveau' ? undefined : edition} onFermer={(fait) => { setEdition(undefined); if (fait) void charger(); }} />}
    </>
  );
}

interface LigneTransfert {
  id: string;
  date: string;
  montant: number;
  libelle: string | null;
  source: string;
  destination: string;
  par: string | null;
}

function Transferts() {
  const { appeler } = useSession();
  const [liste, setListe] = useState<LigneTransfert[]>();
  const [comptes, setComptes] = useState<Compte[]>([]);
  const [nouveau, setNouveau] = useState(false);
  const [f, setF] = useState({ compteSourceId: '', compteDestinationId: '', montant: 0, libelle: '' });
  const [erreur, setErreur] = useState<string>();
  const charger = useCallback(() => {
    appeler<LigneTransfert[]>('GET', '/tresorerie/transferts').then(setListe).catch((e) => setErreur(messageErreur(e)));
    appeler<Compte[]>('GET', '/tresorerie/comptes').then(setComptes).catch(() => undefined);
  }, [appeler]);
  useEffect(charger, [charger]);
  const valider = async () => {
    setErreur(undefined);
    try {
      await appeler('POST', '/tresorerie/transferts', { ...f, montant: Number(f.montant), libelle: f.libelle || null });
      setNouveau(false);
      setF({ compteSourceId: '', compteDestinationId: '', montant: 0, libelle: '' });
      charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };
  return (
    <>
      <div className="barre-outils" style={{ justifyContent: 'space-between' }}>
        <p style={{ color: 'var(--texte-2)' }}>Par exemple un dépôt d’espèces à la banque, ou un retrait Mobile Money.</p>
        <button className="bouton" onClick={() => setNouveau(true)}><Icone nom="plus" /> Nouveau transfert</button>
      </div>
      <Message type="erreur">{!nouveau ? erreur : undefined}</Message>
      <div className="carte">
        {!liste ? (
          <div className="vide">Chargement…</div>
        ) : liste.length === 0 ? (
          <div className="vide">Aucun transfert.</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr><th>Date</th><th>De</th><th>Vers</th><th>Libellé</th><th className="nombre">Montant</th><th>Par</th></tr>
            </thead>
            <tbody>
              {liste.map((t) => (
                <tr key={t.id}>
                  <td>{formaterJour(t.date)}</td>
                  <td>{t.source}</td>
                  <td>{t.destination}</td>
                  <td>{t.libelle ?? <span className="secondaire">-</span>}</td>
                  <td className="nombre">{formaterMontant(t.montant)}</td>
                  <td>{t.par ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {nouveau && (
        <Modale
          titre="Transfert entre comptes"
          onFermer={() => setNouveau(false)}
          pied={
            <>
              <button className="bouton secondaire" onClick={() => setNouveau(false)}>Annuler</button>
              <button className="bouton" disabled={!f.compteSourceId || !f.compteDestinationId || Number(f.montant) <= 0} onClick={() => void valider()}>Transférer</button>
            </>
          }
        >
          <div className="grille-champs">
            <div className="champ"><label htmlFor="source">Depuis</label><ChoixCompte id="source" comptes={comptes} valeur={f.compteSourceId} onChange={(v) => setF({ ...f, compteSourceId: v })} /></div>
            <div className="champ"><label htmlFor="destination">Vers</label><ChoixCompte id="destination" comptes={comptes.filter((c) => c.id !== f.compteSourceId)} valeur={f.compteDestinationId} onChange={(v) => setF({ ...f, compteDestinationId: v })} /></div>
            <Champ libelle="Montant (FCFA)" type="number" min={1} value={f.montant || ''} onChange={(e) => setF({ ...f, montant: Number(e.target.value) })} />
            <Champ libelle="Libellé" value={f.libelle} placeholder="Dépôt à la banque…" onChange={(e) => setF({ ...f, libelle: e.target.value })} />
          </div>
          <Message type="erreur">{erreur}</Message>
        </Modale>
      )}
    </>
  );
}

type Onglet = 'comptes' | 'encaissements' | 'fournisseurs' | 'depenses' | 'transferts' | 'cloture';

/** Module « Trésorerie » (§5.6). */
export function Tresorerie() {
  const { peut } = useSession();
  const [onglet, setOnglet] = useState<Onglet>('comptes');
  const onglets: [Onglet, string, boolean][] = [
    ['comptes', 'Comptes', true],
    ['encaissements', 'Encaissements', true],
    ['fournisseurs', 'Paiements fournisseurs', peut(PERMISSIONS.ACHATS_SAISIR)],
    ['depenses', 'Dépenses', true],
    ['transferts', 'Transferts', true],
    ['cloture', 'Clôture de caisse', peut(PERMISSIONS.CAISSE_CLOTURER)],
  ];
  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Trésorerie</h1>
          <p>Caisse, Mobile Money et banque : chaque franc qui entre ou qui sort, avec son justificatif.</p>
        </div>
      </div>
      <div className="onglets">
        {onglets.filter(([, , visible]) => visible).map(([o, l]) => (
          <button key={o} className={onglet === o ? 'actif' : ''} onClick={() => setOnglet(o)}>{l}</button>
        ))}
      </div>
      {onglet === 'comptes' && <Comptes />}
      {onglet === 'encaissements' && <Encaissements />}
      {onglet === 'fournisseurs' && <Fournisseurs />}
      {onglet === 'depenses' && <Depenses />}
      {onglet === 'transferts' && <Transferts />}
      {onglet === 'cloture' && <Cloture />}
    </>
  );
}
