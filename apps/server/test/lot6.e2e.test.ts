import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { demarrerServeur, IdentiteAppareil, initialiserAvecGerant, requete, ServeurTest, sql, viderBase } from './outils';

/** Lot 6 : mise en service, import du fichier Excel de départ et liste de contrôle. */
describe('Mise en service', () => {
  let srv: ServeurTest;
  let gerant: { poste: IdentiteAppareil; jeton: string };
  let jetonCaissier = '';
  const g = (m: string, c: string, corps?: unknown) => requete(srv, m, c, { appareil: gerant.poste, jeton: gerant.jeton, corps });
  const compter = async (table: string) => Number((await sql<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0].n);

  const fichier = {
    produits: [
      { ligne: 2, designation: 'Savon karité 200 g', categorie: 'Soins du corps', marque: 'Karité Plus', suiviLot: true, seuilAlerte: 24, prixPiece: 350, codeBarrePiece: '6001234567890', conditionnement: 'Carton de 24', piecesParConditionnement: 24, prixConditionnement: 7_800, codeBarreConditionnement: '6001234567891' },
      { ligne: 3, designation: 'Seau 10 L', categorie: 'Plastiques', typeCategorie: 'bazar', suiviLot: false, seuilAlerte: 5, prixPiece: 2_000 },
      { ligne: 4, designation: 'Bassine 30 L', categorie: 'Plastiques', suiviLot: false, piecesParConditionnement: 6, prixConditionnement: 15_000 },
    ],
    fournisseurs: [{ ligne: 2, nom: 'Grossiste du Port', telephone: '+221 33 000 00 00' }],
    clients: [{ ligne: 2, raisonSociale: 'Supermarché Bon Prix', type: 'supermarche', nif: 'NIF-BP' }],
    stock: [
      { ligne: 2, produit: 'Savon karité 200 g', quantite: 48, coutUnitaire: 210, numeroLot: 'L2611', datePeremption: '2028-01-31' },
      { ligne: 3, produit: 'seau 10 l', quantite: 10, coutUnitaire: 1_500 },
    ],
  };

  before(async () => {
    await viderBase();
    srv = await demarrerServeur();
    gerant = await initialiserAvecGerant(srv);
    await g('POST', '/utilisateurs', { identifiant: 'fatou', nomComplet: 'Fatou', motDePasseInitial: 'Initial#2026', roles: ['caissier'] });
    const c = await requete(srv, 'POST', '/auth/connexion', { appareil: gerant.poste, corps: { identifiant: 'fatou', motDePasse: 'Initial#2026' } });
    jetonCaissier = c.corps.jeton;
    await requete(srv, 'POST', '/auth/mot-de-passe', { appareil: gerant.poste, jeton: jetonCaissier, corps: { ancienMotDePasse: 'Initial#2026', nouveauMotDePasse: 'Caisse#2026' } });
  });
  after(async () => srv?.arreter());

  it('liste de contrôle d’une installation neuve', async () => {
    const r = (await g('GET', '/mise-en-service')).corps;
    assert.equal(r.termine, false);
    assert.equal(r.etapes.find((e: { cle: string }) => e.cle === 'catalogue').fait, false);
    assert.equal(r.etapes.find((e: { cle: string }) => e.cle === 'utilisateurs').fait, true);
    assert.equal((await requete(srv, 'GET', '/mise-en-service', { appareil: gerant.poste, jeton: jetonCaissier })).statut, 403);
  });

  it('les erreurs sont signalées ligne par ligne et rien n’est enregistré', async () => {
    const r = await g('POST', '/mise-en-service/import', {
      verifierSeulement: false,
      produits: [
        ...fichier.produits,
        { ligne: 5, designation: 'savon KARITÉ 200 g', categorie: 'Soins du corps', suiviLot: false },
        { ligne: 6, designation: 'Brosse', categorie: 'Catégorie inconnue', suiviLot: false, prixPiece: 500 },
        { ligne: 7, designation: 'Éponge', categorie: 'Divers', suiviLot: false, codeBarrePiece: '6001234567890' },
      ],
      stock: [...fichier.stock, { ligne: 4, produit: 'Produit fantôme', quantite: 1, coutUnitaire: 10 }, { ligne: 5, produit: 'P-0001', quantite: 5, coutUnitaire: 200 }],
    });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.equal(r.corps.valide, false);
    assert.equal(r.corps.enregistre, false);
    const erreurs = r.corps.erreurs.map((e: { feuille: string; ligne: number }) => `${e.feuille}:${e.ligne}`);
    assert.deepEqual(erreurs, ['produits:5', 'produits:6', 'produits:7', 'stock:4', 'stock:5']);
    assert.match(r.corps.erreurs[1].message, /indiquez son type/);
    assert.match(r.corps.erreurs[4].message, /suivi par lot/);
    assert.equal(await compter('produits'), 0, 'tout ou rien');
    assert.equal(await compter('categories WHERE nom = \'Plastiques\''), 0);
  });

  it('vérification d’un fichier correct : bilan annoncé, toujours rien d’enregistré', async () => {
    const r = (await g('POST', '/mise-en-service/import', { verifierSeulement: true, ...fichier })).corps;
    assert.equal(r.valide, true);
    assert.equal(r.enregistre, false);
    assert.deepEqual(r.compte, { produits: 3, categories: 1, marques: 1, fournisseurs: 1, clients: 1, lignesStock: 2, piecesStock: 58, valeurStock: 48 * 210 + 10 * 1_500 });
    assert.equal(r.avertissements.length, 0);
    assert.equal(await compter('produits'), 0);
    assert.equal(await compter('sequences_documents WHERE type = \'PRD\''), 0, 'aucun code produit consommé');
  });

  it('import réel : produits, conditionnements, codes-barres, tiers, stock d’ouverture au bon coût', async () => {
    const r = (await g('POST', '/mise-en-service/import', { verifierSeulement: false, ...fichier })).corps;
    assert.equal(r.enregistre, true, JSON.stringify(r.erreurs));
    const scan = (await g('GET', '/produits/code-barres/6001234567891')).corps;
    assert.equal(scan.produit.code, 'P-0001');
    assert.equal(scan.produit.conditionnements.find((c: { id: string }) => c.id === scan.conditionnementId).prixVente, 7_800);
    assert.equal(scan.produit.stock, 48);
    assert.equal(scan.produit.cmp, 210);
    assert.equal(scan.produit.lots[0].numero, 'L2611');
    const bassine = (await g('GET', '/produits?recherche=Bassine')).corps[0];
    assert.equal(bassine.conditionnements[1].nom, 'Carton de 6');
    assert.equal(bassine.categorie, 'Plastiques');
    const clients = (await g('GET', '/clients')).corps;
    assert.equal(clients[0].code, 'C-0001');
    const entrees = (await g('GET', '/stock/mouvements?sens=entree')).corps;
    assert.equal(entrees.resume.parType.ouverture.pieces, 58);
    assert.equal(entrees.resume.valeur, 48 * 210 + 10 * 1_500);
    const journal = await sql("SELECT 1 FROM journal_audit WHERE action = 'import.catalogue'");
    assert.equal(journal.length, 1);
  });

  it('réimporter le même fichier est refusé ; le stock d’ouverture ne compte pas comme une perte', async () => {
    const r = (await g('POST', '/mise-en-service/import', { verifierSeulement: true, ...fichier })).corps;
    assert.equal(r.valide, false);
    const lignes = new Set(r.erreurs.filter((e: { feuille: string }) => e.feuille === 'produits').map((e: { ligne: number }) => e.ligne));
    assert.deepEqual([...lignes], [2, 3, 4], 'chaque produit déjà présent est signalé (et les codes-barres déjà pris)');
    assert.equal(r.avertissements.filter((e: { feuille: string }) => e.feuille === 'stock').length, 2, 'stock déjà présent signalé');
    const mois = new Date().toISOString().slice(0, 7);
    assert.equal((await g('GET', `/rapports/resultat?mois=${mois}`)).corps.totalPertesStock, 0);
  });

  it('la liste de contrôle suit l’état réel', async () => {
    const r = (await g('GET', '/mise-en-service')).corps;
    const etape = (cle: string) => r.etapes.find((e: { cle: string }) => e.cle === cle);
    assert.equal(etape('catalogue').fait, true, 'chaque produit a au moins un prix (la bassine est vendue au carton)');
    assert.match(etape('catalogue').detail, /3 produits/);
    assert.equal(etape('tiers').fait, true);
    assert.equal(etape('stock').fait, true);
    assert.equal(etape('sauvegardes').fait, false);
  });
});
