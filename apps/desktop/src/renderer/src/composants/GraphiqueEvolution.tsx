import { useEffect, useRef, useState } from 'react';
import { formaterMontant } from '../format';

/**
 * Évolution du chiffre d'affaires et de la marge, période contre année précédente.
 * Deux panneaux empilés sur le même axe des dates (jamais deux échelles sur un même graphique) ;
 * la période en trait plein, l'année précédente en pointillé : l'identité ne repose pas sur la
 * seule couleur. Palette validée (bleu #2563c9, or #c9a24a : contraste, daltonisme).
 */

export interface PointEvolution {
  cle: string;
  ca: number;
  caN1: number;
  marge?: number;
  margeN1?: number;
}

const COULEUR = '#2563c9';
const COULEUR_N1 = '#c9a24a';
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function libelleCle(cle: string, long = false): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(cle)) return long ? `${cle.slice(8)}/${cle.slice(5, 7)}/${cle.slice(0, 4)}` : `${cle.slice(8)}/${cle.slice(5, 7)}`;
  if (/^\d{4}-\d{2}$/.test(cle)) return `${MOIS[Number(cle.slice(5)) - 1]} ${long ? cle.slice(0, 4) : cle.slice(2, 4)}`;
  return cle;
}

/** 1 250 000 → « 1,3 M » ; 85 000 → « 85 k ». */
function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (a >= 1_000) return `${Math.round(v / 1_000).toLocaleString('fr-FR')} k`;
  return v.toLocaleString('fr-FR');
}

/** Graduations « rondes » de 0 au maximum. */
function graduations(max: number): number[] {
  if (max <= 0) return [0, 1];
  const brut = max / 3;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut) ?? brut;
  const res: number[] = [];
  for (let v = 0; v <= max + pas * 0.001; v += pas) res.push(v);
  if (res[res.length - 1] < max) res.push(res[res.length - 1] + pas);
  return res;
}

const MARGE_G = 52;
const MARGE_D = 14;

function Panneau({
  titre,
  points,
  actuel,
  precedent,
  largeur,
  hauteur,
  survol,
  axeX,
}: {
  titre: string;
  points: PointEvolution[];
  actuel: (p: PointEvolution) => number;
  precedent: (p: PointEvolution) => number;
  largeur: number;
  hauteur: number;
  survol: number | null;
  axeX: boolean;
}) {
  const haut = 10;
  const bas = axeX ? 22 : 6;
  const h = hauteur - haut - bas;
  const w = largeur - MARGE_G - MARGE_D;
  const ticks = graduations(Math.max(1, ...points.map((p) => Math.max(actuel(p), precedent(p), 0))));
  const max = ticks[ticks.length - 1];
  const min = Math.min(0, ...points.map((p) => Math.min(actuel(p), precedent(p))));
  const x = (i: number) => MARGE_G + (points.length === 1 ? w / 2 : (i * w) / (points.length - 1));
  const y = (v: number) => haut + h - ((v - min) / (max - min || 1)) * h;
  const chemin = (f: (p: PointEvolution) => number) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join(' ');
  const pasLibelle = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(w / 70))));
  const peuDePoints = points.length <= 2;
  return (
    <svg width={largeur} height={hauteur} role="img" aria-label={titre} style={{ display: 'block' }}>
      <text x={4} y={haut + h / 2} transform={`rotate(-90 10 ${haut + h / 2})`} className="graphe-titre-axe">{titre}</text>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={MARGE_G} x2={largeur - MARGE_D} y1={y(t)} y2={y(t)} className="graphe-grille" />
          <text x={MARGE_G - 6} y={y(t) + 4} textAnchor="end" className="graphe-axe">{compact(t)}</text>
        </g>
      ))}
      {axeX &&
        points.map((p, i) =>
          i % pasLibelle === 0 || i === points.length - 1 ? (
            <text key={p.cle} x={x(i)} y={hauteur - 6} textAnchor="middle" className="graphe-axe">{libelleCle(p.cle)}</text>
          ) : null,
        )}
      <path d={chemin(precedent)} fill="none" stroke={COULEUR_N1} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
      <path d={chemin(actuel)} fill="none" stroke={COULEUR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {survol !== null && <line x1={x(survol)} x2={x(survol)} y1={haut} y2={haut + h} className="graphe-repere" />}
      {points.map((p, i) =>
        peuDePoints || survol === i ? (
          <g key={`m${p.cle}`}>
            <circle cx={x(i)} cy={y(precedent(p))} r={4} fill="#fff" stroke={COULEUR_N1} strokeWidth={2} />
            <circle cx={x(i)} cy={y(actuel(p))} r={4} fill={COULEUR} stroke="#fff" strokeWidth={2} />
          </g>
        ) : null,
      )}
    </svg>
  );
}

export function GraphiqueEvolution({ points, avecMarge }: { points: PointEvolution[]; avecMarge: boolean }) {
  const boite = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(600);
  const [survol, setSurvol] = useState<number | null>(null);
  useEffect(() => {
    if (!boite.current) return;
    const o = new ResizeObserver(([e]) => setLargeur(Math.max(300, Math.floor(e.contentRect.width))));
    o.observe(boite.current);
    return () => o.disconnect();
  }, []);
  const hauteurs = avecMarge ? [150, 128] : [210];
  const w = largeur - MARGE_G - MARGE_D;
  const indice = (clientX: number) => {
    const r = boite.current!.getBoundingClientRect();
    const rel = clientX - r.left - MARGE_G;
    return points.length === 1 ? 0 : Math.max(0, Math.min(points.length - 1, Math.round((rel / w) * (points.length - 1))));
  };
  const p = survol !== null ? points[survol] : undefined;
  const xSurvol = survol === null ? 0 : MARGE_G + (points.length === 1 ? w / 2 : (survol * w) / (points.length - 1));

  return (
    <div
      ref={boite}
      className="graphe"
      onPointerMove={(e) => setSurvol(indice(e.clientX))}
      onPointerLeave={() => setSurvol(null)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') setSurvol((s) => Math.min(points.length - 1, (s ?? -1) + 1));
        if (e.key === 'ArrowLeft') setSurvol((s) => Math.max(0, (s ?? points.length) - 1));
      }}
      onBlur={() => setSurvol(null)}
    >
      <Panneau titre="Chiffre d’affaires" points={points} actuel={(x) => x.ca} precedent={(x) => x.caN1} largeur={largeur} hauteur={hauteurs[0]} survol={survol} axeX={!avecMarge} />
      {avecMarge && <Panneau titre="Marge" points={points} actuel={(x) => x.marge ?? 0} precedent={(x) => x.margeN1 ?? 0} largeur={largeur} hauteur={hauteurs[1]} survol={survol} axeX />}
      {p && (
        <div className="graphe-bulle" style={{ left: Math.min(largeur - 210, Math.max(0, xSurvol + 12)) }}>
          <div className="graphe-bulle-titre">{libelleCle(p.cle, true)}</div>
          <LigneBulle couleur={COULEUR} valeur={p.ca} libelle="CA" />
          <LigneBulle couleur={COULEUR_N1} pointille valeur={p.caN1} libelle="CA an dernier" />
          {avecMarge && <LigneBulle couleur={COULEUR} valeur={p.marge ?? 0} libelle="Marge" />}
          {avecMarge && <LigneBulle couleur={COULEUR_N1} pointille valeur={p.margeN1 ?? 0} libelle="Marge an dernier" />}
        </div>
      )}
    </div>
  );
}

function LigneBulle({ couleur, pointille, valeur, libelle }: { couleur: string; pointille?: boolean; valeur: number; libelle: string }) {
  return (
    <div className="graphe-bulle-ligne">
      <svg width={16} height={8} aria-hidden="true"><line x1={1} x2={15} y1={4} y2={4} stroke={couleur} strokeWidth={2} strokeDasharray={pointille ? '4 3' : undefined} /></svg>
      <strong>{formaterMontant(valeur)}</strong>
      <span>{libelle}</span>
    </div>
  );
}

/** Légende : clés en trait, comme les marques qu'elles désignent. */
export function LegendeEvolution({ anneeN1 }: { anneeN1: string }) {
  return (
    <div className="graphe-legende">
      <span><svg width={18} height={8} aria-hidden="true"><line x1={1} x2={17} y1={4} y2={4} stroke={COULEUR} strokeWidth={2} /></svg> Période choisie</span>
      <span><svg width={18} height={8} aria-hidden="true"><line x1={1} x2={17} y1={4} y2={4} stroke={COULEUR_N1} strokeWidth={2} strokeDasharray="5 4" /></svg> Même période {anneeN1}</span>
    </div>
  );
}
