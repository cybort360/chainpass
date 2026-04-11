type Props = {
  title: string
  subtitle?: string
  aside?: string
  className?: string
}

export function SectionHeader({ title, subtitle, aside, className = "" }: Props) {
  return (
    <div
      className={[
        "flex flex-col md:flex-row justify-between items-end mb-16 gap-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div>
        <h2 className="font-headline text-4xl font-bold mb-4 tracking-tight">{title}</h2>
        {subtitle ? <p className="text-on-surface-variant text-lg">{subtitle}</p> : null}
      </div>
      {aside ? (
        <div className="text-primary font-headline font-bold text-xl opacity-60">{aside}</div>
      ) : null}
    </div>
  )
}
