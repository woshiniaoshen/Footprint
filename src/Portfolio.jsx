import "./portfolio.css";

const skills = [
  "Cybersecurity",
  "Cloud Infrastructure",
  "Attack Detection",
  "JavaScript",
  "Python",
  "Java",
  "Docker",
  "AWS",
  "Networking",
  "UX Design",
];

export default function Portfolio() {
  return (
    <main className="portfolio-shell">
      <header className="portfolio-nav">
        <a className="portfolio-name" href="#top" aria-label="Nelson Tan home">NT</a>
        <nav aria-label="Main navigation">
          <a href="#work">Work</a>
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
        <div className="hero-signal" aria-label="Current focus">
          <span>Current focus</span>
          <strong>Understanding attacks to build stronger defenses.</strong>
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

        <a className="github-band" href="https://github.com/woshiniaoshen" target="_blank" rel="noreferrer">
          <span>More experiments and coursework</span>
          <strong>Browse all projects on GitHub</strong>
          <span aria-hidden="true">↗</span>
        </a>
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
