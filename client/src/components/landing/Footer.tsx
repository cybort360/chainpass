const links = [
  { href: "#", label: "Privacy Policy" },
  { href: "#", label: "Terms of Service" },
  { href: "#", label: "Security Audit" },
  { href: "#", label: "Documentation" },
]

export function Footer() {
  return (
    <footer className="bg-surface w-full py-12 border-t border-monad-deep/30">
      <div className="flex flex-col md:flex-row justify-between items-center px-8 max-w-7xl mx-auto gap-8">
        <div className="flex flex-col items-center md:items-start">
          <div className="text-xl font-bold text-primary mb-4 font-headline">ChainPass</div>
          <p className="text-slate-500 font-body text-sm">© 2026 ChainPass. All rights reserved.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-8">
          {links.map((l) => (
            <a
              key={l.label}
              className="text-slate-500 hover:text-tertiary transition-colors font-body text-sm"
              href={l.href}
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}
