import { MaterialIcon } from './MaterialIcon'
import { MotionSection } from './MotionSection'

const tiles = [
  { icon: 'security', color: 'text-error', label: 'Encrypted' },
  { icon: 'timer', color: 'text-tertiary', label: 'Timed Out' },
  { icon: 'hub', color: 'text-primary', label: 'Decentralized' },
  { icon: 'done_all', color: 'text-on-surface', label: 'Immutable' },
] as const

export function SecureByDesignSection() {
  return (
    <MotionSection className="px-8 py-24 max-w-7xl mx-auto">
      <div className="bg-surface-container p-12 lg:p-20 rounded-[3rem] outline outline-1 outline-outline-variant/10 flex flex-col lg:flex-row items-center gap-16">
        <div className="flex-1 space-y-6">
          <div className="inline-block px-4 py-1 rounded-full bg-error/10 text-error font-headline font-bold text-xs uppercase tracking-widest">
            Enterprise Security
          </div>
          <h2 className="font-headline text-4xl font-bold tracking-tight">Secure by design</h2>
          <p className="text-lg text-on-surface-variant leading-relaxed">
            Each ticket is unique and can only be used once. Short-lived QR codes prevent reuse, and validation happens
            instantly. No duplicates. No guesswork.
          </p>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-4 w-full">
          {tiles.map((t) => (
            <div
              key={t.label}
              className="bg-surface-container-highest p-8 rounded-3xl flex flex-col items-center text-center"
            >
              <MaterialIcon name={t.icon} className={`${t.color} text-4xl mb-4`} />
              <span className="text-sm font-bold">{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </MotionSection>
  )
}

