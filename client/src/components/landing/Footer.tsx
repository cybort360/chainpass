import { Link } from "react-router-dom"

const externalLinks = [
  { href: "https://github.com/cybort360/chainpass", label: "GitHub" },
  { href: "https://faucet.monad.xyz/", label: "Get testnet MON" },
  { href: "https://docs.monad.xyz/", label: "Monad Docs" },
]

export function Footer() {
  return (
    <footer className="bg-surface w-full py-12 border-t border-monad-deep/30">
      <div className="flex flex-col md:flex-row justify-between items-center px-8 max-w-7xl mx-auto gap-8">
        <div className="flex flex-col items-center md:items-start gap-2">
          <div className="text-xl font-bold text-primary font-headline">Hoppr</div>
          <p className="text-slate-500 font-body text-sm">© 2026 Hoppr. All rights reserved.</p>
          <Link
            to="/operators"
            className="text-primary/70 hover:text-primary transition-colors font-body text-sm"
          >
            Buy a ticket →
          </Link>
        </div>
        <div className="flex flex-wrap justify-center gap-8">
          {externalLinks.map((l) => (
            <a
              key={l.label}
              className="text-slate-500 hover:text-tertiary transition-colors font-body text-sm"
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}
