import { InputHTMLAttributes, ReactNode, useEffect, useId } from 'react';

export function Champ({
  libelle,
  aide,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { libelle: string; aide?: ReactNode }) {
  const id = useId();
  return (
    <div className={`champ ${className ?? ''}`}>
      <label htmlFor={id}>{libelle}</label>
      <input id={id} {...props} />
      {aide && <span className="aide">{aide}</span>}
    </div>
  );
}

export function Message({ type, children }: { type: 'erreur' | 'succes' | 'info' | 'attention'; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`message ${type}`} role={type === 'erreur' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Modale({
  titre,
  onFermer,
  children,
  pied,
  large,
}: {
  titre: string;
  onFermer: () => void;
  children: ReactNode;
  pied?: ReactNode;
  large?: boolean;
}) {
  useEffect(() => {
    const echap = (e: KeyboardEvent) => e.key === 'Escape' && onFermer();
    window.addEventListener('keydown', echap);
    return () => window.removeEventListener('keydown', echap);
  }, [onFermer]);
  return (
    <div className="voile" onMouseDown={(e) => e.target === e.currentTarget && onFermer()}>
      <div className="modale" role="dialog" aria-modal="true" aria-label={titre} style={large ? { maxWidth: 720 } : undefined}>
        <div className="entete-modale">
          <h2>{titre}</h2>
          <button className="bouton discret" onClick={onFermer} aria-label="Fermer">
            <Icone nom="fermer" />
          </button>
        </div>
        <div className="corps-modale">{children}</div>
        {pied && <div className="pied-modale">{pied}</div>}
      </div>
    </div>
  );
}

const CHEMINS: Record<string, string> = {
  tableau: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z',
  produits: 'M20 7l-8-4-8 4v10l8 4 8-4zM12 12l8-4M12 12v9M12 12L4 8',
  stock: 'M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10',
  achats: 'M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z',
  ventes: 'M3 17l6-6 4 4 8-8M14 7h7v7',
  tresorerie: 'M3 7h18v12H3zM3 11h18M7 15h3',
  rapports: 'M6 3h9l5 5v13H6zM14 3v6h6M9 13h6M9 17h6',
  utilisateurs: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm13 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  appareils: 'M4 5h16v10H4zM8 19h8M12 15v4',
  parametres: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2l.4 2.6h5l.4-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  journal: 'M12 8v4l3 3M3.05 11a9 9 0 11.5 4M3 4v5h5',
  'mise-en-service': 'M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9',
  verrou: 'M6 11h12v10H6zM8 11V7a4 4 0 118 0v4',
  sortie: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  fermer: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  serveur: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  poste: 'M4 5h16v10H4zM8 19h8M12 15v4',
  cle: 'M15 7a4 4 0 11-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0115 7z',
  bouclier: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  copier: 'M8 8h12v12H8zM4 16V4h12',
  sauvegarde: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
  cle2: 'M7 14a4 4 0 110-8 4 4 0 010 8zm3-4h11v3h-2v3h-3v-3h-6',
};

export function Icone({ nom, taille = 18 }: { nom: keyof typeof CHEMINS | string; taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={CHEMINS[nom] ?? ''} />
    </svg>
  );
}
