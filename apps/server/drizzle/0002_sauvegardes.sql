CREATE TYPE "public"."statut_sauvegarde" AS ENUM('reussie', 'echouee');--> statement-breakpoint
CREATE TABLE "sauvegardes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"declenchement" text NOT NULL,
	"utilisateur_id" uuid,
	"statut" "statut_sauvegarde" NOT NULL,
	"fichier" text,
	"taille" integer,
	"empreinte" text,
	"copies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"erreur" text,
	"duree_ms" integer
);
--> statement-breakpoint
ALTER TABLE "parametres" ADD COLUMN "sauvegarde_heure" text DEFAULT '20:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "parametres" ADD COLUMN "sauvegarde_dossiers" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "parametres" ADD COLUMN "sauvegarde_cle_publique" text;--> statement-breakpoint
ALTER TABLE "parametres" ADD COLUMN "sauvegarde_cle_privee_chiffree" text;--> statement-breakpoint
CREATE INDEX "sauvegardes_cree_le_idx" ON "sauvegardes" USING btree ("cree_le");