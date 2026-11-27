import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Champ, Icone, Message, Modale } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterMontant } from '../../format';

export interface Fournisseur {
  id: string;
  nom: string;
  telephone: string | null;
  adresse: string | null;
  nif: string | null;
  notes: string | null;
  actif: boolean;
  resteDu: number;
}

export function Fournisseurs() {
  const { appeler } = useSession();
  const [liste, setListe] = useState<Fournisseur[]>();
  const [edition, setEdition] = useState<Partial<Fournisseur>>();
  const [erreur, setErreur] = useState<string>();

  const charger = useCallback(async () => {
    try {
      setListe(await appeler<Fournisseur[]>('GET', '/fournisseurs'));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler]);
  useEffect(() => {
    void charger();
  }, [charger]);

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    if (!edition) return;
    setErreur(undefined);
    try {
      const corps = { nom: edition.nom, telephone: edition.telephone, adresse: edition.adresse, nif: edition.nif, notes: edition.notes, actif: edition.actif ?? true };
      if (edition.id) await appeler('PUT', `/fournisseurs/${edition.id}`, corps);
      else await appeler('POST', '/fournisseurs', corps);
      setEdition(undefined);
      await charger();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  return (
    <>
      <div className="barre-outils" style={{ justifyContent: 'flex-end' }}>
        <button className="bouton" onClick={() => setEdition({ actif: true })}>
          <Icone nom="plus" /> Nouveau fournisseur
        </button>
      </div>
      <Message type="erreur">{!edition ? erreur : undefined}</Message>
      <div className="carte">
        {!liste ? (
          <div className="vide">Chargement…</div>
        ) : liste.length === 0 ? (
          <div className="vide">Aucun fournisseur pour l'instant.</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Fournisseur</th>
                <th>Téléphone</th>
                <th>NIF</th>
                <th className="nombre">Reste dû</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((f) => (
                <tr key={f.id} className="cliquable" onClick={() => setEdition(f)}>
                  <td>
                    <strong>{f.nom}</strong>
                    {!f.actif && <span className="pastille grise" style={{ marginLeft: 8 }}>Désactivé</span>}
                    {f.adresse && <div className="secondaire">{f.adresse}</div>}
                  </td>
                  <td>{f.telephone ?? '-'}</td>
                  <td>{f.nif ?? '-'}</td>
                  <td className="nombre">{f.resteDu > 0 ? <strong>{formaterMontant(f.resteDu)}</strong> : formaterMontant(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edition && (
        <Modale titre={edition.id ? edition.nom ?? 'Fournisseur' : 'Nouveau fournisseur'} onFermer={() => setEdition(undefined)}>
          <form onSubmit={enregistrer} className="grille-champs">
            <Champ className="pleine" libelle="Nom" value={edition.nom ?? ''} onChange={(e) => setEdition({ ...edition, nom: e.target.value })} required autoFocus />
            <Champ libelle="Téléphone" value={edition.telephone ?? ''} onChange={(e) => setEdition({ ...edition, telephone: e.target.value })} />
            <Champ libelle="NIF" value={edition.nif ?? ''} onChange={(e) => setEdition({ ...edition, nif: e.target.value })} />
            <Champ className="pleine" libelle="Adresse" value={edition.adresse ?? ''} onChange={(e) => setEdition({ ...edition, adresse: e.target.value })} />
            <Champ className="pleine" libelle="Notes" value={edition.notes ?? ''} onChange={(e) => setEdition({ ...edition, notes: e.target.value })} />
            {edition.id && (
              <label className="case pleine">
                <input type="checkbox" checked={edition.actif ?? true} onChange={(e) => setEdition({ ...edition, actif: e.target.checked })} /> Fournisseur actif
              </label>
            )}
            <div className="pleine"><Message type="erreur">{erreur}</Message></div>
            <div className="pleine actions">
              <button type="button" className="bouton secondaire" onClick={() => setEdition(undefined)}>Annuler</button>
              <button className="bouton">Enregistrer</button>
            </div>
          </form>
        </Modale>
      )}
    </>
  );
}
