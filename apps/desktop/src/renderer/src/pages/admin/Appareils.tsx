import QRCode from 'qrcode';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Champ, Icone, Message, Modale } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterDate, formaterDateHeure, relatif } from '../../format';

interface Appareil {
  id: string;
  nom: string;
  statut: 'en_attente' | 'actif' | 'revoque';
  codeEnAttente: boolean;
  codeExpireLe: string | null;
  enregistreLe: string | null;
  derniereConnexion: string | null;
  certificatExpireLe: string | null;
  infosSysteme: { nomMachine?: string; systeme?: string } | null;
  revoqueLe: string | null;
}

interface CodeAffiche {
  nom: string;
  code: string;
  expireLe: string;
}

function Statut({ a }: { a: Appareil }) {
  if (a.statut === 'actif') return <span className="pastille verte">Actif</span>;
  if (a.statut === 'revoque') return <span className="pastille rouge">Révoqué</span>;
  return a.codeEnAttente ? <span className="pastille orange">En attente</span> : <span className="pastille grise">Code expiré</span>;
}

/** Affiche le code d'activation, l'adresse du serveur et le temps restant (§10.1 étape 1). */
function FenetreCode({ code, onFermer }: { code: CodeAffiche; onFermer: () => void }) {
  const [qr, setQr] = useState<string>();
  const [adresses, setAdresses] = useState<string[]>([]);
  const [restant, setRestant] = useState('');

  useEffect(() => {
    window.somidac.poste.adressesReseau().then((r) => r.ok && setAdresses(r.valeur));
  }, []);
  useEffect(() => {
    const contenu = JSON.stringify({ somidac: 1, serveur: adresses[0] ?? null, code: code.code });
    QRCode.toDataURL(contenu, { margin: 1, width: 320, color: { dark: '#061f4a', light: '#ffffff' } }).then(setQr);
  }, [code.code, adresses]);
  useEffect(() => {
    const maj = () => {
      const s = Math.max(0, Math.floor((new Date(code.expireLe).getTime() - Date.now()) / 1000));
      setRestant(s === 0 ? 'Code expiré' : `Expire dans ${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);
    };
    maj();
    const t = window.setInterval(maj, 1000);
    return () => window.clearInterval(t);
  }, [code.expireLe]);

  return (
    <Modale titre={`Activer « ${code.nom} »`} onFermer={onFermer} pied={<button className="bouton" onClick={onFermer}>Terminé</button>}>
      <p style={{ color: 'var(--texte-2)', lineHeight: 1.5 }}>
        Sur le nouvel appareil, choisissez <strong>Poste secondaire</strong> puis saisissez l'adresse du serveur et ce
        code. Il ne sert qu'une fois.
      </p>
      <div className="code-activation">
        <div className="code">{code.code}</div>
        {qr && <img src={qr} alt="QR code d'activation" />}
        <div className="compte-a-rebours">{restant}</div>
      </div>
      <Message type="info">
        Adresse du serveur : <strong>{adresses.length ? adresses.join(' ou ') : 'aucune connexion réseau détectée'}</strong>
      </Message>
    </Modale>
  );
}

export function Appareils() {
  const { appeler, poste } = useSession();
  const [liste, setListe] = useState<Appareil[]>();
  const [erreur, setErreur] = useState<string>();
  const [creation, setCreation] = useState(false);
  const [nom, setNom] = useState('');
  const [code, setCode] = useState<CodeAffiche>();
  const [aRevoquer, setARevoquer] = useState<Appareil>();

  const charger = useCallback(async () => {
    try {
      setListe(await appeler<Appareil[]>('GET', '/appareils'));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler]);
  useEffect(() => {
    void charger();
  }, [charger]);

  const creer = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    try {
      const r = await appeler<{ codeActivation: string; expireLe: string }>('POST', '/appareils', { nom });
      setCode({ nom, code: r.codeActivation, expireLe: r.expireLe });
      setCreation(false);
      setNom('');
      await charger();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  const nouveauCode = async (a: Appareil) => {
    setErreur(undefined);
    try {
      const r = await appeler<{ codeActivation: string; expireLe: string }>('POST', `/appareils/${a.id}/nouveau-code`);
      setCode({ nom: a.nom, code: r.codeActivation, expireLe: r.expireLe });
      await charger();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  const revoquer = async () => {
    if (!aRevoquer) return;
    setErreur(undefined);
    try {
      await appeler('POST', `/appareils/${aRevoquer.id}/revoquer`);
      setARevoquer(undefined);
      await charger();
    } catch (err) {
      setARevoquer(undefined);
      setErreur(messageErreur(err));
    }
  };

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Appareils</h1>
          <p>Chaque poste possède sa propre clé chiffrée. Un appareil révoqué est bloqué immédiatement.</p>
        </div>
        <button className="bouton" onClick={() => setCreation(true)}>
          <Icone nom="plus" /> Nouvel appareil
        </button>
      </div>
      <Message type="erreur">{erreur}</Message>
      <div className="carte" style={{ marginTop: erreur ? 16 : 0 }}>
        {!liste ? (
          <div className="vide">Chargement…</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Appareil</th>
                <th>Statut</th>
                <th>Dernière connexion</th>
                <th>Clé valable jusqu'au</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {liste.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.nom}</strong>
                    {a.id === poste?.appareilId && <span className="etiquette" style={{ marginLeft: 8 }}>Cet appareil</span>}
                    <div className="secondaire">
                      {a.infosSysteme?.nomMachine ?? '-'} {a.infosSysteme?.systeme ? `· ${a.infosSysteme.systeme}` : ''}
                    </div>
                  </td>
                  <td>
                    <Statut a={a} />
                    {a.statut === 'revoque' && <div className="secondaire">le {formaterDateHeure(a.revoqueLe)}</div>}
                  </td>
                  <td title={formaterDateHeure(a.derniereConnexion)}>{a.derniereConnexion ? relatif(a.derniereConnexion) : '-'}</td>
                  <td>{formaterDate(a.certificatExpireLe)}</td>
                  <td>
                    <div className="actions-ligne">
                      {a.statut === 'en_attente' && (
                        <button className="bouton secondaire petit" onClick={() => void nouveauCode(a)}>
                          Nouveau code
                        </button>
                      )}
                      {a.statut !== 'revoque' && a.id !== poste?.appareilId && (
                        <button className="bouton secondaire petit" style={{ color: 'var(--danger)' }} onClick={() => setARevoquer(a)}>
                          Révoquer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creation && (
        <Modale titre="Nouvel appareil" onFermer={() => setCreation(false)}>
          <form onSubmit={creer} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Champ libelle="Nom de l'appareil" aide="Ex. : PC magasin, PC caisse" value={nom} onChange={(e) => setNom(e.target.value)} autoFocus required minLength={2} />
            <div className="actions">
              <button type="button" className="bouton secondaire" onClick={() => setCreation(false)}>
                Annuler
              </button>
              <button className="bouton">Générer le code d'activation</button>
            </div>
          </form>
        </Modale>
      )}
      {code && <FenetreCode code={code} onFermer={() => setCode(undefined)} />}
      {aRevoquer && (
        <Modale
          titre="Révoquer l'appareil"
          onFermer={() => setARevoquer(undefined)}
          pied={
            <>
              <button className="bouton secondaire" onClick={() => setARevoquer(undefined)}>
                Annuler
              </button>
              <button className="bouton danger" onClick={() => void revoquer()}>
                Révoquer définitivement
              </button>
            </>
          }
        >
          <p style={{ lineHeight: 1.5 }}>
            <strong>{aRevoquer.nom}</strong> ne pourra plus se connecter, et les personnes qui l'utilisent sont
            déconnectées immédiatement. Pour le réutiliser, il faudra l'enregistrer de nouveau avec un nouveau code.
          </p>
        </Modale>
      )}
    </>
  );
}
