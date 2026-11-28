import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { Permission, PERMISSIONS } from '@somidac/shared';
import { ModuleMetier, Permissions, UtilisateurCourant } from '../../noyau/auth/decorateurs';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { aujourdhui } from '../stock/stock.service';
import { GroupeVentes, RapportsService } from './rapports.service';
import { SyntheseService } from './synthese.service';
import { TableauDeBordService } from './tableau-de-bord.service';

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const periode = (du?: string, au?: string) => {
  const fin = au && JOUR.test(au) ? au : aujourdhui();
  return { du: du && JOUR.test(du) ? du : `${fin.slice(0, 8)}01`, au: fin };
};

/** Il suffit d'une des permissions (ex. le magasinier voit les rapports de stock seulement, §3). */
function exigerUne(u: UtilisateurConnecte, ...permissions: Permission[]) {
  if (!permissions.some((p) => u.permissions.has(p))) {
    throw new ErreurMetier('PERMISSION_REFUSEE', "Vous n'avez pas accès à ce rapport", HttpStatus.FORBIDDEN);
  }
}

@Controller('rapports')
@ModuleMetier('rapports')
export class RapportsController {
  constructor(private readonly service: RapportsService) {}

  @Get('ventes')
  ventes(@UtilisateurCourant() u: UtilisateurConnecte, @Query('du') du?: string, @Query('au') au?: string, @Query('groupe') groupe?: string) {
    exigerUne(u, PERMISSIONS.RAPPORTS_TOUS, PERMISSIONS.RAPPORTS_SES_VENTES);
    const g = (['jour', 'mois', 'client', 'produit', 'categorie', 'vendeur'] as const).find((x) => x === groupe) ?? 'jour';
    const p = periode(du, au);
    return this.service.ventes(p.du, p.au, g as GroupeVentes, u);
  }

  @Get('stock')
  stock(@UtilisateurCourant() u: UtilisateurConnecte, @Query('jours') jours?: string) {
    exigerUne(u, PERMISSIONS.RAPPORTS_TOUS, PERMISSIONS.RAPPORTS_STOCK);
    const n = Number(jours);
    return this.service.stock(Number.isInteger(n) && n >= 7 && n <= 365 ? n : 90, u);
  }

  @Get('achats')
  @Permissions(PERMISSIONS.RAPPORTS_TOUS)
  achats(@Query('du') du?: string, @Query('au') au?: string, @Query('groupe') groupe?: string) {
    const p = periode(du, au);
    return this.service.achats(p.du, p.au, groupe === 'produit' ? 'produit' : 'fournisseur');
  }

  @Get('tresorerie')
  @Permissions(PERMISSIONS.RAPPORTS_TOUS)
  tresorerie(@UtilisateurCourant() u: UtilisateurConnecte, @Query('du') du?: string, @Query('au') au?: string) {
    const p = periode(du, au);
    return this.service.tresorerie(p.du, p.au, u);
  }

  /** Résultat du mois : il révèle les coûts, donc « voir les coûts » est aussi exigé. */
  @Get('resultat')
  @Permissions(PERMISSIONS.RAPPORTS_TOUS, PERMISSIONS.COUTS_VOIR)
  resultat(@Query('mois') mois?: string) {
    return this.service.resultat(mois && /^\d{4}-\d{2}$/.test(mois) ? mois : aujourdhui().slice(0, 7));
  }

  @Get('actions-sensibles')
  @Permissions(PERMISSIONS.AUDIT_VOIR)
  actionsSensibles(@Query('du') du?: string, @Query('au') au?: string) {
    const p = periode(du ?? aujourdhui(), au);
    return this.service.actionsSensibles(p.du, p.au);
  }
}

/** Le tableau de bord appartient au noyau : chaque bloc dépend de son propre module. */
@Controller('tableau-de-bord')
export class TableauDeBordController {
  constructor(
    private readonly service: TableauDeBordService,
    private readonly synthese: SyntheseService,
  ) {}

  @Get()
  construire(@UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.construire(u);
  }

  /** Synthèse des ventes (indicateurs vs an dernier, évolution, classements), filtrée. */
  @Get('synthese')
  async syntheseVentes(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Query('du') du?: string,
    @Query('au') au?: string,
    @Query('granularite') granularite?: string,
    @Query('categorieId') categorieId?: string,
    @Query('produitId') produitId?: string,
    @Query('clientId') clientId?: string,
  ) {
    exigerUne(u, PERMISSIONS.TABLEAU_DE_BORD_COMPLET, PERMISSIONS.RAPPORTS_SES_VENTES);
    const p = periode(du, au);
    const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
    const f = {
      ...p,
      granularite: (['jour', 'mois', 'annee'] as const).find((g) => g === granularite),
      categorieId: uuid(categorieId),
      produitId: uuid(produitId),
      clientId: uuid(clientId),
    };
    const [ventes, stock] = await Promise.all([this.synthese.construire(f, u), this.synthese.stock(f, u)]);
    return { ...ventes, stock };
  }
}
