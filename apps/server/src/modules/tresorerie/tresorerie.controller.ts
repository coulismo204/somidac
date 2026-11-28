import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  AnnulationDto,
  annulationSchema,
  CategorieDepenseDto,
  categorieDepenseSchema,
  ClotureDto,
  clotureSchema,
  CompteDto,
  compteSchema,
  DecisionClotureDto,
  decisionClotureSchema,
  DepenseDto,
  depenseSchema,
  EncaissementDto,
  encaissementSchema,
  PaiementFournisseurDto,
  paiementFournisseurSchema,
  PERMISSIONS,
  PieceJointeDto,
  pieceJointeSchema,
  TransfertDto,
  transfertSchema,
} from '@somidac/shared';
import { AppareilCourant, ModuleMetier, Permissions, UtilisateurCourant } from '../../noyau/auth/decorateurs';
import type { AppareilConnecte, UtilisateurConnecte } from '../../noyau/commun/requete';
import { ZodPipe } from '../../noyau/commun/zod.pipe';
import { aujourdhui } from '../stock/stock.service';
import { CloturesService } from './clotures.service';
import { DepensesService } from './depenses.service';
import { PaiementsService } from './paiements.service';
import { PiecesJointesService } from './pieces-jointes.service';
import { TresorerieService } from './tresorerie.service';

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const jourOuDefaut = (v: string | undefined, defaut: string) => (v && JOUR.test(v) ? v : defaut);
const debutMois = () => `${aujourdhui().slice(0, 8)}01`;

@Controller('tresorerie')
@ModuleMetier('tresorerie')
export class TresorerieController {
  constructor(private readonly service: TresorerieService) {}

  /** Comptes actifs : nécessaires aussi pour choisir le compte qui paie un achat. Soldes selon les droits. */
  @Get('comptes')
  comptes(@UtilisateurCourant() u: UtilisateurConnecte, @Query('inactifs') inactifs?: string) {
    return this.service.listerComptes(u, inactifs === '1');
  }

  @Post('comptes')
  @Permissions(PERMISSIONS.ADMIN_PARAMETRES)
  creerCompte(@Body(new ZodPipe(compteSchema)) dto: CompteDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.enregistrerCompte(null, dto, u, a.id);
  }

  @Put('comptes/:id')
  @Permissions(PERMISSIONS.ADMIN_PARAMETRES)
  modifierCompte(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(compteSchema)) dto: CompteDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.enregistrerCompte(id, dto, u, a.id);
  }

  @Get('comptes/:id/journal')
  @Permissions(PERMISSIONS.TRESORERIE_ENCAISSER)
  journal(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte, @Query('du') du?: string, @Query('au') au?: string) {
    return this.service.journal(id, jourOuDefaut(du, debutMois()), jourOuDefaut(au, aujourdhui()), u);
  }

  @Get('transferts')
  @Permissions(PERMISSIONS.TRESORERIE_ENCAISSER)
  transferts() {
    return this.service.listerTransferts();
  }

  @Post('transferts')
  @Permissions(PERMISSIONS.TRESORERIE_ENCAISSER)
  transferer(@Body(new ZodPipe(transfertSchema)) dto: TransfertDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.transferer(dto, u, a.id);
  }

  @Get('resume')
  @Permissions(PERMISSIONS.TABLEAU_DE_BORD_COMPLET)
  resume(@UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.resume(u);
  }
}

@Controller('paiements')
@ModuleMetier('tresorerie')
@Permissions(PERMISSIONS.TRESORERIE_ENCAISSER)
export class PaiementsController {
  constructor(private readonly service: PaiementsService) {}

  @Get()
  lister(@Query('sens') sens?: string, @Query('du') du?: string, @Query('au') au?: string, @Query('clientId') clientId?: string, @Query('fournisseurId') fournisseurId?: string) {
    return this.service.lister({ sens, du: du && JOUR.test(du) ? du : undefined, au: au && JOUR.test(au) ? au : undefined, clientId, fournisseurId });
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Post('encaissements')
  encaisser(@Body(new ZodPipe(encaissementSchema)) dto: EncaissementDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.encaisser(dto, u, a.id);
  }

  @Post('fournisseurs')
  payer(@Body(new ZodPipe(paiementFournisseurSchema)) dto: PaiementFournisseurDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.payerFournisseur(dto, u, a.id);
  }

  /** Annulation tracée (R7), réservée à qui peut annuler des documents (gérant). */
  @Post(':id/annuler')
  @HttpCode(200)
  @Permissions(PERMISSIONS.TRESORERIE_ENCAISSER, PERMISSIONS.DOCUMENTS_ANNULER)
  annuler(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(annulationSchema)) dto: AnnulationDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.annuler(id, dto.motif, u, a.id);
  }
}

@Controller('depenses')
@ModuleMetier('tresorerie')
@Permissions(PERMISSIONS.TRESORERIE_ENCAISSER)
export class DepensesController {
  constructor(private readonly service: DepensesService) {}

  @Get()
  lister(@Query('du') du?: string, @Query('au') au?: string, @Query('categorieId') categorieId?: string) {
    return this.service.lister({ du: jourOuDefaut(du, debutMois()), au: jourOuDefaut(au, aujourdhui()), categorieId });
  }

  @Post()
  creer(@Body(new ZodPipe(depenseSchema)) dto: DepenseDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.creer(dto, u, a.id);
  }

  @Post(':id/annuler')
  @HttpCode(200)
  @Permissions(PERMISSIONS.TRESORERIE_ENCAISSER, PERMISSIONS.DOCUMENTS_ANNULER)
  annuler(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(annulationSchema)) dto: AnnulationDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.annuler(id, dto.motif, u, a.id);
  }
}

@Controller('categories-depenses')
@ModuleMetier('tresorerie')
export class CategoriesDepensesController {
  constructor(private readonly service: DepensesService) {}

  @Get()
  @Permissions(PERMISSIONS.TRESORERIE_ENCAISSER)
  lister() {
    return this.service.listerCategories();
  }

  @Post()
  @Permissions(PERMISSIONS.ADMIN_PARAMETRES)
  creer(@Body(new ZodPipe(categorieDepenseSchema)) dto: CategorieDepenseDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.enregistrerCategorie(null, dto, u, a.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.ADMIN_PARAMETRES)
  modifier(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(categorieDepenseSchema)) dto: CategorieDepenseDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.enregistrerCategorie(id, dto, u, a.id);
  }
}

@Controller('clotures')
@ModuleMetier('tresorerie')
export class CloturesController {
  constructor(private readonly service: CloturesService) {}

  @Get()
  @Permissions(PERMISSIONS.CAISSE_CLOTURER)
  lister(@UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.lister(u);
  }

  @Post()
  @Permissions(PERMISSIONS.CAISSE_CLOTURER)
  saisir(@Body(new ZodPipe(clotureSchema)) dto: ClotureDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.saisir(dto, u, a.id);
  }

  /** Validation par le gérant (§10.3). */
  @Post(':id/decision')
  @HttpCode(200)
  @Permissions(PERMISSIONS.CAISSE_VALIDER)
  decider(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionClotureSchema)) dto: DecisionClotureDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.decider(id, dto, u, a.id);
  }
}

@Controller('pieces-jointes')
@ModuleMetier('tresorerie')
export class PiecesJointesController {
  constructor(private readonly service: PiecesJointesService) {}

  @Get()
  lister(@Query('documentType') documentType: string, @Query('documentId', ParseUUIDPipe) documentId: string, @UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.lister(documentType, documentId, u);
  }

  @Get(':id')
  lire(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.lire(id, u);
  }

  @Post()
  ajouter(@Body(new ZodPipe(pieceJointeSchema)) dto: PieceJointeDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.ajouter(dto, u, a.id);
  }
}
