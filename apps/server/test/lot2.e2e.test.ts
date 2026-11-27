import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DB, Db } from '../src/noyau/base/base';
import { nouveauCmp, StockService } from '../src/modules/stock/stock.service';
import { repartirFrais } from '../src/modules/achats/achats.service';
import { demarrerServeur, IdentiteAppareil, initialiserAvecGerant, requete, ServeurTest, sql, viderBase } from './outils';

describe('Règles de calcul (R1)', () => {
  it('exemple du cahier des charges : 40 savons à 250 + 60 à 270 → CMP 262', () => {
    assert.equal(nouveauCmp(40, 25_000, 60, 27_000), 26_200);
  });
  it('stock vide : le CMP devient le coût d’achat', () => {
    assert.equal(nouveauCmp(0, 0, 10, 15_000), 15_000);
  });
  it('les frais sont répartis au prorata et leur somme est exacte', () => {
    const parts = repartirFrais([9_600, 15_000], 2_000);
    assert.deepEqual(parts, [780, 1_220]);
    assert.equal(repartirFrais([1, 1, 1], 100).reduce((t, p) => t + p, 0), 100);
    assert.deepEqual(repartirFrais([500, 500], 0), [0, 0]);
  });
});

/** Lot 2 : produits, fournisseurs, achats, stock et inventaire, de bout en bout (§5.2 à §5.4). */
describe('Produits, achats et stock', () => {
  let srv: ServeurTest;
  let gerant: { poste: IdentiteAppareil; jeton: string };
  let jetonMagasinier = '';
  const g = (m: string, c: string, corps?: unknown) => requete(srv, m, c, { appareil: gerant.poste, jeton: gerant.jeton, corps });
  const mag = (m: string, c: string, corps?: unknown) => requete(srv, m, c, { appareil: gerant.poste, jeton: jetonMagasinier, corps });
  const ids: Record<string, string> = {};
  const annee = new Date().getFullYear();

  before(async () => {
    await viderBase();
    srv = await demarrerServeur();
    gerant = await initialiserAvecGerant(srv);
    await g('POST', '/utilisateurs', { identifiant: 'moussa', nomComplet: 'Moussa Magasin', motDePasseInitial: 'Initial#2026', roles: ['magasinier'] });
    const c = await requete(srv, 'POST', '/auth/connexion', { appareil: gerant.poste, corps: { identifiant: 'moussa', motDePasse: 'Initial#2026' } });
    jetonMagasinier = c.corps.jeton;
    await mag('POST', '/auth/mot-de-passe', { ancienMotDePasse: 'Initial#2026', nouveauMotDePasse: 'Magasin#2026' });
  });
  after(async () => srv?.arreter());

  it('catégories de départ disponibles', async () => {
    const r = await g('GET', '/categories');
    assert.ok(r.corps.length >= 8);
    ids.soins = r.corps.find((c: { nom: string }) => c.nom === 'Soins du corps').id;
    ids.menage = r.corps.find((c: { nom: string }) => c.nom === 'Ménage et entretien').id;
  });

  it('crée un produit suivi par lot, avec code interne, conditionnements et codes-barres', async () => {
    const marque = await g('POST', '/marques', { nom: 'Karité Plus' });
    const r = await g('POST', '/produits', {
      designation: 'Savon karité 200 g',
      categorieId: ids.soins,
      marqueId: marque.corps.id,
      suiviLot: true,
      seuilAlerte: 24,
      conditionnements: [
        { nom: 'Pièce', nbPieces: 1, prixVente: 350 },
        { nom: 'Carton de 24', nbPieces: 24, prixVente: 7_800 },
      ],
      codesBarres: [
        { code: '6001234567890', conditionnement: 0 },
        { code: '6001234567891', conditionnement: 1 },
      ],
    });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    assert.equal(r.corps.code, 'P-0001');
    ids.savon = r.corps.id;
    const scan = await g('GET', '/produits/code-barres/6001234567891');
    assert.equal(scan.corps.produit.designation, 'Savon karité 200 g');
    assert.equal(scan.corps.produit.conditionnements.find((c: { id: string }) => c.id === scan.corps.conditionnementId).nbPieces, 24);
  });

  it('refuse un code-barres déjà utilisé', async () => {
    const r = await g('POST', '/produits', {
      designation: 'Autre produit',
      categorieId: ids.soins,
      suiviLot: false,
      conditionnements: [{ nom: 'Pièce', nbPieces: 1 }],
      codesBarres: [{ code: '6001234567890', conditionnement: 0 }],
    });
    assert.equal(r.statut, 409);
    assert.equal(r.corps.code, 'CODE_BARRE_PRIS');
  });

  it('le magasinier crée un produit sans prix, mais ne peut pas fixer de prix', async () => {
    const sansPrix = await mag('POST', '/produits', {
      designation: 'Seau 10 L',
      categorieId: ids.menage,
      suiviLot: false,
      seuilAlerte: 5,
      conditionnements: [{ nom: 'Pièce', nbPieces: 1 }],
    });
    assert.equal(sansPrix.statut, 201, JSON.stringify(sansPrix.corps));
    ids.seau = sansPrix.corps.id;
    const prix = await mag('PUT', `/produits/${ids.seau}`, {
      designation: 'Seau 10 L',
      categorieId: ids.menage,
      suiviLot: false,
      seuilAlerte: 5,
      conditionnements: [{ id: (await g('GET', `/produits/${ids.seau}`)).corps.conditionnements[0].id, nom: 'Pièce', nbPieces: 1, prixVente: 2_000 }],
    });
    assert.equal(prix.statut, 403);
  });

  it('fournisseur : création, doublon refusé', async () => {
    const f = await g('POST', '/fournisseurs', { nom: 'Grossiste Dakar Import', telephone: '+221 77 000 00 00' });
    assert.equal(f.statut, 201);
    ids.fournisseur = f.corps.id;
    const doublon = await g('POST', '/fournisseurs', { nom: 'grossiste dakar import' });
    assert.equal(doublon.statut, 409);
  });

  let conds: { savonPiece: string; savonCarton: string; seauPiece: string };
  it('un achat sans lot pour un produit suivi par lot est refusé, sans rien modifier', async () => {
    const savon = (await g('GET', `/produits/${ids.savon}`)).corps;
    const seau = (await g('GET', `/produits/${ids.seau}`)).corps;
    conds = {
      savonPiece: savon.conditionnements.find((c: { nbPieces: number }) => c.nbPieces === 1).id,
      savonCarton: savon.conditionnements.find((c: { nbPieces: number }) => c.nbPieces === 24).id,
      seauPiece: seau.conditionnements[0].id,
    };
    const a = await mag('POST', '/achats', {
      fournisseurId: ids.fournisseur,
      date: `${annee}-03-10`,
      lignes: [{ produitId: ids.savon, conditionnementId: conds.savonCarton, quantite: 2, prixUnitaire: 4_800 }],
    });
    assert.equal(a.statut, 201);
    const v = await mag('POST', `/achats/${a.corps.id}/valider`);
    assert.equal(v.corps.code, 'LOT_REQUIS');
    assert.equal((await g('GET', `/produits/${ids.savon}`)).corps.stock, 0);
    await mag('DELETE', `/achats/${a.corps.id}`);
  });

  it('validation d’un achat : frais répartis, stock en pièces, coût de revient, numéro ACH', async () => {
    const a = await mag('POST', '/achats', {
      fournisseurId: ids.fournisseur,
      date: `${annee}-03-10`,
      referenceFournisseur: 'FA-889',
      montantPaye: 20_000,
      lignes: [
        { produitId: ids.savon, conditionnementId: conds.savonCarton, quantite: 2, prixUnitaire: 4_800, numeroLot: 'L1', datePeremption: '2099-06-30' },
        { produitId: ids.seau, conditionnementId: conds.seauPiece, quantite: 10, prixUnitaire: 1_500 },
      ],
      frais: [{ libelle: 'Transport', montant: 2_000 }],
    });
    const v = await mag('POST', `/achats/${a.corps.id}/valider`);
    assert.equal(v.statut, 200, JSON.stringify(v.corps));
    assert.equal(v.corps.numero, `ACH-${annee}-00001`);
    assert.equal(v.corps.total, 26_600);
    const d = await g('GET', `/achats/${a.corps.id}`);
    assert.deepEqual(d.corps.lignes.map((l: { partFrais: number }) => l.partFrais), [780, 1_220]);
    assert.deepEqual(d.corps.lignes.map((l: { quantitePieces: number }) => l.quantitePieces), [48, 10]);
    assert.deepEqual(d.corps.lignes.map((l: { coutPieceCentimes: number }) => l.coutPieceCentimes), [21_625, 162_200]);
    const savon = (await g('GET', `/produits/${ids.savon}`)).corps;
    assert.equal(savon.stock, 48);
    assert.equal(savon.cmp, 216);
    const f = (await g('GET', '/fournisseurs')).corps.find((x: { id: string }) => x.id === ids.fournisseur);
    assert.equal(f.resteDu, 6_600);
    const modif = await mag('PUT', `/achats/${a.corps.id}`, { fournisseurId: ids.fournisseur, date: `${annee}-03-10`, lignes: [] });
    assert.equal(modif.corps.code, 'ACHAT_VALIDE');
  });

  it('second achat : le coût moyen pondéré est recalculé (R1)', async () => {
    const a = await g('POST', '/achats', {
      fournisseurId: ids.fournisseur,
      date: `${annee}-03-20`,
      lignes: [{ produitId: ids.savon, conditionnementId: conds.savonCarton, quantite: 1, prixUnitaire: 5_280, numeroLot: 'L2', datePeremption: '2099-03-31' }],
    });
    const v = await g('POST', `/achats/${a.corps.id}/valider`);
    assert.equal(v.corps.numero, `ACH-${annee}-00002`);
    const [p] = await sql<{ stock: number; cmp_centimes: string }>('SELECT stock, cmp_centimes FROM produits WHERE id = $1', [ids.savon]);
    assert.equal(p.stock, 72);
    assert.equal(Number(p.cmp_centimes), 21_750); // (48 × 216,25 + 24 × 220) / 72
  });

  it('l’état du stock classe les lots par péremption et cache les coûts au magasinier', async () => {
    const r = await g('GET', '/stock?recherche=savon');
    const savon = r.corps.produits[0];
    assert.deepEqual(savon.lots.map((l: { numero: string }) => l.numero), ['L2', 'L1']);
    assert.equal(savon.valeur, 15_660);
    const m = await mag('GET', '/stock?recherche=savon');
    assert.equal(m.corps.produits[0].cmp, undefined);
    assert.equal(m.corps.resume.valeurTotale, undefined);
  });

  it('casse : le lot est obligatoire pour un produit suivi par lot', async () => {
    const sansLot = await mag('POST', '/stock/ajustements', { produitId: ids.savon, type: 'casse', quantite: -5, motif: 'Carton abîmé' });
    assert.equal(sansLot.corps.code, 'LOT_REQUIS');
    const lotL2 = (await g('GET', `/produits/${ids.savon}`)).corps.lots.find((l: { numero: string }) => l.numero === 'L2');
    ids.lotL2 = lotL2.id;
    const ok = await mag('POST', '/stock/ajustements', { produitId: ids.savon, lotId: ids.lotL2, type: 'casse', quantite: -5, motif: 'Carton abîmé' });
    assert.equal(ok.statut, 201, JSON.stringify(ok.corps));
    assert.equal(ok.corps.stock, 67);
  });

  it('une vente sort d’abord le lot qui périme en premier, et jamais un lot périmé (R4, R5)', async () => {
    // Un lot déjà périmé (retrouvé lors d'un rangement).
    await g('POST', '/stock/ajustements', { produitId: ids.savon, type: 'ajustement', quantite: 5, motif: 'Retrouvé en réserve', numeroLot: 'VIEUX', datePeremption: '2020-01-01' });
    const stock = srv.app.get(StockService);
    const db = srv.app.get<Db>(DB);
    const detail = await db.transaction((tx) => stock.sortie(tx, { produitId: ids.savon, quantite: 30, type: 'vente', utilisateurId: null }));
    const lots = await sql<{ id: string; numero: string; quantite: number }>('SELECT id, numero, quantite FROM lots WHERE produit_id = $1', [ids.savon]);
    const parNumero = Object.fromEntries(lots.map((l) => [l.numero, l.quantite]));
    assert.deepEqual(detail.map((d) => d.quantite), [19, 11]);
    assert.deepEqual(parNumero, { L1: 37, L2: 0, VIEUX: 5 });
    await assert.rejects(
      db.transaction((tx) => stock.sortie(tx, { produitId: ids.savon, quantite: 38, type: 'vente', utilisateurId: null })),
      (e: { response?: { code?: string } }) => e.response?.code === 'STOCK_INSUFFISANT',
    );
  });

  it('deux sorties simultanées ne peuvent pas vendre les mêmes pièces', async () => {
    const stock = srv.app.get(StockService);
    const db = srv.app.get<Db>(DB);
    const resultats = await Promise.allSettled([
      db.transaction((tx) => stock.sortie(tx, { produitId: ids.savon, quantite: 25, type: 'vente', utilisateurId: null })),
      db.transaction((tx) => stock.sortie(tx, { produitId: ids.savon, quantite: 25, type: 'vente', utilisateurId: null })),
    ]);
    assert.equal(resultats.filter((r) => r.status === 'fulfilled').length, 1);
    const [p] = await sql<{ stock: number }>('SELECT stock FROM produits WHERE id = $1', [ids.savon]);
    assert.equal(p.stock, 17); // 12 (L1) + 5 (VIEUX)
    const [somme] = await sql<{ total: number }>('SELECT sum(quantite)::int AS total FROM mouvements_stock WHERE produit_id = $1', [ids.savon]);
    assert.equal(somme.total, 17, 'le stock est toujours la somme des mouvements');
  });

  it('inventaire : comptage par le magasinier, validation réservée au gérant', async () => {
    const o = await mag('POST', '/inventaires', { libelle: 'Inventaire de test' });
    assert.equal(o.statut, 201, JSON.stringify(o.corps));
    assert.equal((await mag('POST', '/inventaires', { libelle: 'Deuxième' })).corps.code, 'INVENTAIRE_EN_COURS');
    const inv = (await mag('GET', `/inventaires/${o.corps.id}`)).corps;
    const l1 = inv.lignes.find((l: { lotNumero: string }) => l.lotNumero === 'L1');
    const vieux = inv.lignes.find((l: { lotNumero: string }) => l.lotNumero === 'VIEUX');
    await mag('PUT', `/inventaires/${o.corps.id}/comptages`, {
      comptages: [
        { ligneId: l1.id, quantiteComptee: 10 },
        { ligneId: vieux.id, quantiteComptee: 0 },
      ],
    });
    const refus = await mag('POST', `/inventaires/${o.corps.id}/valider`);
    assert.equal(refus.statut, 403);
    const v = await g('POST', `/inventaires/${o.corps.id}/valider`);
    assert.equal(v.statut, 200, JSON.stringify(v.corps));
    assert.equal(v.corps.nbEcarts, 2);
    assert.equal((await g('GET', `/produits/${ids.savon}`)).corps.stock, 10);
  });

  it('alertes : stock bas et lots à écouler', async () => {
    const r = await g('GET', '/stock?alertes=1');
    const savon = r.corps.produits.find((p: { id: string }) => p.id === ids.savon);
    assert.equal(savon.stockBas, true);
    assert.ok(r.corps.resume.stockBas >= 1);
  });

  it('un module désactivé ferme ses écrans', async () => {
    const p = (await g('GET', '/parametres')).corps;
    await g('PUT', '/parametres', { ...p, modulesActifs: ['produits', 'stock', 'tresorerie', 'ventes', 'rapports'] });
    const r = await g('GET', '/achats');
    assert.equal(r.corps.code, 'MODULE_DESACTIVE');
    await g('PUT', '/parametres', p);
  });

  it('journal d’audit intact', async () => {
    const r = await g('GET', '/audit/verification');
    assert.equal(r.corps.valide, true);
  });
});
