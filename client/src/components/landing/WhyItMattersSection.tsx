import { MaterialIcon } from './MaterialIcon'
import { MotionSection } from './MotionSection'

const rows = [
  { icon: 'check_circle', text: 'Tickets cannot be reused' },
  { icon: 'speed', text: 'Validation is instant' },
  { icon: 'analytics', text: 'Operators get real data' },
] as const

export function WhyItMattersSection() {
  return (
    <MotionSection className="px-8 py-24 max-w-7xl mx-auto">
      <div className="bg-surface-container-high rounded-[3rem] p-12 lg:p-20 relative overflow-hidden">
        <div className="grid lg:grid-cols-2 gap-16 relative z-10">
          <div>
            <h2 className="font-headline text-4xl font-bold mb-10">Why it matters</h2>
            <div className="space-y-8">
              <div className="flex gap-6">
                <div className="text-error font-headline font-bold text-xl shrink-0">01</div>
                <p className="text-lg">
                  <span className="text-error font-bold block mb-1">The Problem:</span>
                  Cash handling, paper waste, and ticket fraud drain transit efficiency.
                </p>
              </div>
              <div className="flex gap-6">
                <div className="text-primary font-headline font-bold text-xl shrink-0">02</div>
                <p className="text-lg">
                  <span className="text-primary font-bold block mb-1">The Solution:</span>
                  Blockchain-verified passes that are impossible to duplicate or forge.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col justify-center space-y-6 bg-surface/50 p-8 rounded-3xl backdrop-blur-sm">
            {rows.map((row, i) => (
              <div
                key={row.text}
                className={[
                  'flex items-center gap-4 pb-4',
                  i < rows.length - 1 ? 'border-b border-outline-variant/20' : '',
                ].join(' ')}
              >
                <MaterialIcon name={row.icon} className="text-tertiary" />
                <span className="text-lg">{row.text}</span>
              </div>
            ))}
            <p className="text-primary-fixed-dim font-headline font-bold text-center mt-4 italic">
              &quot;Better for passengers. Better for operators.&quot;
            </p>
          </div>
        </div>
      </div>
    </MotionSection>
  )
}

