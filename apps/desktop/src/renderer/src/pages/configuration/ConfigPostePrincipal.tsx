import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { EtatServeurLocal } from '../../../../commun/ipc';
import { Champ, Message } from '../../composants/communs';
import { EcranAccueil } from '../../composants/EcranAccueil';
import { messageErreur, useSession } from '../../contexte';

export function ConfigPostePrincipal({ onRetour }: { onRetour: () => void }) {
  const { rafraichirPoste } = useSession();
  const [serveur, setServeur] = useState<EtatServeurLocal>();
  const serveurPret = serveur?.joignable;
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);
  const [f, setF] = useState({
    raisonSociale: 'SOMIDAC SARL',
    nomComplet: '',
    identifiant: '',
    motDePasse: '',
    confirmation: '',
    nomPoste: 'Poste principal',
  });
  const maj = (cle: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [cle]: e.target.value });

  const verifierServeur = useCallback(async () => {
    const r = await window.somidac.poste.etatServeurLocal();
    setServeur(r.ok ? r.valeur : { joignable: false, initialise: false, installeAvecServeur: true, service: 'inconnu' });
  }, []);
  // Vérifie tout de suite, puis toutes les 5 secondes tant que le serveur ne répond pas.
  useEffect(() => {
    void verifierServeur();
  }, [verifierServeur]);
  useEffect(() => {
    if (serveurPret) return;
    const t = window.setInterval(() => void verifierServeur(), 5000);
    return () => window.clearInterval(t);
  }, [serveurPret, verifierServeur]);

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    if (f.motDePasse.length < 8) return setErreur('Le mot de passe doit contenir au moins 8 caractères.');
    if (f.motDePasse !== f.confirmation) return setErreur('Les deux mots de passe ne correspondent pas.');
    setEnvoi(true);
    const r = await window.somidac.poste.initialiserPrincipal({
      raisonSociale: f.raisonSociale,
      gerant: { identifiant: f.identifiant, nomComplet: f.nomComplet, motDePasse: f.motDePasse },
      nomPoste: f.nomPoste,
    });
    setEnvoi(false);
    if (!r.ok) return setErreur(r.message);
    try {
      await rafraichirPoste();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  if (serveur?.initialise) return <ReenregistrementPostePrincipal onRetour={onRetour} />;

  return (
    <EcranAccueil>
      <div className="etapes">
        <span className="faite" />
        <span className="faite" />
        <span />
      </div>
      <div className="entete">
        <h1>Poste principal</h1>
        <p>Créez le compte du gérant. Il pourra ensuite ajouter les autres utilisateurs et enregistrer les autres postes.</p>
      </div>
      {serveur && !serveur.joignable && <DiagnosticServeur etat={serveur} />}
      <form onSubmit={valider} className="grille-champs">
        <Champ className="pleine" libelle="Nom de l'entreprise" value={f.raisonSociale} onChange={maj('raisonSociale')} required />
        <Champ className="pleine" libelle="Nom complet du gérant" value={f.nomComplet} onChange={maj('nomComplet')} required autoFocus />
        <Champ
          className="pleine"
          libelle="Identifiant de connexion"
          aide="Lettres minuscules, chiffres, point ou tiret (ex. : gerant)"
          value={f.identifiant}
          onChange={(e) => setF({ ...f, identifiant: e.target.value.toLowerCase() })}
          pattern="[a-z0-9._-]{3,32}"
          required
        />
        <Champ libelle="Mot de passe" type="password" value={f.motDePasse} onChange={maj('motDePasse')} minLength={8} required />
        <Champ libelle="Confirmation" type="password" value={f.confirmation} onChange={maj('confirmation')} required />
        <Champ className="pleine" libelle="Nom de ce poste" value={f.nomPoste} onChange={maj('nomPoste')} required />
        <div className="pleine">
          <Message type="erreur">{erreur}</Message>
        </div>
        <div className="pleine actions">
          <button type="button" className="bouton secondaire" onClick={onRetour}>
            Retour
          </button>
          <button className="bouton" disabled={envoi || !serveurPret}>
            {envoi ? 'Configuration…' : 'Terminer la configuration'}
          </button>
        </div>
      </form>
    </EcranAccueil>
  );
}

/** Le serveur est déjà initialisé mais ce PC n'a pas (ou plus) sa clé : le gérant le réenregistre. */
function ReenregistrementPostePrincipal({ onRetour }: { onRetour: () => void }) {
  const { rafraichirPoste } = useSession();
  const [f, setF] = useState({ identifiant: '', motDePasse: '', nomPoste: 'Poste principal' });
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    setEnvoi(true);
    const r = await window.somidac.poste.reenregistrerPrincipal(f);
    setEnvoi(false);
    if (!r.ok) {
      setF({ ...f, motDePasse: '' });
      return setErreur(r.message);
    }
    try {
      await rafraichirPoste();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  return (
    <EcranAccueil>
      <div className="entete">
        <h1>Réenregistrer le poste principal</h1>
        <p>
          Le serveur de ce PC est déjà configuré, mais ce poste n'a plus sa clé (Windows réinstallé, configuration
          interrompue). Un gérant peut lui en attribuer une nouvelle.
        </p>
      </div>
      <form onSubmit={valider} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Champ libelle="Identifiant du gérant" value={f.identifiant} onChange={(e) => setF({ ...f, identifiant: e.target.value })} required autoFocus />
        <Champ libelle="Mot de passe" type="password" value={f.motDePasse} onChange={(e) => setF({ ...f, motDePasse: e.target.value })} required />
        <Champ libelle="Nom de ce poste" value={f.nomPoste} onChange={(e) => setF({ ...f, nomPoste: e.target.value })} required />
        <Message type="info">Pensez à révoquer l'ancienne clé dans Administration → Appareils si elle existe encore.</Message>
        <Message type="erreur">{erreur}</Message>
        <div className="actions">
          <button type="button" className="bouton secondaire" onClick={onRetour}>
            Retour
          </button>
          <button className="bouton" disabled={envoi}>
            {envoi ? 'Enregistrement…' : 'Réenregistrer ce poste'}
          </button>
        </div>
      </form>
    </EcranAccueil>
  );
}

/** Explique pourquoi le serveur de ce PC ne répond pas, et quoi faire. */
function DiagnosticServeur({ etat }: { etat: EtatServeurLocal }) {
  if (!etat.installeAvecServeur) {
    return (
      <Message type="erreur">
        Cet ordinateur a été installé avec l'installateur des <strong>postes secondaires</strong> : il ne contient pas le
        serveur. Pour en faire le poste principal, désinstallez SOMIDAC puis installez{' '}
        <strong>SOMIDAC-Poste-principal-…-Setup.exe</strong> (clic droit → Exécuter en tant qu'administrateur). Sinon,
        revenez en arrière et choisissez « Poste secondaire ».
      </Message>
    );
  }
  switch (etat.service) {
    case 'absent':
      return (
        <Message type="erreur">
          Le service « SOMIDAC Serveur » n'est pas installé. Relancez l'installateur du poste principal en tant
          qu'administrateur.
        </Message>
      );
    case 'demarrage':
    case 'demarre':
      return (
        <Message type="info">
          Le serveur démarre… À la première installation, la création de la base peut prendre jusqu'à une minute. Cette
          page se met à jour toute seule.
        </Message>
      );
    case 'arrete':
      return (
        <Message type="attention">
          Le service « SOMIDAC Serveur » est arrêté. Windows le redémarre automatiquement après un échec ; si ce message
          reste affiché, redémarrez le PC. S'il persiste, le journal se trouve dans C:\ProgramData\SOMIDAC\journaux.
        </Message>
      );
    default:
      return <Message type="attention">Le serveur SOMIDAC ne répond pas sur ce PC. Nouvelle vérification dans quelques secondes…</Message>;
  }
}
