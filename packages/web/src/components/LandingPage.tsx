import type { ReactElement } from "react";

const integrations = ["Google", "Slack", "Notion", "Airtable", "Outlook", "Telegram"];

export function LandingPage({ onStart }: { readonly onStart: () => void }): ReactElement {
  return <main className="landing">
    <nav className="landing-nav" aria-label="Main navigation">
      <button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Spiderz home"><span>✦</span> Spiderz</button>
      <div className="landing-nav-links"><a href="#features">Platform</a><a href="#how-it-works">How it works</a><a href="#integrations">Integrations</a></div>
      <button className="landing-login" onClick={onStart}>Sign in <span aria-hidden="true">→</span></button>
    </nav>

    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow"><span className="status-dot"/> Built for workflows that matter</p>
        <h1>Automate the work that <em>moves you forward.</em></h1>
        <p className="hero-description">Spiderz gives teams one calm, visual place to connect apps, orchestrate processes, and turn every trigger into action.</p>
        <div className="hero-actions"><button className="hero-primary" onClick={onStart}>Build your first workflow <span>→</span></button><a className="hero-secondary" href="#how-it-works">See how it works <span className="play">▶</span></a></div>
        <div className="hero-proof"><div className="avatar-stack"><span>J</span><span>A</span><span>M</span><span>+</span></div><p>Built for teams that value <strong>clarity and control.</strong></p></div>
      </div>
      <div className="hero-art" aria-label="Workflow automation preview">
        <div className="art-glow art-glow-one"/><div className="art-glow art-glow-two"/>
        <div className="workflow-preview">
          <div className="preview-topbar"><span className="preview-logo">✦</span><span>New customer enquiry</span><i/><i/><i/></div>
          <div className="preview-canvas">
            <div className="preview-line line-one"/><div className="preview-line line-two"/>
            <div className="preview-node node-trigger"><span className="node-icon form-icon">▣</span><div><b>Form submitted</b><small>Instant trigger</small></div><span className="node-check">✓</span></div>
            <div className="preview-node node-sheet"><span className="node-icon sheet-icon">▦</span><div><b>Add to Google Sheets</b><small>Contact record</small></div><span className="node-check">✓</span></div>
            <div className="preview-node node-mail"><span className="node-icon mail-icon">✉</span><div><b>Send a welcome email</b><small>Personalised reply</small></div><span className="node-check">✓</span></div>
            <div className="preview-pulse">Live</div>
          </div>
        </div>
      </div>
    </section>

    <section className="logo-strip" id="integrations"><p>Connect the tools your team already relies on</p><div>{integrations.map((name) => <span key={name}>{name}</span>)}</div></section>

    <section className="feature-section" id="features">
      <div className="section-heading"><p className="eyebrow">Designed for momentum</p><h2>Complex workflows,<br/><em>made beautifully simple.</em></h2></div>
      <div className="feature-grid">
        <article className="feature-card feature-card-large"><div className="feature-orb">✦</div><p className="feature-number">01</p><h3>Visual workflows</h3><p>Design powerful automation with a canvas that keeps every step visible, editable, and understandable.</p><div className="mini-canvas"><span/><span/><span/><i/><i/></div></article>
        <article className="feature-card"><div className="feature-icon">⌘</div><p className="feature-number">02</p><h3>Reliable execution</h3><p>Queue-backed runs, retry-aware jobs, and clear execution history give your automation a dependable backbone.</p></article>
        <article className="feature-card"><div className="feature-icon">⌁</div><p className="feature-number">03</p><h3>Your data, your rules</h3><p>Self-hosted architecture, encrypted credentials, role-aware workspaces, and production environments.</p></article>
      </div>
    </section>

    <section className="how-section" id="how-it-works"><div><p className="eyebrow">From idea to action</p><h2>Build once.<br/>Let it run.</h2></div><ol><li><span>01</span><div><h3>Choose a trigger</h3><p>Start from a form, webhook, schedule, or incoming event.</p></div></li><li><span>02</span><div><h3>Connect your tools</h3><p>Compose the steps your team repeats every day.</p></div></li><li><span>03</span><div><h3>Watch work happen</h3><p>Track every run and improve with confidence.</p></div></li></ol></section>

    <section className="landing-cta"><p className="eyebrow">Your next workflow is waiting</p><h2>Make room for the work<br/><em>only humans can do.</em></h2><button className="hero-primary" onClick={onStart}>Get started with Spiderz <span>→</span></button></section>
    <footer className="landing-footer"><button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span>✦</span> Spiderz</button><p>Automation with intention.</p><p>© {new Date().getFullYear()} Spiderz</p></footer>
  </main>;
}
