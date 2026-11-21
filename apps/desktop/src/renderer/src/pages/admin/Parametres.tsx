import { MODULES } from '@somidac/shared';
import { FormEvent, useEffect, useState } from 'react';
import { Champ, Message } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';

interface Parametres {
  raisonSociale: string;
  slogan: string | null;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  nif: string | null;
  rccm: string | null;
  coordonneesBancaires: string | null;
  devise: string;
  tvaActive: boolean;
  tauxTvaPct: number;
  delaiAlertePeremptionJours: number;
  nbMaxAppareils: number;
  modulesActifs: string[];
}

export function Parametres() {
  const { appeler } = useSession();
  const [p, setP] = useState<Parametres>();
  const [erreur, setErreur] = useState<string>();
  const [succes, setSucces] = useState<string>();
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    appeler<Parametres>('GET', '/parametres').then(setP).catch((e) => setErreur(messageErreur(e)));
  }, [appeler]);

  if (!p) return <div className="vide">{erreur ?? 'Chargement…'}</div>;

  const texte = (cle: keyof Parametres) => ({
    value: (p[cle] as string | null) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [cle]: e.target.value }),
  });

  const basculerModule = (code: string, actif: boolean) =>
    setP({ ...p, modulesActifs: actif ? [...p.modulesActifs, code] : p.modulesActifs.filter((m) => m !== code) });

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    setSucces(undefined);
    setEnvoi(true);
    try {
      setP(await appeler<Parametres>('PUT', '/parametres', p));
      setSucces('Paramètres enregistrés.');
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <form onSubmit={enregistrer}>
      <div className="entete-page">
        <div>
          <h1>Paramètres</h1>
          <p>Informations imprimées sur les factures et bons de livraison, fiscalité, modules et sécurité.</p>
        </div>
        <button className="bouton" disabled={envoi}>
          {envoi ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        <Message type="erreur">{erreur}</Message>
        <Message type="succes">{succes}</Message>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20, alignItems: 'start' }}>
        <div className="carte">
          <div className="entete-carte">
            <h3>Entreprise</h3>
          </div>
          <div className="corps grille-champs">
            <Champ className="pleine" libelle="Raison sociale" {...texte('raisonSociale')} required />
            <Champ className="pleine" libelle="Activité / slogan" {...texte('slogan')} placeholder="Distribution cosmétiques & divers produits" />
            <Champ className="pleine" libelle="Adresse" {...texte('adresse')} />
            <Champ libelle="Téléphone" {...texte('telephone')} />
            <Champ libelle="E-mail" type="email" {...texte('email')} />
            <Champ libelle="NIF" {...texte('nif')} />
            <Champ libelle="RCCM" {...texte('rccm')} />
            <Champ className="pleine" libelle="Coordonnées bancaires et Mobile Money" {...texte('coordonneesBancaires')} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="carte">
            <div className="entete-carte">
              <h3>Fiscalité et alertes</h3>
            </div>
            <div className="corps" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Champ libelle="Devise" {...texte('devise')} required />
              <label className="case">
                <input type="checkbox" checked={p.tvaActive} onChange={(e) => setP({ ...p, tvaActive: e.target.checked })} />
                Entreprise assujettie à la TVA
              </label>
              {p.tvaActive && (
                <Champ libelle="Taux de TVA (%)" type="number" step="0.01" min={0} max={100} value={p.tauxTvaPct} onChange={(e) => setP({ ...p, tauxTvaPct: Number(e.target.value) })} />
              )}
              <Champ
                libelle="Alerte de péremption (jours avant)"
                type="number"
                min={1}
                max={730}
                value={p.delaiAlertePeremptionJours}
                onChange={(e) => setP({ ...p, delaiAlertePeremptionJours: Number(e.target.value) })}
              />
              <Champ
                libelle="Nombre maximal d'appareils"
                type="number"
                min={1}
                max={100}
                value={p.nbMaxAppareils}
                onChange={(e) => setP({ ...p, nbMaxAppareils: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="carte">
            <div className="entete-carte">
              <h3>Modules</h3>
            </div>
            <div className="corps" style={{ paddingTop: 6, paddingBottom: 6 }}>
              {MODULES.filter((m) => !m.obligatoire).map((m) => (
                <label key={m.code} className="toggle-module case">
                  <span>
                    {m.libelle}
                    {m.dependances.length > 0 && <small>Nécessite : {m.dependances.filter((d) => d !== 'noyau').map((d) => MODULES.find((x) => x.code === d)?.libelle).join(', ') || 'noyau'}</small>}
                  </span>
                  <input type="checkbox" checked={p.modulesActifs.includes(m.code)} onChange={(e) => basculerModule(m.code, e.target.checked)} />
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
