import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { messageErreur, useSession } from '../contexte';
import { formaterDateHeure } from '../format';
import { Message, Modale } from './communs';

interface Piece {
  id: string;
  nom: string;
  taille: number;
  creeLe: string;
}

/**
 * Réduit une photo (1 600 px au plus, JPEG) avant l'envoi : une photo de téléphone de 4 Mo
 * devient un justificatif lisible de quelques centaines de Ko.
 */
export async function reduireImage(fichier: File): Promise<{ contenu: string; typeMime: 'image/jpeg' }> {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error('Ce fichier n’est pas une image lisible.'));
      i.src = url;
    });
    const echelle = Math.min(1, 1600 / Math.max(img.width, img.height));
    const toile = document.createElement('canvas');
    toile.width = Math.round(img.width * echelle);
    toile.height = Math.round(img.height * echelle);
    const ctx = toile.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, toile.width, toile.height);
    ctx.drawImage(img, 0, 0, toile.width, toile.height);
    const dataUrl = toile.toDataURL('image/jpeg', 0.82);
    return { contenu: dataUrl.slice(dataUrl.indexOf(',') + 1), typeMime: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function envoyerJustificatif(appeler: <T>(m: string, c: string, corps?: unknown) => Promise<T>, documentType: 'depense' | 'achat', documentId: string, fichier: File) {
  const { contenu, typeMime } = await reduireImage(fichier);
  const nom = fichier.name.replace(/\.[^.]+$/, '') + '.jpg';
  await appeler('POST', '/pieces-jointes', { documentType, documentId, nom, typeMime, contenu });
}

/** Photos jointes à un document (justificatif de dépense, facture du grossiste). */
export function Justificatifs({ documentType, documentId, modifiable = true }: { documentType: 'depense' | 'achat'; documentId: string; modifiable?: boolean }) {
  const { appeler } = useSession();
  const [pieces, setPieces] = useState<Piece[]>();
  const [apercu, setApercu] = useState<{ nom: string; src: string }>();
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  const charger = useCallback(() => {
    appeler<Piece[]>('GET', `/pieces-jointes?documentType=${documentType}&documentId=${documentId}`).then(setPieces).catch((e) => setErreur(messageErreur(e)));
  }, [appeler, documentType, documentId]);
  useEffect(charger, [charger]);

  const ajouter = async (e: ChangeEvent<HTMLInputElement>) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    setErreur(undefined);
    setEnvoi(true);
    try {
      await envoyerJustificatif(appeler, documentType, documentId, fichier);
      charger();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  };
  const ouvrir = async (p: Piece) => {
    try {
      const r = await appeler<{ nom: string; typeMime: string; contenu: string }>('GET', `/pieces-jointes/${p.id}`);
      setApercu({ nom: r.nom, src: `data:${r.typeMime};base64,${r.contenu}` });
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  return (
    <div className="justificatifs">
      {(pieces ?? []).map((p) => (
        <button key={p.id} className="justificatif" onClick={() => void ouvrir(p)} title={`Ajouté le ${formaterDateHeure(p.creeLe)}`}>
          {p.nom} <span>{Math.ceil(p.taille / 1024)} Ko</span>
        </button>
      ))}
      {pieces?.length === 0 && !modifiable && <span className="secondaire">Aucun justificatif</span>}
      {modifiable && (
        <>
          <button className="bouton secondaire petit" disabled={envoi} onClick={() => champ.current?.click()}>
            {envoi ? 'Envoi…' : 'Joindre une photo'}
          </button>
          <input ref={champ} type="file" accept="image/*" hidden onChange={(e) => void ajouter(e)} />
        </>
      )}
      <Message type="erreur">{erreur}</Message>
      {apercu && (
        <Modale titre={apercu.nom} onFermer={() => setApercu(undefined)} large>
          <img src={apercu.src} alt={apercu.nom} style={{ maxWidth: '100%', borderRadius: 8 }} />
        </Modale>
      )}
    </div>
  );
}
