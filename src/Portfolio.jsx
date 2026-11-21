import "./portfolio.css";

const skills = [
  "Cybersecurity",
  "Cloud Infrastructure",
  "Attack Detection",
  "JavaScript",
  "Python",
  "Java",
  "C#",
  "PHP",
  "MySQL",
  "Docker",
  "AWS",
  "Networking",
  "UX Design",
];

export default function Portfolio() {
  return (
    <main className="portfolio-shell">
      <header className="portfolio-nav">
        <a className="portfolio-name" href="#top" aria-label="Nelson Tan home">
          <span>NT</span>
          <strong>Nelson Tan</strong>
        </a>
        <nav aria-label="Main navigation">
          <a href="#work">Work</a>
          <a href="#values">Values</a>
          <a href="#about">About</a>
          <a href="https://github.com/woshiniaoshen" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://www.linkedin.com/in/nelson-tan-b58170206/" target="_blank" rel="noreferrer">LinkedIn</a>
        </nav>
      </header>

      <section className="portfolio-hero" id="top">
        <div className="hero-copy">
          <p className="hero-kicker">Cybersecurity · Cloud · Software</p>
          <h1>Nelson Tan</h1>
          <p className="hero-lead">
            Cybersecurity student and developer building secure, practical digital experiences.
          </p>
          <p className="hero-summary">
            I study Computer Science at Singapore Management University on the cybersecurity track,
            with a background in cloud infrastructure and industry experience at Nokia Solutions and Networks.
          </p>
          <div className="hero-actions">
            <a className="primary-link" href="#work">View my work</a>
            <a className="text-link" href="https://github.com/woshiniaoshen" target="_blank" rel="noreferrer">Explore GitHub</a>
          </div>
        </div>
        <div className="hero-facts" aria-label="Profile highlights">
          <div className="hero-signal">
            <span>Current focus</span>
            <strong>Understanding attacks to build stronger defenses.</strong>
          </div>
          <dl>
            <div><dt>Based in</dt><dd>Singapore</dd></div>
            <div><dt>Studying</dt><dd>Computer Science at SMU</dd></div>
            <div><dt>Track</dt><dd>Cybersecurity</dd></div>
          </dl>
        </div>
      </section>

      <section className="portfolio-work" id="work">
        <div className="section-heading">
          <p>Selected work</p>
          <h2>Projects built around real problems</h2>
        </div>

        <article className="project-feature">
          <a className="project-visual" href="/footprint/" aria-label="Open Footprint">
            <img src="/footprint-preview.png" alt="Footprint travel map application" />
          </a>
          <div className="project-copy">
            <p className="project-number">01 · Featured project</p>
            <h3>Footprint</h3>
            <p>
              A travel mapping web app that reads photo location data, builds personal and global heatmaps,
              supports HEIC uploads, and lets users share memories with friends.
            </p>
            <ul>
              <li>React and Vite frontend</li>
              <li>Firebase authentication and Firestore</li>
              <li>Cloudflare deployment</li>
              <li>Privacy controls, messaging, and social activity</li>
            </ul>
            <div className="project-actions">
              <a className="primary-link" href="/footprint/">Launch Footprint</a>
              <a className="text-link" href="https://github.com/woshiniaoshen/Footprint" target="_blank" rel="noreferrer">Source code</a>
            </div>
          </div>
        </article>

        <article className="project-feature project-feature-secondary">
          <a className="project-visual" href="/projects/hardware-store/" aria-label="Open the hardware store demo">
            <img src="/hardware-store-preview.png" alt="Yong Huat Hardware academic website" />
          </a>
          <div className="project-copy">
            <p className="project-number">02 · Polytechnic project</p>
            <h3>Hardware Store</h3>
            <p>
              A responsive PHP and MySQL e-commerce coursework project with product browsing,
              account flows, search, sessions, and profile-image uploads.
            </p>
            <ul>
              <li>PHP and MySQL backend</li>
              <li>Responsive HTML, CSS, and JavaScript</li>
              <li>Product catalogue and account workflows</li>
              <li>Safe read-only portfolio demonstration</li>
            </ul>
            <div className="project-actions">
              <a className="primary-link" href="/projects/hardware-store/">Try the demo</a>
              <a className="text-link" href="https://github.com/woshiniaoshen/Poly-php-project" target="_blank" rel="noreferrer">Source code</a>
            </div>
          </div>
        </article>

        <article className="project-feature project-feature-secondary">
          <a className="project-visual" href="/netwatch/" aria-label="Open NetWatch dashboard">
            <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #0a0f1a 0%, #111827 60%, #0d1f2d 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="80" height="80" viewBox="0 0 64 64" fill="none">
                <rect width="64" height="64" rx="14" fill="#111827" />
                <circle cx="32" cy="32" r="18" stroke="#42d9b8" strokeWidth="2.5" fill="none" />
                <circle cx="32" cy="32" r="10" stroke="#63b3ed" strokeWidth="2" fill="none" />
                <circle cx="32" cy="32" r="3" fill="#e63946" />
                <line x1="32" y1="6" x2="32" y2="14" stroke="#42d9b8" strokeWidth="2" strokeLinecap="round" />
                <line x1="32" y1="50" x2="32" y2="58" stroke="#42d9b8" strokeWidth="2" strokeLinecap="round" />
                <line x1="6" y1="32" x2="14" y2="32" stroke="#42d9b8" strokeWidth="2" strokeLinecap="round" />
                <line x1="50" y1="32" x2="58" y2="32" stroke="#42d9b8" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </a>
          <div className="project-copy">
            <p className="project-number">03 · Security project</p>
            <h3>NetWatch</h3>
            <p>
              A network intrusion detection dashboard that simulates real traffic logs, detects
              port scans, brute-force attempts, and data exfiltration, and visualises threats in real time.
            </p>
            <ul>
              <li>React frontend with live detection rules</li>
              <li>Simulated TCP/UDP event log with 600+ entries</li>
              <li>Traffic volume chart, protocol split, and top-IP ranking</li>
              <li>Threat severity alerts with per-IP flagging</li>
            </ul>
            <div className="project-actions">
              <a className="primary-link" href="/netwatch/">Launch NetWatch</a>
            </div>
          </div>
        </article>

        <article className="project-feature project-feature-secondary">
          <a className="project-visual" href="/wireshark/" aria-label="Open Wireshark Companion">
            <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #0a0f1a 0%, #111827 60%, #0d1f2d 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="80" height="80" viewBox="0 0 64 64" fill="none">
                <rect width="64" height="64" rx="14" fill="#111827" />
                <rect x="10" y="20" width="44" height="6" rx="3" fill="#42d9b8" opacity="0.9" />
                <rect x="10" y="30" width="30" height="6" rx="3" fill="#63b3ed" opacity="0.8" />
                <rect x="10" y="40" width="38" height="6" rx="3" fill="#f2c36b" opacity="0.8" />
                <circle cx="50" cy="23" r="4" fill="#42d9b8" />
                <circle cx="36" cy="33" r="4" fill="#63b3ed" />
                <circle cx="44" cy="43" r="4" fill="#f2c36b" />
              </svg>
            </div>
          </a>
          <div className="project-copy">
            <p className="project-number">04 · Security tool</p>
            <h3>Wireshark Companion</h3>
            <p>
              Drop a <code>.pcap</code> or <code>.pcapng</code> file and get an instant visual breakdown —
              protocol split, traffic timeline, top IPs, and every packet in a searchable table.
              Parses binary data entirely in the browser with no upload.
            </p>
            <ul>
              <li>Custom binary parser for .pcap and .pcapng formats</li>
              <li>Decodes Ethernet, IP, TCP, and UDP headers from raw bytes</li>
              <li>Auto-generates a plain-English capture summary</li>
              <li>Applies NetWatch threat detection rules on real captures</li>
            </ul>
            <div className="project-actions">
              <a className="primary-link" href="/wireshark/">Launch Companion</a>
            </div>
          </div>
        </article>

        <article className="project-feature project-feature-secondary">
          <a className="project-visual" href="/osi/" aria-label="Open OSI Layer Explorer">
            <div style={{ width:"100%", height:"100%", background:"linear-gradient(135deg,#0a0f1a 0%,#111827 60%,#0d1f2d 100%)", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="80" height="80" viewBox="0 0 64 64" fill="none">
                <rect width="64" height="64" rx="14" fill="#111827"/>
                {[["#a78bfa",7],["#63b3ed",18],["#42d9b8",29],["#f2c36b",40],["#fb923c",51]].map(([c,y]) => (
                  <rect key={y} x="8" y={y} width="48" height="7" rx="3" fill={c} opacity="0.85"/>
                ))}
              </svg>
            </div>
          </a>
          <div className="project-copy">
            <p className="project-number">05 · Learning tool</p>
            <h3>OSI Layer Explorer</h3>
            <p>
              An interactive step-by-step walkthrough of how a network packet travels from one PC,
              through every OSI layer, across two LANs via a router, and arrives at another PC.
            </p>
            <ul>
              <li>20-step animated journey through all 7 OSI layers</li>
              <li>Shows encapsulation and decapsulation header-by-header</li>
              <li>Explains the router's Layer 2 / Layer 3 boundary role</li>
              <li>Topology builder: wire up PCs, switches, routers and VLAN trunks, then trace a packet hop by hop</li>
              <li>Keyboard navigation and auto-play mode</li>
            </ul>
            <div className="project-actions">
              <a className="primary-link" href="/osi/">Launch Explorer</a>
            </div>
          </div>
        </article>

        <a className="github-band" href="https://github.com/woshiniaoshen" target="_blank" rel="noreferrer">
          <span>More experiments and coursework</span>
          <strong>Browse all projects on GitHub</strong>
          <span aria-hidden="true">↗</span>
        </a>
      </section>

      <section className="portfolio-values" id="values">
        <div className="section-heading">
          <p>How I work</p>
          <h2>Reliable thinking under real constraints</h2>
        </div>
        <div className="value-grid">
          <article>
            <span>01</span>
            <h3>Problem solving</h3>
            <p>I break complex technical issues into smaller, testable steps and keep working until the underlying cause is clear.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Ethical security</h3>
            <p>I believe effective cybersecurity starts with responsible conduct, clear rules, and respect for people and their boundaries.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Team contribution</h3>
            <p>I communicate openly, support shared goals, and value the different strengths that each person brings to a team.</p>
          </article>
        </div>
      </section>

      <section className="portfolio-about" id="about">
        <div className="section-heading">
          <p>About</p>
          <h2>Security-minded, practical, and always learning</h2>
        </div>
        <div className="about-grid">
          <div className="about-copy">
            <p>
              I am a problem-solver and team player who is passionate about protecting organisations and
              the people within them. I value ethical conduct, responsibility, respect for others, and
              following sound processes.
            </p>
            <p>
              I hold a Diploma in Infocomm and Media Engineering, specialising in Cloud and Infrastructure
              Services. I am currently pursuing a Bachelor of Science in Computer Science at Singapore
              Management University and completing the Google Cybersecurity Certificate.
            </p>
          </div>
          <div className="experience-list">
            <div>
              <span>Industry</span>
              <strong>Nokia Solutions and Networks</strong>
              <p>Internship experience</p>
            </div>
            <div>
              <span>Education</span>
              <strong>Singapore Management University</strong>
              <p>BSc Computer Science · Cybersecurity track</p>
            </div>
            <div>
              <span>Education</span>
              <strong>Nanyang Polytechnic</strong>
              <p>Diploma in Infocomm &amp; Media Engineering · Cloud and Infrastructure Services</p>
            </div>
          </div>
        </div>
        <div className="skill-list" aria-label="Skills">
          {skills.map((skill) => <span key={skill}>{skill}</span>)}
        </div>
      </section>

      <footer className="portfolio-footer">
        <div>
          <strong>Nelson Tan</strong>
          <span>Singapore</span>
        </div>
        <div>
          <a href="https://github.com/woshiniaoshen" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://www.linkedin.com/in/nelson-tan-b58170206/" target="_blank" rel="noreferrer">LinkedIn</a>
        </div>
      </footer>
    </main>
  );
}
