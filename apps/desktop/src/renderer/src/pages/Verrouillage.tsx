import { FormEvent, useState } from 'react';
import { Champ, Message } from '../composants/communs';
import { messageErreur, useSession } from '../contexte';
import { initiales } from '../format';

/** Écran de verrouillage après inactivité : seul l'utilisateur connecté peut reprendre. */
export function Verrouillage() {
  const { profil, deverrouiller, deconnecter } = useSession();
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string>();

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    try {
      await deverrouiller(motDePasse);
      setMotDePasse('');
    } catch (err) {
      setErreur(messageErreur(err));
      setMotDePasse('');
    }
  };

  return (
    <div className="verrouillage">
      <form className="carte-verrou" onSubmit={valider}>
        <div className="avatar">{initiales(profil?.nomComplet ?? '?')}</div>
        <div>
          <h2>Session verrouillée</h2>
          <p style={{ color: 'var(--texte-2)', marginTop: 6 }}>{profil?.nomComplet}, saisissez votre mot de passe pour continuer.</p>
        </div>
        <Champ libelle="Mot de passe" type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} autoFocus required />
        <Message type="erreur">{erreur}</Message>
        <button className="bouton large">Déverrouiller</button>
        <button type="button" className="bouton discret" onClick={() => void deconnecter()}>
          Changer d'utilisateur
        </button>
      </form>
    </div>
  );
}
