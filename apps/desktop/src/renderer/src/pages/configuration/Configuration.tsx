import { useCallback, useEffect, useState } from 'react';
import type { EtatServeurLocal, PostePrincipalTrouve } from '../../../../commun/ipc';
import { Icone, Message } from '../../composants/communs';
import { EcranAccueil } from '../../composants/EcranAccueil';
import { ConfigPostePrincipal, ReenregistrementPostePrincipal } from './ConfigPostePrincipal';
import { ConfigPosteSecondaire } from './ConfigPosteSecondaire';

type Etape =
  | { nom: 'recherche' }
  | { nom: 'resultat'; trouves: PostePrincipalTrouve[]; local?: EtatServeurLocal }
  | { nom: 'principal' }
  | { nom: 'reenregistrement' }
  | { nom: 'secondaire'; principal?: PostePrincipalTrouve };

/**
 * Premier lancement (un seul installateur pour tous les PC) :
 * - un poste principal répond sur le Wi-Fi → ce PC le rejoint avec le code du gérant ;
 * - aucun ne répond → ce PC peut devenir le poste principal.
 */
export function Configuration() {
  const [etape, setEtape] = useState<Etape>({ nom: 'recherche' });
  const [activation, setActivation] = useState(false);
  const [erreur, setErreur] = useState<string>();

  const rechercher = useCallback(async () => {
    setErreur(undefined);
    setEtape({ nom: 'recherche' });
    const [r, l] = await Promise.all([window.somidac.poste.rechercher(), window.somidac.poste.etatServeurLocal()]);
    const local = l.ok ? l.valeur : undefined;
    // Ce PC héberge déjà un serveur configuré, mais n'a plus sa clé : le gérant le réenregistre.
    if (local?.joignable && local.initialise) return setEtape({ nom: 'reenregistrement' });
    const trouves = (r.ok ? r.valeur : []).filter((t) => !t.local);
    setEtape({ nom: 'resultat', trouves, local });
  }, []);

  useEffect(() => {
    void rechercher();
  }, [rechercher]);

  const devenirPrincipal = async () => {
    setErreur(undefined);
    setActivation(true);
    const r = await window.somidac.poste.activerPrincipal();
    setActivation(false);
    if (!r.ok) return setErreur(r.message);
    setEtape({ nom: 'principal' });
  };

  if (etape.nom === 'principal') return <ConfigPostePrincipal onRetour={() => void rechercher()} />;
  if (etape.nom === 'reenregistrement') return <ReenregistrementPostePrincipal onRetour={() => void rechercher()} />;
  if (etape.nom === 'secondaire') {
    return (
      <ConfigPosteSecondaire
        onRetour={() => void rechercher()}
        adresseInitiale={etape.principal ? `${etape.principal.adresse}:${etape.principal.port}` : undefined}
        nomPrincipal={etape.principal ? `${etape.principal.entreprise} (${etape.principal.nomMachine}, ${etape.principal.adresse})` : undefined}
      />
    );
  }

  return (
    <EcranAccueil>
      <div className="entete">
        <h1>Bienvenue</h1>
        <p>
          {etape.nom === 'recherche'
            ? 'Recherche du poste principal SOMIDAC sur le réseau Wi-Fi…'
            : 'Cet ordinateur n’est pas encore configuré.'}
        </p>
      </div>

      {etape.nom === 'recherche' && <Message type="info">Recherche en cours, quelques secondes…</Message>}

      {etape.nom === 'resultat' && etape.trouves.length > 0 && (
        <>
          <Message type="succes">
            {etape.trouves.length === 1 ? 'Un poste principal a été trouvé sur le réseau.' : 'Plusieurs postes principaux ont été trouvés : choisissez le bon.'}
          </Message>
          <div className="choix-mode">
            {etape.trouves.map((t) => (
              <button key={`${t.adresse}:${t.port}`} onClick={() => setEtape({ nom: 'secondaire', principal: t })} disabled={!t.initialise}>
                <div className="icone">
                  <Icone nom="serveur" taille={22} />
                </div>
                <div>
                  <strong>
                    Rejoindre {t.entreprise} - {t.nomMachine}
                  </strong>
                  <span>
                    {t.initialise
                      ? `Poste principal à l'adresse ${t.adresse}. Il faudra le code d'activation donné par le gérant.`
                      : 'Ce poste principal est en cours de configuration : réessayez dans un instant.'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {etape.nom === 'resultat' && etape.trouves.length === 0 && (
        <>
          <Message type="attention">
            Aucun poste principal n'a été trouvé sur ce réseau. Si c'est le premier PC équipé, il devient le poste
            principal : il gardera la base de données et devra rester allumé pour les autres.
          </Message>
          {etape.local && !etape.local.installeAvecServeur && (
            <Message type="erreur">Cette installation ne contient pas le serveur : réinstallez SOMIDAC avec l'installateur à jour.</Message>
          )}
          <button className="bouton large" disabled={activation || (etape.local && !etape.local.installeAvecServeur)} onClick={() => void devenirPrincipal()}>
            {activation ? 'Autorisez la demande de Windows…' : 'Faire de ce PC le poste principal'}
          </button>
          <p style={{ color: 'var(--texte-3)', fontSize: 12, lineHeight: 1.5 }}>
            Windows demandera une autorisation administrateur pour démarrer le serveur et l'ouvrir aux autres postes du
            réseau privé.
          </p>
        </>
      )}

      <Message type="erreur">{erreur}</Message>

      {etape.nom === 'resultat' && (
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <a href="#" onClick={(e) => (e.preventDefault(), setEtape({ nom: 'secondaire' }))}>
            Saisir l'adresse du poste principal
          </a>
          <button className="bouton secondaire" onClick={() => void rechercher()}>
            Rechercher à nouveau
          </button>
        </div>
      )}
    </EcranAccueil>
  );
}
