CREATE TYPE "public"."sens_paiement" AS ENUM('client', 'fournisseur');--> statement-breakpoint
CREATE TYPE "public"."statut_cloture" AS ENUM('a_valider', 'validee', 'refusee');--> statement-breakpoint
CREATE TYPE "public"."statut_operation" AS ENUM('valide', 'annule');--> statement-breakpoint
CREATE TYPE "public"."type_compte" AS ENUM('caisse', 'mobile_money', 'banque');--> statement-breakpoint
CREATE TYPE "public"."type_operation_tresorerie" AS ENUM('ouverture', 'encaissement', 'paiement_fournisseur', 'depense', 'transfert', 'ecart_cloture', 'annulation');--> statement-breakpoint
CREATE TABLE "categories_depenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text NOT NULL,
	"actif" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clotures_caisse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compte_id" uuid NOT NULL,
	"jour" date NOT NULL,
	"solde_calcule" bigint NOT NULL,
	"montant_compte" bigint NOT NULL,
	"ecart" bigint NOT NULL,
	"justification" text,
	"statut" "statut_cloture" DEFAULT 'a_valider' NOT NULL,
	"commentaire" text,
	"saisie_par" uuid,
	"saisie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"valide_par" uuid,
	"valide_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comptes_tresorerie" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text NOT NULL,
	"type" "type_compte" NOT NULL,
	"reference" text,
	"solde_initial" bigint DEFAULT 0 NOT NULL,
	"solde" bigint DEFAULT 0 NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"date" date NOT NULL,
	"categorie_id" uuid NOT NULL,
	"compte_id" uuid NOT NULL,
	"montant" bigint NOT NULL,
	"libelle" text NOT NULL,
	"beneficiaire" text,
	"statut" "statut_operation" DEFAULT 'valide' NOT NULL,
	"motif_annulation" text,
	"annule_par" uuid,
	"annule_le" timestamp with time zone,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depenses_montant" CHECK ("depenses"."montant" > 0)
);
--> statement-breakpoint
CREATE TABLE "mouvements_tresorerie" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compte_id" uuid NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"montant" bigint NOT NULL,
	"solde_apres" bigint NOT NULL,
	"type" "type_operation_tresorerie" NOT NULL,
	"document_type" text,
	"document_id" uuid,
	"libelle" text NOT NULL,
	"utilisateur_id" uuid
);
--> statement-breakpoint
CREATE TABLE "paiement_affectations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paiement_id" uuid NOT NULL,
	"facture_id" uuid,
	"achat_id" uuid,
	"montant" bigint NOT NULL,
	CONSTRAINT "paiement_affectations_montant" CHECK ("paiement_affectations"."montant" > 0)
);
--> statement-breakpoint
CREATE TABLE "paiements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"sens" "sens_paiement" NOT NULL,
	"client_id" uuid,
	"fournisseur_id" uuid,
	"compte_id" uuid NOT NULL,
	"date" date NOT NULL,
	"montant" bigint NOT NULL,
	"reference" text,
	"notes" text,
	"statut" "statut_operation" DEFAULT 'valide' NOT NULL,
	"motif_annulation" text,
	"annule_par" uuid,
	"annule_le" timestamp with time zone,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paiements_montant" CHECK ("paiements"."montant" > 0),
	CONSTRAINT "paiements_tiers" CHECK (("paiements"."sens" = 'client' AND "paiements"."client_id" IS NOT NULL) OR ("paiements"."sens" = 'fournisseur' AND "paiements"."fournisseur_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "pieces_jointes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_type" text NOT NULL,
	"document_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"type_mime" text NOT NULL,
	"taille" integer NOT NULL,
	"contenu_base64" text NOT NULL,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transferts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"compte_source_id" uuid NOT NULL,
	"compte_destination_id" uuid NOT NULL,
	"montant" bigint NOT NULL,
	"libelle" text,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transferts_montant" CHECK ("transferts"."montant" > 0),
	CONSTRAINT "transferts_comptes" CHECK ("transferts"."compte_source_id" <> "transferts"."compte_destination_id")
);
--> statement-breakpoint
ALTER TABLE "achats" ADD COLUMN "compte_paiement_id" uuid;--> statement-breakpoint
ALTER TABLE "clotures_caisse" ADD CONSTRAINT "clotures_caisse_compte_id_comptes_tresorerie_id_fk" FOREIGN KEY ("compte_id") REFERENCES "public"."comptes_tresorerie"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clotures_caisse" ADD CONSTRAINT "clotures_caisse_saisie_par_utilisateurs_id_fk" FOREIGN KEY ("saisie_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clotures_caisse" ADD CONSTRAINT "clotures_caisse_valide_par_utilisateurs_id_fk" FOREIGN KEY ("valide_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depenses" ADD CONSTRAINT "depenses_categorie_id_categories_depenses_id_fk" FOREIGN KEY ("categorie_id") REFERENCES "public"."categories_depenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depenses" ADD CONSTRAINT "depenses_compte_id_comptes_tresorerie_id_fk" FOREIGN KEY ("compte_id") REFERENCES "public"."comptes_tresorerie"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depenses" ADD CONSTRAINT "depenses_annule_par_utilisateurs_id_fk" FOREIGN KEY ("annule_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depenses" ADD CONSTRAINT "depenses_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_tresorerie" ADD CONSTRAINT "mouvements_tresorerie_compte_id_comptes_tresorerie_id_fk" FOREIGN KEY ("compte_id") REFERENCES "public"."comptes_tresorerie"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_tresorerie" ADD CONSTRAINT "mouvements_tresorerie_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiement_affectations" ADD CONSTRAINT "paiement_affectations_paiement_id_paiements_id_fk" FOREIGN KEY ("paiement_id") REFERENCES "public"."paiements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiement_affectations" ADD CONSTRAINT "paiement_affectations_facture_id_factures_id_fk" FOREIGN KEY ("facture_id") REFERENCES "public"."factures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiement_affectations" ADD CONSTRAINT "paiement_affectations_achat_id_achats_id_fk" FOREIGN KEY ("achat_id") REFERENCES "public"."achats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_fournisseur_id_fournisseurs_id_fk" FOREIGN KEY ("fournisseur_id") REFERENCES "public"."fournisseurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_compte_id_comptes_tresorerie_id_fk" FOREIGN KEY ("compte_id") REFERENCES "public"."comptes_tresorerie"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_annule_par_utilisateurs_id_fk" FOREIGN KEY ("annule_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces_jointes" ADD CONSTRAINT "pieces_jointes_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferts" ADD CONSTRAINT "transferts_compte_source_id_comptes_tresorerie_id_fk" FOREIGN KEY ("compte_source_id") REFERENCES "public"."comptes_tresorerie"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferts" ADD CONSTRAINT "transferts_compte_destination_id_comptes_tresorerie_id_fk" FOREIGN KEY ("compte_destination_id") REFERENCES "public"."comptes_tresorerie"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferts" ADD CONSTRAINT "transferts_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_depenses_nom_uq" ON "categories_depenses" USING btree (lower("nom"));--> statement-breakpoint
CREATE UNIQUE INDEX "clotures_caisse_jour_uq" ON "clotures_caisse" USING btree ("compte_id","jour") WHERE "clotures_caisse"."statut" <> 'refusee';--> statement-breakpoint
CREATE INDEX "clotures_caisse_jour_idx" ON "clotures_caisse" USING btree ("jour");--> statement-breakpoint
CREATE UNIQUE INDEX "comptes_tresorerie_nom_uq" ON "comptes_tresorerie" USING btree (lower("nom"));--> statement-breakpoint
CREATE UNIQUE INDEX "depenses_numero_uq" ON "depenses" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "depenses_date_idx" ON "depenses" USING btree ("date");--> statement-breakpoint
CREATE INDEX "mouvements_tresorerie_compte_date_idx" ON "mouvements_tresorerie" USING btree ("compte_id","date");--> statement-breakpoint
CREATE INDEX "mouvements_tresorerie_document_idx" ON "mouvements_tresorerie" USING btree ("document_type","document_id");--> statement-breakpoint
CREATE INDEX "paiement_affectations_paiement_idx" ON "paiement_affectations" USING btree ("paiement_id");--> statement-breakpoint
CREATE INDEX "paiement_affectations_facture_idx" ON "paiement_affectations" USING btree ("facture_id");--> statement-breakpoint
CREATE INDEX "paiement_affectations_achat_idx" ON "paiement_affectations" USING btree ("achat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paiements_numero_uq" ON "paiements" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "paiements_date_idx" ON "paiements" USING btree ("date");--> statement-breakpoint
CREATE INDEX "pieces_jointes_document_idx" ON "pieces_jointes" USING btree ("document_type","document_id");