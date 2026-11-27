CREATE TYPE "public"."condition_paiement" AS ENUM('comptant', 'credit');--> statement-breakpoint
CREATE TYPE "public"."destination_retour" AS ENUM('stock', 'casse');--> statement-breakpoint
CREATE TYPE "public"."statut_livraison" AS ENUM('brouillon', 'livre', 'receptionne', 'facture', 'retourne');--> statement-breakpoint
CREATE TYPE "public"."type_client" AS ENUM('supermarche', 'boutique', 'revendeur', 'particulier');--> statement-breakpoint
CREATE TABLE "avoir_lignes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"avoir_id" uuid NOT NULL,
	"facture_ligne_id" uuid NOT NULL,
	"ordre" integer NOT NULL,
	"quantite" integer NOT NULL,
	"montant" bigint NOT NULL,
	"destination" "destination_retour" NOT NULL,
	CONSTRAINT "avoir_lignes_quantite" CHECK ("avoir_lignes"."quantite" > 0)
);
--> statement-breakpoint
CREATE TABLE "avoirs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"facture_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"motif" text NOT NULL,
	"total_ht" bigint NOT NULL,
	"tva" bigint NOT NULL,
	"total_ttc" bigint NOT NULL,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bl_lignes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bl_id" uuid NOT NULL,
	"ordre" integer NOT NULL,
	"produit_id" uuid NOT NULL,
	"conditionnement_id" uuid NOT NULL,
	"quantite" integer NOT NULL,
	"prix_unitaire" bigint,
	"remise_bp" integer DEFAULT 0 NOT NULL,
	"montant" bigint,
	"quantite_pieces" integer,
	"cout_piece_centimes" bigint,
	"quantite_acceptee" integer,
	"motif_refus" text,
	CONSTRAINT "bl_lignes_quantite" CHECK ("bl_lignes"."quantite" > 0),
	CONSTRAINT "bl_lignes_acceptee" CHECK ("bl_lignes"."quantite_acceptee" IS NULL OR ("bl_lignes"."quantite_acceptee" >= 0 AND "bl_lignes"."quantite_acceptee" <= "bl_lignes"."quantite")),
	CONSTRAINT "bl_lignes_remise" CHECK ("bl_lignes"."remise_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "bl_sorties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bl_ligne_id" uuid NOT NULL,
	"ordre" integer NOT NULL,
	"lot_id" uuid NOT NULL,
	"quantite" integer NOT NULL,
	"cout_centimes" bigint NOT NULL,
	"quantite_retournee" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bl_sorties_retour" CHECK ("bl_sorties"."quantite_retournee" >= 0 AND "bl_sorties"."quantite_retournee" <= "bl_sorties"."quantite")
);
--> statement-breakpoint
CREATE TABLE "bons_livraison" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text,
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reference_client" text,
	"statut" "statut_livraison" DEFAULT 'brouillon' NOT NULL,
	"remise_globale_bp" integer DEFAULT 0 NOT NULL,
	"total_lignes" bigint DEFAULT 0 NOT NULL,
	"total_ht" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"valide_par" uuid,
	"valide_le" timestamp with time zone,
	"reception_par" uuid,
	"reception_le" timestamp with time zone,
	CONSTRAINT "bons_livraison_remise" CHECK ("bons_livraison"."remise_globale_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"raison_sociale" text NOT NULL,
	"type" "type_client" NOT NULL,
	"contact" text,
	"telephone" text,
	"email" text,
	"adresse" text,
	"nif" text,
	"condition_paiement" "condition_paiement" DEFAULT 'comptant' NOT NULL,
	"delai_paiement_jours" integer DEFAULT 0 NOT NULL,
	"plafond_credit" bigint,
	"bl_sans_prix" boolean DEFAULT false NOT NULL,
	"notes" text,
	"actif" boolean DEFAULT true NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"cree_par" uuid,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facture_lignes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facture_id" uuid NOT NULL,
	"bl_ligne_id" uuid NOT NULL,
	"ordre" integer NOT NULL,
	"produit_id" uuid NOT NULL,
	"conditionnement_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"quantite" integer NOT NULL,
	"prix_unitaire" bigint NOT NULL,
	"remise_bp" integer DEFAULT 0 NOT NULL,
	"montant" bigint NOT NULL,
	"quantite_pieces" integer NOT NULL,
	"cout_piece_centimes" bigint NOT NULL,
	"quantite_retournee" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "facture_lignes_quantite" CHECK ("facture_lignes"."quantite" > 0),
	CONSTRAINT "facture_lignes_retour" CHECK ("facture_lignes"."quantite_retournee" >= 0 AND "facture_lignes"."quantite_retournee" <= "facture_lignes"."quantite")
);
--> statement-breakpoint
CREATE TABLE "factures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text NOT NULL,
	"bl_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"echeance" date NOT NULL,
	"reference_client" text,
	"remise_globale_bp" integer DEFAULT 0 NOT NULL,
	"total_lignes" bigint NOT NULL,
	"remise_globale" bigint NOT NULL,
	"total_ht" bigint NOT NULL,
	"taux_tva_bp" integer DEFAULT 0 NOT NULL,
	"tva" bigint NOT NULL,
	"total_ttc" bigint NOT NULL,
	"montant_paye" bigint DEFAULT 0 NOT NULL,
	"montant_avoirs" bigint DEFAULT 0 NOT NULL,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prix_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"conditionnement_id" uuid NOT NULL,
	"prix" bigint NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_par" uuid,
	CONSTRAINT "prix_clients_positif" CHECK ("prix_clients"."prix" >= 0)
);
--> statement-breakpoint
ALTER TABLE "avoir_lignes" ADD CONSTRAINT "avoir_lignes_avoir_id_avoirs_id_fk" FOREIGN KEY ("avoir_id") REFERENCES "public"."avoirs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avoir_lignes" ADD CONSTRAINT "avoir_lignes_facture_ligne_id_facture_lignes_id_fk" FOREIGN KEY ("facture_ligne_id") REFERENCES "public"."facture_lignes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avoirs" ADD CONSTRAINT "avoirs_facture_id_factures_id_fk" FOREIGN KEY ("facture_id") REFERENCES "public"."factures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avoirs" ADD CONSTRAINT "avoirs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avoirs" ADD CONSTRAINT "avoirs_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bl_lignes" ADD CONSTRAINT "bl_lignes_bl_id_bons_livraison_id_fk" FOREIGN KEY ("bl_id") REFERENCES "public"."bons_livraison"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bl_lignes" ADD CONSTRAINT "bl_lignes_produit_id_produits_id_fk" FOREIGN KEY ("produit_id") REFERENCES "public"."produits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bl_lignes" ADD CONSTRAINT "bl_lignes_conditionnement_id_conditionnements_id_fk" FOREIGN KEY ("conditionnement_id") REFERENCES "public"."conditionnements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bl_sorties" ADD CONSTRAINT "bl_sorties_bl_ligne_id_bl_lignes_id_fk" FOREIGN KEY ("bl_ligne_id") REFERENCES "public"."bl_lignes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bl_sorties" ADD CONSTRAINT "bl_sorties_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bons_livraison" ADD CONSTRAINT "bons_livraison_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bons_livraison" ADD CONSTRAINT "bons_livraison_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bons_livraison" ADD CONSTRAINT "bons_livraison_valide_par_utilisateurs_id_fk" FOREIGN KEY ("valide_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bons_livraison" ADD CONSTRAINT "bons_livraison_reception_par_utilisateurs_id_fk" FOREIGN KEY ("reception_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facture_lignes" ADD CONSTRAINT "facture_lignes_facture_id_factures_id_fk" FOREIGN KEY ("facture_id") REFERENCES "public"."factures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facture_lignes" ADD CONSTRAINT "facture_lignes_bl_ligne_id_bl_lignes_id_fk" FOREIGN KEY ("bl_ligne_id") REFERENCES "public"."bl_lignes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facture_lignes" ADD CONSTRAINT "facture_lignes_produit_id_produits_id_fk" FOREIGN KEY ("produit_id") REFERENCES "public"."produits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facture_lignes" ADD CONSTRAINT "facture_lignes_conditionnement_id_conditionnements_id_fk" FOREIGN KEY ("conditionnement_id") REFERENCES "public"."conditionnements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factures" ADD CONSTRAINT "factures_bl_id_bons_livraison_id_fk" FOREIGN KEY ("bl_id") REFERENCES "public"."bons_livraison"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factures" ADD CONSTRAINT "factures_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factures" ADD CONSTRAINT "factures_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prix_clients" ADD CONSTRAINT "prix_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prix_clients" ADD CONSTRAINT "prix_clients_conditionnement_id_conditionnements_id_fk" FOREIGN KEY ("conditionnement_id") REFERENCES "public"."conditionnements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prix_clients" ADD CONSTRAINT "prix_clients_modifie_par_utilisateurs_id_fk" FOREIGN KEY ("modifie_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avoir_lignes_avoir_idx" ON "avoir_lignes" USING btree ("avoir_id");--> statement-breakpoint
CREATE UNIQUE INDEX "avoirs_numero_uq" ON "avoirs" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "avoirs_facture_idx" ON "avoirs" USING btree ("facture_id");--> statement-breakpoint
CREATE INDEX "bl_lignes_bl_idx" ON "bl_lignes" USING btree ("bl_id");--> statement-breakpoint
CREATE INDEX "bl_sorties_ligne_idx" ON "bl_sorties" USING btree ("bl_ligne_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bons_livraison_numero_uq" ON "bons_livraison" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "bons_livraison_date_idx" ON "bons_livraison" USING btree ("date");--> statement-breakpoint
CREATE INDEX "bons_livraison_client_idx" ON "bons_livraison" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_code_uq" ON "clients" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_raison_sociale_uq" ON "clients" USING btree (lower("raison_sociale"));--> statement-breakpoint
CREATE INDEX "facture_lignes_facture_idx" ON "facture_lignes" USING btree ("facture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "factures_numero_uq" ON "factures" USING btree ("numero");--> statement-breakpoint
CREATE UNIQUE INDEX "factures_bl_uq" ON "factures" USING btree ("bl_id");--> statement-breakpoint
CREATE INDEX "factures_date_idx" ON "factures" USING btree ("date");--> statement-breakpoint
CREATE INDEX "factures_client_idx" ON "factures" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prix_clients_uq" ON "prix_clients" USING btree ("client_id","conditionnement_id");