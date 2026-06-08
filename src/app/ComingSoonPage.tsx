export function ComingSoonPage({ title = 'Feature' }: { title?: string }) {
  return (
    <section className="coming-soon-page" aria-labelledby="coming-soon-title">
      <div>
        <p>{title}</p>
        <h2 id="coming-soon-title">Feature coming soon.</h2>
      </div>
    </section>
  );
}
