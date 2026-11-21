import { FormEvent, useState } from 'react';
import { Champ, Message } from '../../composants/communs';
import { EcranAccueil } from '../../composants/EcranAccueil';
import { messageErreur, useSession } from '../../contexte';

/** Formate la saisie du code au fil de la frappe : ABCD-EFGH-JKLM */
function formaterCode(saisie: string): string {
  const brut = saisie.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return brut.match(/.{1,4}/g)?.join('-') ?? '';
}

export function ConfigPosteSecondaire({ onRetour }: { onRetour: () => void }) {
  const { rafraichirPoste } = useSession();
  const [adresse, setAdresse] = useState('');
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    setEnvoi(true);
    const r = await window.somidac.poste.enregistrerSecondaire(adresse, code);
    setEnvoi(false);
    if (!r.ok) return setErreur(r.message);
    try {
      await rafraichirPoste();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  return (
    <EcranAccueil>
      <div className="etapes">
        <span className="faite" />
        <span className="faite" />
        <span />
      </div>
      <div className="entete">
        <h1>Poste secondaire</h1>
        <p>
          Sur le poste principal, le gérant ouvre <strong>Administration → Appareils</strong>, crée ce poste et vous
          donne l'adresse du serveur et un code d'activation, valable 15 minutes.
        </p>
      </div>
      <form onSubmit={valider} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Champ
          libelle="Adresse du poste principal"
          aide="Affichée avec le code (ex. : 192.168.1.10)"
          value={adresse}
          onChange={(e) => setAdresse(e.target.value)}
          placeholder="192.168.1.10"
          required
          autoFocus
        />
        <div className="champ">
          <label htmlFor="code">Code d'activation</label>
          <input
            id="code"
            className="code"
            value={code}
            onChange={(e) => setCode(formaterCode(e.target.value))}
            placeholder="ABCD-EFGH-JKLM"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>
        <Message type="info">
          Ce PC crée sa propre clé, protégée par Windows. Le code n'est jamais envoyé sur le réseau : seule une preuve
          calculée avec lui l'est.
        </Message>
        <Message type="erreur">{erreur}</Message>
        <div className="actions">
          <button type="button" className="bouton secondaire" onClick={onRetour}>
            Retour
          </button>
          <button className="bouton" disabled={envoi || code.length !== 14 || !adresse}>
            {envoi ? 'Enregistrement…' : 'Enregistrer ce poste'}
          </button>
        </div>
      </form>
    </EcranAccueil>
  );
}
