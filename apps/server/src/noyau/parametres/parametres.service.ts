import { Inject, Injectable } from '@nestjs/common';
import { MODULES, ParametresEntrepriseDto } from '@somidac/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Db, DbOuTx } from '../base/base';
import { parametres } from '../base/schema';
import { ErreurMetier } from '../commun/erreurs';

export type Parametres = typeof parametres.$inferSelect;

@Injectable()
export class ParametresService {
  private cache?: Parametres;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async lire(tx: DbOuTx = this.db): Promise<Parametres> {
    if (tx === this.db && this.cache) return this.cache;
    const [p] = await tx.select().from(parametres).where(eq(parametres.id, 1));
    if (tx === this.db) this.cache = p;
    return p;
  }

  invaliderCache() {
    this.cache = undefined;
  }

  async moduleActif(code: string): Promise<boolean> {
    if (code === 'noyau') return true;
    return (await this.lire()).modulesActifs.includes(code);
  }

  /** Vue publique (sans champs internes), montants en pourcentage. */
  versDto(p: Parametres) {
    return {
      raisonSociale: p.raisonSociale,
      slogan: p.slogan,
      adresse: p.adresse,
      telephone: p.telephone,
      email: p.email,
      nif: p.nif,
      rccm: p.rccm,
      coordonneesBancaires: p.coordonneesBancaires,
      devise: p.devise,
      tvaActive: p.tvaActive,
      tauxTvaPct: p.tauxTvaBp / 100,
      delaiAlertePeremptionJours: p.delaiAlertePeremptionJours,
      nbMaxAppareils: p.nbMaxAppareils,
      modulesActifs: p.modulesActifs,
    };
  }

  async modifier(dto: ParametresEntrepriseDto, utilisateurId: string, appareilId: string) {
    const connus = new Set<string>(MODULES.map((m) => m.code));
    const actifs = new Set(['noyau', ...dto.modulesActifs]);
    for (const code of actifs) {
      if (!connus.has(code)) throw new ErreurMetier('MODULE_INCONNU', `Module inconnu : ${code}`);
    }
    // Un module ne peut être actif que si ses dépendances le sont.
    for (const m of MODULES) {
      if (!actifs.has(m.code)) continue;
      const manquantes = (m.dependances as readonly string[]).filter((d) => !actifs.has(d));
      if (manquantes.length) {
        throw new ErreurMetier(
          'DEPENDANCE_MODULE',
          `Le module « ${m.libelle} » nécessite : ${manquantes.join(', ')}`,
        );
      }
    }
    const resultat = await this.db.transaction(async (tx) => {
      const avant = await this.lire(tx);
      const [apres] = await tx
        .update(parametres)
        .set({
          raisonSociale: dto.raisonSociale,
          slogan: dto.slogan ?? null,
          adresse: dto.adresse ?? null,
          telephone: dto.telephone ?? null,
          email: dto.email || null,
          nif: dto.nif ?? null,
          rccm: dto.rccm ?? null,
          coordonneesBancaires: dto.coordonneesBancaires ?? null,
          devise: dto.devise,
          tvaActive: dto.tvaActive,
          tauxTvaBp: Math.round(dto.tauxTvaPct * 100),
          delaiAlertePeremptionJours: dto.delaiAlertePeremptionJours,
          nbMaxAppareils: dto.nbMaxAppareils,
          modulesActifs: [...actifs],
          modifieLe: new Date(),
          modifiePar: utilisateurId,
        })
        .where(eq(parametres.id, 1))
        .returning();
      await this.audit.enregistrer(tx, {
        action: 'parametres.modifier',
        utilisateurId,
        appareilId,
        entite: 'parametres',
        entiteId: '1',
        avant: this.versDto(avant),
        apres: this.versDto(apres),
      });
      return apres;
    });
    this.invaliderCache();
    return this.versDto(resultat);
  }
}
