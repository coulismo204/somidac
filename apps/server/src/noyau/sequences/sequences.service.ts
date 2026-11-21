import { Injectable } from '@nestjs/common';
import { formaterNumero, TypeDocument } from '@somidac/shared';
import { sql } from 'drizzle-orm';
import { Tx } from '../base/base';
import { sequencesDocuments } from '../base/schema';

/**
 * Numérotation des documents (règle R6) : série annuelle, continue et sans trou.
 * Doit être appelée dans la transaction qui valide le document : si la validation échoue,
 * le numéro n'est pas consommé.
 */
@Injectable()
export class SequencesService {
  async suivant(tx: Tx, type: TypeDocument, date: Date = new Date()): Promise<string> {
    const annee = date.getFullYear();
    const [ligne] = await tx
      .insert(sequencesDocuments)
      .values({ type, annee, derniereValeur: 1 })
      .onConflictDoUpdate({
        target: [sequencesDocuments.type, sequencesDocuments.annee],
        set: { derniereValeur: sql`${sequencesDocuments.derniereValeur} + 1` },
      })
      .returning({ valeur: sequencesDocuments.derniereValeur });
    return formaterNumero(type, annee, ligne.valeur);
  }
}
