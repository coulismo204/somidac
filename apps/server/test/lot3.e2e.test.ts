import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { calculerTotaux, montantEnLettres, montantLigne, nombreEnLettres, partCumulee, remiseCumuleeBp } from '@somidac/shared';
import { demarrerServeur, IdentiteAppareil, initialiserAvecGerant, requete, ServeurTest, sql, viderBase } from './outils';

describe('Calculs des ventes (R8, R9) et montant en lettres', () => {
  it('ligne arrondie au franc, remise sur le total, TVA', () => {
    assert.equal(montantLigne(3, 333, 0), 999);
    assert.equal(montantLigne(1, 7_500, 500), 7_125);
    assert.equal(montantLigne(3, 1_001, 333), 2_903); // 3 003 - 100 (99,99 arrondi)
    assert.deepEqual(calculerTotaux([10_000, 5_000], 1_000, 1_800), { totalLignes: 15_000, remiseGlobale: 1_500, totalHT: 13_500, tva: 2_430, totalTTC: 15_930 });
    assert.equal(remiseCumuleeBp(500, 500), 975);
  });
  it('les parts successives retombent exactement sur le total', () => {
    const parts = [partCumulee(1_000, 3, 0, 1), partCumulee(1_000, 3, 1, 1), partCumulee(1_000, 3, 2, 1)];
    assert.deepEqual(parts, [333, 334, 333]);
    assert.equal(parts.reduce((t, p) => t + p, 0), 1_000);
  });
  it('nombres en lettres (orthographe traditionnelle)', () => {
    const cas: [number, string][] = [
      [0, 'zéro'],
      [21, 'vingt et un'],
      [71, 'soixante et onze'],
      [80, 'quatre-vingts'],
      [81, 'quatre-vingt-un'],
      [91, 'quatre-vingt-onze'],
      [200, 'deux cents'],
      [201, 'deux cent un'],
      [1_000, 'mille'],
      [1_080, 'mille quatre-vingts'],
      [80_000, 'quatre-vingt mille'],
      [125_000, 'cent vingt-cinq mille'],
      [280_000, 'deux cent quatre-vingt mille'],
      [2_000_000, 'deux millions'],
      [200_000_000, 'deux cents millions'],
      [1_234_567, 'un million deux cent trente-quatre mille cinq cent soixante-sept'],
    ];
    for (const [n, texte] of cas) assert.equal(nombreEnLettres(n), texte, String(n));
    assert.equal(montantEnLettres(17_553), 'Dix-sept mille cinq cent cinquante-trois francs CFA');
  });
});

/** Lot 3 : clients, prix particuliers, bons de livraison, réception, factures et avoirs (§5.5). */
describe('Clients et ventes', () => {
  let srv: ServeurTest;
  let gerant: { poste: IdentiteAppareil; jeton: string };
  const jetons: Record<string, string> = {};
  const g = (m: string, c: string, corps?: unknown) => requete(srv, m, c, { appareil: gerant.poste, jeton: gerant.jeton, corps });
  const en = (qui: string) => (m: string, c: string, corps?: unknown) => requete(srv, m, c, { appareil: gerant.poste, jeton: jetons[qui], corps });
  const ids: Record<string, string> = {};
  const annee = new Date().getFullYear();
  const jour = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const lotsSavon = async () =>
    Object.fromEntries((await sql<{ numero: string; quantite: number }>('SELECT numero, quantite FROM lots WHERE produit_id = $1', [ids.savon])).map((l) => [l.numero, l.quantite]));
  const stockDe = async (id: string) => (await sql<{ stock: number }>('SELECT stock FROM produits WHERE id = $1', [id]))[0].stock;

  async function creerUtilisateur(identifiant: string, roles: string[], plafondRemisePct = 0) {
    const r = await g('POST', '/utilisateurs', { identifiant, nomComplet: identifiant, motDePasseInitial: 'Initial#2026', roles, plafondRemisePct });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    const c = await requete(srv, 'POST', '/auth/connexion', { appareil: gerant.poste, corps: { identifiant, motDePasse: 'Initial#2026' } });
    jetons[identifiant] = c.corps.jeton;
    await en(identifiant)('POST', '/auth/mot-de-passe', { ancienMotDePasse: 'Initial#2026', nouveauMotDePasse: 'Nouveau#2026' });
  }

  before(async () => {
    await viderBase();
    srv = await demarrerServeur();
    gerant = await initialiserAvecGerant(srv);
    await creerUtilisateur('awa', ['commercial'], 5);
    await creerUtilisateur('moussa', ['magasinier']);

    const categories = (await g('GET', '/categories')).corps;
    const soins = categories.find((c: { nom: string }) => c.nom === 'Soins du corps').id;
    const menage = categories.find((c: { nom: string }) => c.nom === 'Ménage et entretien').id;
    const savon = await g('POST', '/produits', {
      designation: 'Savon karité 200 g',
      categorieId: soins,
      suiviLot: true,
      conditionnements: [
        { nom: 'Pièce', nbPieces: 1, prixVente: 350 },
        { nom: 'Carton de 24', nbPieces: 24, prixVente: 7_800 },
      ],
    });
    ids.savon = savon.corps.id;
    const seau = await g('POST', '/produits', { designation: 'Seau 10 L', categorieId: menage, suiviLot: false, conditionnements: [{ nom: 'Pièce', nbPieces: 1 }] });
    ids.seau = seau.corps.id;
    const ds = (await g('GET', `/produits/${ids.savon}`)).corps;
    ids.savonPiece = ds.conditionnements.find((c: { nbPieces: number }) => c.nbPieces === 1).id;
    ids.savonCarton = ds.conditionnements.find((c: { nbPieces: number }) => c.nbPieces === 24).id;
    ids.seauPiece = (await g('GET', `/produits/${ids.seau}`)).corps.conditionnements[0].id;

    const f = await g('POST', '/fournisseurs', { nom: 'Grossiste du port' });
    const achat = await g('POST', '/achats', {
      fournisseurId: f.corps.id,
      date: jour,
      lignes: [
        { produitId: ids.savon, conditionnementId: ids.savonCarton, quantite: 2, prixUnitaire: 4_800, numeroLot: 'LOINTAIN', datePeremption: '2099-12-31' },
        { produitId: ids.savon, conditionnementId: ids.savonCarton, quantite: 1, prixUnitaire: 4_800, numeroLot: 'PROCHE', datePeremption: '2098-01-31' },
        { produitId: ids.savon, conditionnementId: ids.savonPiece, quantite: 10, prixUnitaire: 200, numeroLot: 'PERIME', datePeremption: '2020-01-31' },
        { produitId: ids.seau, conditionnementId: ids.seauPiece, quantite: 10, prixUnitaire: 1_500 },
      ],
    });
    const v = await g('POST', `/achats/${achat.corps.id}/valider`);
    assert.equal(v.statut, 200, JSON.stringify(v.corps));
  });
  after(async () => srv?.arreter());

  it('fiche client : code automatique, doublon refusé, crédit désactivé en V1', async () => {
    const r = await en('awa')('POST', '/clients', { raisonSociale: 'Supermarché Bon Prix', type: 'supermarche', telephone: '+221 33 000 00 00', nif: 'NIF-BP-01' });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    assert.equal(r.corps.code, 'C-0001');
    assert.equal(r.corps.conditionPaiement, 'comptant');
    ids.bonPrix = r.corps.id;
    assert.equal((await g('POST', '/clients', { raisonSociale: 'supermarché bon prix', type: 'supermarche' })).statut, 409);
    const credit = await g('POST', '/clients', { raisonSociale: 'Boutique Awa', type: 'boutique', conditionPaiement: 'credit', delaiPaiementJours: 30 });
    assert.equal(credit.corps.code, 'CREDIT_DESACTIVE');
  });

  it('le magasinier n’a pas accès aux ventes', async () => {
    assert.equal((await en('moussa')('GET', '/clients')).statut, 403);
    assert.equal((await en('moussa')('POST', '/livraisons', { clientId: ids.bonPrix, date: jour, lignes: [] })).statut, 403);
  });

  it('prix particulier : réservé au gérant, appliqué à la place du prix par défaut (R3)', async () => {
    const refus = await en('awa')('PUT', `/clients/${ids.bonPrix}/prix`, { prix: [{ conditionnementId: ids.savonCarton, prix: 7_500 }] });
    assert.equal(refus.statut, 403);
    const ok = await g('PUT', `/clients/${ids.bonPrix}/prix`, { prix: [{ conditionnementId: ids.savonCarton, prix: 7_500 }] });
    assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
    assert.equal(ok.corps[0].prix, 7_500);
    assert.equal(ok.corps[0].prixDefaut, 7_800);
    const journal = await sql("SELECT 1 FROM journal_audit WHERE action = 'client.prix_modifies'");
    assert.equal(journal.length, 1);
  });

  it('remise : refusée au-delà du plafond du commercial, acceptée en dessous', async () => {
    const lignes = [{ produitId: ids.savon, conditionnementId: ids.savonCarton, quantite: 2, remisePct: 5 }];
    const trop = await en('awa')('POST', '/livraisons', { clientId: ids.bonPrix, date: jour, remiseGlobalePct: 1, lignes });
    assert.equal(trop.statut, 403);
    assert.equal(trop.corps.code, 'REMISE_PLAFOND');
    const ok = await en('awa')('POST', '/livraisons', {
      clientId: ids.bonPrix,
      date: jour,
      referenceClient: 'CMD-BP-4521',
      lignes: [...lignes, { produitId: ids.savon, conditionnementId: ids.savonPiece, quantite: 5 }, { produitId: ids.seau, conditionnementId: ids.seauPiece, quantite: 3 }],
    });
    assert.equal(ok.statut, 201, JSON.stringify(ok.corps));
    ids.bl = ok.corps.id;
  });

  it('validation impossible sans prix de vente : rien ne bouge', async () => {
    const v = await en('awa')('POST', `/livraisons/${ids.bl}/valider`);
    assert.equal(v.corps.code, 'PRIX_MANQUANT');
    assert.equal(await stockDe(ids.seau), 10);
    assert.equal(await stockDe(ids.savon), 82);
    // Le gérant fixe le prix du seau.
    const r = await g('PUT', `/produits/${ids.seau}`, {
      designation: 'Seau 10 L',
      categorieId: (await g('GET', `/produits/${ids.seau}`)).corps.categorieId,
      suiviLot: false,
      conditionnements: [{ id: ids.seauPiece, nom: 'Pièce', nbPieces: 1, prixVente: 2_000 }],
    });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
  });

  it('validation du BL : numéro, prix figés, sortie lot par lot en commençant par la péremption la plus proche, jamais un lot périmé', async () => {
    const v = await en('awa')('POST', `/livraisons/${ids.bl}/valider`);
    assert.equal(v.statut, 200, JSON.stringify(v.corps));
    assert.equal(v.corps.numero, `BL-${annee}-00001`);
    assert.equal(v.corps.totalHT, 14_250 + 1_750 + 6_000);
    assert.deepEqual(await lotsSavon(), { PROCHE: 0, LOINTAIN: 48 - 29, PERIME: 10 });
    assert.equal(await stockDe(ids.seau), 7);
    const d = await g('GET', `/livraisons/${ids.bl}`);
    assert.equal(d.corps.statut, 'livre');
    assert.deepEqual(d.corps.lignes[0].lots.map((l: { numero: string; quantite: number }) => [l.numero, l.quantite]), [['PROCHE', 24], ['LOINTAIN', 24]]);
    assert.equal(d.corps.lignes[0].prixUnitaire, 7_500);
    assert.ok(d.corps.coutTotal > 0, 'le gérant voit le coût de la vente (R2)');
    assert.equal((await en('awa')('GET', `/livraisons/${ids.bl}`)).corps.coutTotal, undefined);
    const modif = await en('awa')('PUT', `/livraisons/${ids.bl}`, { clientId: ids.bonPrix, date: jour, lignes: [] });
    assert.equal(modif.statut, 409);
    assert.equal((await en('awa')('DELETE', `/livraisons/${ids.bl}`)).statut, 409);
    const mvts = await sql("SELECT count(*)::int AS n FROM mouvements_stock WHERE type = 'vente' AND document_id = $1", [ids.bl]);
    assert.equal(mvts[0].n, 4);
  });

  it('stock insuffisant : refus sans consommer de numéro (R4, R6)', async () => {
    const b = await en('awa')('POST', '/livraisons', { clientId: ids.bonPrix, date: jour, lignes: [{ produitId: ids.seau, conditionnementId: ids.seauPiece, quantite: 100 }] });
    const v = await en('awa')('POST', `/livraisons/${b.corps.id}/valider`);
    assert.equal(v.statut, 409);
    assert.equal(v.corps.code, 'STOCK_INSUFFISANT');
    assert.equal(await stockDe(ids.seau), 7);
    await en('awa')('DELETE', `/livraisons/${b.corps.id}`);
    const seq = await sql<{ derniere_valeur: number }>("SELECT derniere_valeur FROM sequences_documents WHERE type = 'BL'");
    assert.equal(seq[0].derniere_valeur, 1);
  });

  it('réception : les refus reviennent en stock dans leur lot, avec motif obligatoire', async () => {
    const lignes = (await g('GET', `/livraisons/${ids.bl}`)).corps.lignes as { id: string; quantite: number }[];
    const saisie = (motif: string | null) => ({
      lignes: [
        { ligneId: lignes[0].id, quantiteAcceptee: 1, motifRefus: motif },
        { ligneId: lignes[1].id, quantiteAcceptee: 5 },
        { ligneId: lignes[2].id, quantiteAcceptee: 3 },
      ],
    });
    assert.equal((await en('awa')('POST', `/livraisons/${ids.bl}/reception`, saisie(null))).corps.code, 'MOTIF_REQUIS');
    assert.equal((await en('awa')('POST', `/livraisons/${ids.bl}/reception`, { lignes: [{ ligneId: lignes[0].id, quantiteAcceptee: 2 }] })).corps.code, 'RECEPTION_INCOMPLETE');
    const r = await en('awa')('POST', `/livraisons/${ids.bl}/reception`, saisie('Date trop courte'));
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.equal(r.corps.statut, 'receptionne');
    assert.deepEqual(await lotsSavon(), { PROCHE: 24, LOINTAIN: 19, PERIME: 10 });
  });

  it('facture : quantités acceptées, TVA des paramètres, numéro FAC, une seule facture par BL', async () => {
    const p = (await g('GET', '/parametres')).corps;
    const { tauxTvaPct: _t, tvaActive: _a, ...reste } = p;
    const maj = await g('PUT', '/parametres', { ...reste, tvaActive: true, tauxTvaPct: 18 });
    assert.equal(maj.statut, 200, JSON.stringify(maj.corps));

    const f = await en('awa')('POST', `/livraisons/${ids.bl}/facturer`);
    assert.equal(f.statut, 200, JSON.stringify(f.corps));
    assert.equal(f.corps.numero, `FAC-${annee}-00001`);
    ids.facture = f.corps.id;
    const d = (await g('GET', `/factures/${ids.facture}`)).corps;
    assert.deepEqual(d.lignes.map((l: { montant: number }) => l.montant), [7_125, 1_750, 6_000]);
    assert.equal(d.totalHT, 14_875);
    assert.equal(d.tva, 2_678);
    assert.equal(d.totalTTC, 17_553);
    assert.equal(d.referenceClient, 'CMD-BP-4521');
    assert.equal(d.statutPaiement, 'non_payee');
    assert.equal(d.resteDu, 17_553);
    assert.equal(typeof d.marge, 'number');
    assert.equal((await en('awa')('POST', `/livraisons/${ids.bl}/facturer`)).statut, 409);
    const client = (await g('GET', '/clients')).corps.find((c: { id: string }) => c.id === ids.bonPrix);
    assert.equal(client.resteDu, 17_553);
  });

  it('avoir : réservé au gérant, montant proportionnel, retour en stock ou en casse', async () => {
    const lignes = (await g('GET', `/factures/${ids.facture}`)).corps.lignes as { id: string }[];
    const corps = {
      motif: 'Articles abîmés au rayon',
      lignes: [
        { factureLigneId: lignes[1].id, quantite: 2, destination: 'stock' },
        { factureLigneId: lignes[2].id, quantite: 1, destination: 'casse' },
      ],
    };
    assert.equal((await en('awa')('POST', `/factures/${ids.facture}/avoirs`, corps)).statut, 403);
    const a = await g('POST', `/factures/${ids.facture}/avoirs`, corps);
    assert.equal(a.statut, 201, JSON.stringify(a.corps));
    assert.equal(a.corps.numero, `AV-${annee}-00001`);
    assert.equal(a.corps.totalTTC, 2_700 + 486);
    assert.deepEqual(await lotsSavon(), { PROCHE: 24, LOINTAIN: 21, PERIME: 10 });
    assert.equal(await stockDe(ids.seau), 7, 'le seau abîmé revient puis sort en casse');
    const casse = await sql("SELECT count(*)::int AS n FROM mouvements_stock WHERE type = 'casse' AND document_id = $1", [a.corps.id]);
    assert.equal(casse[0].n, 1);
    const trop = await g('POST', `/factures/${ids.facture}/avoirs`, { motif: 'Encore', lignes: [{ factureLigneId: lignes[1].id, quantite: 4, destination: 'stock' }] });
    assert.equal(trop.corps.code, 'RETOUR_EXCESSIF');
    const r = (await g('GET', '/ventes/resume')).corps;
    assert.equal(r.caJour, 14_875 - 2_700);
    assert.equal(r.livraisonsJour, 1);
  });

  it('retour du reste : les avoirs retombent exactement sur la facture (R7, R8)', async () => {
    const lignes = (await g('GET', `/factures/${ids.facture}`)).corps.lignes as { id: string }[];
    const a = await g('POST', `/factures/${ids.facture}/avoirs`, {
      motif: 'Annulation de la commande',
      lignes: [
        { factureLigneId: lignes[0].id, quantite: 1, destination: 'stock' },
        { factureLigneId: lignes[1].id, quantite: 3, destination: 'stock' },
        { factureLigneId: lignes[2].id, quantite: 2, destination: 'stock' },
      ],
    });
    assert.equal(a.statut, 201, JSON.stringify(a.corps));
    const d = (await g('GET', `/factures/${ids.facture}`)).corps;
    assert.equal(d.montantAvoirs, d.totalTTC);
    assert.equal(d.statutPaiement, 'annulee');
    assert.equal(d.avoirs.length, 2);
    assert.equal(await stockDe(ids.savon), 82, 'tout le savon livré est revenu');
    assert.equal(await stockDe(ids.seau), 9);
    assert.equal((await g('GET', '/ventes/resume')).corps.caJour, 0);
    const av = (await g('GET', `/avoirs/${a.corps.id}`)).corps;
    assert.equal(av.facture.numero, `FAC-${annee}-00001`);
    assert.equal(av.lignes.length, 3);
  });

  it('tout refusé à la livraison : le BL est « retourné » et rien n’est facturé', async () => {
    const b = await g('POST', '/livraisons', { clientId: ids.bonPrix, date: jour, lignes: [{ produitId: ids.seau, conditionnementId: ids.seauPiece, quantite: 2 }] });
    await g('POST', `/livraisons/${b.corps.id}/valider`);
    assert.equal(await stockDe(ids.seau), 7);
    const ligne = (await g('GET', `/livraisons/${b.corps.id}`)).corps.lignes[0];
    const r = await g('POST', `/livraisons/${b.corps.id}/reception`, { lignes: [{ ligneId: ligne.id, quantiteAcceptee: 0, motifRefus: 'Commande annulée' }] });
    assert.equal(r.corps.statut, 'retourne');
    assert.equal(await stockDe(ids.seau), 9);
    assert.equal((await g('POST', `/livraisons/${b.corps.id}/facturer`)).statut, 409);
  });

  it('le journal d’audit reste intègre', async () => {
    const r = await g('GET', '/audit/verification');
    assert.equal(r.corps.valide, true);
  });
});
