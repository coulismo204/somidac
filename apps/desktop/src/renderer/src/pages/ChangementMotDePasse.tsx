import { FormEvent, useState } from 'react';
import { Champ, Message } from '../composants/communs';
import { EcranAccueil } from '../composants/EcranAccueil';
import { messageErreur, useSession } from '../contexte';

/** Premier login : le mot de passe donné par le gérant doit être remplacé (§10.2). */
export function ChangementMotDePasse() {
  const { appeler, rechargerProfil, profil, deconnecter } = useSession();
  const [f, setF] = useState({ ancien: '', nouveau: '', confirmation: '' });
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    if (f.nouveau.length < 8) return setErreur('Le nouveau mot de passe doit contenir au moins 8 caractères.');
    if (f.nouveau !== f.confirmation) return setErreur('Les deux mots de passe ne correspondent pas.');
    setEnvoi(true);
    try {
      await appeler('POST', '/auth/mot-de-passe', { ancienMotDePasse: f.ancien, nouveauMotDePasse: f.nouveau });
      await rechargerProfil();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <EcranAccueil>
      <div className="entete">
        <h1>Choisissez votre mot de passe</h1>
        <p>Bonjour {profil?.nomComplet}. Pour votre sécurité, remplacez le mot de passe donné par le gérant.</p>
      </div>
      <form onSubmit={valider} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Champ libelle="Mot de passe actuel" type="password" value={f.ancien} onChange={(e) => setF({ ...f, ancien: e.target.value })} required autoFocus />
        <Champ libelle="Nouveau mot de passe" aide="Au moins 8 caractères" type="password" value={f.nouveau} onChange={(e) => setF({ ...f, nouveau: e.target.value })} required />
        <Champ libelle="Confirmation" type="password" value={f.confirmation} onChange={(e) => setF({ ...f, confirmation: e.target.value })} required />
        <Message type="erreur">{erreur}</Message>
        <div className="actions">
          <button type="button" className="bouton secondaire" onClick={() => void deconnecter()}>
            Annuler
          </button>
          <button className="bouton" disabled={envoi}>
            Enregistrer
          </button>
        </div>
      </form>
    </EcranAccueil>
  );
}
