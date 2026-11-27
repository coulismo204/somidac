import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EXE = process.platform === 'win32' ? '.exe' : '';

export interface OptionsPostgres {
  /** Dossier des exécutables (initdb, pg_ctl, postgres). */
  binDir: string;
  /** Dossier des données de la base. */
  dataDir: string;
  /** Dossier des journaux. */
  journalDir: string;
  port: number;
  utilisateur: string;
}

/**
 * PostgreSQL embarqué sur le poste principal (§4) :
 * n'écoute que sur 127.0.0.1, seul le serveur SOMIDAC s'y connecte (§10.4).
 */
export class PostgresEmbarque {
  constructor(private readonly o: OptionsPostgres) {}

  private outil(nom: string) {
    const chemin = path.join(this.o.binDir, nom + EXE);
    if (!fs.existsSync(chemin)) throw new Error(`PostgreSQL introuvable : ${chemin}`);
    return chemin;
  }

  private executer(nom: string, args: string[], delaiMs = 120_000) {
    const r = spawnSync(this.outil(nom), args, { encoding: 'utf8', windowsHide: true, timeout: delaiMs });
    let sortie = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`;
    // 0xC0000135 : une DLL manque (le plus souvent les bibliothèques Visual C++ de Microsoft).
    if (r.status === 3221225781 || r.status === -1073741515) {
      sortie = `${nom} ne peut pas démarrer : bibliothèque Windows manquante (Visual C++). ` +
        'Installez « Microsoft Visual C++ Redistributable x64 » (https://aka.ms/vs/17/release/vc_redist.x64.exe). ' + sortie;
    }
    return { code: r.status ?? -1, sortie };
  }

  get initialisee(): boolean {
    return fs.existsSync(path.join(this.o.dataDir, 'PG_VERSION'));
  }

  /** Première installation : création de la base avec un mot de passe aléatoire. */
  initialiser(motDePasse: string) {
    if (this.initialisee) return;
    fs.mkdirSync(this.o.dataDir, { recursive: true });
    const fichierMdp = path.join(path.dirname(this.o.dataDir), `.initdb-${crypto.randomBytes(6).toString('hex')}`);
    fs.writeFileSync(fichierMdp, motDePasse, { mode: 0o600 });
    try {
      const r = this.executer('initdb', [
        '-D',
        this.o.dataDir,
        '-U',
        this.o.utilisateur,
        `--pwfile=${fichierMdp}`,
        '--auth=scram-sha-256',
        '--encoding=UTF8',
        '--no-locale',
      ]);
      if (r.code !== 0) throw new Error(`Échec de création de la base : ${r.sortie}`);
    } finally {
      fs.rmSync(fichierMdp, { force: true });
    }
    // Réglages SOMIDAC : écoute locale uniquement.
    fs.appendFileSync(
      path.join(this.o.dataDir, 'postgresql.conf'),
      [
        '',
        '# --- SOMIDAC ---',
        "listen_addresses = '127.0.0.1'",
        // Pas de socket local : uniquement TCP sur 127.0.0.1 (identique sous Windows et en test).
        "unix_socket_directories = ''",
        `port = ${this.o.port}`,
        'max_connections = 40',
        "password_encryption = 'scram-sha-256'",
        "timezone = 'UTC'",
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(this.o.dataDir, 'pg_hba.conf'),
      [
        '# SOMIDAC : seules les connexions locales avec mot de passe sont acceptées',
        'local   all   all                 scram-sha-256',
        'host    all   all   127.0.0.1/32  scram-sha-256',
        '',
      ].join('\n'),
    );
  }

  enCours(): boolean {
    return this.executer('pg_ctl', ['status', '-D', this.o.dataDir], 15_000).code === 0;
  }

  demarrer() {
    if (this.enCours()) return;
    fs.mkdirSync(this.o.journalDir, { recursive: true });
    const r = this.executer('pg_ctl', [
      'start',
      '-D',
      this.o.dataDir,
      '-l',
      path.join(this.o.journalDir, 'postgresql.log'),
      '-w',
      '-t',
      '90',
      '-o',
      `-p ${this.o.port}`,
    ]);
    if (r.code !== 0) throw new Error(`PostgreSQL n'a pas démarré : ${r.sortie}`);
  }

  arreter() {
    if (!this.enCours()) return;
    this.executer('pg_ctl', ['stop', '-D', this.o.dataDir, '-m', 'fast', '-w', '-t', '60'], 90_000);
  }

  /** Crée la base applicative si elle n'existe pas encore (connexion directe, sans outil externe). */
  async creerBase(nom: string, motDePasse: string) {
    const { Client } = await import('pg');
    const client = new Client({
      host: '127.0.0.1',
      port: this.o.port,
      user: this.o.utilisateur,
      password: motDePasse,
      database: 'postgres',
      connectionTimeoutMillis: 15_000,
    });
    await client.connect();
    try {
      const r = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [nom]);
      if (r.rowCount === 0) await client.query(`CREATE DATABASE "${nom.replace(/"/g, '')}"`);
    } finally {
      await client.end();
    }
  }
}
