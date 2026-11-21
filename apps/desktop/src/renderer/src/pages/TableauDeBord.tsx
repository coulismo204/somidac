import { useEffect, useState } from 'react';
import { Message } from '../composants/communs';
import { useSession } from '../contexte';
import { formaterDate } from '../format';

interface Parametres {
  raisonSociale: string;
  devise: string;
  modulesActifs: string[];
  tvaActive: boolean;
}

export function TableauDeBord() {
  const { profil, poste, appeler, peut } = useSession();
  const [p, setP] = useState<Parametres>();
  const [alertesSauvegarde, setAlertesSauvegarde] = useState<string[]>([]);

  useEffect(() => {
    appeler<Parametres>('GET', '/parametres').then(setP).catch(() => undefined);
    if (peut('admin.sauvegardes')) {
      appeler<{ alertes: string[] }>('GET', '/sauvegardes').then((e) => setAlertesSauvegarde(e.alertes)).catch(() => undefined);
    }
  }, [appeler, peut]);

  const heure = new Date().getHours();
  const salut = heure < 18 ? 'Bonjour' : 'Bonsoir';

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>
            {salut}, {profil?.nomComplet.split(' ')[0]}
          </h1>
          <p>{p?.raisonSociale ?? 'SOMIDAC SARL'} · {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(new Date())}</p>
        </div>
      </div>
      {alertesSauvegarde.map((a) => (
        <div key={a} style={{ marginBottom: 12 }}>
          <Message type="attention">
            {a} <a href="#/sauvegardes">Ouvrir les sauvegardes</a>
          </Message>
        </div>
      ))}
      <div className="grille-cartes" style={{ marginBottom: 20 }}>
        <div className="carte indicateur">
          <div className="libelle">Ventes du jour</div>
          <div className="valeur">—</div>
          <div className="detail">Disponible avec le module Ventes (lot 3)</div>
        </div>
        <div className="carte indicateur">
          <div className="libelle">Stock bas</div>
          <div className="valeur">—</div>
          <div className="detail">Disponible avec le module Stock (lot 2)</div>
        </div>
        <div className="carte indicateur">
          <div className="libelle">Trésorerie</div>
          <div className="valeur">—</div>
          <div className="detail">Disponible avec le module Trésorerie (lot 4)</div>
        </div>
        <div className="carte indicateur">
          <div className="libelle">Cet appareil</div>
          <div className="valeur" style={{ fontSize: 17 }}>{poste?.nomAppareil}</div>
          <div className="detail">Clé valable jusqu'au {formaterDate(poste?.certificatExpireLe)}</div>
        </div>
      </div>
      <Message type="info">
        Le socle de l'application est en place : comptes, rôles, appareils enregistrés par clé chiffrée, paramètres et
        journal d'audit. Les modules Produits, Stock et Achats arrivent au lot 2.
      </Message>
    </>
  );
}
