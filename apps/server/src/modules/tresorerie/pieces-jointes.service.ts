import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PERMISSIONS, Permission, PieceJointeDto } from '@somidac/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db } from '../../noyau/base/base';
import { achats, depenses, piecesJointes } from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';

/** Qui peut joindre ou consulter un justificatif, selon le document (§7 « pieces_jointes »). */
const PERMISSION_PAR_TYPE: Record<string, Permission> = {
  depense: PERMISSIONS.TRESORERIE_ENCAISSER,
  achat: PERMISSIONS.ACHATS_SAISIR,
};
const TAILLE_MAX = 2 * 1024 * 1024;
const NOMBRE_MAX = 5;

@Injectable()
export class PiecesJointesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private autoriser(type: string, u: UtilisateurConnecte) {
    const p = PERMISSION_PAR_TYPE[type];
    if (!p || !u.permissions.has(p)) throw new ErreurMetier('PERMISSION_REFUSEE', "Vous n'avez pas accès aux justificatifs de ce document", HttpStatus.FORBIDDEN);
  }

  async ajouter(dto: PieceJointeDto, u: UtilisateurConnecte, appareilId: string) {
    this.autoriser(dto.documentType, u);
    const taille = Buffer.from(dto.contenu, 'base64').length;
    if (taille > TAILLE_MAX) throw new ErreurMetier('FICHIER_TROP_GROS', 'Image trop lourde (2 Mo au plus)');
    const table = dto.documentType === 'depense' ? depenses : achats;
    const [doc] = await this.db.select({ id: table.id }).from(table).where(eq(table.id, dto.documentId));
    if (!doc) throw new ErreurMetier('INTROUVABLE', 'Document introuvable', HttpStatus.NOT_FOUND);
    return this.db.transaction(async (tx) => {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(piecesJointes)
        .where(and(eq(piecesJointes.documentType, dto.documentType), eq(piecesJointes.documentId, dto.documentId)));
      if (n >= NOMBRE_MAX) throw new ErreurMetier('TROP_DE_PIECES', `${NOMBRE_MAX} justificatifs au plus par document`);
      const [p] = await tx
        .insert(piecesJointes)
        .values({ documentType: dto.documentType, documentId: dto.documentId, nom: dto.nom, typeMime: dto.typeMime, taille, contenuBase64: dto.contenu, creePar: u.id })
        .returning({ id: piecesJointes.id, nom: piecesJointes.nom, taille: piecesJointes.taille, creeLe: piecesJointes.creeLe });
      await this.audit.enregistrer(tx, {
        action: 'piece_jointe.ajoutee',
        utilisateurId: u.id,
        appareilId,
        entite: dto.documentType,
        entiteId: dto.documentId,
        details: { nom: dto.nom, taille },
      });
      return p;
    });
  }

  async lister(documentType: string, documentId: string, u: UtilisateurConnecte) {
    this.autoriser(documentType, u);
    return this.db
      .select({ id: piecesJointes.id, nom: piecesJointes.nom, typeMime: piecesJointes.typeMime, taille: piecesJointes.taille, creeLe: piecesJointes.creeLe })
      .from(piecesJointes)
      .where(and(eq(piecesJointes.documentType, documentType), eq(piecesJointes.documentId, documentId)))
      .orderBy(asc(piecesJointes.creeLe));
  }

  async lire(id: string, u: UtilisateurConnecte) {
    const [p] = await this.db.select().from(piecesJointes).where(eq(piecesJointes.id, id));
    if (!p) throw new ErreurMetier('INTROUVABLE', 'Justificatif introuvable', HttpStatus.NOT_FOUND);
    this.autoriser(p.documentType, u);
    return { id: p.id, nom: p.nom, typeMime: p.typeMime, contenu: p.contenuBase64 };
  }
}
