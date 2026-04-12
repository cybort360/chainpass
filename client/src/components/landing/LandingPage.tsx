import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { Header } from './Header'
import { Footer } from './Footer'
import { LandingBackdrop } from './LandingBackdrop'
import { HeroSection } from './HeroSection'
import { TrustStrip } from './TrustStrip'
import { HowItWorks } from './HowItWorks'
import { WhyMonadSection } from './WhyMonadSection'
import { BetterWaySection } from './BetterWaySection'
import { WhyItMattersSection } from './WhyItMattersSection'
import { OperatorsSection } from './OperatorsSection'
import { SecureByDesignSection } from './SecureByDesignSection'
import { FinalCtaSection } from './FinalCtaSection'

export function LandingPage() {
  const { ready, authenticated } = usePrivy()
  const navigate = useNavigate()

  useEffect(() => {
    if (ready && authenticated) {
      navigate('/routes', { replace: true })
    }
  }, [ready, authenticated, navigate])

  return (
    <div className="relative isolate min-h-screen flex flex-col bg-surface">
      <LandingBackdrop />
      <Header />
      <main className="flex-1 pt-[6.5rem] sm:pt-32">
        <HeroSection />
        <TrustStrip />
        <HowItWorks />
        <WhyMonadSection />
        <BetterWaySection />
        <WhyItMattersSection />
        <OperatorsSection />
        <SecureByDesignSection />
        <FinalCtaSection />
      </main>
      <Footer />
    </div>
  )
}

