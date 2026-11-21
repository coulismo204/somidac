export function ModuleAVenir({ titre, lot, description }: { titre: string; lot: number; description: string }) {
  return (
    <>
      <div className="entete-page">
        <div>
          <h1>{titre}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="carte">
        <div className="vide">Ce module sera livré avec le lot {lot}.</div>
      </div>
    </>
  );
}
