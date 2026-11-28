import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, Db } from '../../noyau/base/base';
import { ParametresService } from '../../noyau/parametres/parametres.service';

export interface EtapeMiseEnService {
  cle: string;
  titre: string;
  fait: boolean;
  detail: string;
  lien: string;
  /** Facultative : n'empêche pas de considérer la mise en service comme terminée. */
  facultative?: boolean;
}

/**
 * Liste de contrôle de la mise en service (lot 6) : chaque étape est vérifiée sur l'état réel
 * de l'application, rien n'est coché à la main.
 */
@Injectable()
export class MiseEnServiceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly parametres: ParametresService,
  ) {}

  private async nombre(requete: ReturnType<typeof sql>): Promise<number> {
    const r = (await this.db.execute(requete)).rows[0] as { n: string | number };
    return Number(r.n);
  }

  async etat() {
    const p = await this.parametres.lire();
    const manquantes = ([['adresse', p.adresse], ['téléphone', p.telephone], ['NIF', p.nif], ['RCCM', p.rccm]] as const).filter(([, v]) => !v?.trim()).map(([k]) => k);
    const coordonnees = 4 - manquantes.length;
    const utilisateurs = await this.nombre(sql`SELECT count(*) AS n FROM utilisateurs WHERE actif`);
    const postes = await this.nombre(sql`SELECT count(*) AS n FROM appareils WHERE statut = 'actif'`);
    const sauvegardesReussies = await this.nombre(sql`SELECT count(*) AS n FROM sauvegardes WHERE statut = 'reussie'`);
    const comptesOuverts = await this.nombre(sql`SELECT count(DISTINCT compte_id) AS n FROM mouvements_tresorerie`);
    const produitsActifs = await this.nombre(sql`SELECT count(*) AS n FROM produits WHERE actif`);
    const sansPrix = await this.nombre(sql`
      SELECT count(*) AS n FROM produits p WHERE p.actif AND NOT EXISTS (SELECT 1 FROM conditionnements c WHERE c.produit_id = p.id AND c.actif AND c.prix_vente IS NOT NULL)`);
    const fournisseursN = await this.nombre(sql`SELECT count(*) AS n FROM fournisseurs WHERE actif`);
    const clientsN = await this.nombre(sql`SELECT count(*) AS n FROM clients WHERE actif`);
    const stockN = await this.nombre(sql`SELECT count(*) AS n FROM mouvements_stock WHERE type IN ('ouverture', 'achat', 'inventaire')`);

    const etapes: EtapeMiseEnService[] = [
      {
        cle: 'entreprise',
        titre: 'Coordonnées de l’entreprise',
        fait: coordonnees === 4,
        detail: coordonnees === 4 ? 'Renseignées.' : `Manque : ${manquantes.join(', ')}.`,
        lien: '#/parametres',
      },
      {
        cle: 'sauvegardes',
        titre: 'Sauvegardes',
        fait: !!p.sauvegardeClePublique && p.sauvegardeDossiers.length > 0 && sauvegardesReussies > 0,
        detail: !p.sauvegardeClePublique
          ? 'Choisir le mot de passe de restauration.'
          : !p.sauvegardeDossiers.length
            ? 'Ajouter une copie externe (clé USB).'
            : sauvegardesReussies
              ? `Chaque jour à ${p.sauvegardeHeure}.`
              : 'Faire une première sauvegarde.',
        lien: '#/sauvegardes',
      },
      {
        cle: 'utilisateurs',
        titre: 'Comptes des utilisateurs',
        fait: utilisateurs > 1,
        detail: utilisateurs > 1 ? `${utilisateurs} comptes actifs.` : 'Créer les comptes du personnel.',
        lien: '#/utilisateurs',
      },
      {
        cle: 'postes',
        titre: 'Postes secondaires',
        fait: postes > 1,
        facultative: true,
        detail: postes > 1 ? `${postes} postes.` : 'Enregistrer les autres PC.',
        lien: '#/appareils',
      },
      {
        cle: 'tresorerie',
        titre: 'Comptes de trésorerie et soldes d’ouverture',
        fait: comptesOuverts > 0,
        detail: comptesOuverts > 0 ? `${comptesOuverts} compte(s) ouvert(s).` : 'Saisir l’argent en caisse.',
        lien: '#/tresorerie',
      },
      {
        cle: 'catalogue',
        titre: 'Catalogue des produits',
        fait: produitsActifs > 0 && sansPrix === 0,
        detail: !produitsActifs ? 'Importer ou créer les produits.' : sansPrix ? `${sansPrix} produit(s) sans prix.` : `${produitsActifs} produits.`,
        lien: '#/produits',
      },
      {
        cle: 'tiers',
        titre: 'Fournisseurs et clients',
        fait: fournisseursN > 0 && clientsN > 0,
        detail: `${fournisseursN} fournisseur(s), ${clientsN} client(s).`,
        lien: '#/ventes',
      },
      {
        cle: 'stock',
        titre: 'Stock de départ',
        fait: stockN > 0,
        detail: stockN > 0 ? 'Saisi.' : 'Importer ou faire un inventaire.',
        lien: '#/mise-en-service',
      },
    ];
    const obligatoires = etapes.filter((e) => !e.facultative);
    return { etapes, faites: obligatoires.filter((e) => e.fait).length, total: obligatoires.length, termine: obligatoires.every((e) => e.fait) };
  }
}
