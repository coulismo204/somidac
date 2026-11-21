import { Body, Controller, Get, HttpStatus, Inject, Post } from '@nestjs/common';
import { CODES_ERREUR as E, InitialisationDto, initialisationSchema, ROLES_PAR_DEFAUT } from '@somidac/shared';
import { eq, sql } from 'drizzle-orm';
import { AppareilsService } from '../appareils/appareils.service';
import { AuditService } from '../audit/audit.service';
import { LocalSeulement, Public, SansAppareil } from '../auth/decorateurs';
import { DB, Db } from '../base/base';
import { parametres } from '../base/schema';
import { ErreurMetier } from '../commun/erreurs';
import { ZodPipe } from '../commun/zod.pipe';
import { ParametresService } from '../parametres/parametres.service';
import { UtilisateursService } from '../utilisateurs/utilisateurs.service';

/**
 * Première mise en route du poste principal : création du compte gérant et
 * enregistrement de l'appareil du poste principal. Possible une seule fois,
 * et uniquement depuis le PC qui héberge le serveur.
 */
@Controller('initialisation')
@Public()
@SansAppareil()
@LocalSeulement()
export class InitialisationController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly parametres: ParametresService,
    private readonly utilisateurs: UtilisateursService,
    private readonly appareils: AppareilsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async etat() {
    const p = await this.parametres.lire();
    return { initialise: p.initialise };
  }

  @Post()
  async initialiser(@Body(new ZodPipe(initialisationSchema)) dto: InitialisationDto) {
    const resultat = await this.db.transaction(async (tx) => {
      // Verrou : deux initialisations simultanées sont impossibles.
      const [p] = await tx.select().from(parametres).where(eq(parametres.id, 1)).for('update');
      if (p.initialise) {
        throw new ErreurMetier(E.DEJA_INITIALISE, 'Le poste principal est déjà initialisé', HttpStatus.CONFLICT);
      }
      const poste = await this.appareils.enregistrerPostePrincipal(
        tx,
        dto.appareil.nom,
        dto.appareil.csrPem,
        dto.appareil.infosSysteme as Record<string, string>,
      );
      const gerant = await this.utilisateurs.creer(
        tx,
        {
          identifiant: dto.gerant.identifiant,
          nomComplet: dto.gerant.nomComplet,
          motDePasseInitial: dto.gerant.motDePasse,
          roles: [ROLES_PAR_DEFAUT[0].code],
          plafondRemisePct: 100,
        },
        { utilisateurId: null, appareilId: poste.appareil.id },
        false,
      );
      await tx
        .update(parametres)
        .set({
          initialise: true,
          raisonSociale: dto.raisonSociale ?? sql`${parametres.raisonSociale}`,
          modifieLe: new Date(),
        })
        .where(eq(parametres.id, 1));
      await this.audit.enregistrer(tx, {
        action: 'initialisation',
        utilisateurId: gerant.id,
        appareilId: poste.appareil.id,
        details: { gerant: gerant.identifiant, postePrincipal: dto.appareil.nom },
      });
      return { appareilId: poste.appareil.id, certificatPem: poste.certificatPem, caPem: poste.caPem };
    });
    this.parametres.invaliderCache();
    return resultat;
  }
}
