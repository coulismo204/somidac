CREATE TYPE "public"."statut_appareil" AS ENUM('en_attente', 'actif', 'revoque');--> statement-breakpoint
CREATE TABLE "appareils" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"statut" "statut_appareil" DEFAULT 'en_attente' NOT NULL,
	"id_code" text,
	"secret_code" text,
	"code_expire_le" timestamp with time zone,
	"tentatives_code" integer DEFAULT 0 NOT NULL,
	"empreinte_cle_publique" text,
	"numero_serie_certificat" text,
	"certificat_pem" text,
	"certificat_expire_le" timestamp with time zone,
	"infos_systeme" jsonb,
	"enregistre_le" timestamp with time zone,
	"derniere_connexion" timestamp with time zone,
	"dernier_utilisateur_id" uuid,
	"revoque_le" timestamp with time zone,
	"revoque_par" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"cree_par" uuid
);
--> statement-breakpoint
CREATE TABLE "journal_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"horodatage" timestamp with time zone NOT NULL,
	"utilisateur_id" uuid,
	"appareil_id" uuid,
	"action" text NOT NULL,
	"entite" text,
	"entite_id" text,
	"avant" jsonb,
	"apres" jsonb,
	"details" jsonb,
	"hash_precedent" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parametres" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"raison_sociale" text DEFAULT 'SOMIDAC SARL' NOT NULL,
	"slogan" text,
	"adresse" text,
	"telephone" text,
	"email" text,
	"nif" text,
	"rccm" text,
	"coordonnees_bancaires" text,
	"devise" text DEFAULT 'FCFA' NOT NULL,
	"tva_active" boolean DEFAULT false NOT NULL,
	"taux_tva_bp" integer DEFAULT 0 NOT NULL,
	"delai_alerte_peremption_jours" integer DEFAULT 90 NOT NULL,
	"nb_max_appareils" integer DEFAULT 5 NOT NULL,
	"modules_actifs" text[] NOT NULL,
	"initialise" boolean DEFAULT false NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_par" uuid
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"libelle" text NOT NULL,
	"systeme" boolean DEFAULT false NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sequences_documents" (
	"type" text NOT NULL,
	"annee" integer NOT NULL,
	"derniere_valeur" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sequences_documents_type_annee_pk" PRIMARY KEY("type","annee")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"appareil_id" uuid NOT NULL,
	"hash_jeton" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"derniere_activite" timestamp with time zone DEFAULT now() NOT NULL,
	"expire_le" timestamp with time zone NOT NULL,
	"verrouillee" boolean DEFAULT false NOT NULL,
	"fermee_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nom" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "utilisateur_roles" (
	"utilisateur_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "utilisateur_roles_utilisateur_id_role_id_pk" PRIMARY KEY("utilisateur_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "utilisateurs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"identifiant" text NOT NULL,
	"nom_complet" text NOT NULL,
	"hash_mot_de_passe" text NOT NULL,
	"doit_changer_mot_de_passe" boolean DEFAULT true NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"plafond_remise_pct" integer DEFAULT 0 NOT NULL,
	"echecs_connexion" integer DEFAULT 0 NOT NULL,
	"bloque_jusqu_a" timestamp with time zone,
	"derniere_connexion" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"cree_par" uuid,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appareils" ADD CONSTRAINT "appareils_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_appareil_id_appareils_id_fk" FOREIGN KEY ("appareil_id") REFERENCES "public"."appareils"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utilisateur_roles" ADD CONSTRAINT "utilisateur_roles_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utilisateur_roles" ADD CONSTRAINT "utilisateur_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utilisateurs" ADD CONSTRAINT "utilisateurs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appareils_id_code_uq" ON "appareils" USING btree ("id_code");--> statement-breakpoint
CREATE UNIQUE INDEX "appareils_serie_uq" ON "appareils" USING btree ("numero_serie_certificat");--> statement-breakpoint
CREATE INDEX "journal_audit_entite_idx" ON "journal_audit" USING btree ("entite","entite_id");--> statement-breakpoint
CREATE INDEX "journal_audit_horodatage_idx" ON "journal_audit" USING btree ("horodatage");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_hash_uq" ON "sessions" USING btree ("hash_jeton");--> statement-breakpoint
CREATE INDEX "sessions_utilisateur_idx" ON "sessions" USING btree ("utilisateur_id");--> statement-breakpoint
CREATE UNIQUE INDEX "utilisateurs_identifiant_uq" ON "utilisateurs" USING btree ("identifiant");