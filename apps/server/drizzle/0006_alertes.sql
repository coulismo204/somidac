ALTER TABLE "parametres" ADD COLUMN "heure_ouverture" text DEFAULT '07:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "parametres" ADD COLUMN "heure_fermeture" text DEFAULT '20:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "parametres" ADD COLUMN "seuil_alerte_ecart" integer DEFAULT 5000 NOT NULL;