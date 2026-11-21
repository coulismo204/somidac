import { HttpException, HttpStatus } from '@nestjs/common';

/** Erreur métier avec un code stable que les écrans peuvent interpréter. */
export class ErreurMetier extends HttpException {
  constructor(code: string, message: string, statut: HttpStatus = HttpStatus.BAD_REQUEST, details?: unknown) {
    super({ code, message, details }, statut);
  }
}
