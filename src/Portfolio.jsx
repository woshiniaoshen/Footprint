import "./portfolio.css";

const GITHUB = "https://github.com/woshiniaoshen";
const LINKEDIN = "https://www.linkedin.com/in/nelson-tan-b58170206/";

const projects = [
  {
    name: "NetWatch",
    type: "Security",
    summary: "A simulated network intrusion detection dashboard. Detection rules run over 600+ generated TCP and UDP events to flag port scans, brute-force logins and data exfiltration, with severity alerts per source IP.",
    stack: ["React", "Detection rules", "Traffic analytics"],
    links: [{ label: "Open dashboard", href: "/netwatch/" }],
  },
  {
    name: "Wireshark Companion",
    type: "Security tool",
    summary: "Analyses .pcap and .pcapng captures entirely in the browser. A hand-written binary parser decodes Ethernet, IP, TCP and UDP headers, then summarises protocols, top talkers and a traffic timeline. Files never leave the device.",
    stack: ["JavaScript", "Binary parsing", "React"],
    links: [{ label: "Open tool", href: "/wireshark/" }],
  },
  {
    name: "OSI Layer Explorer",
    type: "Teaching tool",
    summary: "Steps through how a packet crosses all seven OSI layers between two LANs, showing each header as it is added and removed. Includes a topology builder for switches, routers, VLAN trunks and DHCP.",
    stack: ["React", "Networking", "VLANs"],
    links: [{ label: "Open explorer", href: "/osi/" }],
  },
  {
    name: "Hardware Store",
    type: "Coursework · Nanyang Polytechnic",
    summary: "An e-commerce site built in PHP and MySQL with product search, user accounts, sessions and image uploads. Shown here as a read-only demo.",
    stack: ["PHP", "MySQL", "HTML/CSS", "JavaScript"],
    links: [
      { label: "View demo", href: "/projects/hardware-store/" },
      { label: "Source", href: "https://github.com/woshiniaoshen/Poly-php-project", external: true },
    ],
  },
];

const background = [
  {
    heading: "Experience",
    items: [
      { period: "2022 – 2023", org: "Nokia Solutions and Networks", detail: "System Engineer Intern, Sep 2022 – Apr 2023" },
    ],
  },
  {
    heading: "Education",
    items: [
      { period: "2025 – 2029", org: "Singapore Management University", detail: "BSc Computer Science, Cybersecurity track", status: "In progress" },
      { period: "2020 – 2023", org: "Nanyang Polytechnic", detail: "Diploma with Merit in Infocomm & Media Engineering, Cloud and Infrastructure Services · Director's List, three consecutive semesters" },
    ],
  },
  {
    heading: "Certifications",
    items: [
      {
        period: "2026",
        org: "Google Cybersecurity Certificate",
        detail: "Coursera",
        status: "In progress",
        courses: [
          { name: "Foundations of Cybersecurity", date: "May 2026", href: "https://coursera.org/verify/ZA07YAJ39M2F" },
          { name: "Play It Safe: Manage Security Risks", date: "Jul 2026", href: "https://coursera.org/verify/9WKZ25SOVCQD" },
          { name: "Connect and Protect: Networks and Network Security", date: "Jul 2026", href: "https://coursera.org/verify/LXD64Q13JJ5L" },
        ],
      },
      { period: "Dec 2022", org: "Google IT Support Specialization", detail: "Coursera · 5 courses, including IT Security and Computer Networking", href: "https://www.coursera.org/account/accomplishments/specialization/certificate/SK3WM4BMRK5Y" },
    ],
  },
];

const skills = [
  { group: "Security", items: "Attack detection, packet analysis, security risk management, network security" },
  { group: "Networking", items: "Cisco IOS routing and switching, VLANs, DHCP, DNS (BIND), Apache, IIS" },
  { group: "Systems", items: "AWS, Docker, VMware ESXi, Windows Server, Active Directory, Ubuntu" },
  { group: "Programming", items: "JavaScript, Python, Java, C#, PHP, PowerShell, SQL" },
  { group: "Tools", items: "React, MySQL, SQL Server, Cloudflare, UX design" },
  { group: "Spoken", items: "English, Chinese" },
];

function ProjectLink({ href, label, external }) {
  return (
    <a className="link" href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {label} <span aria-hidden="true">{external ? "↗" : "→"}</span>
    </a>
  );
}

export default function Portfolio() {
  return (
    <div className="page">
      <header className="site-header">
        <div className="container header-inner">
          <a className="wordmark" href="#top" aria-label="Nelson Tan, home">
            <span className="monogram" aria-hidden="true">NT</span>
            Nelson Tan
          </a>
          <nav aria-label="Main navigation">
            <a href="#projects">Projects</a>
            <a href="#experience">Experience</a>
            <a href="#about">About</a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="container hero">
          <p className="meta">Singapore · Computer Science, SMU</p>
          <h1>Nelson Tan</h1>
          <p className="lead">
            I study Computer Science at Singapore Management University on the cybersecurity track.
            I build tools for understanding networks and the security problems in them. Before university
            I interned as a system engineer at Nokia Solutions and Networks.
          </p>
          <div className="actions">
            <a className="button button-primary" href="#projects">View projects</a>
            <a className="button" href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
            <a className="button" href={LINKEDIN} target="_blank" rel="noreferrer">LinkedIn</a>
          </div>
        </section>

        <section className="section" id="projects">
          <div className="container">
            <h2 className="section-title">Projects</h2>

            <article className="featured">
              <div className="featured-copy">
                <p className="meta">Web app · Featured</p>
                <h3>Footprint</h3>
                <p>
                  Upload photos and see where they were taken on a map. Footprint reads GPS data from
                  photo metadata, including HEIC and Xiaomi motion photos, builds personal and global
                  heatmaps, and lets friends share their trips.
                </p>
                <ul className="stack" aria-label="Technologies">
                  {["React", "Vite", "Firebase", "Cloudflare Pages"].map(s => <li key={s}>{s}</li>)}
                </ul>
                <div className="links">
                  <ProjectLink href="/footprint/" label="Open app" />
                  <ProjectLink href="https://github.com/woshiniaoshen/Footprint" label="Source" external />
                </div>
              </div>
              <a className="featured-image" href="/footprint/" aria-label="Open Footprint">
                <img src="/footprint-preview.png" alt="Footprint showing photo pins on a world map" />
              </a>
            </article>

            <div className="project-grid">
              {projects.map(p => (
                <article className="project" key={p.name}>
                  <p className="meta">{p.type}</p>
                  <h3>{p.name}</h3>
                  <p>{p.summary}</p>
                  <ul className="stack" aria-label="Technologies">
                    {p.stack.map(s => <li key={s}>{s}</li>)}
                  </ul>
                  <div className="links">
                    {p.links.map(l => <ProjectLink key={l.label} {...l} />)}
                  </div>
                </article>
              ))}
            </div>

            <p className="more">
              More coursework and experiments are on <a className="inline-link" href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>.
            </p>
          </div>
        </section>

        <section className="section" id="experience">
          <div className="container two-col">
            <h2 className="section-title">Experience &amp; education</h2>
            <div className="background">
              {background.map(group => (
                <div key={group.heading}>
                  <h3 className="group-title">{group.heading}</h3>
                  <ol className="timeline">
                    {group.items.map(e => (
                      <li key={e.org}>
                        <span className="meta">{e.period}</span>
                        <div>
                          <strong>{e.org}</strong>
                          <p>
                            {e.detail}
                            {e.status && <span className="status">{e.status}</span>}
                            {e.href && <> · <a className="inline-link" href={e.href} target="_blank" rel="noreferrer">Verify</a></>}
                          </p>
                          {e.courses && (
                            <ul className="courses" aria-label="Completed courses">
                              {e.courses.map(c => (
                                <li key={c.name}>
                                  <span>{c.name}</span>
                                  <span className="course-meta">
                                    {c.date} · <a className="inline-link" href={c.href} target="_blank" rel="noreferrer">Verify</a>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="about">
          <div className="container two-col">
            <h2 className="section-title">About</h2>
            <div>
              <div className="prose">
                <p>
                  I came to security through cloud infrastructure. My diploma at Nanyang Polytechnic
                  focused on cloud and infrastructure services, and I am now studying how systems are
                  attacked so I can defend them better.
                </p>
                <p>
                  I like breaking problems into small, testable steps and staying with them until the
                  root cause is clear. I take the ethical side of security seriously: responsible conduct,
                  clear rules and respect for the people behind the systems.
                </p>
              </div>
              <dl className="skills">
                {skills.map(s => (
                  <div key={s.group}>
                    <dt>{s.group}</dt>
                    <dd>{s.items}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <span>© {new Date().getFullYear()} Nelson Tan</span>
          <div>
            <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
            <a href={LINKEDIN} target="_blank" rel="noreferrer">LinkedIn</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
