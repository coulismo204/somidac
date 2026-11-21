import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Valide le corps d'une requête avec un schéma partagé (@somidac/shared). */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(valeur: unknown): T {
    const resultat = this.schema.safeParse(valeur);
    if (!resultat.success) {
      throw new BadRequestException({
        code: 'DONNEES_INVALIDES',
        message: resultat.error.issues.map((i) => i.message).join(' ; '),
        details: resultat.error.issues.map((i) => ({ champ: i.path.join('.'), message: i.message })),
      });
    }
    return resultat.data;
  }
}
