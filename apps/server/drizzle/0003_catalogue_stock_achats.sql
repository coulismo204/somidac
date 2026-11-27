CREATE TYPE "public"."statut_achat" AS ENUM('brouillon', 'valide', 'annule');--> statement-breakpoint
CREATE TYPE "public"."statut_inventaire" AS ENUM('en_cours', 'valide', 'annule');--> statement-breakpoint
CREATE TYPE "public"."type_categorie" AS ENUM('cosmetique', 'bazar');--> statement-breakpoint
CREATE TYPE "public"."type_mouvement" AS ENUM('achat', 'vente', 'retour_client', 'retour_fournisseur', 'ajustement', 'casse', 'peremption', 'inventaire');--> statement-breakpoint
CREATE TABLE "achat_frais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"achat_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"montant" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achat_lignes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"achat_id" uuid NOT NULL,
	"ordre" integer NOT NULL,
	"produit_id" uuid NOT NULL,
	"conditionnement_id" uuid NOT NULL,
	"quantite" integer NOT NULL,
	"prix_unitaire" bigint NOT NULL,
	"numero_lot" text,
	"date_peremption" date,
	"quantite_pieces" integer,
	"montant" bigint,
	"part_frais" bigint,
	"cout_piece_centimes" bigint,
	"lot_id" uuid,
	CONSTRAINT "achat_lignes_quantite" CHECK ("achat_lignes"."quantite" > 0)
);
--> statement-breakpoint
CREATE TABLE "achats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" text,
	"fournisseur_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reference_fournisseur" text,
	"statut" "statut_achat" DEFAULT 'brouillon' NOT NULL,
	"total_marchandises" bigint DEFAULT 0 NOT NULL,
	"total_frais" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"montant_paye" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"valide_par" uuid,
	"valide_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text NOT NULL,
	"type" "type_categorie" NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codes_barres" (
	"code" text PRIMARY KEY NOT NULL,
	"produit_id" uuid NOT NULL,
	"conditionnement_id" uuid
);
--> statement-breakpoint
CREATE TABLE "conditionnements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"produit_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"nb_pieces" integer NOT NULL,
	"prix_vente" bigint,
	"actif" boolean DEFAULT true NOT NULL,
	CONSTRAINT "conditionnements_nb_pieces" CHECK ("conditionnements"."nb_pieces" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fournisseurs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text NOT NULL,
	"telephone" text,
	"adresse" text,
	"nif" text,
	"notes" text,
	"actif" boolean DEFAULT true NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventaire_lignes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventaire_id" uuid NOT NULL,
	"produit_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"quantite_theorique" integer NOT NULL,
	"quantite_comptee" integer
);
--> statement-breakpoint
CREATE TABLE "inventaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"libelle" text NOT NULL,
	"statut" "statut_inventaire" DEFAULT 'en_cours' NOT NULL,
	"cree_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"valide_par" uuid,
	"valide_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"produit_id" uuid NOT NULL,
	"numero" text DEFAULT '' NOT NULL,
	"date_peremption" date,
	"quantite" integer DEFAULT 0 NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lots_quantite_positive" CHECK ("lots"."quantite" >= 0)
);
--> statement-breakpoint
CREATE TABLE "marques" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mouvements_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "type_mouvement" NOT NULL,
	"produit_id" uuid NOT NULL,
	"lot_id" uuid,
	"quantite" integer NOT NULL,
	"cout_centimes" bigint NOT NULL,
	"document_type" text,
	"document_id" uuid,
	"motif" text,
	"utilisateur_id" uuid,
	"date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "produits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"designation" text NOT NULL,
	"categorie_id" uuid NOT NULL,
	"marque_id" uuid,
	"suivi_lot" boolean DEFAULT false NOT NULL,
	"seuil_alerte" integer DEFAULT 0 NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"cmp_centimes" bigint DEFAULT 0 NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"cree_par" uuid,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produits_stock_positif" CHECK ("produits"."stock" >= 0)
);
--> statement-breakpoint
ALTER TABLE "achat_frais" ADD CONSTRAINT "achat_frais_achat_id_achats_id_fk" FOREIGN KEY ("achat_id") REFERENCES "public"."achats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achat_lignes" ADD CONSTRAINT "achat_lignes_achat_id_achats_id_fk" FOREIGN KEY ("achat_id") REFERENCES "public"."achats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achat_lignes" ADD CONSTRAINT "achat_lignes_produit_id_produits_id_fk" FOREIGN KEY ("produit_id") REFERENCES "public"."produits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achat_lignes" ADD CONSTRAINT "achat_lignes_conditionnement_id_conditionnements_id_fk" FOREIGN KEY ("conditionnement_id") REFERENCES "public"."conditionnements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achat_lignes" ADD CONSTRAINT "achat_lignes_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achats" ADD CONSTRAINT "achats_fournisseur_id_fournisseurs_id_fk" FOREIGN KEY ("fournisseur_id") REFERENCES "public"."fournisseurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achats" ADD CONSTRAINT "achats_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achats" ADD CONSTRAINT "achats_valide_par_utilisateurs_id_fk" FOREIGN KEY ("valide_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codes_barres" ADD CONSTRAINT "codes_barres_produit_id_produits_id_fk" FOREIGN KEY ("produit_id") REFERENCES "public"."produits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codes_barres" ADD CONSTRAINT "codes_barres_conditionnement_id_conditionnements_id_fk" FOREIGN KEY ("conditionnement_id") REFERENCES "public"."conditionnements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditionnements" ADD CONSTRAINT "conditionnements_produit_id_produits_id_fk" FOREIGN KEY ("produit_id") REFERENCES "public"."produits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventaire_lignes" ADD CONSTRAINT "inventaire_lignes_inventaire_id_inventaires_id_fk" FOREIGN KEY ("inventaire_id") REFERENCES "public"."inventaires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventaire_lignes" ADD CONSTRAINT "inventaire_lignes_produit_id_produits_id_fk" FOREIGN KEY ("produit_id") REFERENCES "public"."produits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventaire_lignes" ADD CONSTRAINT "inventaire_lignes_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventaires" ADD CONSTRAINT "inventaires_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventaires" ADD CONSTRAINT "inventaires_valide_par_utilisateurs_id_fk" FOREIGN KEY ("valide_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_produit_id_produits_id_fk" FOREIGN KEY ("produit_id") REFERENCES "public"."produits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_produit_id_produits_id_fk" FOREIGN KEY ("produit_id") REFERENCES "public"."produits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvements_stock" ADD CONSTRAINT "mouvements_stock_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produits" ADD CONSTRAINT "produits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produits" ADD CONSTRAINT "produits_categorie_id_categories_id_fk" FOREIGN KEY ("categorie_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produits" ADD CONSTRAINT "produits_marque_id_marques_id_fk" FOREIGN KEY ("marque_id") REFERENCES "public"."marques"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produits" ADD CONSTRAINT "produits_cree_par_utilisateurs_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achat_lignes_achat_idx" ON "achat_lignes" USING btree ("achat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "achats_numero_uq" ON "achats" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "achats_date_idx" ON "achats" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_nom_uq" ON "categories" USING btree (lower("nom"));--> statement-breakpoint
CREATE INDEX "codes_barres_produit_idx" ON "codes_barres" USING btree ("produit_id");--> statement-breakpoint
CREATE INDEX "conditionnements_produit_idx" ON "conditionnements" USING btree ("produit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fournisseurs_nom_uq" ON "fournisseurs" USING btree (lower("nom"));--> statement-breakpoint
CREATE UNIQUE INDEX "inventaire_lignes_lot_uq" ON "inventaire_lignes" USING btree ("inventaire_id","lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lots_produit_numero_peremption_uq" ON "lots" USING btree ("produit_id","numero",coalesce("date_peremption", '9999-12-31'));--> statement-breakpoint
CREATE INDEX "lots_peremption_idx" ON "lots" USING btree ("date_peremption");--> statement-breakpoint
CREATE UNIQUE INDEX "marques_nom_uq" ON "marques" USING btree (lower("nom"));--> statement-breakpoint
CREATE INDEX "mouvements_produit_date_idx" ON "mouvements_stock" USING btree ("produit_id","date");--> statement-breakpoint
CREATE INDEX "mouvements_document_idx" ON "mouvements_stock" USING btree ("document_type","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "produits_code_uq" ON "produits" USING btree ("code");--> statement-breakpoint
CREATE INDEX "produits_designation_idx" ON "produits" USING btree ("designation");