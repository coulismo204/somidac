import { useState } from 'react';
import { Icone } from '../../composants/communs';
import { EcranAccueil } from '../../composants/EcranAccueil';
import { ConfigPostePrincipal } from './ConfigPostePrincipal';
import { ConfigPosteSecondaire } from './ConfigPosteSecondaire';

/** Premier lancement : ce PC héberge-t-il le serveur, ou se connecte-t-il à un autre poste ? */
export function Configuration() {
  const [mode, setMode] = useState<'principal' | 'secondaire'>();

  if (mode === 'principal') return <ConfigPostePrincipal onRetour={() => setMode(undefined)} />;
  if (mode === 'secondaire') return <ConfigPosteSecondaire onRetour={() => setMode(undefined)} />;

  return (
    <EcranAccueil>
      <div className="entete">
        <h1>Bienvenue</h1>
        <p>Cet ordinateur n'est pas encore configuré. Quel est son rôle ?</p>
      </div>
      <div className="choix-mode">
        <button onClick={() => setMode('principal')}>
          <div className="icone">
            <Icone nom="serveur" taille={22} />
          </div>
          <div>
            <strong>Poste principal</strong>
            <span>Ce PC garde la base de données. Il doit rester allumé pour que les autres postes travaillent.</span>
          </div>
        </button>
        <button onClick={() => setMode('secondaire')}>
          <div className="icone">
            <Icone nom="poste" taille={22} />
          </div>
          <div>
            <strong>Poste secondaire</strong>
            <span>Ce PC se connecte au poste principal par le Wi-Fi. Il faut un code d'activation donné par le gérant.</span>
          </div>
        </button>
      </div>
    </EcranAccueil>
  );
}
