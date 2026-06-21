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
            <p className="project-number">02 Â· Polytechnic project</p>
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
