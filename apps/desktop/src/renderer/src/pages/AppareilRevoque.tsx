import { useState } from 'react';
import { Message } from '../composants/communs';
import { EcranAccueil } from '../composants/EcranAccueil';
import { useSession } from '../contexte';

export function AppareilRevoque() {
  const { rafraichirPoste } = useSession();
  const [confirmer, setConfirmer] = useState(false);

  const recommencer = async () => {
    await window.somidac.poste.oublier();
    await rafraichirPoste();
  };

  return (
    <EcranAccueil>
      <div className="entete">
        <h1>Appareil non autorisé</h1>
        <p>Le serveur ne reconnaît plus cet ordinateur : il a été révoqué par le gérant ou n'a jamais été enregistré.</p>
      </div>
      <Message type="attention">
        Pour l'utiliser à nouveau, demandez au gérant un nouveau code d'activation, puis enregistrez de nouveau ce poste.
      </Message>
      {!confirmer ? (
        <button className="bouton" onClick={() => setConfirmer(true)}>
          Enregistrer à nouveau ce poste
        </button>
      ) : (
        <div className="actions">
          <button className="bouton secondaire" onClick={() => setConfirmer(false)}>
            Annuler
          </button>
          <button className="bouton danger" onClick={() => void recommencer()}>
            Effacer l'ancienne clé et recommencer
          </button>
        </div>
      )}
    </EcranAccueil>
  );
}
