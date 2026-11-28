import { PERMISSIONS, TYPES_CLIENTS, TypeClient } from '@somidac/shared';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Champ, Icone, Message, Modale } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterMontant } from '../../format';
import type { Produit } from '../produits/FicheProduit';

export interface Client {
  id: string;
  code: string;
  raisonSociale: string;
  type: TypeClient;
  contact: string | null;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  nif: string | null;
  conditionPaiement: 'comptant' | 'credit';
  delaiPaiementJours: number;
  blSansPrix: boolean;
  notes: string | null;
  actif: boolean;
  resteDu: number;
}

interface PrixParticulier {
  conditionnementId: string;
  prix: number;
  produit: string;
  codeProduit: string;
  conditionnement: string;
  prixDefaut: number | null;
}

/** Prix particuliers du client (R3) : ils remplacent le prix par défaut du conditionnement. */
function PrixClient({ client }: { client: Client }) {
  const { appeler, peut } = useSession();
  const modifiable = peut(PERMISSIONS.PRIX_MODIFIER);
  const [lignes, setLignes] = useState<PrixParticulier[]>();
  const [produits, setProduits] = useState<Produit[]>([]);
  const [ajout, setAjout] = useState('');
  const [erreur, setErreur] = useState<string>();
  const [info, setInfo] = useState<string>();

  useEffect(() => {
    appeler<{ prix: PrixParticulier[] }>('GET', `/clients/${client.id}`).then((c) => setLignes(c.prix)).catch((e) => setErreur(messageErreur(e)));
    if (modifiable) appeler<Produit[]>('GET', '/produits').then(setProduits).catch(() => undefined);
  }, [appeler, client.id, modifiable]);

  const options = useMemo(
    () => produits.flatMap((p) => p.conditionnements.filter((c) => c.actif).map((c) => ({ libelle: `${p.code} - ${p.designation} - ${c.nom}`, p, c }))),
    [produits],
  );
  const ajouter = (texte: string) => {
    const o = options.find((x) => x.libelle === texte);
    if (!o || !lignes || lignes.some((l) => l.conditionnementId === o.c.id)) return;
    setLignes([...lignes, { conditionnementId: o.c.id, prix: o.c.prixVente ?? 0, produit: o.p.designation, codeProduit: o.p.code, conditionnement: o.c.nom, prixDefaut: o.c.prixVente }]);
    setAjout('');
  };
  const enregistrer = async () => {
    setErreur(undefined);
    setInfo(undefined);
    try {
      setLignes(await appeler<PrixParticulier[]>('PUT', `/clients/${client.id}/prix`, { prix: (lignes ?? []).map((l) => ({ conditionnementId: l.conditionnementId, prix: Number(l.prix) || 0 })) }));
      setInfo('Prix enregistrés. Ils s’appliquent aux prochains bons de livraison.');
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  if (!lignes) return <div className="vide">Chargement…</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {modifiable && (
        <div>
          <input
            list="prix-options"
            className="recherche"
            style={{ width: '100%', height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--bord)' }}
            placeholder="Ajouter un produit : tapez son nom ou son code"
            value={ajout}
            onChange={(e) => {
              setAjout(e.target.value);
              ajouter(e.target.value);
            }}
          />
          <datalist id="prix-options">{options.map((o) => <option key={o.c.id} value={o.libelle} />)}</datalist>
        </div>
      )}
      {lignes.length === 0 ? (
        <div className="vide" style={{ padding: 20 }}>Aucun prix particulier.</div>
      ) : (
        <table className="tableau">
          <thead>
            <tr>
              <th>Produit</th>
              <th className="nombre">Prix par défaut</th>
              <th className="nombre" style={{ width: 140 }}>Prix du client</th>
              {modifiable && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={l.conditionnementId}>
                <td>
                  <strong>{l.produit}</strong>
                  <div className="secondaire">{l.codeProduit} · {l.conditionnement}</div>
                </td>
                <td className="nombre">{formaterMontant(l.prixDefaut)}</td>
                <td className="serre">
                  {modifiable ? (
                    <input className="nombre" type="number" min={0} value={l.prix} onChange={(e) => setLignes(lignes.map((x, n) => (n === i ? { ...x, prix: Number(e.target.value) } : x)))} />
                  ) : (
                    <span className="nombre">{formaterMontant(l.prix)}</span>
                  )}
                </td>
                {modifiable && (
                  <td className="serre">
                    <button className="bouton discret petit" aria-label="Retirer" onClick={() => setLignes(lignes.filter((_, n) => n !== i))}><Icone nom="fermer" taille={14} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Message type="erreur">{erreur}</Message>
      <Message type="succes">{info}</Message>
      {modifiable && (
        <div className="actions">
          <button className="bouton" onClick={() => void enregistrer()}>Enregistrer les prix</button>
        </div>
      )}
    </div>
  );
}

function FicheClient({ client, creditActif, onFermer }: { client?: Client; creditActif: boolean; onFermer: (modifie: boolean) => void }) {
  const { appeler } = useSession();
  const [onglet, setOnglet] = useState<'fiche' | 'prix'>('fiche');
  const [f, setF] = useState({
    raisonSociale: client?.raisonSociale ?? '',
    type: client?.type ?? ('supermarche' as TypeClient),
    contact: client?.contact ?? '',
    telephone: client?.telephone ?? '',
    email: client?.email ?? '',
    adresse: client?.adresse ?? '',
    nif: client?.nif ?? '',
    conditionPaiement: client?.conditionPaiement ?? 'comptant',
    delaiPaiementJours: client?.delaiPaiementJours ?? 0,
    blSansPrix: client?.blSansPrix ?? false,
    notes: client?.notes ?? '',
    actif: client?.actif ?? true,
  });
  const [erreur, setErreur] = useState<string>();

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    try {
      const corps = { ...f, delaiPaiementJours: Number(f.delaiPaiementJours) || 0 };
      if (client) await appeler('PUT', `/clients/${client.id}`, corps);
      else await appeler('POST', '/clients', corps);
      onFermer(true);
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  return (
    <Modale titre={client ? `${client.code} - ${client.raisonSociale}` : 'Nouveau client'} onFermer={() => onFermer(false)} large>
      {client && (
        <div className="onglets" style={{ marginBottom: 0 }}>
          <button className={onglet === 'fiche' ? 'actif' : ''} onClick={() => setOnglet('fiche')}>Fiche</button>
          <button className={onglet === 'prix' ? 'actif' : ''} onClick={() => setOnglet('prix')}>Prix particuliers</button>
        </div>
      )}
      {onglet === 'prix' && client ? (
        <PrixClient client={client} />
      ) : (
        <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="grille-champs">
            <Champ className="pleine" libelle="Raison sociale" value={f.raisonSociale} onChange={(e) => setF({ ...f, raisonSociale: e.target.value })} required autoFocus />
            <div className="champ">
              <label htmlFor="type-client">Type</label>
              <select id="type-client" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as TypeClient })}>
                {Object.entries(TYPES_CLIENTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <Champ libelle="Personne à contacter" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
            <Champ libelle="Téléphone" value={f.telephone} onChange={(e) => setF({ ...f, telephone: e.target.value })} />
            <Champ libelle="E-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <Champ className="pleine" libelle="Adresse" value={f.adresse} onChange={(e) => setF({ ...f, adresse: e.target.value })} />
            <Champ libelle="NIF" value={f.nif} onChange={(e) => setF({ ...f, nif: e.target.value })} />
            <div className="champ">
              <label htmlFor="paiement">Condition de paiement</label>
              <select id="paiement" value={f.conditionPaiement} onChange={(e) => setF({ ...f, conditionPaiement: e.target.value as 'comptant' | 'credit' })}>
                <option value="comptant">Comptant (à la livraison)</option>
                {(creditActif || f.conditionPaiement === 'credit') && <option value="credit">À crédit</option>}
              </select>
            </div>
            {f.conditionPaiement === 'credit' && (
              <Champ libelle="Délai de paiement (jours)" type="number" min={0} max={180} value={f.delaiPaiementJours} onChange={(e) => setF({ ...f, delaiPaiementJours: Number(e.target.value) })} />
            )}
            <label className="case pleine">
              <input type="checkbox" checked={f.blSansPrix} onChange={(e) => setF({ ...f, blSansPrix: e.target.checked })} />
              Imprimer ses bons de livraison sans les prix
            </label>
            <div className="champ pleine">
              <label htmlFor="notes-client">Notes</label>
              <textarea id="notes-client" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </div>
            {client && (
              <label className="case pleine">
                <input type="checkbox" checked={f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} />
                Client actif (décochez pour l’archiver : il reste dans l’historique)
              </label>
            )}
          </div>
          <Message type="erreur">{erreur}</Message>
          <div className="actions">
            <button type="button" className="bouton secondaire" onClick={() => onFermer(false)}>Annuler</button>
            <button className="bouton">Enregistrer</button>
          </div>
        </form>
      )}
    </Modale>
  );
}

export function Clients() {
  const { appeler } = useSession();
  const [liste, setListe] = useState<Client[]>();
  const [recherche, setRecherche] = useState('');
  const [inactifs, setInactifs] = useState(false);
  const [edition, setEdition] = useState<Client | 'nouveau'>();
  const [creditActif, setCreditActif] = useState(false);
  const [erreur, setErreur] = useState<string>();

  const charger = useCallback(async () => {
    try {
      setListe(await appeler<Client[]>('GET', `/clients${inactifs ? '?inactifs=1' : ''}`));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler, inactifs]);
  useEffect(() => {
    void charger();
    appeler<{ modulesActifs: string[] }>('GET', '/parametres').then((p) => setCreditActif(p.modulesActifs.includes('credit_client'))).catch(() => undefined);
  }, [charger, appeler]);

  const t = recherche.trim().toLowerCase();
  const filtres = (liste ?? []).filter((c) => !t || c.raisonSociale.toLowerCase().includes(t) || c.code.toLowerCase().includes(t) || (c.telephone ?? '').includes(t));

  return (
    <>
      <div className="barre-outils">
        <input className="recherche" placeholder="Rechercher un client (nom, code, téléphone)" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        <label className="case">
          <input type="checkbox" checked={inactifs} onChange={(e) => setInactifs(e.target.checked)} /> Archivés
        </label>
        <button className="bouton" onClick={() => setEdition('nouveau')}>
          <Icone nom="plus" /> Nouveau client
        </button>
      </div>
      <Message type="erreur">{erreur}</Message>
      <div className="carte">
        {!liste ? (
          <div className="vide">Chargement…</div>
        ) : filtres.length === 0 ? (
          <div className="vide">{liste.length ? 'Aucun client ne correspond.' : 'Aucun client. Commencez par « Nouveau client » (par exemple Bon Prix).'}</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Client</th>
                <th>Type</th>
                <th>Téléphone</th>
                <th>Paiement</th>
                <th className="nombre">Reste dû</th>
              </tr>
            </thead>
            <tbody>
              {filtres.map((c) => (
                <tr key={c.id} className="cliquable" onClick={() => setEdition(c)}>
                  <td>
                    <strong>{c.raisonSociale}</strong>
                    {!c.actif && <span className="pastille grise" style={{ marginLeft: 8 }}>Archivé</span>}
                    <div className="secondaire">{c.code}{c.nif ? ` · NIF ${c.nif}` : ''}</div>
                  </td>
                  <td>{TYPES_CLIENTS[c.type]}</td>
                  <td>{c.telephone ?? '-'}</td>
                  <td>{c.conditionPaiement === 'credit' ? `Crédit ${c.delaiPaiementJours} j` : 'Comptant'}</td>
                  <td className="nombre">{c.resteDu > 0 ? <strong>{formaterMontant(c.resteDu)}</strong> : formaterMontant(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edition && (
        <FicheClient
          client={edition === 'nouveau' ? undefined : edition}
          creditActif={creditActif}
          onFermer={(modifie) => {
            setEdition(undefined);
            if (modifie) void charger();
          }}
        />
      )}
    </>
  );
}
