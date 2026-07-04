export type FeedMode = 'tokens' | 'coins';

export function FeedModeSwitch({ value, onChange }: { value: FeedMode; onChange: (value: FeedMode) => void }) {
  return (
    <div className="overview-feed-mode" role="tablist" aria-label="Live Market Feed source">
      {[
        { value: 'tokens' as const, label: 'Tokens' },
        { value: 'coins' as const, label: 'Coins' }
      ].map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={value === item.value ? 'is-active' : ''}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
