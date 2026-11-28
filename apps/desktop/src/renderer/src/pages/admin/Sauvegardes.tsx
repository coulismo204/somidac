import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Champ, Icone, Message, Modale } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterDateHeure, relatif } from '../../format';

interface LigneHistorique {
  id: string;
  creeLe: string;
  declenchement: string;
  statut: 'reussie' | 'echouee';
  fichier: string | null;
  taille: number | null;
  copies: { dossier: string; ok: boolean; erreur?: string }[];
  erreur: string | null;
}

interface Etat {
  configure: boolean;
  outilDisponible: boolean;
  heure: string;
  dossiers: string[];
  dossierLocal: string;
  derniereReussieLe: string | null;
  derniereCopieExterneLe: string | null;
  alertes: string[];
  historique: LigneHistorique[];
}

interface Fichier {
  nom: string;
  dossier: string;
  taille: number;
  date: string;
}

const LIBELLES_DECLENCHEMENT: Record<string, string> = {
  automatique: 'Automatique',
  manuelle: 'Manuelle',
  'avant-restauration': 'Avant restauration',
  'cloture-caisse': 'Clôture de caisse',
};

const taille = (o: number | null) => (o == null ? '-' : o > 1024 * 1024 ? `${(o / 1024 / 1024).toFixed(1)} Mo` : `${Math.ceil(o / 1024)} Ko`);

/** Première configuration : le mot de passe de restauration. */
function Configuration({ onFait }: { onFait: () => void }) {
  const { appeler } = useSession();
  const [mdp, setMdp] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [compris, setCompris] = useState(false);
  const [erreur, setErreur] = useState<string>();

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    if (mdp.length < 10) return setErreur('Au moins 10 caractères.');
    if (mdp !== confirmation) return setErreur('Les deux mots de passe ne correspondent pas.');
    try {
      await appeler('PUT', '/sauvegardes/mot-de-passe', { motDePasse: mdp });
      onFait();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  return (
    <div className="carte" style={{ maxWidth: 640 }}>
      <div className="entete-carte">
        <h3>Activer les sauvegardes</h3>
      </div>
      <form className="corps" onSubmit={valider} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ color: 'var(--texte-2)', lineHeight: 1.5 }}>
          Chaque sauvegarde est chiffrée. Seul le <strong>mot de passe de restauration</strong> permet de la relire :
          une clé USB perdue ou volée reste illisible. Il est différent de votre mot de passe de connexion.
        </p>
        <Message type="attention">
          Notez ce mot de passe et gardez-le en lieu sûr (hors de ce PC). Sans lui, <strong>aucune sauvegarde ne pourra
          être restaurée</strong>, et personne ne peut le retrouver.
        </Message>
        <div className="grille-champs">
          <Champ libelle="Mot de passe de restauration" type="password" value={mdp} onChange={(e) => setMdp(e.target.value)} minLength={10} required />
          <Champ libelle="Confirmation" type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
        </div>
        <label className="case">
          <input type="checkbox" checked={compris} onChange={(e) => setCompris(e.target.checked)} />
          J'ai noté ce mot de passe en lieu sûr.
        </label>
        <Message type="erreur">{erreur}</Message>
        <div className="actions">
          <button className="bouton" disabled={!compris}>
            Activer les sauvegardes
          </button>
        </div>
      </form>
    </div>
  );
}

/** Restauration : vérification d'abord, puis confirmation explicite. */
function Restauration({ fichier, onFermer }: { fichier: Fichier; onFermer: () => void }) {
  const { appeler, deconnecter } = useSession();
  const [mdp, setMdp] = useState('');
  const [verifiee, setVerifiee] = useState<{ creeLe: string; entreprise: string }>();
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);

  const verifier = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    setEnvoi(true);
    try {
      setVerifiee(await appeler('POST', '/sauvegardes/verifier', { nom: fichier.nom, dossier: fichier.dossier, motDePasse: mdp }));
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  };

  const restaurer = async () => {
    setErreur(undefined);
    setEnvoi(true);
    try {
      await appeler('POST', '/sauvegardes/restaurer', { nom: fichier.nom, dossier: fichier.dossier, motDePasse: mdp, confirmation });
      await deconnecter(`Restauration terminée (sauvegarde du ${formaterDateHeure(verifiee?.creeLe)}). Reconnectez-vous.`);
    } catch (err) {
      setErreur(messageErreur(err));
      setEnvoi(false);
    }
  };

  return (
    <Modale titre="Restaurer une sauvegarde" onFermer={() => !envoi && onFermer()}>
      <p style={{ lineHeight: 1.5 }}>
        Sauvegarde du <strong>{formaterDateHeure(fichier.date)}</strong> ({taille(fichier.taille)}), dossier {fichier.dossier}.
      </p>
      {!verifiee ? (
        <form onSubmit={verifier} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Champ libelle="Mot de passe de restauration" type="password" value={mdp} onChange={(e) => setMdp(e.target.value)} autoFocus required />
          <Message type="erreur">{erreur}</Message>
          <div className="actions">
            <button type="button" className="bouton secondaire" onClick={onFermer}>
              Annuler
            </button>
            <button className="bouton" disabled={envoi}>
              {envoi ? 'Vérification…' : 'Vérifier la sauvegarde'}
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Message type="succes">
            Sauvegarde valide : {verifiee.entreprise}, du {formaterDateHeure(verifiee.creeLe)}.
          </Message>
          <Message type="attention">
            Toutes les données saisies depuis cette date seront remplacées. L'état actuel est d'abord sauvegardé
            automatiquement. Tous les utilisateurs, sur tous les postes, seront déconnectés.
          </Message>
          <Champ libelle="Tapez RESTAURER pour confirmer" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoFocus />
          <Message type="erreur">{erreur}</Message>
          <div className="actions">
            <button className="bouton secondaire" onClick={onFermer} disabled={envoi}>
              Annuler
            </button>
            <button className="bouton danger" disabled={confirmation !== 'RESTAURER' || envoi} onClick={() => void restaurer()}>
              {envoi ? 'Restauration en cours…' : 'Restaurer'}
            </button>
          </div>
        </div>
      )}
    </Modale>
  );
}

function ChangementMotDePasseRestauration({ onFermer }: { onFermer: () => void }) {
  const { appeler } = useSession();
  const [f, setF] = useState({ ancien: '', nouveau: '', confirmation: '' });
  const [erreur, setErreur] = useState<string>();
  const [fait, setFait] = useState(false);
  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    if (f.nouveau !== f.confirmation) return setErreur('Les deux mots de passe ne correspondent pas.');
    try {
      await appeler('PUT', '/sauvegardes/mot-de-passe', { ancienMotDePasse: f.ancien, motDePasse: f.nouveau });
      setFait(true);
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };
  return (
    <Modale titre="Changer le mot de passe de restauration" onFermer={onFermer}>
      {fait ? (
        <>
          <Message type="succes">Mot de passe changé. Les anciennes sauvegardes se restaurent avec le nouveau mot de passe.</Message>
          <div className="actions">
            <button className="bouton" onClick={onFermer}>
              Fermer
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={valider} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Champ libelle="Mot de passe actuel" type="password" value={f.ancien} onChange={(e) => setF({ ...f, ancien: e.target.value })} required autoFocus />
          <Champ libelle="Nouveau mot de passe" type="password" value={f.nouveau} onChange={(e) => setF({ ...f, nouveau: e.target.value })} minLength={10} required />
          <Champ libelle="Confirmation" type="password" value={f.confirmation} onChange={(e) => setF({ ...f, confirmation: e.target.value })} required />
          <Message type="erreur">{erreur}</Message>
          <div className="actions">
            <button type="button" className="bouton secondaire" onClick={onFermer}>
              Annuler
            </button>
            <button className="bouton">Changer</button>
          </div>
        </form>
      )}
    </Modale>
  );
}

export function Sauvegardes() {
  const { appeler } = useSession();
  const [etat, setEtat] = useState<Etat>();
  const [fichiers, setFichiers] = useState<Fichier[]>([]);
  const [reglages, setReglages] = useState({ heure: '20:00', dossiers: '' });
  const [erreur, setErreur] = useState<string>();
  const [succes, setSucces] = useState<string>();
  const [enCours, setEnCours] = useState(false);
  const [aRestaurer, setARestaurer] = useState<Fichier>();
  const [changerMdp, setChangerMdp] = useState(false);

  const charger = useCallback(async () => {
    try {
      const e = await appeler<Etat>('GET', '/sauvegardes');
      setEtat(e);
      setReglages({ heure: e.heure, dossiers: e.dossiers.join('\n') });
      if (e.configure) setFichiers(await appeler<Fichier[]>('GET', '/sauvegardes/fichiers'));
    } catch (err) {
      setErreur(messageErreur(err));
    }
  }, [appeler]);
  useEffect(() => {
    void charger();
  }, [charger]);

  const sauvegarderMaintenant = async () => {
    setErreur(undefined);
    setSucces(undefined);
    setEnCours(true);
    try {
      const r = await appeler<LigneHistorique>('POST', '/sauvegardes');
      const echecs = r.copies.filter((c) => !c.ok);
      if (echecs.length) setErreur(`Sauvegarde faite sur ce PC, mais copie impossible vers : ${echecs.map((c) => `${c.dossier} (${c.erreur})`).join(', ')}`);
      else setSucces(`Sauvegarde faite${r.copies.length ? ` et copiée vers ${r.copies.length} dossier(s) externe(s)` : ''}.`);
      await charger();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnCours(false);
    }
  };

  const enregistrerReglages = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    setSucces(undefined);
    try {
      await appeler('PUT', '/sauvegardes/reglages', { heure: reglages.heure, dossiers: reglages.dossiers.split('\n').map((d) => d.trim()).filter(Boolean) });
      setSucces('Réglages enregistrés.');
      await charger();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  if (!etat) return <div className="vide">{erreur ?? 'Chargement…'}</div>;

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Sauvegardes</h1>
          <p>Chaque jour à {etat.heure}, chiffrées, copiées vers une clé USB ou un dossier synchronisé.</p>
        </div>
        {etat.configure && (
          <button className="bouton" onClick={() => void sauvegarderMaintenant()} disabled={enCours || !etat.outilDisponible}>
            <Icone nom="sauvegarde" /> {enCours ? 'Sauvegarde en cours…' : 'Sauvegarder maintenant'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {!etat.outilDisponible && <Message type="erreur">Outils PostgreSQL introuvables sur le serveur : les sauvegardes sont impossibles.</Message>}
        {etat.alertes.map((a) => (
          <Message key={a} type="attention">
            {a}
          </Message>
        ))}
        <Message type="erreur">{erreur}</Message>
        <Message type="succes">{succes}</Message>
      </div>

      {!etat.configure ? (
        <Configuration onFait={() => void charger()} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="grille-cartes">
            <div className="carte indicateur">
              <div className="libelle">Dernière sauvegarde</div>
              <div className="valeur" style={{ fontSize: 18 }}>{etat.derniereReussieLe ? relatif(etat.derniereReussieLe) : 'Aucune'}</div>
              <div className="detail">{formaterDateHeure(etat.derniereReussieLe)}</div>
            </div>
            <div className="carte indicateur">
              <div className="libelle">Dernière copie externe</div>
              <div className="valeur" style={{ fontSize: 18 }}>{etat.derniereCopieExterneLe ? relatif(etat.derniereCopieExterneLe) : 'Aucune'}</div>
              <div className="detail">{etat.dossiers.length} dossier(s) externe(s)</div>
            </div>
            <div className="carte indicateur">
              <div className="libelle">Conservation</div>
              <div className="valeur" style={{ fontSize: 18 }}>30 jours + 12 mois</div>
              <div className="detail">
                <a href="#" onClick={(e) => (e.preventDefault(), setChangerMdp(true))}>
                  Changer le mot de passe de restauration
                </a>
              </div>
            </div>
          </div>

          <form className="carte" onSubmit={enregistrerReglages}>
            <div className="entete-carte">
              <h3>Réglages</h3>
              <button className="bouton secondaire petit">Enregistrer</button>
            </div>
            <div className="corps" style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 20 }}>
              <div className="champ">
                <label htmlFor="heure">Heure quotidienne</label>
                <input id="heure" type="time" value={reglages.heure} onChange={(e) => setReglages({ ...reglages, heure: e.target.value })} required />
              </div>
              <div className="champ">
                <label htmlFor="dossiers">Dossiers externes (un par ligne)</label>
                <textarea
                  id="dossiers"
                  rows={3}
                  value={reglages.dossiers}
                  onChange={(e) => setReglages({ ...reglages, dossiers: e.target.value })}
                  placeholder={'E:\\SOMIDAC-sauvegardes\nD:\\Drive-SOMIDAC'}
                />
                <span className="aide">
                  Clé USB, disque externe, ou dossier synchronisé avec Google Drive / OneDrive placé hors de C:\Users (le
                  service n'a pas accès aux dossiers personnels). Copie locale : {etat.dossierLocal}
                </span>
              </div>
            </div>
          </form>

          <div className="carte">
            <div className="entete-carte">
              <h3>Sauvegardes disponibles</h3>
            </div>
            {fichiers.length === 0 ? (
              <div className="vide">Aucune sauvegarde pour l'instant.</div>
            ) : (
              <table className="tableau">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Emplacement</th>
                    <th>Taille</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {fichiers.slice(0, 40).map((f) => (
                    <tr key={`${f.dossier}/${f.nom}`}>
                      <td>{formaterDateHeure(f.date)}</td>
                      <td className="secondaire">{f.dossier === etat.dossierLocal ? 'Ce PC' : f.dossier}</td>
                      <td>{taille(f.taille)}</td>
                      <td>
                        <div className="actions-ligne">
                          <button className="bouton secondaire petit" onClick={() => setARestaurer(f)}>
                            Restaurer…
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="carte">
            <div className="entete-carte">
              <h3>Historique</h3>
            </div>
            <table className="tableau">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Résultat</th>
                  <th>Copies externes</th>
                </tr>
              </thead>
              <tbody>
                {etat.historique.map((h) => (
                  <tr key={h.id}>
                    <td>{formaterDateHeure(h.creeLe)}</td>
                    <td>{LIBELLES_DECLENCHEMENT[h.declenchement] ?? h.declenchement}</td>
                    <td>
                      {h.statut === 'reussie' ? <span className="pastille verte">Réussie</span> : <span className="pastille rouge">Échouée</span>}
                      {h.erreur && <div className="secondaire">{h.erreur}</div>}
                    </td>
                    <td>
                      {h.copies.length === 0
                        ? '-'
                        : h.copies.map((c) => (
                            <div key={c.dossier} className="secondaire" title={c.erreur}>
                              {c.ok ? '✓' : '✗'} {c.dossier}
                            </div>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {aRestaurer && <Restauration fichier={aRestaurer} onFermer={() => setARestaurer(undefined)} />}
      {changerMdp && <ChangementMotDePasseRestauration onFermer={() => setChangerMdp(false)} />}
    </>
  );
}
