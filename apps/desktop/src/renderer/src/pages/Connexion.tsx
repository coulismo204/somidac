import { FormEvent, useState } from 'react';
import { Champ, Message } from '../composants/communs';
import { EcranAccueil } from '../composants/EcranAccueil';
import { messageErreur, useSession } from '../contexte';

export function Connexion() {
  const { connecter, poste, messageConnexion } = useSession();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    setEnvoi(true);
    try {
      await connecter(identifiant, motDePasse);
    } catch (err) {
      setErreur(messageErreur(err));
      setMotDePasse('');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <EcranAccueil>
      <div className="entete">
        <h1>Connexion</h1>
        <p>
          {poste?.nomAppareil}
          {poste?.mode === 'secondaire' && poste.serveur ? ` · serveur ${poste.serveur.hote}` : ''}
        </p>
      </div>
      {messageConnexion && !erreur && <Message type="info">{messageConnexion}</Message>}
      <form onSubmit={valider} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Champ libelle="Identifiant" value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} autoFocus required autoComplete="username" />
        <Champ libelle="Mot de passe" type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} required autoComplete="current-password" />
        <Message type="erreur">{erreur}</Message>
        <button className="bouton large" disabled={envoi}>
          {envoi ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </EcranAccueil>
  );
}
