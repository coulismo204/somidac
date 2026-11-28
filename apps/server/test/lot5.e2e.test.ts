import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { anneePrecedente, clesPeriode } from '../src/modules/rapports/synthese.service';
import { demarrerServeur, IdentiteAppareil, initialiserAvecGerant, requete, ServeurTest, viderBase } from './outils';

/**
 * Lot 5 : rapports (§5.7), tableau de bord (§5.1), alertes anti-fraude (§10.3).
 * Jeu de données calculable à la main :
 *  - achat : 100 savons à 600, 20 seaux à 2 000 (CMP savon 600, seau 2 000) ;
 *  - FAC 1 (gérant, Bon Prix) : 10 savons à 1 000 = 10 000 HT, coût 6 000 ;
 *  - FAC 2 (commercial, Boutique) : 2 seaux à 3 000, remise 10 % sur le total = 5 400 HT, coût 4 000 ;
 *  - avoir sur FAC 1 : 2 savons = -2 000 HT, -1 200 de coût ;
 *  => ventes 13 400, coût 8 800, marge 4 600 ; dépense 3 000 ; casse d'un savon : -600 ; résultat 1 000.
 */
describe('Rapports et tableau de bord', () => {
  let srv: ServeurTest;
  let gerant: { poste: IdentiteAppareil; jeton: string };
  const jetons: Record<string, string> = {};
  const g = (m: string, c: string, corps?: unknown) => requete(srv, m, c, { appareil: gerant.poste, jeton: gerant.jeton, corps });
  const en = (qui: string) => (m: string, c: string, corps?: unknown) => requete(srv, m, c, { appareil: gerant.poste, jeton: jetons[qui], corps });
  const jour = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const mois = jour.slice(0, 7);
  const ids: Record<string, string> = {};

  async function creerUtilisateur(identifiant: string, roles: string[], plafondRemisePct = 0) {
    await g('POST', '/utilisateurs', { identifiant, nomComplet: identifiant, motDePasseInitial: 'Initial#2026', roles, plafondRemisePct });
    const c = await requete(srv, 'POST', '/auth/connexion', { appareil: gerant.poste, corps: { identifiant, motDePasse: 'Initial#2026' } });
    jetons[identifiant] = c.corps.jeton;
    await en(identifiant)('POST', '/auth/mot-de-passe', { ancienMotDePasse: 'Initial#2026', nouveauMotDePasse: 'Nouveau#2026' });
  }
  async function livrerEtFacturer(qui: (m: string, c: string, corps?: unknown) => ReturnType<typeof g>, corps: unknown) {
    const bl = await qui('POST', '/livraisons', corps);
    await qui('POST', `/livraisons/${bl.corps.id}/valider`);
    const lignes = (await qui('GET', `/livraisons/${bl.corps.id}`)).corps.lignes as { id: string; quantite: number }[];
    await qui('POST', `/livraisons/${bl.corps.id}/reception`, { lignes: lignes.map((l) => ({ ligneId: l.id, quantiteAcceptee: l.quantite })) });
    return (await qui('POST', `/livraisons/${bl.corps.id}/facturer`)).corps.id as string;
  }

  before(async () => {
    await viderBase();
    srv = await demarrerServeur();
    gerant = await initialiserAvecGerant(srv);
    await creerUtilisateur('awa', ['commercial'], 10);
    await creerUtilisateur('moussa', ['magasinier']);
    await creerUtilisateur('fatou', ['caissier']);

    const cats = (await g('GET', '/categories')).corps;
    const cat = (n: string) => cats.find((c: { nom: string }) => c.nom === n).id;
    ids.savon = (await g('POST', '/produits', { designation: 'Savon', categorieId: cat('Soins du corps'), suiviLot: false, conditionnements: [{ nom: 'Pièce', nbPieces: 1, prixVente: 1_000 }] })).corps.id;
    ids.seau = (await g('POST', '/produits', { designation: 'Seau', categorieId: cat('Ménage et entretien'), suiviLot: false, seuilAlerte: 20, conditionnements: [{ nom: 'Pièce', nbPieces: 1, prixVente: 3_000 }] })).corps.id;
    const c = async (p: string) => (await g('GET', `/produits/${p}`)).corps.conditionnements[0].id as string;
    ids.cSavon = await c(ids.savon);
    ids.cSeau = await c(ids.seau);
    const f = (await g('POST', '/fournisseurs', { nom: 'Grossiste Central' })).corps.id;
    const a = await g('POST', '/achats', {
      fournisseurId: f,
      date: jour,
      lignes: [
        { produitId: ids.savon, conditionnementId: ids.cSavon, quantite: 100, prixUnitaire: 600 },
        { produitId: ids.seau, conditionnementId: ids.cSeau, quantite: 20, prixUnitaire: 2_000 },
      ],
    });
    await g('POST', `/achats/${a.corps.id}/valider`);
    const bonPrix = (await g('POST', '/clients', { raisonSociale: 'Bon Prix', type: 'supermarche' })).corps.id;
    const boutique = (await g('POST', '/clients', { raisonSociale: 'Boutique Awa', type: 'boutique' })).corps.id;

    const fac1 = await livrerEtFacturer(g, { clientId: bonPrix, date: jour, lignes: [{ produitId: ids.savon, conditionnementId: ids.cSavon, quantite: 10 }] });
    await livrerEtFacturer(en('awa'), { clientId: boutique, date: jour, remiseGlobalePct: 10, lignes: [{ produitId: ids.seau, conditionnementId: ids.cSeau, quantite: 2 }] });
    const l1 = (await g('GET', `/factures/${fac1}`)).corps.lignes[0].id;
    await g('POST', `/factures/${fac1}/avoirs`, { motif: 'Retour', lignes: [{ factureLigneId: l1, quantite: 2, destination: 'stock' }] });

    const caisse = (await g('GET', '/tresorerie/comptes')).corps[0];
    ids.caisse = caisse.id;
    await g('PUT', `/tresorerie/comptes/${caisse.id}`, { nom: caisse.nom, type: 'caisse', soldeInitial: 100_000 });
    const cd = (await g('GET', '/categories-depenses')).corps.find((x: { nom: string }) => x.nom === 'Transport').id;
    await g('POST', '/depenses', { date: jour, categorieId: cd, compteId: caisse.id, montant: 3_000, libelle: 'Taxi' });
    await g('POST', '/stock/ajustements', { produitId: ids.savon, type: 'casse', quantite: -1, motif: 'Savon écrasé' });
  });
  after(async () => srv?.arreter());

  it('ventes du mois : totaux, marge, regroupements par produit, client et catégorie', async () => {
    const r = (await g('GET', `/rapports/ventes?du=${jour}&au=${jour}&groupe=produit`)).corps;
    assert.deepEqual(r.totaux, { pieces: 10, factures: 2, ca: 13_400, cout: 8_800, marge: 4_600, tauxMarge: 34.3 });
    assert.deepEqual(r.lignes.map((l: { libelle: string; ca: number; cout: number }) => [l.libelle, l.ca, l.cout]), [['Savon', 8_000, 4_800], ['Seau', 5_400, 4_000]]);
    const clients = (await g('GET', `/rapports/ventes?groupe=client`)).corps;
    assert.deepEqual(clients.lignes.map((l: { libelle: string; ca: number }) => [l.libelle, l.ca]), [['Bon Prix', 8_000], ['Boutique Awa', 5_400]]);
    const cats = (await g('GET', `/rapports/ventes?groupe=categorie`)).corps;
    assert.equal(cats.lignes[0].libelle, 'Soins du corps');
    const vendeurs = (await g('GET', `/rapports/ventes?groupe=vendeur`)).corps;
    assert.deepEqual(vendeurs.lignes.map((l: { libelle: string; ca: number }) => [l.libelle, l.ca]).sort(), [['Gérant', 8_000], ['awa', 5_400]]);
    const jours = (await g('GET', `/rapports/ventes?groupe=jour`)).corps;
    assert.equal(jours.lignes.length, 1);
    assert.equal(jours.lignes[0].ca, 13_400);
  });

  it('le commercial ne voit que ses ventes, sans les coûts ; le magasinier n’y a pas accès (§3)', async () => {
    const r = (await en('awa')('GET', '/rapports/ventes?groupe=produit')).corps;
    assert.equal(r.sesVentesSeulement, true);
    assert.equal(r.totaux.ca, 5_400);
    assert.equal(r.totaux.marge, undefined);
    assert.equal(r.lignes.length, 1);
    assert.equal((await en('moussa')('GET', '/rapports/ventes')).statut, 403);
    assert.equal((await en('awa')('GET', '/rapports/stock')).statut, 403);
    assert.equal((await en('awa')('GET', '/rapports/resultat')).statut, 403);
  });

  it('stock valorisé et rotation ; le magasinier voit les quantités sans les valeurs', async () => {
    const r = (await g('GET', '/rapports/stock')).corps;
    const savon = r.produits.find((p: { designation: string }) => p.designation === 'Savon');
    assert.equal(savon.stock, 91);
    assert.equal(savon.ventes, 10);
    assert.equal(savon.valeur, 91 * 600);
    assert.equal(r.totaux.valeur, 91 * 600 + 18 * 2_000);
    const m = (await en('moussa')('GET', '/rapports/stock')).corps;
    assert.equal(m.totaux.valeur, undefined);
    assert.equal(m.produits[0].valeur, undefined);
  });

  it('achats par fournisseur et par produit', async () => {
    const r = (await g('GET', '/rapports/achats')).corps;
    assert.deepEqual(r.totaux, { achats: 1, montant: 100_000, frais: 0, total: 100_000, paye: 0, reste: 100_000 });
    const p = (await g('GET', '/rapports/achats?groupe=produit')).corps;
    assert.deepEqual(p.lignes.map((l: { libelle: string; pieces: number }) => [l.libelle, l.pieces]), [['Savon', 100], ['Seau', 20]]);
  });

  it('résultat simplifié du mois : ventes - coût - dépenses - pertes de stock', async () => {
    const r = (await g('GET', `/rapports/resultat?mois=${mois}`)).corps;
    assert.equal(r.ventes, 13_400);
    assert.equal(r.coutMarchandises, 8_800);
    assert.equal(r.margeBrute, 4_600);
    assert.equal(r.totalDepenses, 3_000);
    assert.deepEqual(r.pertesStock, [{ type: 'casse', libelle: 'Casse', valeur: -600 }]);
    assert.equal(r.resultat, 1_000);
    assert.equal((await en('fatou')('GET', `/rapports/resultat?mois=${mois}`)).statut, 200, 'le caissier voit les coûts et tous les rapports');
  });

  it('trésorerie : soldes de début et de fin ; caisse masquée pour le caissier', async () => {
    const r = (await g('GET', `/rapports/tresorerie?du=${mois}-01&au=${jour}`)).corps;
    assert.deepEqual(r.comptes[0], { id: ids.caisse, nom: 'Caisse espèces', type: 'caisse', masque: false, debut: 0, entrees: 100_000, sorties: 3_000, fin: 97_000 });
    const c = (await en('fatou')('GET', `/rapports/tresorerie?du=${mois}-01&au=${jour}`)).corps;
    assert.equal(c.comptes[0].fin, null);
  });

  it('actions sensibles du jour et alertes anti-fraude (§10.3)', async () => {
    const p = (await g('GET', '/parametres')).corps;
    await g('PUT', '/parametres', { ...p, heureOuverture: '00:00', heureFermeture: '23:59' });
    const r = (await g('GET', '/rapports/actions-sensibles')).corps;
    const actions = r.actions.map((a: { action: string }) => a.action);
    assert.ok(actions.includes('avoir.emis'));
    assert.ok(actions.includes('stock.casse'));
    assert.ok(r.actions.some((a: { libelle: string }) => a.libelle === 'Livraison avec remise'));
    assert.ok(!actions.includes('facture.emise'));
    assert.equal((await en('fatou')('GET', '/rapports/actions-sensibles')).statut, 403);

    // Écart de caisse au-delà du seuil (5 000 FCFA par défaut).
    const clo = await g('POST', '/clotures', { compteId: ids.caisse, montantCompte: 91_000, justification: 'Billet manquant' });
    assert.equal(clo.corps.statut, 'validee');
    // Heures d'ouverture vides : toute opération est hors heures.
    await g('PUT', '/parametres', { ...p, heureOuverture: '00:00', heureFermeture: '00:00' });
    const a = (await g('GET', '/tableau-de-bord')).corps.alertes;
    assert.deepEqual(a.ecartsCaisse.map((e: { ecart: number }) => e.ecart), [-6_000]);
    assert.ok(a.horsHeures > 0);
  });

  it('synthèse du tableau de bord : indicateurs, évolution, classements, filtres', async () => {
    assert.equal(anneePrecedente('2028-02-29'), '2027-02-28');
    assert.deepEqual(clesPeriode('2026-11-28', '2027-02-03', 'mois'), ['2026-11', '2026-12', '2027-01', '2027-02']);
    const s = (await g('GET', `/tableau-de-bord/synthese?du=${jour}&au=${jour}`)).corps;
    assert.equal(s.indicateurs.ca.valeur, 13_400);
    assert.equal(s.indicateurs.ca.variation, null, 'aucune vente l’an dernier : pas de pourcentage');
    assert.equal(s.indicateurs.marge.valeur, 4_600);
    assert.equal(s.indicateurs.ventes.valeur, 2);
    assert.equal(s.indicateurs.panierMoyen.valeur, 6_700);
    assert.deepEqual(s.serie, [{ cle: jour, ca: 13_400, caN1: 0, marge: 4_600, margeN1: 0 }]);
    assert.deepEqual(s.produits.map((p: { libelle: string; ca: number }) => [p.libelle, p.ca]), [['Savon', 8_000], ['Seau', 5_400]]);
    assert.deepEqual(s.categories.map((c: { libelle: string; ca: number }) => [c.libelle, c.ca]), [['Soins du corps', 8_000], ['Ménage et entretien', 5_400]]);
    const bonPrix = s.clients.find((c: { libelle: string }) => c.libelle === 'Bon Prix');
    assert.equal(bonPrix.ca, 8_000);
    assert.equal(bonPrix.avoirs, 2_000);
    assert.equal(s.stock.valeurCout, 91 * 600 + 18 * 2_000);
    assert.equal(s.stock.valeurVente, 91 * 1_000 + 18 * 3_000);

    const cat = s.categories[1].id;
    const filtre = (await g('GET', `/tableau-de-bord/synthese?du=${jour}&au=${jour}&categorieId=${cat}`)).corps;
    assert.equal(filtre.indicateurs.ca.valeur, 5_400);
    assert.equal(filtre.produits.length, 1);
    assert.equal(filtre.stock.valeurCout, 18 * 2_000);
    const mois = (await g('GET', `/tableau-de-bord/synthese?du=${jour}&au=${jour}&granularite=mois`)).corps;
    assert.deepEqual(mois.serie.map((x: { cle: string }) => x.cle), [jour.slice(0, 7)]);

    const c = (await en('awa')('GET', `/tableau-de-bord/synthese?du=${jour}&au=${jour}`)).corps;
    assert.equal(c.sesVentesSeulement, true);
    assert.equal(c.indicateurs.ca.valeur, 5_400);
    assert.equal(c.indicateurs.marge, undefined);
    assert.equal(c.stock.valeurCout, undefined);
    assert.equal((await en('moussa')('GET', '/tableau-de-bord/synthese')).statut, 403);
  });

  it('tableau de bord selon le rôle (§5.1)', async () => {
    const t = (await g('GET', '/tableau-de-bord')).corps;
    assert.equal(t.ventes.caJour, 13_400);
    assert.equal(t.ventes.margeMois, 4_600);
    assert.equal(t.ventes.livraisonsJour, 2);
    assert.equal(t.ventes.top[0].libelle, 'Savon');
    assert.equal(t.stock.nbStockBas, 1);
    assert.equal(t.stock.stockBas[0].designation, 'Seau');
    assert.equal(t.tresorerie.parType.caisse, 91_000);
    assert.ok(t.alertes);

    const c = (await en('awa')('GET', '/tableau-de-bord')).corps;
    assert.equal(c.ventes.sesVentesSeulement, true);
    assert.equal(c.ventes.caMois, 5_400);
    assert.equal(c.ventes.margeMois, null);
    assert.equal(c.tresorerie, undefined);
    assert.equal(c.alertes, undefined);
    const m = (await en('moussa')('GET', '/tableau-de-bord')).corps;
    assert.equal(m.ventes, undefined);
    assert.equal(m.stock.nbStockBas, 1);
    assert.equal(m.stock.valeur, undefined);
  });
});
