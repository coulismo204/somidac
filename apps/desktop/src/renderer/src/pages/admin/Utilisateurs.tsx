import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Champ, Icone, Message, Modale } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterDateHeure, relatif } from '../../format';

interface Utilisateur {
  id: string;
  identifiant: string;
  nomComplet: string;
  actif: boolean;
  roles: string[];
  plafondRemisePct: number;
  doitChangerMotDePasse: boolean;
  bloqueJusquA: string | null;
  derniereConnexion: string | null;
}

interface Role {
  id: string;
  code: string;
  libelle: string;
}

function ChoixRoles({ roles, choisis, onChange }: { roles: Role[]; choisis: string[]; onChange: (r: string[]) => void }) {
  return (
    <div className="champ">
      <label>Rôles</label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {roles.map((r) => (
          <label key={r.code} className="case">
            <input
              type="checkbox"
              checked={choisis.includes(r.code)}
              onChange={(e) => onChange(e.target.checked ? [...choisis, r.code] : choisis.filter((c) => c !== r.code))}
            />
            {r.libelle}
          </label>
        ))}
      </div>
    </div>
  );
}

export function Utilisateurs() {
  const { appeler, profil } = useSession();
  const [liste, setListe] = useState<Utilisateur[]>();
  const [roles, setRoles] = useState<Role[]>([]);
  const [erreur, setErreur] = useState<string>();
  const [succes, setSucces] = useState<string>();
  const [edition, setEdition] = useState<Partial<Utilisateur> & { motDePasseInitial?: string }>();
  const [reinit, setReinit] = useState<Utilisateur>();
  const [mdp, setMdp] = useState('');
  const [erreurModale, setErreurModale] = useState<string>();

  const charger = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([appeler<Utilisateur[]>('GET', '/utilisateurs'), appeler<Role[]>('GET', '/roles')]);
      setListe(u);
      setRoles(r);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler]);
  useEffect(() => {
    void charger();
  }, [charger]);

  const libelleRole = (code: string) => roles.find((r) => r.code === code)?.libelle ?? code;

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    if (!edition) return;
    setErreurModale(undefined);
    try {
      if (edition.id) {
        await appeler('PATCH', `/utilisateurs/${edition.id}`, {
          nomComplet: edition.nomComplet,
          roles: edition.roles,
          plafondRemisePct: Number(edition.plafondRemisePct ?? 0),
          actif: edition.actif,
        });
        setSucces(`Compte de ${edition.nomComplet} mis à jour.`);
      } else {
        await appeler('POST', '/utilisateurs', {
          identifiant: edition.identifiant,
          nomComplet: edition.nomComplet,
          motDePasseInitial: edition.motDePasseInitial,
          roles: edition.roles,
          plafondRemisePct: Number(edition.plafondRemisePct ?? 0),
        });
        setSucces(`Compte créé. ${edition.nomComplet} devra changer son mot de passe à la première connexion.`);
      }
      setEdition(undefined);
      await charger();
    } catch (err) {
      setErreurModale(messageErreur(err));
    }
  };

  const reinitialiser = async (e: FormEvent) => {
    e.preventDefault();
    if (!reinit) return;
    setErreurModale(undefined);
    try {
      await appeler('POST', `/utilisateurs/${reinit.id}/reinitialiser-mot-de-passe`, { motDePasseInitial: mdp });
      setSucces(`Mot de passe de ${reinit.nomComplet} réinitialisé. Le compte est débloqué.`);
      setReinit(undefined);
      setMdp('');
      await charger();
    } catch (err) {
      setErreurModale(messageErreur(err));
    }
  };

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Utilisateurs</h1>
          <p>Un compte personnel par personne. Les comptes ne sont jamais supprimés : on les désactive.</p>
        </div>
        <button className="bouton" onClick={() => (setErreurModale(undefined), setEdition({ roles: [], plafondRemisePct: 0, actif: true }))}>
          <Icone nom="plus" /> Nouvel utilisateur
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        <Message type="erreur">{erreur}</Message>
        <Message type="succes">{succes}</Message>
      </div>
      <div className="carte">
        {!liste ? (
          <div className="vide">Chargement…</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Rôles</th>
                <th>Statut</th>
                <th>Dernière connexion</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {liste.map((u) => {
                const bloque = u.bloqueJusquA && new Date(u.bloqueJusquA) > new Date();
                return (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.nomComplet}</strong>
                      <div className="secondaire">{u.identifiant}</div>
                    </td>
                    <td>{u.roles.map((r) => <span key={r} className="etiquette">{libelleRole(r)}</span>)}</td>
                    <td>
                      {!u.actif ? (
                        <span className="pastille grise">Désactivé</span>
                      ) : bloque ? (
                        <span className="pastille rouge">Bloqué</span>
                      ) : u.doitChangerMotDePasse ? (
                        <span className="pastille orange">Mot de passe à changer</span>
                      ) : (
                        <span className="pastille verte">Actif</span>
                      )}
                    </td>
                    <td title={formaterDateHeure(u.derniereConnexion)}>{u.derniereConnexion ? relatif(u.derniereConnexion) : 'Jamais'}</td>
                    <td>
                      <div className="actions-ligne">
                        <button className="bouton secondaire petit" onClick={() => (setErreurModale(undefined), setEdition({ ...u }))}>
                          Modifier
                        </button>
                        {u.id !== profil?.id && (
                          <button className="bouton secondaire petit" onClick={() => (setErreurModale(undefined), setMdp(''), setReinit(u))}>
                            Réinitialiser le mot de passe
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {edition && (
        <Modale titre={edition.id ? `Modifier ${edition.nomComplet}` : 'Nouvel utilisateur'} onFermer={() => setEdition(undefined)}>
          <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Champ libelle="Nom complet" value={edition.nomComplet ?? ''} onChange={(e) => setEdition({ ...edition, nomComplet: e.target.value })} required autoFocus />
            {!edition.id && (
              <div className="grille-champs">
                <Champ
                  libelle="Identifiant"
                  value={edition.identifiant ?? ''}
                  onChange={(e) => setEdition({ ...edition, identifiant: e.target.value.toLowerCase() })}
                  pattern="[a-z0-9._-]{3,32}"
                  required
                />
                <Champ
                  libelle="Mot de passe initial"
                  aide="À changer à la 1re connexion"
                  type="password"
                  value={edition.motDePasseInitial ?? ''}
                  onChange={(e) => setEdition({ ...edition, motDePasseInitial: e.target.value })}
                  minLength={8}
                  required
                />
              </div>
            )}
            <ChoixRoles roles={roles} choisis={edition.roles ?? []} onChange={(r) => setEdition({ ...edition, roles: r })} />
            <Champ
              libelle="Remise maximale autorisée (%)"
              type="number"
              min={0}
              max={100}
              value={edition.plafondRemisePct ?? 0}
              onChange={(e) => setEdition({ ...edition, plafondRemisePct: Number(e.target.value) })}
            />
            {edition.id && edition.id !== profil?.id && (
              <label className="case">
                <input type="checkbox" checked={edition.actif ?? true} onChange={(e) => setEdition({ ...edition, actif: e.target.checked })} />
                Compte actif (décocher pour désactiver et déconnecter immédiatement)
              </label>
            )}
            <Message type="erreur">{erreurModale}</Message>
            <div className="actions">
              <button type="button" className="bouton secondaire" onClick={() => setEdition(undefined)}>
                Annuler
              </button>
              <button className="bouton" disabled={!edition.roles?.length}>
                Enregistrer
              </button>
            </div>
          </form>
        </Modale>
      )}

      {reinit && (
        <Modale titre={`Réinitialiser le mot de passe de ${reinit.nomComplet}`} onFermer={() => setReinit(undefined)}>
          <form onSubmit={reinitialiser} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ color: 'var(--texte-2)', lineHeight: 1.5 }}>
              Ses sessions ouvertes sont fermées et le compte est débloqué. Il devra choisir un nouveau mot de passe à
              la prochaine connexion.
            </p>
            <Champ libelle="Mot de passe provisoire" type="password" value={mdp} onChange={(e) => setMdp(e.target.value)} minLength={8} required autoFocus />
            <Message type="erreur">{erreurModale}</Message>
            <div className="actions">
              <button type="button" className="bouton secondaire" onClick={() => setReinit(undefined)}>
                Annuler
              </button>
              <button className="bouton">Réinitialiser</button>
            </div>
          </form>
        </Modale>
      )}
    </>
  );
}
