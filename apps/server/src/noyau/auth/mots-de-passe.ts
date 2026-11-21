import * as argon2 from 'argon2';

/** Hachage Argon2id (§10.2) : le mot de passe n'est jamais stocké en clair. */
export function hacherMotDePasse(motDePasse: string): Promise<string> {
  return argon2.hash(motDePasse, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifierMotDePasse(hash: string, motDePasse: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, motDePasse);
  } catch {
    return false;
  }
}

/** Hachage factice : la vérification prend le même temps qu'un identifiant existe ou non. */
let hashFactice: Promise<string> | undefined;
export function obtenirHashFactice(): Promise<string> {
  hashFactice ??= hacherMotDePasse('mot-de-passe-factice-somidac');
  return hashFactice;
}
