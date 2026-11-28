import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { demarrerServeur, IdentiteAppareil, initialiserAvecGerant, requete, ServeurTest, sql, viderBase } from './outils';

/** Lot 4 : comptes, encaissements, paiements fournisseurs, dépenses, transferts, clôture de caisse (§5.6, §10.3). */
describe('Trésorerie', () => {
  let srv: ServeurTest;
  let gerant: { poste: IdentiteAppareil; jeton: string };
  let jetonCaissier = '';
  const g = (m: string, c: string, corps?: unknown) => requete(srv, m, c, { appareil: gerant.poste, jeton: gerant.jeton, corps });
  const ca = (m: string, c: string, corps?: unknown) => requete(srv, m, c, { appareil: gerant.poste, jeton: jetonCaissier, corps });
  const ids: Record<string, string> = {};
  const annee = new Date().getFullYear();
  const jour = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const solde = async (id: string) => Number((await sql<{ solde: string }>('SELECT solde FROM comptes_tresorerie WHERE id = $1', [id]))[0].solde);

  before(async () => {
    await viderBase();
    srv = await demarrerServeur();
    gerant = await initialiserAvecGerant(srv);
    await g('POST', '/utilisateurs', { identifiant: 'fatou', nomComplet: 'Fatou Caisse', motDePasseInitial: 'Initial#2026', roles: ['caissier'] });
    const c = await requete(srv, 'POST', '/auth/connexion', { appareil: gerant.poste, corps: { identifiant: 'fatou', motDePasse: 'Initial#2026' } });
    jetonCaissier = c.corps.jeton;
    await ca('POST', '/auth/mot-de-passe', { ancienMotDePasse: 'Initial#2026', nouveauMotDePasse: 'Caisse#2026' });

    // Un produit, un fournisseur, un client, un achat pour avoir du stock, puis une facture de 10 000 FCFA.
    const cat = (await g('GET', '/categories')).corps.find((x: { nom: string }) => x.nom === 'Soins du corps').id;
    ids.produit = (await g('POST', '/produits', { designation: 'Crème 250 ml', categorieId: cat, suiviLot: false, conditionnements: [{ nom: 'Pièce', nbPieces: 1, prixVente: 2_000 }] })).corps.id;
    ids.cond = (await g('GET', `/produits/${ids.produit}`)).corps.conditionnements[0].id;
    ids.fournisseur = (await g('POST', '/fournisseurs', { nom: 'Grossiste Central' })).corps.id;
    const achat = await g('POST', '/achats', { fournisseurId: ids.fournisseur, date: jour, lignes: [{ produitId: ids.produit, conditionnementId: ids.cond, quantite: 50, prixUnitaire: 1_000 }] });
    await g('POST', `/achats/${achat.corps.id}/valider`);
    ids.client = (await g('POST', '/clients', { raisonSociale: 'Supermarché Bon Prix', type: 'supermarche' })).corps.id;
    const bl = await g('POST', '/livraisons', { clientId: ids.client, date: jour, lignes: [{ produitId: ids.produit, conditionnementId: ids.cond, quantite: 5 }] });
    await g('POST', `/livraisons/${bl.corps.id}/valider`);
    const ligne = (await g('GET', `/livraisons/${bl.corps.id}`)).corps.lignes[0];
    await g('POST', `/livraisons/${bl.corps.id}/reception`, { lignes: [{ ligneId: ligne.id, quantiteAcceptee: 5 }] });
    ids.facture = (await g('POST', `/livraisons/${bl.corps.id}/facturer`)).corps.id;
  });
  after(async () => srv?.arreter());

  it('comptes : caisse créée d’office, solde d’ouverture, comptes Mobile Money et banque', async () => {
    const comptes = (await g('GET', '/tresorerie/comptes')).corps;
    assert.equal(comptes.length, 1);
    assert.equal(comptes[0].type, 'caisse');
    ids.caisse = comptes[0].id;
    const ouverture = await g('PUT', `/tresorerie/comptes/${ids.caisse}`, { nom: 'Caisse espèces', type: 'caisse', soldeInitial: 50_000 });
    assert.equal(ouverture.statut, 200, JSON.stringify(ouverture.corps));
    assert.equal(ouverture.corps.solde, 50_000);
    ids.om = (await g('POST', '/tresorerie/comptes', { nom: 'Orange Money', type: 'mobile_money', reference: '77 000 00 00' })).corps.id;
    ids.banque = (await g('POST', '/tresorerie/comptes', { nom: 'Banque XYZ', type: 'banque', soldeInitial: 500_000 })).corps.id;
    assert.equal(await solde(ids.banque), 500_000);
    assert.equal((await ca('POST', '/tresorerie/comptes', { nom: 'Wave', type: 'mobile_money' })).statut, 403);
  });

  it('le caissier ne voit pas le solde de la caisse, mais voit les autres comptes (§10.3)', async () => {
    const comptes = (await ca('GET', '/tresorerie/comptes')).corps;
    const caisse = comptes.find((c: { id: string }) => c.id === ids.caisse);
    assert.equal(caisse.solde, null);
    assert.equal(caisse.soldeMasque, true);
    assert.equal(comptes.find((c: { id: string }) => c.id === ids.banque).solde, 500_000);
  });

  it('encaissement partiel, puis du reste ; jamais plus que le reste dû (R10)', async () => {
    const p1 = await ca('POST', '/paiements/encaissements', { clientId: ids.client, compteId: ids.om, reference: 'OM-123456', affectations: [{ factureId: ids.facture, montant: 4_000 }] });
    assert.equal(p1.statut, 201, JSON.stringify(p1.corps));
    assert.equal(p1.corps.numero, `PAI-${annee}-00001`);
    ids.paiement1 = p1.corps.id;
    let f = (await g('GET', `/factures/${ids.facture}`)).corps;
    assert.equal(f.statutPaiement, 'partielle');
    assert.equal(f.resteDu, 6_000);
    const trop = await ca('POST', '/paiements/encaissements', { clientId: ids.client, compteId: ids.caisse, affectations: [{ factureId: ids.facture, montant: 7_000 }] });
    assert.equal(trop.corps.code, 'PAIEMENT_EXCESSIF');
    const p2 = await ca('POST', '/paiements/encaissements', { clientId: ids.client, compteId: ids.caisse, affectations: [{ factureId: ids.facture, montant: 6_000 }] });
    assert.equal(p2.statut, 201);
    f = (await g('GET', `/factures/${ids.facture}`)).corps;
    assert.equal(f.statutPaiement, 'payee');
    assert.equal(await solde(ids.om), 4_000);
    assert.equal(await solde(ids.caisse), 56_000);
    const recu = (await ca('GET', `/paiements/${p2.corps.id}`)).corps;
    assert.equal(recu.client.raisonSociale, 'Supermarché Bon Prix');
    assert.equal(recu.affectations[0].resteDu, 0);
    assert.equal(recu.compte.type, 'caisse');
  });

  it('achat réglé en partie à la validation : le paiement sort de la caisse ; le reste est payé ensuite', async () => {
    const a = await g('POST', '/achats', {
      fournisseurId: ids.fournisseur,
      date: jour,
      montantPaye: 3_000,
      comptePaiementId: ids.caisse,
      lignes: [{ produitId: ids.produit, conditionnementId: ids.cond, quantite: 10, prixUnitaire: 1_000 }],
    });
    const v = await g('POST', `/achats/${a.corps.id}/valider`);
    assert.equal(v.statut, 200, JSON.stringify(v.corps));
    ids.achat = a.corps.id;
    assert.equal(await solde(ids.caisse), 53_000);
    const [achat] = await sql<{ montant_paye: string }>('SELECT montant_paye FROM achats WHERE id = $1', [ids.achat]);
    assert.equal(Number(achat.montant_paye), 3_000);

    const excessif = await ca('POST', '/paiements/fournisseurs', { fournisseurId: ids.fournisseur, compteId: ids.banque, affectations: [{ achatId: ids.achat, montant: 8_000 }] });
    assert.equal(excessif.corps.code, 'PAIEMENT_EXCESSIF');
    const insuffisant = await ca('POST', '/paiements/fournisseurs', { fournisseurId: ids.fournisseur, compteId: ids.om, affectations: [{ achatId: ids.achat, montant: 5_000 }] });
    assert.equal(insuffisant.corps.code, 'SOLDE_INSUFFISANT');
    const ok = await ca('POST', '/paiements/fournisseurs', { fournisseurId: ids.fournisseur, compteId: ids.banque, reference: 'VIR-889', affectations: [{ achatId: ids.achat, montant: 7_000 }] });
    assert.equal(ok.statut, 201, JSON.stringify(ok.corps));
    assert.equal(await solde(ids.banque), 493_000);
    const fournisseur = (await g('GET', '/fournisseurs')).corps.find((x: { id: string }) => x.id === ids.fournisseur);
    assert.equal(fournisseur.resteDu, 50_000, 'il ne reste que le premier achat, jamais payé');
  });

  it('dépense avec justificatif, annulation réservée au gérant', async () => {
    const cats = (await ca('GET', '/categories-depenses')).corps;
    assert.ok(cats.some((c: { nom: string }) => c.nom === 'Transport'));
    const d = await ca('POST', '/depenses', { date: jour, categorieId: cats.find((c: { nom: string }) => c.nom === 'Transport').id, compteId: ids.caisse, montant: 2_000, libelle: 'Taxi livraison Bon Prix' });
    assert.equal(d.statut, 201, JSON.stringify(d.corps));
    assert.equal(d.corps.numero, `DEP-${annee}-00001`);
    assert.equal(await solde(ids.caisse), 51_000);

    const photo = Buffer.alloc(1_500_000, 7).toString('base64');
    const pj = await ca('POST', '/pieces-jointes', { documentType: 'depense', documentId: d.corps.id, nom: 'recu-taxi.jpg', typeMime: 'image/jpeg', contenu: photo });
    assert.equal(pj.statut, 201, JSON.stringify(pj.corps).slice(0, 300));
    const liste = (await ca('GET', `/pieces-jointes?documentType=depense&documentId=${d.corps.id}`)).corps;
    assert.equal(liste.length, 1);
    assert.equal(liste[0].taille, 1_500_000);
    assert.equal((await ca('GET', `/pieces-jointes/${liste[0].id}`)).corps.contenu.length, photo.length);
    assert.equal((await ca('GET', '/depenses')).corps[0].justificatifs, 1);

    assert.equal((await ca('POST', `/depenses/${d.corps.id}/annuler`, { motif: 'Erreur de saisie' })).statut, 403);
    const annule = await g('POST', `/depenses/${d.corps.id}/annuler`, { motif: 'Erreur de saisie' });
    assert.equal(annule.statut, 200, JSON.stringify(annule.corps));
    assert.equal(await solde(ids.caisse), 53_000);
    assert.equal((await g('POST', `/depenses/${d.corps.id}/annuler`, { motif: 'Encore' })).statut, 409);
  });

  it('transfert de la caisse vers la banque', async () => {
    const t = await ca('POST', '/tresorerie/transferts', { compteSourceId: ids.caisse, compteDestinationId: ids.banque, montant: 10_000, libelle: 'Dépôt à la banque' });
    assert.equal(t.statut, 201, JSON.stringify(t.corps));
    assert.equal(await solde(ids.caisse), 43_000);
    assert.equal(await solde(ids.banque), 503_000);
    const trop = await ca('POST', '/tresorerie/transferts', { compteSourceId: ids.caisse, compteDestinationId: ids.banque, montant: 1_000_000 });
    assert.equal(trop.corps.code, 'SOLDE_INSUFFISANT');
  });

  it('clôture de caisse : saisie à l’aveugle, écart à justifier, validation par le gérant (§10.3)', async () => {
    const sansMotif = await ca('POST', '/clotures', { compteId: ids.caisse, montantCompte: 42_500 });
    assert.equal(sansMotif.corps.code, 'ECART_A_JUSTIFIER');
    assert.doesNotMatch(sansMotif.corps.message, /43/, 'le montant attendu n’est pas révélé au caissier');
    const c = await ca('POST', '/clotures', { compteId: ids.caisse, montantCompte: 42_500, justification: 'Pièce de 500 introuvable' });
    assert.equal(c.statut, 201, JSON.stringify(c.corps));
    assert.equal(c.corps.statut, 'a_valider');
    assert.equal(c.corps.soldeCalcule, null);
    assert.equal(c.corps.ecart, null);
    assert.equal((await ca('POST', '/clotures', { compteId: ids.caisse, montantCompte: 42_500 })).corps.code, 'CLOTURE_DEJA_FAITE');
    assert.equal((await ca('POST', `/clotures/${c.corps.id}/decision`, { decision: 'valider' })).statut, 403);

    const vueGerant = (await g('GET', '/clotures')).corps[0];
    assert.equal(vueGerant.ecart, -500);
    assert.equal(vueGerant.soldeCalcule, 43_000);
    const v = await g('POST', `/clotures/${c.corps.id}/decision`, { decision: 'valider' });
    assert.equal(v.statut, 200, JSON.stringify(v.corps));
    assert.equal(v.corps.statut, 'validee');
    assert.equal(await solde(ids.caisse), 42_500, 'le solde suit l’argent réellement compté');

    const jg = (await g('GET', `/tresorerie/comptes/${ids.caisse}/journal`)).corps;
    assert.equal(jg.operations[0].type, 'ecart_cloture');
    assert.equal(jg.operations[0].soldeApres, 42_500);
    const jc = await ca('GET', `/tresorerie/comptes/${ids.caisse}/journal`);
    assert.equal(jc.statut, 403, 'le journal de la caisse permettrait de recalculer le montant attendu');
    assert.equal((await ca('GET', `/tresorerie/comptes/${ids.banque}/journal`)).statut, 200);
  });

  it('annulation d’un encaissement par le gérant : la facture redevient partiellement payée (R7)', async () => {
    assert.equal((await ca('POST', `/paiements/${ids.paiement1}/annuler`, { motif: 'Transaction OM refusée' })).statut, 403);
    const a = await g('POST', `/paiements/${ids.paiement1}/annuler`, { motif: 'Transaction OM refusée' });
    assert.equal(a.statut, 200, JSON.stringify(a.corps));
    assert.equal(await solde(ids.om), 0);
    const f = (await g('GET', `/factures/${ids.facture}`)).corps;
    assert.equal(f.statutPaiement, 'partielle');
    assert.equal(f.resteDu, 4_000);
    const liste = (await g('GET', '/paiements?sens=client')).corps;
    assert.equal(liste.find((p: { id: string }) => p.id === ids.paiement1).statut, 'annule');
  });

  it('résumé du tableau de bord et intégrité du journal d’audit', async () => {
    const r = (await g('GET', '/tresorerie/resume')).corps;
    assert.deepEqual(r.parType, { caisse: 42_500, mobile_money: 0, banque: 503_000 });
    assert.equal(r.encaissementsJour, 6_000);
    assert.equal(r.dettesFournisseurs, 50_000);
    assert.equal(r.derniereCloture.ecart, -500);
    const rc = (await ca('GET', '/tresorerie/resume')).corps;
    assert.equal(rc.parType.caisse, null);
    assert.equal(rc.total, null);
    assert.equal((await g('GET', '/audit/verification')).corps.valide, true);
  });
});
